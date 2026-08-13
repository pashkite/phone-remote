package com.galaxyremote.app

import android.content.ComponentName
import android.content.Context
import android.graphics.Color
import android.inputmethodservice.InputMethodService
import android.provider.Settings
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import org.json.JSONObject

class RemoteKeyboardService : InputMethodService() {
    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onCreateInputView(): View {
        return TextView(this).apply {
            text = "Galaxy Remote 키보드 사용 중\nPC에서 입력하면 현재 칸에 바로 전달됩니다."
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.rgb(31, 50, 78))
            setPadding(24, 28, 24, 28)
            textSize = 14f
        }
    }

    private fun handle(command: JSONObject): Boolean {
        val connection = currentInputConnection ?: return false
        return when (command.optString("type")) {
            "text" -> {
                val value = command.optString("value").take(2_000)
                value.isNotEmpty() && connection.commitText(value, 1)
            }
            "key" -> when (command.optString("key")) {
                "backspace" -> connection.deleteSurroundingText(1, 0) || sendKey(connection, KeyEvent.KEYCODE_DEL)
                "delete" -> connection.deleteSurroundingText(0, 1) || sendKey(connection, KeyEvent.KEYCODE_FORWARD_DEL)
                "enter" -> {
                    val action = currentInputEditorInfo?.imeOptions?.and(EditorInfo.IME_MASK_ACTION)
                        ?: EditorInfo.IME_ACTION_NONE
                    if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
                        connection.performEditorAction(action)
                    } else {
                        sendKey(connection, KeyEvent.KEYCODE_ENTER)
                    }
                }
                else -> false
            }
            else -> false
        }
    }

    private fun sendKey(
        connection: android.view.inputmethod.InputConnection,
        keyCode: Int,
    ): Boolean {
        val now = android.os.SystemClock.uptimeMillis()
        val down = connection.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
        val up = connection.sendKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
        return down || up
    }

    companion object {
        @Volatile
        private var instance: RemoteKeyboardService? = null

        fun dispatch(command: JSONObject): Boolean = instance?.handle(command) ?: false

        fun isEnabled(context: Context): Boolean {
            val manager = context.getSystemService(InputMethodManager::class.java)
            return manager.enabledInputMethodList.any { it.packageName == context.packageName }
        }

        fun isSelected(context: Context): Boolean {
            val selected = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.DEFAULT_INPUT_METHOD,
            ) ?: return false
            val component = ComponentName(context, RemoteKeyboardService::class.java)
            return selected == component.flattenToString() || selected == component.flattenToShortString()
        }
    }
}
