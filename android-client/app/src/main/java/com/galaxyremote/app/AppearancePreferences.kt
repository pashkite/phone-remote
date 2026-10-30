package com.galaxyremote.app

import android.content.Context
import androidx.appcompat.app.AppCompatDelegate

/** Separate UI preferences: registration and encrypted credentials are untouched. */
class AppearancePreferences(context: Context) {
    private val prefs = context.getSharedPreferences("linro_appearance", Context.MODE_PRIVATE)
    var mode: String
        get() = prefs.getString("mode", "system").takeIf { it in MODES } ?: "system"
        set(value) { if (value in MODES) prefs.edit().putString("mode", value).apply() }
    val nightMode: Int get() = when (mode) {
        "dark" -> AppCompatDelegate.MODE_NIGHT_YES
        "light" -> AppCompatDelegate.MODE_NIGHT_NO
        else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
    }

    companion object { val MODES = listOf("system", "dark", "light") }
}
