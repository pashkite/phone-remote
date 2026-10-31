package com.galaxyremote.app.display

/** Typed, single-pointer lease. No command strings, arbitrary displays or unbounded input. */
internal data class TouchGeometry(val width: Int, val height: Int, val rotation: Int) {
    fun valid() = width in 1..16384 && height in 1..16384 && rotation in 0..3
}
internal data class ShellMotion(val action: Int, val x: Float, val y: Float, val downAt: Long, val at: Long)
internal class ShellTouchState(private val emit: (ShellMotion) -> Boolean) {
    private var token = 0L
    private var active = false
    private var deadline = 0L
    private var downAt: Long? = null
    private var geometry: TouchGeometry? = null
    private var x = 0f
    private var y = 0f
    private var lastSeen = 0L
    private var lastUptime = 0L

    fun prepare(consent: Boolean, now: Long): Long {
        check(consent) { "SHELL_TOUCH_CONSENT_REQUIRED" }
        stop(); token++; active = true; deadline = now + 30_000
        return token
    }
    fun extendForOff(seconds: Int, now: Long) {
        check(active) { "SHELL_TOUCH_NOT_PREPARED" }
        require(seconds in 10..330)
        deadline = now + seconds * 1000L
    }
    fun inject(id: Long, action: Int, nx: Float, ny: Float, size: TouchGeometry,
               now: Long, uptime: Long, ownerAlive: Boolean, heartbeatFresh: Boolean): Boolean {
        if (id != token) return false // an old trial must not cancel/re-arm a newer pointer
        if (!active || now >= deadline || !ownerAlive || !heartbeatFresh) { stop(); return false }
        if (action !in 0..3 || !nx.isFinite() || !ny.isFinite() || nx !in 0f..1f || ny !in 0f..1f || !size.valid()) {
            cancel(); return false
        }
        if ((action == 0) != (downAt == null) || (geometry != null && geometry != size)) { cancel(); return false }
        if (action == 0) { downAt = uptime; geometry = size }
        x = nx * (size.width - 1); y = ny * (size.height - 1)
        lastSeen = now; lastUptime = uptime
        val accepted = try { emit(ShellMotion(action, x, y, downAt!!, uptime)) } catch (_: Exception) { false }
        if (!accepted) { cancel(); return false }
        if (action == 1 || action == 3) { downAt = null; geometry = null }
        return true
    }
    fun release(id: Long): Boolean = if (id == token) cancel() else false
    fun tick(now: Long, uptime: Long, ownerAlive: Boolean, heartbeatFresh: Boolean) {
        lastUptime = uptime
        if (!ownerAlive || !heartbeatFresh || now >= deadline) stop()
        else if (downAt != null && now - lastSeen >= 1500) cancel()
    }
    fun stop(): Boolean { active = false; return cancel() }
    private fun cancel(): Boolean {
        val down = downAt ?: return true
        downAt = null; geometry = null
        return try { emit(ShellMotion(3, x, y, down, lastUptime.coerceAtLeast(down))) } catch (_: Exception) { false }
    }
}

internal object ShellTouchPolicy {
    fun requireOffDuration(selected: Boolean, seconds: Int) {
        check(!selected || seconds == 30) { "SHELL_TOUCH_SHORT_TRIAL_ONLY" }
    }
}
