package com.galaxyremote.app

import android.os.Handler
import android.os.Looper
import org.json.JSONObject

class RemoteCommandProcessor(
    private val send: (JSONObject) -> Unit,
    private val handle: (JSONObject, (Boolean, String?) -> Unit) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val results = linkedMapOf<String, JSONObject>()
    @Volatile private var active = true
    private var highestSequence = 0L
    private val inbox = com.galaxyremote.app.streaming.BoundedInputQueue<JSONObject>(64) {
        if (it.optString("type") == "touch" && it.optString("phase") == "move") it.optString("touchId") else null
    }
    private var draining = false
    private var overflow = false
    fun receive(command: JSONObject) {
        synchronized(inbox) {
            if (!active) return
            if (!inbox.offer(command)) { inbox.clear(); overflow = true }
            if (draining) return
            draining = true
        }
        main.post(::drain)
    }
    private fun drain() {
        val batch = synchronized(inbox) {
            if (overflow) { RemoteAccessibilityService.stopTouch(); overflow = false }
            List(8) { inbox.poll() }.filterNotNull()
        }
        batch.forEach(::process)
        synchronized(inbox) {
            if (inbox.size > 0) main.post(::drain) else draining = false
        }
    }
    private fun process(command: JSONObject) {
        if (!active) return
        val id = command.optString("id")
        if (id.isBlank()) { try { handle(command) { _, _ -> } } catch (_: Exception) { RemoteAccessibilityService.stopTouch() }; return }
        if (command.optInt("v") != 1 || !id.matches(Regex("[0-9a-f-]{36}"))) return
        results[id]?.let { send(it); return }
        val sequence = command.optLong("seq", -1)
        if (sequence <= highestSequence || sequence <= 0) {
            send(JSONObject().put("type", "ack").put("v", 1).put("id", id).put("status", "failed").put("code", "STALE_COMMAND"))
            return
        }
        highestSequence = sequence
        if (results.size >= 512) results.remove(results.keys.first())
        fun ack(status: String, code: String? = null) {
            if (!active) return
            val value = JSONObject().put("type", "ack").put("v", 1).put("id", id).put("status", status)
            if (code != null) value.put("code", code)
            results[id] = value; send(value)
        }
        ack("received")
        var finished = false
        val timeout = Runnable { if (!finished) { finished = true; ack("failed", "PROCESSING_TIMEOUT") } }
        main.postDelayed(timeout, 5000)
        try {
            ack("accepted")
            handle(command) { success, code ->
                main.post {
                    if (!finished && active) { finished = true; main.removeCallbacks(timeout); ack(if (success) "completed" else "failed", code) }
                }
            }
        } catch (_: Exception) { finished = true; main.removeCallbacks(timeout); ack("failed", "ANDROID_ERROR") }
    }
    fun close() { active = false; synchronized(inbox) { inbox.clear(); draining = false }; main.removeCallbacksAndMessages(null); main.post { results.clear() } }
}
