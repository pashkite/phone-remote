package com.galaxyremote.app.display

import org.junit.Assert.*
import org.junit.Test

class PanelTrialGateTest {
    private fun accepted(gate: PanelTrialGate): Long {
        val ticket = gate.invalidate("4번 사전 검사 중")
        assertTrue(gate.complete(ticket, true))
        return gate.ticket()!!
    }
    private fun blocked(gate: PanelTrialGate, ticket: Long) {
        try { gate.requireCurrent(ticket); fail("stale OFF request accepted") }
        catch (error: IllegalStateException) { assertEquals("RECOVERY_NOT_VERIFIED", error.message) }
    }
    @Test fun acceptanceAllowsOnlyCurrentPreflightAndNeverClaimsPhysicalRecovery() {
        val gate = PanelTrialGate()
        assertNull(gate.ticket())
        val ticket = accepted(gate)
        gate.requireCurrent(ticket)
        assertTrue(gate.summary().contains("미검증"))
        gate.invalidate("OFF 시험에 사용")
        blocked(gate, ticket)
    }
    @Test fun disconnectDuringFiveSecondDelayBlocksOldRequestEvenAfterRecheck() {
        val gate = PanelTrialGate()
        val delayed = accepted(gate)
        gate.invalidate("WebRTC 연결 해제")
        assertNull(gate.ticket()); blocked(gate, delayed)
        assertTrue(gate.summary().contains("WebRTC"))
        val fresh = accepted(gate)
        blocked(gate, delayed)
        gate.requireCurrent(fresh)
    }
    @Test fun lateSuccessfulBinderResultCannotReviveDisconnectedSession() {
        val gate = PanelTrialGate()
        val inFlight = gate.invalidate("4번 검사 중")
        gate.invalidate("shell 연결 중단")
        assertFalse(gate.complete(inFlight, true))
        assertNull(gate.ticket()); blocked(gate, inFlight)
        assertTrue(gate.summary().contains("shell 연결 중단"))
        assertTrue(gate.diagnostics().contains("늦은 응답"))
    }
    @Test fun requeryRestoreCancelPermissionAndServiceLossEachInvalidateAcceptedTrial() {
        for (reason in listOf("3번 재조회", "복구 요청", "사용자 취소", "Shizuku 권한 변경", "서비스 연결 중단")) {
            val gate = PanelTrialGate()
            val old = accepted(gate)
            gate.invalidate(reason)
            blocked(gate, old)
            assertTrue(gate.summary().contains(reason))
            assertTrue(gate.diagnostics().contains("사전 검사"))
        }
    }
    @Test fun rejectedRecoveryNeverGrantsAndHistoryStaysBounded() {
        val gate = PanelTrialGate()
        val ticket = gate.invalidate("검사")
        assertFalse(gate.complete(ticket, false))
        blocked(gate, ticket)
        repeat(100) { gate.invalidate("이벤트$it") }
        val log = gate.diagnostics()
        assertFalse(log.contains("이벤트0\n"))
        assertTrue(log.contains("이벤트99"))
        assertEquals(16, log.lineSequence().count { it.startsWith("#") })
    }
}
