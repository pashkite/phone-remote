package com.galaxyremote.app.display

internal object PanelAccessPolicy {
    fun authorize(running: Boolean, uid: Int?, granted: Boolean) {
        check(running) { "SHIZUKU_NOT_RUNNING" }
        check(granted) { "SHIZUKU_PERMISSION_DENIED" }
        check(uid == 2000) { "SHELL_ONLY_NO_ROOT" }
    }
    fun requireService(bound: Boolean) { check(bound) { "SERVICE_NOT_BOUND" } }
}

internal object PanelMessages {
    private val messages = linkedMapOf(
        "SHIZUKU_NOT_RUNNING" to "Shizuku를 먼저 시작하세요.",
        "SHIZUKU_PERMISSION_DENIED" to "Shizuku 권한을 휴대폰에서 허용하세요.",
        "SHELL_ONLY_NO_ROOT" to "루트 방식은 지원하지 않습니다. shell 방식 Shizuku를 사용하세요.",
        "SERVICE_NOT_BOUND" to "shell 서비스를 먼저 연결하세요.",
        "SERVICE_BIND_FAILED" to "shell 서비스 연결에 실패했습니다. Shizuku 상태를 확인하세요.",
        "SERVICE_DISCONNECTED" to "shell 서비스 연결이 끊겼습니다. OFF 시험은 차단됩니다.",
        "COMMAND_TIMEOUT" to "명령 응답 시간이 초과됐습니다. 전체 진단을 확인하세요.",
        "COMMAND_FAILED" to "화면 제어 명령이 실패했습니다. 전체 진단을 확인하세요.",
        "SUPPORT_NOT_VERIFIED" to "OFF·복구 명령 지원을 확인하지 못했습니다. 다시 조회하세요.",
        "RECOVERY_NOT_VERIFIED" to "복구 사전 검사와 외부 복구 검증이 필요합니다.",
        "NOT_ARMED" to "새 복구 사전 검사와 사용자 확인이 필요합니다.",
        "RESTORE_FIRST" to "이전 시험을 먼저 복구하세요.",
        "ACTIVE_CONNECTION_REQUIRED" to "화면 ON에서 WebRTC 연결을 먼저 시작하세요.",
        "OWNER_GONE" to "앱 연결이 끊겨 OFF 시험을 차단했습니다.",
        "INVALID_DURATION" to "허용된 시험 시간을 사용하세요.",
        "DEVICE_LOCKED" to "기기를 직접 잠금 해제하세요.",
        "DISPLAY_NOT_ON" to "display 0이 화면 ON 상태인지 먼저 확인하세요.",
        "WATCHDOG_NOT_STARTED" to "시간 제한 복구 장치를 시작하지 못해 시험을 차단했습니다.",
    )
    fun failure(error: Throwable): String = messages.entries.firstOrNull { (code, _) ->
        Regex("(?<![A-Z_])" + code + "(?![A-Z_])").containsMatchIn(error.message.orEmpty())
    }?.value ?: "작업에 실패했습니다. Shizuku 상태와 전체 진단을 확인하세요."
}
