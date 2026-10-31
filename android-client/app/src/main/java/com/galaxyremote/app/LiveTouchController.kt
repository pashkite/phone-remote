package com.galaxyremote.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Handler
import org.json.JSONObject
import com.galaxyremote.app.interaction.InteractionDiagnostics
import com.galaxyremote.app.interaction.InteractionTrace.Kind
import com.galaxyremote.app.interaction.InteractionTrace.Result

/** Serial continued strokes keep a single Android pointer down across network samples. */
class LiveTouchController(
    private val service: AccessibilityService,
    private val handler: Handler,
    private val screenSize: () -> Pair<Float, Float>,
    private val fault: (String) -> Unit = {},
) {
    private data class Sample(val touchId: String, val phase: String, val x: Float, val y: Float)
    private val queue = ArrayDeque<Sample>()
    private var acceptingId: String? = null
    private var stroke: GestureDescription.StrokeDescription? = null
    private var x = 0f
    private var y = 0f
    private var busy = false
    private var generation = 0
    private var display: Pair<Float, Float>? = null
    private val watchdog = Runnable { release() }

    fun receive(command: JSONObject): Boolean {
        val id = command.optString("touchId")
        val phase = command.optString("phase")
        val nx = command.optDouble("x")
        val ny = command.optDouble("y")
        if (!id.matches(Regex("[0-9a-f-]{36}")) || phase !in setOf("down", "move", "up", "cancel") ||
            !nx.isFinite() || !ny.isFinite() || nx !in 0.0..1.0 || ny !in 0.0..1.0) return false
        if (phase == "down") {
            if (acceptingId != null || queue.size >= 16) return false
            acceptingId = id
            // Each new down gets the current display size; a rotation cancels a held pointer.
            if (stroke == null && !busy) display = screenSize()
        } else if (acceptingId != id) return false
        val size = display ?: screenSize().also { display = it }
        if (size != screenSize()) { release(); return false }
        val sample = Sample(id, phase, nx.toFloat() * (size.first - 1), ny.toFloat() * (size.second - 1))
        // Bound latency: retain the newest move while a segment is executing, never drop down/up.
        if (phase == "move" && queue.lastOrNull()?.let { it.phase == "move" && it.touchId == id } == true) queue.removeLast()
        if (queue.size >= 16) { release(); return false }
        queue.addLast(sample)
        handler.removeCallbacks(watchdog)
        if (phase == "up" || phase == "cancel") acceptingId = null
        else handler.postDelayed(watchdog, 1500)
        drain()
        return true
    }

    fun release() {
        handler.removeCallbacks(watchdog)
        acceptingId = null
        queue.clear()
        if (stroke != null || busy) {
            // Finish at the last dispatched endpoint, including when disconnect interrupts a segment.
            queue.addLast(Sample("", "cancel", x, y))
            drain()
        } else display = null
    }

    private fun drain() {
        if (busy || queue.isEmpty()) return
        val sample = queue.removeFirst()
        if (sample.phase != "down" && stroke == null) { drain(); return }
        val continuing = sample.phase != "up" && sample.phase != "cancel"
        val path = Path().apply {
            if (sample.phase == "down") moveTo(sample.x, sample.y)
            else { moveTo(x, y); if (x != sample.x || y != sample.y) lineTo(sample.x, sample.y) }
        }
        val next = if (sample.phase == "down") GestureDescription.StrokeDescription(path, 0, 24, true)
            else stroke!!.continueStroke(path, 0, 24, continuing)
        x = sample.x; y = sample.y
        stroke = next
        busy = true
        val token = generation
        val origin = InteractionDiagnostics.trace.currentPhase()
        val callback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                if (token != generation) return
                InteractionDiagnostics.trace.record(Kind.LIVE_TOUCH, Result.COMPLETED, origin)
                busy = false
                if (!continuing) { stroke = null; if (queue.isEmpty()) display = null }
                drain()
            }
            override fun onCancelled(gestureDescription: GestureDescription?) {
                if (token != generation) return
                InteractionDiagnostics.trace.record(Kind.LIVE_TOUCH, Result.CANCELLED, origin)
                reset(token); fault("LIVE_GESTURE_CANCELLED")
            }
        }
        try {
            if (service.dispatchGesture(GestureDescription.Builder().addStroke(next).build(), callback, handler)) {
                InteractionDiagnostics.trace.record(Kind.LIVE_TOUCH, Result.SUBMITTED, origin)
            } else {
                InteractionDiagnostics.trace.record(Kind.LIVE_TOUCH, Result.REJECTED, origin)
                reset(token); fault("LIVE_GESTURE_REJECTED")
            }
        } catch (_: Exception) {
            InteractionDiagnostics.trace.record(Kind.LIVE_TOUCH, Result.ERROR, origin)
            reset(token); fault("LIVE_GESTURE_ERROR")
        }
    }

    private fun reset(token: Int) {
        if (token != generation) return
        generation++
        busy = false; stroke = null; display = null; acceptingId = null
        queue.clear(); handler.removeCallbacks(watchdog)
    }
}
