package com.galaxyremote.app

import org.junit.Assert.*
import org.junit.Test

class ConnectionReadinessTest {
    @Test fun registrationAndBothPermissionsAreRequiredForReady() {
        for (registered in listOf(false, true)) for (accessibility in listOf(false, true)) for (notifications in listOf(false, true)) {
            val state = ConnectionReadiness(registered, accessibility, notifications, true, true, false)
            assertEquals(registered && accessibility && notifications, state.ready)
            if (!state.ready) assertNotEquals("연결 준비 완료", state.title)
        }
    }

    @Test fun permissionToListenIsNotProjectionOrConnection() {
        val waiting = ConnectionReadiness(true, true, true, true, false, false)
        assertFalse(waiting.ready)
        assertEquals("연결 요청 대기 중", waiting.title)
        assertEquals("연결 대기를 시작하세요", waiting.copy(listening = false).title)
        assertEquals("연결 준비 완료", waiting.copy(projection = true).title)
        assertEquals("원격 연결 중", waiting.copy(projection = true, connected = true).title)
    }

    @Test fun revokedCaptureNeverClaimsAnActiveRemoteSession() {
        val revoked = ConnectionReadiness(true, true, true, true, false, true)
        assertFalse(revoked.ready)
        assertNotEquals("원격 연결 중", revoked.title)
        assertEquals("기기 등록이 필요해요", revoked.copy(registered = false).title)
    }
}
