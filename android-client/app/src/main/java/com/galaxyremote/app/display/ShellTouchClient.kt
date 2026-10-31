package com.galaxyremote.app.display

import android.os.SystemClock
import com.galaxyremote.app.interaction.InteractionDiagnostics
import com.galaxyremote.app.interaction.InteractionTrace
import org.json.JSONObject
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** One trial, one bounded worker. Control strings never cross into the shell service. */
internal class ShellTouchClient(private val remote: IPanelService, private val trial: Long, private val diagnostics: (String) -> Unit) {
    @Volatile private var active = true
    @Volatile private var streamId: String? = null
    private var pointerSequence = 0L
    private val pointerGeneration = java.util.concurrent.atomic.AtomicLong()
    private val releasePending = java.util.concurrent.atomic.AtomicBoolean(false)
    private val jobs = ArrayBlockingQueue<Runnable>(32)
    private val worker = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, jobs)

    val isActive: Boolean get() = active
    fun accepts(type: String) = type in setOf("touch", "pointerFrame", "tap", "longPress", "swipe")
    fun submit(command: JSONObject, finish: (Boolean, String?) -> Unit) {
        if (!active) { finish(false, "SHELL_TOUCH_QUEUE_CLOSED"); return }
        val generation = pointerGeneration.get()
        val queuedAt = SystemClock.elapsedRealtime()
        val origin = InteractionDiagnostics.trace.currentPhase()
        val copy = JSONObject(command.toString())
        val job = object : Runnable {
            private var finished = false
            @Synchronized fun done(ok: Boolean, code: String?) { if (!finished) { finished = true; finish(ok, code) } }
            override fun run() {
                if (generation != pointerGeneration.get()) { done(false, "SHELL_TOUCH_STALE"); return }
                if (!active || SystemClock.elapsedRealtime() - queuedAt > 1500) {
                    if (active) { try { remote.releaseTouch(trial) } catch (_: Exception) { }; streamId = null }
                    done(false, "SHELL_TOUCH_STALE"); return
                }
                try { execute(copy, origin, generation); done(true, null) }
                catch (error: Exception) {
                    try { remote.releaseTouch(trial) } catch (_: Exception) { }
                    streamId = null
                    try { diagnostics(remote.touchDiagnostics()) } catch (_: Exception) { }
                    done(false, if (error.message == "SHELL_SINGLE_POINTER_ONLY") "SHELL_SINGLE_POINTER_ONLY" else "SHELL_TOUCH_REJECTED")
                }
            }
        }
        try { worker.execute(job) }
        catch (_: java.util.concurrent.RejectedExecutionException) { close(); job.done(false, "SHELL_TOUCH_QUEUE_CLOSED") }
    }
    private fun send(action: Int, x: Float, y: Float, origin: InteractionTrace.Phase, generation: Long) {
        check(active && generation == pointerGeneration.get()) { "SHELL_TOUCH_STALE" }
        val accepted = try { remote.injectTouch(trial, action, x, y) } catch (error: Exception) {
            InteractionDiagnostics.trace.record(InteractionTrace.Kind.SHELL_TOUCH, InteractionTrace.Result.ERROR, origin)
            throw error
        }
        InteractionDiagnostics.trace.record(InteractionTrace.Kind.SHELL_TOUCH,
            if (accepted) InteractionTrace.Result.SUBMITTED else InteractionTrace.Result.REJECTED, origin)
        check(accepted) { "SHELL_TOUCH_REJECTED" }
    }
    private fun coordinate(value: JSONObject, key: String): Float {
        require(value.opt(key) is Number)
        val number = value.optDouble(key)
        require(number.isFinite() && number in 0.0..1.0)
        return number.toFloat()
    }
    private fun streamed(id: String, phase: String, x: Float, y: Float, origin: InteractionTrace.Phase, generation: Long) {
        require(id.matches(Regex("[A-Za-z0-9:_-]{1,48}")))
        val action = when (phase) { "down" -> 0; "up" -> 1; "move" -> 2; "cancel" -> 3; else -> error("INVALID_PHASE") }
        check(if (action == 0) streamId == null else streamId == id) { "INVALID_POINTER_STATE" }
        send(action, x, y, origin, generation)
        check(generation == pointerGeneration.get())
        streamId = if (action in setOf(1, 3)) null else id
    }
    private fun execute(command: JSONObject, origin: InteractionTrace.Phase, generation: Long) {
        when (command.optString("type")) {
            "touch" -> streamed(command.optString("touchId"), command.optString("phase"), coordinate(command,"x"), coordinate(command,"y"), origin, generation)
            "pointerFrame" -> {
                val raw = (command.opt("pointerSeq") as? Number)?.toDouble() ?: error("INVALID_SEQUENCE")
                check(raw.isFinite() && raw in 1.0..9007199254740991.0 && raw == kotlin.math.floor(raw) && raw > pointerSequence)
                pointerSequence = raw.toLong()
                val points = command.getJSONArray("points")
                check(points.length() <= 1) { "SHELL_SINGLE_POINTER_ONLY" }
                if (points.length() == 0) { check(remote.releaseTouch(trial)); streamId = null }
                else {
                    val point = points.getJSONObject(0)
                    streamed(point.optString("pointerId"),point.optString("phase"),coordinate(point,"x"),coordinate(point,"y"),origin,generation)
                }
            }
            else -> {
                check(streamId == null)
                val swipe = command.optString("type") == "swipe"
                val x = coordinate(command, if (swipe) "fromX" else "x")
                val y = coordinate(command, if (swipe) "fromY" else "y")
                val endX = if (swipe) coordinate(command,"toX") else x
                val endY = if (swipe) coordinate(command,"toY") else y
                val duration = when (command.optString("type")) {
                    "tap" -> 60L
                    "longPress" -> command.optLong("durationMs",650).coerceIn(500,1200)
                    "swipe" -> command.optLong("durationMs",300).coerceIn(80,1200)
                    else -> error("UNSUPPORTED_COMMAND")
                }
                send(0,x,y,origin,generation)
                val begin = SystemClock.elapsedRealtime()
                while (true) {
                    Thread.sleep(16) // bounded worker; restoration and the UI use separate threads
                    check(active && generation == pointerGeneration.get())
                    val elapsed = SystemClock.elapsedRealtime() - begin
                    if (elapsed >= duration) break
                    if (swipe) {
                        val progress = elapsed.toFloat() / duration
                        send(2,x+(endX-x)*progress,y+(endY-y)*progress,origin,generation)
                    }
                }
                send(1,endX,endY,origin,generation)
            }
        }
    }
    @Synchronized fun close() {
        if (!active) return
        active = false
        // Run retained jobs only to return a failed result; active=false prevents injection.
        worker.shutdown()
        // Fixed one-shot release on a separate worker; cannot wait behind a hold/swipe job.
        cancelPointers()
    }
    fun cancelPointers() {
        pointerGeneration.incrementAndGet()
        streamId = null
        if (releasePending.compareAndSet(false, true)) releaseWorker.execute {
            try { remote.releaseTouch(trial) } catch (_: Exception) { }
            finally { releasePending.set(false) }
        }
    }
    companion object {
        private val releaseWorker = java.util.concurrent.Executors.newSingleThreadExecutor()
    }
}
