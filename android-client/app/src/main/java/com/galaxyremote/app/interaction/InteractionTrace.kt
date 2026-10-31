package com.galaxyremote.app.interaction

/** Process-local counters only: never store coordinates, content, app names, IDs or input text. */
internal class InteractionTrace(private val clock: () -> Long = { System.nanoTime() / 1_000_000 }) {
    enum class Phase { BASELINE, OFF_REQUESTED, RESTORE_REQUESTED }
    enum class Kind { TAP, LONG_PRESS, SWIPE, LIVE_TOUCH, MULTI_TOUCH, GLOBAL }
    enum class Result { RECEIVED, SUBMITTED, COMPLETED, CANCELLED, REJECTED, ERROR }
    private var phase = Phase.BASELINE
    private val counts = linkedMapOf<Triple<Phase, Kind, Result>, Long>()
    private val frames = Phase.entries.associateWith { 0L }.toMutableMap()
    private var lastFrameAt: Long? = null
    private var capture = "UNKNOWN"
    private val events = ArrayDeque<String>()
    private val startedAt = clock()
    private var beforeOffSnapshot = "아직 OFF 요청 전 비교 기록이 없습니다."
    private var offSnapshot = "아직 OFF 요청 구간이 없습니다."

    @Synchronized fun currentPhase(): Phase = phase
    @Synchronized fun record(kind: Kind, result: Result, origin: Phase? = null) {
        val key = Triple(origin ?: phase, kind, result)
        counts[key] = (counts[key] ?: 0) + 1
        // Aggregate repeated segments; bound memory and keep phase transitions visible.
        if (result != Result.SUBMITTED && result != Result.COMPLETED && result != Result.RECEIVED)
            event("$kind/$result; submittedPhase=${origin ?: phase}")
    }
    @Synchronized fun received(type: String) {
        val kind = when (type) {
            "tap" -> Kind.TAP; "longPress" -> Kind.LONG_PRESS; "swipe" -> Kind.SWIPE
            "touch" -> Kind.LIVE_TOUCH; "pointerFrame" -> Kind.MULTI_TOUCH; "global" -> Kind.GLOBAL
            else -> return
        }
        record(kind, Result.RECEIVED)
    }
    @Synchronized fun phase(value: Phase) {
        if (phase == Phase.OFF_REQUESTED) offSnapshot = snapshot()
        if (value == Phase.OFF_REQUESTED && phase != value) beforeOffSnapshot = snapshot()
        phase = value
        event("phase=$value")
    }
    @Synchronized fun frame() { frames[phase] = frames.getValue(phase) + 1; lastFrameAt = clock() }
    @Synchronized fun capture(started: Boolean) { capture = if (started) "STARTED" else "STOPPED"; event("capture=$capture") }
    @Synchronized fun diagnostics(): String = "입력·캡처 진단 (앱 프로세스 누적)\n" + snapshot() +
        "\n최근 OFF 요청 직전 비교 기록\n$beforeOffSnapshot\n최근 OFF 요청 구간 종료 시점\n$offSnapshot\n최근 오류·구간 변경\n${events.joinToString("\n")}\n" +
        "SUBMITTED=API 접수, COMPLETED=접근성 콜백 완료이며 대상 앱 반응을 증명하지 않습니다.\n" +
        "캡처 프레임 수는 내용 변화·웹 수신을 증명하지 않습니다. OFF_REQUESTED는 실제 패널 OFF 확인값이 아닙니다."
    private fun snapshot(): String = "phase=$phase; capture=$capture; lastFrameAgeMs=${lastFrameAt?.let { (clock() - it).coerceAtLeast(0) } ?: "unknown"}\n" +
        "captureFrames=${frames.entries.joinToString { "${it.key}:${it.value}" }}\n" +
        counts.entries.joinToString("\n") { (key, count) -> "${key.first}/${key.second}/${key.third}=$count" }
    private fun event(value: String) {
        events.addLast("+${(clock() - startedAt).coerceAtLeast(0)}ms $phase $value")
        while (events.size > 32) events.removeFirst()
    }
}

internal object InteractionDiagnostics {
    val trace = InteractionTrace()
}
