package com.galaxyremote.app.display

import android.os.Process
import android.view.InputDevice
import android.view.InputEvent
import android.view.MotionEvent

/** Shell UserService only. Missing/denied framework APIs fail closed; no hidden-API exemptions. */
internal class ShellTouchInjector {
    private var lastResult = "NOT_PREPARED"
    private var lastFailure = "none"
    private var manager: Any? = null
    private var inject: java.lang.reflect.Method? = null
    private var displays: Any? = null
    private var info: java.lang.reflect.Method? = null
    private var displayId: java.lang.reflect.Method? = null

    fun prepare() {
        check(Process.myUid() == 2000) { "SHELL_ONLY_NO_ROOT" }
        lastFailure = "none"
        try {
            val type = Class.forName("android.hardware.input.InputManagerGlobal")
            manager = type.getMethod("getInstance").invoke(null)
            inject = type.getMethod("injectInputEvent", InputEvent::class.java, Int::class.javaPrimitiveType)
            val dm = Class.forName("android.hardware.display.DisplayManagerGlobal")
            displays = dm.getMethod("getInstance").invoke(null)
            info = dm.getMethod("getDisplayInfo", Int::class.javaPrimitiveType)
            displayId = InputEvent::class.java.getMethod("setDisplayId", Int::class.javaPrimitiveType)
            check(geometry().valid())
            lastResult = "API_RESOLVED_NOT_DEVICE_VERIFIED"
        } catch (error: Exception) { lastFailure = error.javaClass.simpleName; throw IllegalStateException("SHELL_TOUCH_UNSUPPORTED", error) }
    }
    fun geometry(): TouchGeometry {
        val value = info?.invoke(displays, 0) ?: error("SHELL_TOUCH_UNSUPPORTED")
        return TouchGeometry(value.javaClass.getField("logicalWidth").getInt(value),
            value.javaClass.getField("logicalHeight").getInt(value), value.javaClass.getField("rotation").getInt(value))
    }
    fun diagnostics() = "shell touch: display=0; mode=single-pointer; result=$lastResult; lastFailure=$lastFailure\nAPI 접수는 대상 앱 반응·펌웨어 호환성의 증거가 아닙니다."
    fun emit(motion: ShellMotion): Boolean {
        check(Process.myUid() == 2000) { "SHELL_ONLY_NO_ROOT" }
        val properties = MotionEvent.PointerProperties().apply { id = 0; toolType = MotionEvent.TOOL_TYPE_FINGER }
        val coordinates = MotionEvent.PointerCoords().apply {
            x = motion.x; y = motion.y; pressure = if (motion.action in setOf(1, 3)) 0f else 1f; size = 1f
        }
        val event = MotionEvent.obtain(motion.downAt, maxOf(motion.at, android.os.SystemClock.uptimeMillis()), motion.action, 1,
            arrayOf(properties), arrayOf(coordinates), 0, 0, 1f, 1f, -1, 0, InputDevice.SOURCE_TOUCHSCREEN, 0)
        return try {
            (displayId ?: error("SHELL_TOUCH_UNSUPPORTED")).invoke(event, 0)
            // Asynchronous injection avoids blocking the restoration timer on Android dispatch waits.
            // true is framework acceptance, never proof of target-app delivery.
            (inject?.invoke(manager, event, 0) == true).also {
                lastResult = if (it) "API_ACCEPTED" else "API_REJECTED"
                if (!it) lastFailure = "API_RETURNED_FALSE"
            }
        } catch (error: Exception) {
            val cause = (error as? java.lang.reflect.InvocationTargetException)?.targetException ?: error
            lastFailure = if (cause is SecurityException) "INJECT_PERMISSION_DENIED" else cause.javaClass.simpleName
            lastResult = "API_ERROR"
            false
        } finally { event.recycle() }
    }
}
