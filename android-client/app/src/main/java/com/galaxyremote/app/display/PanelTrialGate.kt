package com.galaxyremote.app.display

/** App-side one-shot preflight. A late result cannot revive a disconnected/requeried session. */
internal class PanelTrialGate {
    private var revision = 0L
    private var ready = false
    private var reason = "아직 복구 사전 검사를 하지 않았습니다."
    private val events = ArrayDeque<String>()

    @Synchronized fun invalidate(message: String): Long {
        revision++; ready = false; reason = message
        record(message)
        return revision
    }
    @Synchronized fun complete(ticket: Long, accepted: Boolean): Boolean {
        if (ticket != revision) { record("이전 검사의 늦은 응답을 무시했습니다."); return false }
        ready = accepted
        reason = if (accepted) "화면 ON 사전 검사 수락 · OFF 이후 실제 복구는 미검증입니다."
            else "복구 사전 검사 또는 명령 지원 확인이 완료되지 않았습니다."
        record(reason)
        return ready
    }
    @Synchronized fun ticket(): Long? = if (ready) revision else null
    @Synchronized fun requireCurrent(ticket: Long) {
        check(ready && ticket == revision) { "RECOVERY_NOT_VERIFIED" }
    }
    @Synchronized fun summary(): String = if (ready) reason else "OFF 시험 차단: $reason 4번 사전 검사를 다시 진행하세요."
    @Synchronized fun diagnostics(): String = "복구 사전 검사 상태\nrevision=$revision; ready=$ready\n${summary()}\n상태 변경 이력 (앱 내 순서)\n${events.joinToString("\n")}"
    private fun record(message: String) {
        events.addLast("#$revision $message")
        while (events.size > 16) events.removeFirst()
    }
}
