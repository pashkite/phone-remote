package com.galaxyremote.app.display

import org.junit.Assert.*
import org.junit.Test

class PanelAccessPolicyTest {
    private fun rejected(code: String, action: () -> Unit) {
        try { action(); fail("unauthorized access accepted") } catch (error: IllegalStateException) { assertEquals(code, error.message) }
    }
    @Test fun stoppedShizukuNeverRequestsAService() {
        rejected("SHIZUKU_NOT_RUNNING") { PanelAccessPolicy.authorize(false, null, false) }
    }
    @Test fun deniedPermissionDoesNotBecomeAControlAttempt() {
        rejected("SHIZUKU_PERMISSION_DENIED") { PanelAccessPolicy.authorize(true, 2000, false) }
        rejected("SHIZUKU_PERMISSION_DENIED") { PanelAccessPolicy.authorize(true, null, false) }
    }
    @Test fun onlyShellAndConnectedServiceAreAllowed() {
        rejected("SHELL_ONLY_NO_ROOT") { PanelAccessPolicy.authorize(true, 0, true) }
        PanelAccessPolicy.authorize(true, 2000, true)
        rejected("SERVICE_NOT_BOUND") { PanelAccessPolicy.requireService(false) }
        PanelAccessPolicy.requireService(true)
    }
    @Test fun connectionAndControlFailuresHaveShortKoreanMessagesWithoutRawHelp() {
        for (code in listOf("SERVICE_BIND_FAILED", "SERVICE_DISCONNECTED", "COMMAND_FAILED", "RECOVERY_NOT_VERIFIED")) {
            val message = PanelMessages.failure(IllegalStateException("$code: Display manager commands:" + "raw help".repeat(100)))
            assertTrue(message.length < 100)
            assertFalse(message.contains("Display manager commands:"))
            assertTrue(message.any { it in '가'..'힣' })
        }
    }
}
