package com.galaxyremote.app.display

import org.junit.Assert.*
import org.junit.Test

class PanelPreflightTest {
    private fun help(vararg commands: String) = "Display manager commands:\n  help\n    Print help.\n" + commands.joinToString("\n") { "  $it DISPLAY_ID" }
    private fun rejected(code: String, action: () -> Unit) {
        try { action(); fail("unsafe transition accepted") } catch (error: IllegalStateException) { assertEquals(code, error.message) }
    }
    private class Rig(var helpText: String, var helpExit: Int = 0, var control: PanelCommandResult = PanelCommandResult(0, "")) {
        val lease = PanelLease()
        val calls = mutableListOf<PanelCommand>()
        var state = PanelCommandResult(0, "Display 0: state=ON")
        val gate = PanelPreflight({ command ->
            calls += command
            when (command) {
                PanelCommand.HELP -> PanelCommandResult(helpExit, helpText)
                PanelCommand.STATE -> state
                else -> control
            }
        }, lease)
    }

    @Test fun normalHelpExitZeroIsReadOnlyAndRecordsBothResults() {
        val rig = Rig(help("power-off", "power-reset"))
        val result = rig.gate.inspect()
        assertTrue(result.support.canOff)
        assertEquals(listOf(PanelCommand.HELP, PanelCommand.STATE), rig.calls)
        assertTrue(result.diagnostics().contains("exitCode=0"))
        assertTrue(result.diagnostics().contains(rig.helpText))
        assertFalse(rig.lease.checked)
    }
    @Test fun normalHelpWithMinusOneOrAdb255StillDescribesSupportedCommands() {
        for (exit in listOf(-1, 255)) {
            val rig = Rig(help("power-off", "power-reset"), exit)
            val result = rig.gate.checkRecovery()
            assertTrue(result.success)
            assertTrue(result.trialReady)
            assertTrue(result.diagnostics.contains("exitCode=$exit"))
            assertTrue(result.summary.contains("미검증"))
            assertFalse(rig.calls.contains(PanelCommand.OFF))
        }
    }
    @Test fun missingOrUnrecognizedCommandListBlocksRecoveryAndOff() {
        for (text in listOf("", "Display manager commands:", "Permission denial: display", "power-off DISPLAY_ID\npower-reset DISPLAY_ID")) {
            val rig = Rig(text, -1)
            assertFalse(rig.gate.checkRecovery().success)
            assertFalse(rig.lease.checked)
            rejected("SUPPORT_NOT_VERIFIED") { rig.gate.requireOffSupport() }
            assertEquals(listOf(PanelCommand.HELP, PanelCommand.STATE), rig.calls)
        }
    }
    @Test fun allHelpIsSearchedAndPartialNamesOrProseAreNotDeclarations() {
        val rig = Rig(help() + "\n" + "    descriptive text\n".repeat(100) + "  power-off DISPLAY_ID\n  power-reset DISPLAY_ID\n")
        assertTrue(rig.gate.inspect().support.canOff)
        val misleading = Rig(help() + "\n  power-off-extra DISPLAY_ID\n    Use power-reset DISPLAY_ID for an example.\n    power-off is described but not declared here.\n")
        assertFalse(misleading.gate.inspect().support.canOff)
    }
    @Test fun prefersAdvertisedResetAndNeverGuessesAnotherRecoveryAfterFailure() {
        val rig = Rig(help("power-off", "power-reset", "power-on"), control = PanelCommandResult(1, "failed"))
        assertFalse(rig.gate.checkRecovery().success)
        assertEquals(PanelCommand.RESET, rig.calls.last())
        assertFalse(rig.calls.contains(PanelCommand.ON))
        assertFalse(rig.lease.checked)
    }
    @Test fun oldFirmwareUsesOnlyAdvertisedPowerOn() {
        val rig = Rig(help("power-off", "power-on"))
        assertTrue(rig.gate.checkRecovery().trialReady)
        assertEquals(PanelCommand.ON, rig.calls.last())
        assertFalse(rig.calls.contains(PanelCommand.RESET))
    }
    @Test fun missingEitherRequiredCommandBlocksOff() {
        val noOff = Rig(help("power-reset"))
        assertTrue(noOff.gate.checkRecovery().success) // ON preflight is allowed for a known recovery command
        assertFalse(noOff.lease.checked)
        rejected("SUPPORT_NOT_VERIFIED") { noOff.gate.requireOffSupport() }
        val noRecovery = Rig(help("power-off"))
        assertFalse(noRecovery.gate.checkRecovery().success)
        assertEquals(listOf(PanelCommand.HELP, PanelCommand.STATE), noRecovery.calls)
    }
    @Test fun realControlMinusOneTimeoutTruncationAndPermissionErrorRemainFailures() {
        for (result in listOf(PanelCommandResult(-1, "Display manager commands:"), PanelCommandResult(null, "", timedOut = true), PanelCommandResult(0, "partial", truncated = true), PanelCommandResult(0, "Permission denial: display"))) {
            val rig = Rig(help("power-off", "power-reset"), control = result)
            val report = rig.gate.checkRecovery()
            assertFalse(report.success); assertFalse(report.trialReady); assertFalse(rig.lease.checked)
            rejected("RECOVERY_NOT_VERIFIED") { rig.lease.arm(true) }
            assertTrue(report.diagnostics.contains("recovery preflight"))
        }
    }
    @Test fun truncatedTimedOutOrFailedHelpCannotAuthorizePowerCommands() {
        for (result in listOf(PanelCommandResult(0, help("power-off", "power-reset"), truncated = true), PanelCommandResult(0, help("power-off", "power-reset"), timedOut = true), PanelCommandResult(null, help("power-off", "power-reset"), failure = "IO_ERROR"))) {
            assertFalse(PanelSupport.parse(result).known)
        }
    }
    @Test fun displayFailureDoesNotHideCommandSupportAndHelpFailureStillQueriesDisplay() {
        val rig = Rig(help("power-off", "power-reset"))
        rig.state = PanelCommandResult(1, "dumpsys denied")
        val result = rig.gate.inspect()
        assertTrue(result.support.canOff); assertFalse(result.display.controlSucceeded)
        val calls = mutableListOf<PanelCommand>()
        val gate = PanelPreflight({ command -> calls += command; if (command == PanelCommand.HELP) throw IllegalStateException("transport failed") else PanelCommandResult(0, "display state") }, PanelLease())
        val unavailable = gate.inspect()
        assertFalse(unavailable.support.known)
        assertEquals("display state", unavailable.display.output)
        assertEquals(listOf(PanelCommand.HELP, PanelCommand.STATE), calls)
    }
    @Test fun freshInspectionInvalidatesPreviousRecoveryAndConsent() {
        val rig = Rig(help("power-off", "power-reset"))
        assertTrue(rig.gate.checkRecovery().trialReady)
        rig.lease.arm(true)
        rig.helpText = "no help"
        rig.gate.inspect()
        assertFalse(rig.lease.checked); assertFalse(rig.lease.armed)
        rejected("SUPPORT_NOT_VERIFIED") { rig.gate.requireOffSupport() }
    }
    @Test fun commandAcceptanceNeverSkipsExternalAttestationOrOneShotGate() {
        val rig = Rig(help("power-off", "power-reset"), -1)
        rejected("RECOVERY_NOT_VERIFIED") { rig.lease.arm(true) }
        rig.gate.checkRecovery()
        rejected("RECOVERY_NOT_VERIFIED") { rig.lease.arm(false) }
        rig.lease.arm(true); rig.lease.requireOff(30)
        rejected("NOT_ARMED") { rig.lease.requireOff(30) }
        rejected("RECOVERY_NOT_VERIFIED") { rig.lease.arm(true) }
        assertFalse(rig.calls.contains(PanelCommand.OFF))
    }
    @Test fun everyAdvertisedCombinationIsFailClosed() {
        for (mask in 0..7) for (exit in listOf(0, -1)) {
            val commands = listOf("power-off", "power-reset", "power-on").filterIndexed { index, _ -> mask and (1 shl index) != 0 }
            val rig = Rig(help(*commands.toTypedArray()), exit)
            val report = rig.gate.checkRecovery()
            val expected = "power-off" in commands && ("power-reset" in commands || "power-on" in commands)
            assertEquals(expected, report.trialReady)
            assertEquals(expected, rig.lease.checked)
            assertFalse(rig.calls.contains(PanelCommand.OFF))
        }
    }
}
