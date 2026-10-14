package com.galaxyremote.app
import android.app.Activity
import android.os.Bundle
import android.view.MotionEvent
import android.view.View

/** Debug-only touch target. No production permissions or exported component changes. */
class TouchProbeActivity : Activity() {
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        android.util.Log.i("LiveTouchProbe", "window focus=$hasFocus")
        getSharedPreferences("touch_probe", MODE_PRIVATE).edit().putBoolean("ready", hasFocus).commit()
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("touch_probe", MODE_PRIVATE)
        prefs.edit().clear().commit()
        setContentView(object : View(this) {
            override fun onTouchEvent(event: MotionEvent): Boolean {
                android.util.Log.i("LiveTouchProbe", "touch action=${event.actionMasked}")
                val key = when(event.actionMasked) { MotionEvent.ACTION_DOWN -> "down"; MotionEvent.ACTION_MOVE -> "move"; MotionEvent.ACTION_UP -> "up"; MotionEvent.ACTION_CANCEL -> "cancel"; else -> "other" }
                prefs.edit().putInt(key, prefs.getInt(key, 0) + 1).putFloat("x", event.x).commit()
                return true
            }
        })
    }
}
