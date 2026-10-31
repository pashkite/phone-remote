package com.galaxyremote.app.interaction

import com.galaxyremote.app.interaction.InteractionTrace.Kind
import com.galaxyremote.app.interaction.InteractionTrace.Result
import com.galaxyremote.app.interaction.InteractionTrace.Phase
import org.junit.Assert.*
import org.junit.Test

class InteractionTraceTest {
    @Test fun receivedAndSubmittedNeverBecomeCompletedWithoutCallback() {
        val trace = InteractionTrace { 0 }
        trace.received("touch")
        trace.record(Kind.LIVE_TOUCH, Result.SUBMITTED)
        assertTrue(trace.diagnostics().contains("BASELINE/LIVE_TOUCH/RECEIVED=1"))
        assertTrue(trace.diagnostics().contains("BASELINE/LIVE_TOUCH/SUBMITTED=1"))
        assertFalse(trace.diagnostics().contains("LIVE_TOUCH/COMPLETED="))
        trace.record(Kind.LIVE_TOUCH, Result.CANCELLED)
        assertTrue(trace.diagnostics().contains("LIVE_TOUCH/CANCELLED=1"))
        assertFalse(trace.diagnostics().contains("LIVE_TOUCH/COMPLETED="))
    }
    @Test fun restorePreservesOffCountersAndFrameFreshnessForLaterExport() {
        var now = 0L
        val trace = InteractionTrace { now }
        trace.capture(true); trace.frame()
        trace.record(Kind.TAP, Result.COMPLETED)
        trace.phase(Phase.OFF_REQUESTED)
        now = 2000; trace.frame()
        trace.received("touch"); trace.record(Kind.LIVE_TOUCH, Result.REJECTED)
        now = 2500; trace.phase(Phase.RESTORE_REQUESTED)
        now = 10000; trace.frame()
        val log = trace.diagnostics()
        assertTrue(log.contains("BASELINE/TAP/COMPLETED=1"))
        assertTrue(log.contains("OFF_REQUESTED/LIVE_TOUCH/REJECTED=1"))
        assertTrue(log.contains("phase=OFF_REQUESTED; capture=STARTED; lastFrameAgeMs=500"))
        assertTrue(log.contains("OFF_REQUESTED:1"))
        assertTrue(log.contains("RESTORE_REQUESTED:1"))
    }
    @Test fun noFrameAndStoppedCaptureRemainExplicitWithoutInventingStreamSuccess() {
        val trace = InteractionTrace { 0 }
        assertTrue(trace.diagnostics().contains("lastFrameAgeMs=unknown"))
        trace.capture(false)
        assertTrue(trace.diagnostics().contains("capture=STOPPED"))
        assertTrue(trace.diagnostics().contains("BASELINE:0"))
    }
    @Test fun onlyKnownTypesAreCountedAndHistoryRemainsBoundedUnderInputFlood() {
        val trace = InteractionTrace { 1 }
        trace.received("private text https://secret.example/token")
        trace.received("com.private.app")
        repeat(10000) { trace.received("pointerFrame"); trace.record(Kind.MULTI_TOUCH, Result.COMPLETED) }
        repeat(100) { trace.record(Kind.LIVE_TOUCH, Result.CANCELLED) }
        val log = trace.diagnostics()
        assertFalse(log.contains("secret")); assertFalse(log.contains("com.private.app"))
        assertTrue(log.contains("MULTI_TOUCH/RECEIVED=10000"))
        assertTrue(log.contains("MULTI_TOUCH/COMPLETED=10000"))
        assertEquals(32,log.lineSequence().count { it.startsWith("+") })
        assertTrue(log.length < 8000)
    }
    @Test fun globalCommandAcceptanceDoesNotProveCoordinateGestureDelivery() {
        val trace = InteractionTrace { 0 }
        trace.received("global"); trace.record(Kind.GLOBAL, Result.SUBMITTED)
        trace.phase(Phase.OFF_REQUESTED)
        trace.received("tap"); trace.record(Kind.TAP, Result.CANCELLED)
        val log = trace.diagnostics()
        assertTrue(log.contains("GLOBAL/SUBMITTED=1"))
        assertTrue(log.contains("OFF_REQUESTED/TAP/CANCELLED=1"))
        assertFalse(log.contains("TAP/COMPLETED="))
    }
    @Test fun callbackAfterRestoreIsAttributedToSubmissionPhase() {
        val trace = InteractionTrace { 0 }
        trace.phase(Phase.OFF_REQUESTED)
        val origin = trace.currentPhase()
        trace.record(Kind.SWIPE, Result.SUBMITTED)
        trace.phase(Phase.RESTORE_REQUESTED)
        trace.record(Kind.SWIPE, Result.CANCELLED, origin)
        val log = trace.diagnostics()
        assertTrue(log.contains("OFF_REQUESTED/SWIPE/CANCELLED=1"))
        assertFalse(log.contains("RESTORE_REQUESTED/SWIPE/CANCELLED="))
    }

}
