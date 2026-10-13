package com.galaxyremote.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

object RemoteDiagnostics {
    private val allowed = setOf("state", "type", "status", "code", "mode", "battery", "pollMs", "requests", "bytes", "appVersion")
    @Synchronized fun record(context: Context, event: String, values: Map<String, Any> = emptyMap()) {
        val prefs = context.getSharedPreferences("remote_diagnostics", Context.MODE_PRIVATE)
        val old = try { JSONArray(prefs.getString("events", "[]")) } catch (_: Exception) { JSONArray() }
        val events = JSONArray()
        for (i in maxOf(0, old.length() - 199) until old.length()) {
            val item = old.optJSONObject(i) ?: continue
            if (System.currentTimeMillis() - item.optLong("at") < 86_400_000) events.put(item)
        }
        val data = JSONObject()
        values.forEach { (key, value) ->
            if (key in allowed && (value is Number || value is Boolean || (value is String && value.matches(Regex("[a-zA-Z0-9_.-]{0,80}"))))) data.put(key, value)
        }
        events.put(JSONObject().put("at", System.currentTimeMillis()).put("event", event.replace(Regex("[^a-zA-Z0-9_.-]"), "").take(60)).put("data", data))
        prefs.edit().putString("events", events.toString()).apply()
    }
    fun export(context: Context): String {
        record(context, "diagnostics_export")
        return JSONObject().put("format", 1).put("platform", "android")
        .put("appVersion", BuildConfig.VERSION_NAME)
        .put("events", JSONArray(context.getSharedPreferences("remote_diagnostics", Context.MODE_PRIVATE).getString("events", "[]"))).toString(2)
    }
}
