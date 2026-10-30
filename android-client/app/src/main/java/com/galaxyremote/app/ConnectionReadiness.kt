package com.galaxyremote.app

/** Observed service state, never the persisted request to start a service. */
data class ConnectionReadiness(
    val registered: Boolean,
    val accessibility: Boolean,
    val notifications: Boolean,
    val listening: Boolean,
    val projection: Boolean,
    val connected: Boolean,
) {
    val ready: Boolean get() = registered && accessibility && notifications && projection
    val title: String get() = when {
        !registered -> "기기 등록이 필요해요"
        connected && projection -> "원격 연결 중"
        !accessibility || !notifications -> "권한을 확인해 주세요"
        ready -> "연결 준비 완료"
        listening -> "연결 요청 대기 중"
        else -> "연결 대기를 시작하세요"
    }
}
