package com.galaxyremote.app

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

class ApiException(message: String, val statusCode: Int) : Exception(message)

data class PairingResult(
    val deviceId: String,
    val deviceToken: String,
    val signalingBaseUrl: String,
    val owner: String,
)

class ApiClient(private val credentials: DeviceCredentials? = null) {
    fun pair(code: String, deviceName: String, appVersion: String): PairingResult {
        val payload = JSONObject()
            .put("code", code)
            .put("name", deviceName)
            .put("platform", "android")
            .put("appVersion", appVersion)
        val response = post(BuildConfig.SIGNALING_BASE_URL, "/api/pairing/complete", payload, false)
        return PairingResult(
            deviceId = response.getString("deviceId"),
            deviceToken = response.getString("deviceToken"),
            signalingBaseUrl = response.optString("signalingBaseUrl", BuildConfig.SIGNALING_BASE_URL),
            owner = response.optString("owner", ""),
        )
    }

    fun heartbeat(batteryLevel: Int, width: Int, height: Int): JSONObject {
        val payload = JSONObject()
            .put("batteryLevel", batteryLevel)
            .put("screenWidth", width)
            .put("screenHeight", height)
            .put("appVersion", BuildConfig.VERSION_NAME)
        return authorizedPost("/api/device/heartbeat", payload)
    }

    fun poll(): JSONObject = authorizedPost("/api/device/poll", JSONObject())

    fun decideSession(sessionId: String, decision: String): JSONObject {
        val payload = JSONObject()
            .put("sessionId", sessionId)
            .put("decision", decision)
        return authorizedPost("/api/device/decision", payload)
    }

    fun fetchSession(sessionId: String): JSONObject {
        val payload = JSONObject().put("sessionId", sessionId)
        return authorizedPost("/api/device/session", payload)
    }

    fun submitAnswer(sessionId: String, sdp: String): JSONObject {
        val payload = JSONObject()
            .put("sessionId", sessionId)
            .put("type", "answer")
            .put("sdp", sdp)
        return authorizedPost("/api/device/answer", payload)
    }

    fun submitCandidate(
        sessionId: String,
        candidate: String,
        sdpMid: String?,
        sdpMLineIndex: Int,
    ): JSONObject {
        val payload = JSONObject()
            .put("sessionId", sessionId)
            .put("candidate", candidate)
            .put("sdpMid", sdpMid ?: JSONObject.NULL)
            .put("sdpMLineIndex", sdpMLineIndex)
        return authorizedPost("/api/device/candidate", payload)
    }

    private fun authorizedPost(path: String, payload: JSONObject): JSONObject {
        val auth = credentials ?: throw ApiException("기기가 등록되지 않았습니다.", 401)
        return post(auth.baseUrl, path, payload, true)
    }

    private fun post(baseUrl: String, path: String, payload: JSONObject, authorize: Boolean): JSONObject {
        val normalizedBase = baseUrl.trimEnd('/')
        require(normalizedBase.startsWith("https://")) { "HTTPS 연결 주소만 사용할 수 있습니다." }
        val connection = (URL("$normalizedBase$path").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 12_000
            readTimeout = 20_000
            doInput = true
            doOutput = true
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("User-Agent", "GalaxyRemote/${BuildConfig.VERSION_NAME} Android")
            if (authorize) {
                val auth = credentials ?: throw ApiException("기기가 등록되지 않았습니다.", 401)
                setRequestProperty("X-Device-Id", auth.deviceId)
                setRequestProperty("Authorization", "Bearer ${auth.deviceToken}")
            }
        }

        return try {
            connection.outputStream.use { stream ->
                stream.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            val source = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = source?.use { input ->
                BufferedReader(InputStreamReader(input, Charsets.UTF_8)).readText()
            }.orEmpty()
            val json = try {
                if (body.isBlank()) JSONObject() else JSONObject(body)
            } catch (_: Exception) {
                val message = if (status == HttpURLConnection.HTTP_UNAUTHORIZED) {
                    "서버의 기기 연결 권한이 아직 적용되지 않았습니다. 잠시 뒤 다시 시도해 주세요."
                } else {
                    "서버가 올바르지 않은 응답을 보냈습니다. (HTTP $status)"
                }
                throw ApiException(message, status)
            }
            if (status !in 200..299) {
                throw ApiException(json.optString("error", "서버 요청에 실패했습니다."), status)
            }
            json
        } finally {
            connection.disconnect()
        }
    }
}
