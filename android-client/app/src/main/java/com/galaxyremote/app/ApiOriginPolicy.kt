package com.galaxyremote.app

import java.net.URI

/** The same two pre-existing origins allowed by Gradle; no new QA host is trusted here. */
object ApiOriginPolicy {
    private val origins = setOf(
        "https://galaxy-remote-control.ashkite.chatgpt.site",
        "https://remote.ashkite.kro.kr",
    )
    fun canonical(value: String): String {
        val uri = try { URI(value.trim()) } catch (_: Exception) { throw IllegalArgumentException("연결 주소가 올바르지 않습니다.") }
        require(uri.scheme?.lowercase() == "https" && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null) { "승인된 HTTPS 연결 주소가 필요합니다." }
        require(uri.port == -1 || uri.port == 443) { "승인되지 않은 연결 포트입니다." }
        require(uri.rawPath.isNullOrEmpty() || uri.rawPath == "/") { "시그널링 주소에는 경로를 넣을 수 없습니다." }
        val origin = "https://${uri.host?.lowercase()}"
        require(origin in origins) { "승인되지 않은 시그널링 주소입니다. 새 QA 주소는 별도 검토가 필요합니다." }
        return origin
    }
    fun pairedOrigin(requested: String, returned: String): String {
        val expected = canonical(requested)
        require(canonical(returned) == expected) { "등록 응답의 주소가 요청한 서버와 다릅니다. 등록 정보를 저장하지 않았습니다." }
        return expected
    }
}
