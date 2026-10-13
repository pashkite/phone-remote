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
    private var active = true
    private var highestSequence = 0L
    fun receive(command: JSONObject) {
        main.post {
            if (!active) return@post
            val id = command.optString("id")
            if (id.isBlank()) { handle(command) { _, _ -> }; return@post }
            if (command.optInt("v") != 1 || !id.matches(Regex("[0-9a-f-]{36}"))) return@post
            results[id]?.let { send(it); return@post }
            val sequence = command.optLong("seq", -1)
            if (sequence <= highestSequence || sequence <= 0) {
                send(JSONObject().put("type", "ack").put("v", 1).put("id", id).put("status", "failed").put("code", "STALE_COMMAND"))
                return@post
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
    }
    fun close() { active = false; main.removeCallbacksAndMessages(null); results.clear() }
}
