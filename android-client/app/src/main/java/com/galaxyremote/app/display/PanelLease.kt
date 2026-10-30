package com.galaxyremote.app.display

/** Pure safety gate. Every new owner must redo recovery preflight and local consent. */
class PanelLease {
    var checked = false
        private set
    var armed = false
        private set
    fun checked(success: Boolean) { checked = success; armed = false }
    fun arm(verified: Boolean) {
        check(checked && verified) { "RECOVERY_NOT_VERIFIED" }
        armed = true
    }
    fun requireOff(seconds: Int) {
        check(armed) { "NOT_ARMED" }
        require(seconds in 10..330) { "INVALID_DURATION" }
        armed = false // one-shot; another OFF requires a fresh local approval
        checked = false
    }
    fun reset() { checked = false; armed = false }
}
