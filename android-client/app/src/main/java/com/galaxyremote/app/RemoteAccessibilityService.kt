package com.galaxyremote.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.content.ClipData
import android.content.ClipboardManager
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

class RemoteAccessibilityService : AccessibilityService() {
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pointerFault: ((String) -> Unit)? = null
    private val multiTouch: com.galaxyremote.app.interaction.PointerBackend by lazy { com.galaxyremote.app.interaction.MultiPointerController(this, mainHandler, ::screenSize) { pointerFault?.invoke(it) } }
    private val liveTouch by lazy { LiveTouchController(this, mainHandler, ::screenSize) }
    private var savedClipboard: ClipData? = null
    private var clipboardCaptured = false
    private val restoreClipboard = Runnable {
        val clipboard = getSystemService(ClipboardManager::class.java)
        try {
            if (savedClipboard != null) clipboard.setPrimaryClip(savedClipboard!!)
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) clipboard.clearPrimaryClip()
        } catch (_: Exception) {
            // Clipboard access can be restricted by the current foreground app.
        } finally {
            savedClipboard = null
            clipboardCaptured = false
        }
    }

    override fun onServiceConnected() {
        instance = this
        pendingPointerSession?.let { multiTouch.begin(it); pointerFault = pendingPointerFault }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() { liveTouch.release(); multiTouch.release(); pointerFault?.invoke("ACCESSIBILITY_INTERRUPTED") }

    override fun onDestroy() {
        liveTouch.release(); multiTouch.release(); pointerFault?.invoke("ACCESSIBILITY_DISABLED"); pointerFault = null
        mainHandler.removeCallbacks(restoreClipboard)
        if (clipboardCaptured) restoreClipboard.run()
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun acceptPointerFrame(command: JSONObject): Boolean {
        val seq=(command.opt("pointerSeq") as? Number)?.toDouble() ?: return false
        if(!seq.isFinite() || seq < 1 || seq > 9007199254740991.0 || seq != kotlin.math.floor(seq))return false
        val points=command.optJSONArray("points") ?: return false
        if(points.length()>5)return false
        val events=mutableListOf<com.galaxyremote.app.interaction.PointerEvent>()
        for(i in 0 until points.length()) {
            val p=points.optJSONObject(i) ?: return false
            if(p.opt("x") !is Number || p.opt("y") !is Number)return false
            events += com.galaxyremote.app.interaction.PointerEvent(p.optString("pointerId"),p.optString("phase"),p.optDouble("x"),p.optDouble("y"))
        }
        return multiTouch.accept(command.optString("sessionId"),seq.toLong(),events)
    }

    private fun handle(command: JSONObject): Boolean {
        if (!RemotePreferences(this).standbyActive) return false
        return when (command.optString("type")) {
            "pointerFrame" -> { liveTouch.release(); val ok=acceptPointerFrame(command); if(!ok)multiTouch.release(); ok }
            "touch" -> { multiTouch.release(); liveTouch.receive(command) }
            "tap" -> tap(command.optDouble("x"), command.optDouble("y"))
            "longPress" -> longPress(
                command.optDouble("x"),
                command.optDouble("y"),
                command.optLong("durationMs", 650L),
            )
            "swipe" -> swipe(
                command.optDouble("fromX"),
                command.optDouble("fromY"),
                command.optDouble("toX"),
                command.optDouble("toY"),
                command.optLong("durationMs", 300L),
            )
            "global" -> global(command.optString("action"))
            "text" -> pasteFocusedText(command.optString("value"))
            "key" -> when (command.optString("key")) {
                "backspace" -> replaceFocusedText("", true)
                "delete" -> deleteForward()
                "enter" -> pressImeEnter()
                else -> false
            }
            else -> false
        }
    }

    private fun tap(normalizedX: Double, normalizedY: Double, callback: GestureResultCallback? = null): Boolean {
        val (width, height) = screenSize()
        val x = normalizedX.coerceIn(0.0, 1.0).toFloat() * width
        val y = normalizedY.coerceIn(0.0, 1.0).toFloat() * height
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 60))
            .build()
        return dispatchGesture(gesture, callback, mainHandler)
    }

    private fun longPress(normalizedX: Double, normalizedY: Double, durationMs: Long, callback: GestureResultCallback? = null): Boolean {
        val (width, height) = screenSize()
        val x = normalizedX.coerceIn(0.0, 1.0).toFloat() * width
        val y = normalizedY.coerceIn(0.0, 1.0).toFloat() * height
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(
                GestureDescription.StrokeDescription(
                    path,
                    0,
                    durationMs.coerceIn(500L, 1_200L),
                ),
            )
            .build()
        return dispatchGesture(gesture, callback, mainHandler)
    }

    private fun swipe(
        normalizedFromX: Double,
        normalizedFromY: Double,
        normalizedToX: Double,
        normalizedToY: Double,
        durationMs: Long,
        callback: GestureResultCallback? = null,
    ): Boolean {
        val (width, height) = screenSize()
        val path = Path().apply {
            moveTo(
                normalizedFromX.coerceIn(0.0, 1.0).toFloat() * width,
                normalizedFromY.coerceIn(0.0, 1.0).toFloat() * height,
            )
            lineTo(
                normalizedToX.coerceIn(0.0, 1.0).toFloat() * width,
                normalizedToY.coerceIn(0.0, 1.0).toFloat() * height,
            )
        }
        val gesture = GestureDescription.Builder()
            .addStroke(
                GestureDescription.StrokeDescription(
                    path,
                    0,
                    durationMs.coerceIn(80L, 1_200L),
                ),
            )
            .build()
        return dispatchGesture(gesture, callback, mainHandler)
    }

    private fun global(action: String): Boolean {
        val globalAction = when (action) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "lock" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_LOCK_SCREEN else return false
            else -> return false
        }
        return performGlobalAction(globalAction)
    }

    private fun focusedInput(): AccessibilityNodeInfo? {
        return findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
    }

    private fun pasteFocusedText(value: String): Boolean {
        if (value.isEmpty()) return false
        val focused = focusedInput() ?: return false
        if (!focused.isEditable) return false
        val clipboard = getSystemService(ClipboardManager::class.java)
        return try {
            if (!clipboardCaptured) {
                savedClipboard = clipboard.primaryClip
                clipboardCaptured = true
            }
            mainHandler.removeCallbacks(restoreClipboard)
            clipboard.setPrimaryClip(ClipData.newPlainText("Galaxy Remote 2.0 입력", value.take(2_000)))
            val pasted = focused.performAction(AccessibilityNodeInfo.ACTION_PASTE)
            mainHandler.postDelayed(restoreClipboard, 800L)
            pasted || replaceFocusedText(value, false)
        } catch (_: Exception) {
            replaceFocusedText(value, false)
        }
    }

    private fun pressImeEnter(): Boolean {
        val focused = focusedInput() ?: return false
        if (!focused.isEditable || Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
        return focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
    }

    private fun replaceFocusedText(value: String, backspace: Boolean): Boolean {
        val focused = focusedInput() ?: return false
        if (!focused.isEditable) return false
        // Some apps expose their placeholder through `text` even though the
        // field is empty. Never merge remote typing with that visual hint.
        val current = editableText(focused)
        val rawStart = focused.textSelectionStart
        val rawEnd = focused.textSelectionEnd
        val start = if (rawStart in 0..current.length) rawStart else current.length
        val end = if (rawEnd in start..current.length) rawEnd else start
        val next = if (backspace) {
            when {
                start != end -> current.removeRange(start, end)
                start > 0 -> current.removeRange(start - 1, start)
                else -> current
            }
        } else {
            current.substring(0, start) + value.take(2_000) + current.substring(end)
        }
        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, next)
        }
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    private fun deleteForward(): Boolean {
        val focused = focusedInput() ?: return false
        if (!focused.isEditable) return false
        val current = editableText(focused)
        val rawStart = focused.textSelectionStart
        val rawEnd = focused.textSelectionEnd
        val start = if (rawStart in 0..current.length) rawStart else current.length
        val end = if (rawEnd in start..current.length) rawEnd else start
        val next = when {
            start != end -> current.removeRange(start, end)
            end < current.length -> current.removeRange(end, end + 1)
            else -> current
        }
        val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, next)
        }
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
    }

    private fun editableText(focused: AccessibilityNodeInfo): String {
        val current = focused.text?.toString().orEmpty()
        if (focused.isShowingHintText) return ""
        val hint = focused.hintText?.toString().orEmpty()
        return if (hint.isNotEmpty() && current == hint) "" else current
    }

    private fun screenSize(): Pair<Float, Float> {
        val windowManager = getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            return bounds.width().toFloat() to bounds.height().toFloat()
        }
        @Suppress("DEPRECATION")
        return DisplayMetrics().also(windowManager.defaultDisplay::getRealMetrics).let {
            it.widthPixels.toFloat() to it.heightPixels.toFloat()
        }
    }

    companion object {
        @Volatile
        private var instance: RemoteAccessibilityService? = null
        @Volatile private var pendingPointerSession: String? = null
        @Volatile private var pendingPointerFault: ((String) -> Unit)? = null

        fun stopTouch() { instance?.let { it.mainHandler.post { it.liveTouch.release(); it.multiTouch.release() } } }
        fun beginPointerSession(session: String, fault: (String) -> Unit) { pendingPointerSession=session;pendingPointerFault=fault; instance?.let { it.mainHandler.post { it.pointerFault=fault; it.multiTouch.begin(session) } } }
        fun endPointerSession() { pendingPointerSession=null;pendingPointerFault=null; instance?.let { it.mainHandler.post { it.pointerFault=null; it.multiTouch.release() } } }
        fun isConnected(): Boolean = instance != null

        fun dispatch(command: JSONObject): Boolean = instance?.handle(command) ?: false
        fun pasteClipboard(): Boolean = instance?.focusedInput()?.performAction(AccessibilityNodeInfo.ACTION_PASTE) ?: false

        fun dispatchWithResult(command: JSONObject, finish: (Boolean, String?) -> Unit) {
            val service = instance
            if (service == null) { finish(false, "ACCESSIBILITY_DISABLED"); return }
            if (!RemotePreferences(service).standbyActive) { finish(false, "SESSION_INACTIVE"); return }
            val type = command.optString("type")
            if (type in setOf("tap", "longPress", "swipe")) {
                val keys = if (type == "swipe") listOf("fromX", "fromY", "toX", "toY") else listOf("x", "y")
                if (keys.any { !command.optDouble(it).isFinite() || command.optDouble(it) !in 0.0..1.0 }) { finish(false, "INVALID_COORDINATES"); return }
                val callback = object : GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) { finish(true, null) }
                    override fun onCancelled(gestureDescription: GestureDescription?) { finish(false, "GESTURE_CANCELLED") }
                }
                val accepted = when (type) {
                    "tap" -> service.tap(command.optDouble("x"), command.optDouble("y"), callback)
                    "longPress" -> service.longPress(command.optDouble("x"), command.optDouble("y"), command.optLong("durationMs", 650L), callback)
                    else -> service.swipe(command.optDouble("fromX"), command.optDouble("fromY"), command.optDouble("toX"), command.optDouble("toY"), command.optLong("durationMs", 300L), callback)
                }
                if (!accepted) finish(false, "GESTURE_REJECTED")
            } else {
                val success = service.handle(command)
                finish(success, if (success) null else if (type in setOf("text", "key")) "INPUT_UNAVAILABLE" else "ACTION_UNSUPPORTED_OR_REJECTED")
            }
        }

        fun isEnabled(context: Context): Boolean {
            val manager = context.getSystemService(AccessibilityManager::class.java)
            return manager
                .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                .any { service ->
                    val info = service.resolveInfo?.serviceInfo
                    info?.packageName == context.packageName && info.name == RemoteAccessibilityService::class.java.name
                }
        }
    }
}
