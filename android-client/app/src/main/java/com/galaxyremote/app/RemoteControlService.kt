package com.galaxyremote.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.res.Configuration
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

class RemoteControlService : Service() {
    private lateinit var preferences: RemotePreferences
    private lateinit var executor: ScheduledExecutorService
    private val webRtcLock = Any()
    private val seenRemoteCandidates = mutableSetOf<String>()
    @Volatile
    private var webRtcSession: WebRtcSession? = null
    private var projectionPermission: Intent? = null
    private var currentSessionId: String? = null
    private var candidatePollFuture: ScheduledFuture<*>? = null
    private var candidatePollCount = 0
    private var connected = false
    private var leaseFuture: ScheduledFuture<*>? = null
    private var lastLeaseSuccess = 0L
    private var shuttingDown = false
    private var finishingSession = false
    private var started = false

    override fun onCreate() {
        super.onCreate()
        preferences = RemotePreferences(this)
        activeInstance = this
        RemoteDiagnostics.record(this, "service", mapOf("state" to "started"))
        executor = Executors.newSingleThreadScheduledExecutor()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> shutdown("화면 공유를 중지했습니다.")
            ACTION_PREPARE -> prepareTrustedAccess(intent)
            ACTION_CONNECT -> connectTrustedSession(intent)
            ACTION_START -> startRemoteSession(intent)
            else -> if (!started) shutdown("화면 공유 승인이 필요합니다.")
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        webRtcSession?.setQuality(1080, 30)
    }

    override fun onDestroy() {
        if (!shuttingDown) shuttingDown = true
        preferences.standbyActive = false
        candidatePollFuture?.cancel(true)
        leaseFuture?.cancel(true)
        if (activeInstance === this) activeInstance = null
        executor.shutdownNow()
        val session = synchronized(webRtcLock) {
            webRtcSession.also { webRtcSession = null }
        }
        try {
            session?.release()
        } catch (error: Throwable) {
            rethrowIfFatal(error)
            Log.e(TAG, "WebRTC release failed", error)
        }
        projectionPermission = null
        currentSessionId = null
        seenRemoteCandidates.clear()
        projectionReady = false
        sendStatus("화면 공유가 종료되었습니다.", false)
        super.onDestroy()
    }

    private fun prepareTrustedAccess(intent: Intent): Boolean {
        if (started && webRtcSession != null) return true
        try {
            startProjectionForeground("등록된 PC의 자동 연결을 준비하고 있어요.")
            if (preferences.credentials == null) {
                shutdown("기기 등록이 필요합니다.")
                return false
            }
            if (projectionResultCodeFrom(intent) != android.app.Activity.RESULT_OK) {
                shutdown("화면 공유 승인이 확인되지 않았습니다.")
                return false
            }
            val projectionData = projectionDataFrom(intent)
                ?: throw IllegalStateException("화면 공유 승인 정보를 받지 못했습니다.")
            projectionPermission = Intent(projectionData)
        } catch (error: Throwable) {
            rethrowIfFatal(error)
            failSession("연결 승인 준비", error)
            return false
        }

        started = true
        preferences.standbyActive = true
        try {
            createWebRtcSession()
            projectionReady = true
            sendStatus("자동 연결 준비 완료 · 등록된 PC 요청을 기다리고 있어요.", true)
            updateNotification("등록된 PC 요청을 자동으로 연결할 준비가 됐어요.", false)
        } catch (error: RejectedExecutionException) {
            failSession("연결 작업 시작", error)
            return false
        } catch (error: Throwable) {
            rethrowIfFatal(error)
            failSession("화면 공유 엔진 초기화", error)
            return false
        }
        return true
    }

    private fun startRemoteSession(intent: Intent) {
        if (!prepareTrustedAccess(intent)) return
        connectTrustedSession(intent)
    }

    private fun connectTrustedSession(intent: Intent) {
        if (!started || webRtcSession == null || !projectionReady) {
            shutdown("자동 연결 대기가 꺼져 있습니다. 앱에서 화면 공유를 다시 허용해 주세요.")
            return
        }
        val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
            ?.takeIf(String::isNotBlank)
            ?: return
        candidatePollFuture?.cancel(false)
        currentSessionId = sessionId
        seenRemoteCandidates.clear()
        candidatePollCount = 0
        connected = false
        sendStatus("등록된 PC 요청을 자동으로 연결하고 있어요.", true)
        updateNotification("등록된 PC 요청을 자동으로 연결하고 있어요.", false)
        try {
            executor.execute(::approveAndStartSession)
        } catch (error: RejectedExecutionException) {
            failSession("연결 작업 시작", error)
        }
    }

    private fun approveAndStartSession() {
        val credentials = preferences.credentials ?: return
        val sessionId = currentSessionId ?: return
        val response = try {
            ApiClient(credentials).decideSession(sessionId, "approve")
        } catch (error: Throwable) {
            rethrowIfFatal(error)
            failSession("연결 요청 승인", error)
            return
        }
        val session = response.optJSONObject("session")
        val offerSdp = session?.optString("offerSdp").orEmpty()
        if (offerSdp.isBlank()) {
            failSession("PC 연결 요청 읽기", IllegalStateException("화면 연결 요청이 비어 있습니다."))
            return
        }
        val iceServers = response.optJSONArray("iceServers") ?: JSONArray()
        try {
            val webRtc = createWebRtcSession()
            webRtc.answerOffer(sessionId, offerSdp, iceServers)
            applyRemoteCandidates(response.optJSONArray("candidates") ?: JSONArray())
            candidatePollFuture = executor.scheduleWithFixedDelay(
                ::pollRemoteCandidates,
                150,
                350,
                TimeUnit.MILLISECONDS,
            )
        } catch (error: Throwable) {
            rethrowIfFatal(error)
            failSession("화면 공유 엔진 초기화", error)
        }
    }

    private fun createWebRtcSession(): WebRtcSession {
        synchronized(webRtcLock) {
            webRtcSession?.let { return it }
            val permission = projectionPermission
                ?: throw IllegalStateException("화면 공유 승인 정보가 만료되었습니다.")
            return WebRtcSession(
                context = this,
                projectionPermission = permission,
                onControl = ::handleControl,
                onControlResult = ::handleControlResult,
                onAnswerReady = ::submitAnswer,
                onLocalCandidate = ::submitCandidate,
                onConnectionState = { isConnected, message ->
                    connected = isConnected
                    sendStatus(message, true)
                    updateNotification(message, isConnected)
                    if (isConnected) {
                        candidatePollCount = 0
                        if (leaseFuture == null) {
                            lastLeaseSuccess = System.currentTimeMillis()
                            leaseFuture = executor.scheduleWithFixedDelay(::checkLease, 15, 15, TimeUnit.SECONDS)
                        }
                    } else if (!shuttingDown) {
                        finishRemoteSession(message)
                    }
                },
                onProjectionStopped = {
                    if (!shuttingDown) shutdown("안드로이드에서 화면 공유가 중지되었습니다.")
                },
            ).also {
                webRtcSession = it
                projectionPermission = null
            }
        }
    }

    private fun submitAnswer(sessionId: String, sdp: String) {
        try {
            executor.execute {
                val credentials = preferences.credentials ?: return@execute
                try {
                    ApiClient(credentials).submitAnswer(sessionId, sdp)
                    sendStatus("PC가 보안 연결을 완료하는 중이에요.", true)
                } catch (error: Exception) {
                    failSession("PC 연결 응답 전송", error)
                }
            }
        } catch (_: RejectedExecutionException) {
            // Service is already stopping.
        }
    }

    private fun submitCandidate(
        sessionId: String,
        candidate: String,
        sdpMid: String?,
        sdpMLineIndex: Int,
    ) {
        try {
            executor.execute {
                val credentials = preferences.credentials ?: return@execute
                try {
                    ApiClient(credentials).submitCandidate(
                        sessionId,
                        candidate,
                        sdpMid,
                        sdpMLineIndex,
                    )
                } catch (_: Exception) {
                    // A later candidate usually succeeds; session polling has a bounded timeout.
                }
            }
        } catch (_: RejectedExecutionException) {
            // Service is already stopping.
        }
    }

    private fun pollRemoteCandidates() {
        if (shuttingDown) return
        candidatePollCount += 1
        if ((connected && candidatePollCount > 10) || candidatePollCount > 80) {
            candidatePollFuture?.cancel(false)
            return
        }
        val credentials = preferences.credentials ?: return
        val sessionId = currentSessionId ?: return
        val response = try {
            ApiClient(credentials).fetchSession(sessionId)
        } catch (error: ApiException) {
            if (error.statusCode == 410 && !connected) shutdown("PC 연결 요청이 만료되었습니다.")
            return
        } catch (_: Exception) {
            return
        }
        applyRemoteCandidates(response.optJSONArray("candidates") ?: JSONArray())
    }

    private fun applyRemoteCandidates(candidates: JSONArray) {
        for (index in 0 until candidates.length()) {
            val candidate = candidates.optJSONObject(index) ?: continue
            val id = candidate.optString("id")
            val value = candidate.optString("candidate")
            if (id.isBlank() || value.isBlank() || !seenRemoteCandidates.add(id)) continue
            val sdpMid = candidate.optString("sdpMid").takeIf(String::isNotBlank)
            val sdpMLineIndex = candidate.optInt("sdpMLineIndex", 0)
            webRtcSession?.addRemoteCandidate(value, sdpMid, sdpMLineIndex)
        }
    }

    private fun checkLease() {
        val id = currentSessionId ?: return
        val credentials = preferences.credentials ?: run { shutdown("기기 등록이 해제됐습니다."); return }
        try {
            val response = ApiClient(credentials).checkLease(id)
            if (currentSessionId != id) return
            lastLeaseSuccess = System.currentTimeMillis()
            if (!response.optBoolean("active")) finishRemoteSession("서버에서 연결이 종료됐습니다.")
        } catch (error: ApiException) {
            if (error.statusCode == 401) shutdown("기기 등록이 해제됐습니다.")
        } catch (_: Exception) {
            if (System.currentTimeMillis() - lastLeaseSuccess > 45000) finishRemoteSession("연결 권한 확인 시간이 초과됐습니다.")
        }
    }

    private fun handleControlResult(command: JSONObject, finish: (Boolean, String?) -> Unit) {
        when (command.optString("type")) {
            "clipboardSet" -> {
                val text = command.optString("text")
                if (text.toByteArray(Charsets.UTF_8).size > 65536) { finish(false, "CLIPBOARD_TOO_LARGE"); return }
                try { getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(android.content.ClipData.newPlainText("Galaxy Remote", text)); finish(true, null) }
                catch (_: Exception) { finish(false, "CLIPBOARD_ACCESS_RESTRICTED") }
            }
            "clipboardPaste" -> {
                try { val success = RemoteKeyboardService.pasteClipboard() || RemoteAccessibilityService.pasteClipboard(); finish(success, if (success) null else "INPUT_OR_CLIPBOARD_UNAVAILABLE") }
                catch (_: Exception) { finish(false, "CLIPBOARD_ACCESS_RESTRICTED") }
            }
            "audio" -> { val code = webRtcSession?.setAudio(command.optBoolean("enabled")) ?: if (webRtcSession == null) "SESSION_INACTIVE" else null; finish(code == null, code) }
            "standby" -> {
                val mode = command.optString("mode")
                if (mode !in setOf("fast", "balanced", "saving")) { finish(false, "INVALID_MODE"); return }
                preferences.standbyMode = mode; finish(true, null)
            }
            "diagnostics" -> {
                val battery = getSystemService(android.os.BatteryManager::class.java).getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
                webRtcSession?.sendJson(JSONObject().put("type", "diagnostic").put("data", JSONObject().put("battery", battery).put("mode", preferences.standbyMode).put("appVersion", BuildConfig.VERSION_NAME)))
                finish(true, null)
            }
            "quality", "volume" -> { val success = handleControl(command); finish(success, if (success) null else "SESSION_INACTIVE") }
            "text", "key" -> if (RemoteKeyboardService.dispatch(command)) finish(true, null) else RemoteAccessibilityService.dispatchWithResult(command, finish)
            "tap", "longPress", "swipe", "global" -> RemoteAccessibilityService.dispatchWithResult(command, finish)
            else -> finish(false, "UNSUPPORTED_COMMAND")
        }
    }

    fun sendLocalClipboard(text: String): Boolean = webRtcSession?.sendClipboard(text) ?: false

    private fun handleControl(command: JSONObject): Boolean {
        when (command.optString("type")) {
            "quality" -> {
                val description = webRtcSession?.setQuality(
                    command.optInt("shortEdge", 1080),
                    command.optInt("fps", 30),
                ) ?: return false
                webRtcSession?.sendNotice("화질: $description")
                return true
            }
            "volume" -> {
                val audioManager = getSystemService(AudioManager::class.java)
                val maximum = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                val normalized = command.optDouble("value", 50.0).coerceIn(0.0, 100.0)
                audioManager.setStreamVolume(
                    AudioManager.STREAM_MUSIC,
                    (maximum * normalized / 100.0).roundToInt(),
                    0,
                )
                return true
            }
            "text", "key" -> if (RemoteKeyboardService.dispatch(command)) return true
        }
        return RemoteAccessibilityService.dispatch(command)
    }

    private fun startProjectionForeground(message: String) {
        val notification = buildNotification(message, false)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(message: String, isConnected: Boolean) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(message, isConnected))
    }

    private fun buildNotification(message: String, isConnected: Boolean): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, RemoteControlService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_remote)
            .setContentTitle(if (isConnected) "Galaxy Remote 연결됨" else "Galaxy Remote 화면 공유")
            .setContentText(message)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(Notification.Action.Builder(null, "공유 중지", stopIntent).build())
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_ID,
            getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "승인한 PC에 화면을 공유하는 동안 표시됩니다."
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun projectionDataFrom(intent: Intent): Intent? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_RESULT_DATA)
        }
    }

    private fun projectionResultCodeFrom(intent: Intent): Int {
        return intent.getIntExtra(EXTRA_RESULT_CODE, android.app.Activity.RESULT_CANCELED)
    }

    private fun sendStatus(message: String, active: Boolean) {
        sendBroadcast(
            Intent(ACTION_STATUS)
                .setPackage(packageName)
                .putExtra(EXTRA_STATUS_MESSAGE, message)
                .putExtra(EXTRA_STATUS_ACTIVE, active),
        )
    }

    private fun shutdown(message: String) {
        if (shuttingDown) return
        shuttingDown = true
        preferences.standbyActive = false
        sendStatus(message, false)
        candidatePollFuture?.cancel(true)
        leaseFuture?.cancel(true)
        if (activeInstance === this) activeInstance = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun finishRemoteSession(message: String) {
        if (shuttingDown || finishingSession) return
        finishingSession = true
        candidatePollFuture?.cancel(false)
        candidatePollFuture = null
        leaseFuture?.cancel(false); leaseFuture = null
        connected = false
        currentSessionId = null
        seenRemoteCandidates.clear()
        synchronized(webRtcLock) {
            webRtcSession?.closePeer()
        }
        updateNotification("자동 연결 대기 중 · 등록된 PC 요청은 바로 연결됩니다.", false)
        sendStatus("$message 자동 연결 대기를 계속합니다.", true)
        finishingSession = false
    }

    private fun failSession(stage: String, error: Throwable) {
        val diagnostic = RemotePreferences.runtimeDiagnostic(stage, error)
        preferences.recordRuntimeError(diagnostic)
        Log.e(TAG, "$stage failed", error)
        if (projectionReady && webRtcSession != null) {
            finishRemoteSession("연결에 실패했습니다.")
        } else {
            shutdown("화면 공유를 시작하지 못했습니다. 앱을 열어 오류 내용을 확인해 주세요.")
        }
    }

    private fun rethrowIfFatal(error: Throwable) {
        if (error is VirtualMachineError || error is ThreadDeath) throw error
    }

    companion object {
        @Volatile var activeInstance: RemoteControlService? = null
            private set
        const val ACTION_START = "com.galaxyremote.app.action.START"
        const val ACTION_PREPARE = "com.galaxyremote.app.action.PREPARE_TRUSTED"
        const val ACTION_CONNECT = "com.galaxyremote.app.action.CONNECT_TRUSTED"
        const val ACTION_STOP = "com.galaxyremote.app.action.STOP"
        const val ACTION_STATUS = "com.galaxyremote.app.action.STATUS"
        const val EXTRA_RESULT_CODE = "projection_result_code"
        const val EXTRA_RESULT_DATA = "projection_result_data"
        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_STATUS_MESSAGE = "status_message"
        const val EXTRA_STATUS_ACTIVE = "status_active"
        private const val NOTIFICATION_CHANNEL_ID = "galaxy_remote_screen_share"
        private const val NOTIFICATION_ID = 7264
        private const val TAG = "GalaxyRemoteService"
        @Volatile
        private var projectionReady = false

        fun isProjectionReady(): Boolean = projectionReady
    }
}
