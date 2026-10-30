package com.galaxyremote.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

class ConnectionListenerService : Service() {
    private lateinit var preferences: RemotePreferences
    private lateinit var executor: ScheduledExecutorService
    private var started = false
    private var stoppedByUser = false
    private var currentRequestId: String? = null
    private var nextPollMs = 4000L
    private var failures = 0
    private var requests = 0
    private var lastHeartbeat = 0L

    override fun onCreate() {
        super.onCreate()
        preferences = RemotePreferences(this)
        executor = Executors.newSingleThreadScheduledExecutor()
        createNotificationChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopListener()
            ACTION_REJECT -> rejectRequest(intent.getStringExtra(EXTRA_SESSION_ID))
            else -> startListener()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        executor.shutdownNow()
        if (stoppedByUser) preferences.listenerEnabled = false
        sendStatus(if (stoppedByUser) "연결 요청 알림을 껐습니다." else "연결 요청 알림이 중단되었습니다.")
        super.onDestroy()
    }

    private fun startListener() {
        if (started) return
        if (preferences.credentials == null) {
            stoppedByUser = true
            stopSelf()
            return
        }
        started = true
        preferences.listenerEnabled = true
        val notification = buildReadyNotification("PC의 연결 요청을 기다리고 있어요.")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                READY_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(READY_NOTIFICATION_ID, notification)
        }
        sendStatus("PC에서 연결 시작을 누르면 승인 알림이 도착합니다.")
        executor.execute(::pollLoop)
    }

    private fun pollLoop() {
        if (executor.isShutdown) return
        pollForRequest()
        if (System.currentTimeMillis() - lastHeartbeat >= 60000) { sendHeartbeat(); lastHeartbeat = System.currentTimeMillis() }
        try { executor.schedule(::pollLoop, nextPollMs, TimeUnit.MILLISECONDS) } catch (_: RejectedExecutionException) { }
    }

    private fun pollForRequest() {
        val credentials = preferences.credentials ?: return
        val response = try {
            requests += 1
            pollRequests = requests
            ApiClient(credentials).poll()
        } catch (error: ApiException) {
            failures = (failures + 1).coerceAtMost(4); nextPollMs = (4000L shl failures).coerceAtMost(30000L)
            if (error.statusCode == 401) {
                preferences.listenerEnabled = false
                stopService(Intent(this, RemoteControlService::class.java))
                stopSelf()
            } else {
                updateReadyNotification("네트워크 연결을 다시 확인하고 있어요.")
            }
            return
        } catch (_: Exception) {
            failures = (failures + 1).coerceAtMost(4); nextPollMs = (4000L shl failures).coerceAtMost(30000L)
            updateReadyNotification("네트워크 연결을 다시 확인하고 있어요.")
            return
        }

        failures = 0
        val minimum = when (preferences.standbyMode) { "fast" -> 1800L; "saving" -> 12000L; else -> 4000L }
        nextPollMs = maxOf(minimum, response.optLong("pollAfterMs", 1800L).coerceIn(1000L, 30000L))
        if (RemoteControlService.activeInstance != null && requests % 15 == 0) RemoteDiagnostics.record(this, "standby", mapOf("pollMs" to nextPollMs, "requests" to requests, "mode" to preferences.standbyMode))
        val session = response.optJSONObject("session")
        if (session == null) {
            if (currentRequestId != null) {
                getSystemService(NotificationManager::class.java).cancel(REQUEST_NOTIFICATION_ID)
                currentRequestId = null
            }
            updateReadyNotification("PC의 연결 요청을 기다리고 있어요.")
            return
        }
        val sessionId = session.optString("id")
        val expiresAt = session.optLong("expiresAt", 0L)
        if (sessionId.isBlank() || expiresAt <= System.currentTimeMillis()) return
        if (sessionId == currentRequestId) return
        RemoteDiagnostics.record(this, "connection_request", mapOf("state" to "received"))
        currentRequestId = sessionId
        if (RemoteControlService.isProjectionReady()) {
            connectTrustedRequest(sessionId)
        } else {
            showConnectionRequest(sessionId, expiresAt)
        }
    }

    private fun connectTrustedRequest(sessionId: String) {
        startService(
            Intent(this, RemoteControlService::class.java)
                .setAction(RemoteControlService.ACTION_CONNECT)
                .putExtra(EXTRA_SESSION_ID, sessionId),
        )
        getSystemService(NotificationManager::class.java).cancel(REQUEST_NOTIFICATION_ID)
        updateReadyNotification("등록된 PC 요청을 자동으로 연결하고 있어요.")
        sendStatus("등록된 PC 요청을 자동으로 승인했습니다.")
    }

    private fun showConnectionRequest(sessionId: String, expiresAt: Long) {
        val approveIntent = PendingIntent.getActivity(
            this,
            sessionId.hashCode(),
            Intent(this, MainActivity::class.java)
                .setAction(MainActivity.ACTION_APPROVE_SESSION)
                .putExtra(EXTRA_SESSION_ID, sessionId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val rejectIntent = PendingIntent.getService(
            this,
            sessionId.hashCode() xor 0x55aa,
            Intent(this, ConnectionListenerService::class.java)
                .setAction(ACTION_REJECT)
                .putExtra(EXTRA_SESSION_ID, sessionId),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val timeout = (expiresAt - System.currentTimeMillis()).coerceIn(1_000L, 60_000L)
        val notification = Notification.Builder(this, REQUEST_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_remote)
            .setContentTitle("PC 연결 요청")
            .setContentText("자동 연결 대기가 꺼져 있어 화면 공유 확인이 필요합니다.")
            .setStyle(
                Notification.BigTextStyle().bigText(
                    "휴대폰 재시작 또는 공유 중지로 자동 연결 대기가 꺼졌습니다. 눌러서 Android 화면 공유를 다시 한 번 허용해 주세요.",
                ),
            )
            .setContentIntent(approveIntent)
            .setAutoCancel(true)
            .setTimeoutAfter(timeout)
            .setCategory(Notification.CATEGORY_STATUS)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPriority(Notification.PRIORITY_HIGH)
            .addAction(Notification.Action.Builder(null, "거절", rejectIntent).build())
            .addAction(Notification.Action.Builder(null, "승인", approveIntent).build())
            .build()
        getSystemService(NotificationManager::class.java).notify(REQUEST_NOTIFICATION_ID, notification)
        updateReadyNotification("PC 연결 요청이 도착했습니다. 승인 또는 거절해 주세요.")
        sendStatus("PC 연결 요청이 도착했습니다. 알림에서 승인해 주세요.")
    }

    private fun rejectRequest(sessionId: String?) {
        if (sessionId.isNullOrBlank()) return
        try {
            executor.execute {
                try {
                    preferences.credentials?.let { ApiClient(it).decideSession(sessionId, "reject") }
                } catch (_: Exception) {
                    // The browser request also expires automatically after 60 seconds.
                }
                currentRequestId = null
                getSystemService(NotificationManager::class.java).cancel(REQUEST_NOTIFICATION_ID)
                updateReadyNotification("연결 요청을 거절했습니다. 새 요청을 기다립니다.")
                sendStatus("연결 요청을 거절했습니다. 새 요청을 기다립니다.")
            }
        } catch (_: RejectedExecutionException) {
            // Service is already stopping.
        }
    }

    private fun sendHeartbeat() {
        val credentials = preferences.credentials ?: return
        val battery = getSystemService(BatteryManager::class.java)
            .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            .coerceIn(0, 100)
        val (width, height) = screenSize()
        try {
            ApiClient(credentials).heartbeat(battery, width, height)
        } catch (_: Exception) {
            // The request poll also refreshes the online timestamp.
        }
    }

    private fun screenSize(): Pair<Int, Int> {
        val windowManager = getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            return bounds.width() to bounds.height()
        }
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
    }

    private fun buildReadyNotification(message: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stopIntent = PendingIntent.getService(
            this,
            1,
            Intent(this, ConnectionListenerService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return Notification.Builder(this, READY_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_remote)
            .setContentTitle("Galaxy Remote 2.0 연결 요청 대기")
            .setContentText(message)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(Notification.Action.Builder(null, "끄기", stopIntent).build())
            .build()
    }

    private fun updateReadyNotification(message: String) {
        if (!started) return
        getSystemService(NotificationManager::class.java)
            .notify(READY_NOTIFICATION_ID, buildReadyNotification(message))
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val ready = NotificationChannel(
            READY_CHANNEL_ID,
            "연결 요청 대기",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "PC 연결 요청을 받을 수 있을 때 계속 표시됩니다."
            setShowBadge(false)
        }
        val request = NotificationChannel(
            REQUEST_CHANNEL_ID,
            "PC 연결 요청",
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "등록된 PC가 화면 공유를 요청할 때 승인 알림을 표시합니다."
            enableVibration(true)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannels(listOf(ready, request))
    }

    private fun sendStatus(message: String) {
        sendBroadcast(
            Intent(ACTION_STATUS)
                .setPackage(packageName)
                .putExtra(EXTRA_STATUS_MESSAGE, message),
        )
    }

    private fun stopListener() {
        stoppedByUser = true
        preferences.listenerEnabled = false
        getSystemService(NotificationManager::class.java).cancel(REQUEST_NOTIFICATION_ID)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    companion object {
        @Volatile var pollRequests = 0
            private set

        const val ACTION_START = "com.galaxyremote.app.action.LISTEN"
        const val ACTION_STOP = "com.galaxyremote.app.action.STOP_LISTENING"
        const val ACTION_REJECT = "com.galaxyremote.app.action.REJECT_SESSION"
        const val ACTION_STATUS = "com.galaxyremote.app.action.LISTENER_STATUS"
        const val EXTRA_SESSION_ID = "session_id"
        const val EXTRA_STATUS_MESSAGE = "listener_status_message"
        private const val READY_CHANNEL_ID = "galaxy_remote_listener"
        private const val REQUEST_CHANNEL_ID = "galaxy_remote_requests"
        private const val READY_NOTIFICATION_ID = 7263
        private const val REQUEST_NOTIFICATION_ID = 7265
    }
}
