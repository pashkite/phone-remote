package com.galaxyremote.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ProjectionSmokeService : Service() {
    private val executor = Executors.newSingleThreadExecutor()
    private val projectionStopped = AtomicBoolean(false)
    private var session: WebRtcSession? = null
    private var loopbackReceiver: WebRtcLoopbackReceiver? = null

    override fun onCreate() {
        super.onCreate()
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Projection smoke test",
            NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_remote)
            .setContentTitle("Galaxy Remote 자동 테스트")
            .setContentText("화면 공유 엔진을 검사하고 있습니다.")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val projectionData = projectionDataFrom(intent)
        if (projectionData == null) {
            recordFailure("화면 공유 승인 Intent가 없습니다.")
            stopNow()
            return START_NOT_STICKY
        }

        executor.execute {
            try {
                lateinit var loopback: WebRtcLoopbackReceiver
                session = WebRtcSession(
                    context = this,
                    projectionPermission = projectionData,
                    onControl = { _: JSONObject -> false },
                    onAnswerReady = { _, sdp -> loopback.acceptAnswer(sdp) },
                    onConnectionState = { _, _ -> },
                    onProjectionStopped = { projectionStopped.set(true) },
                    onLocalCandidate = { _, candidate, sdpMid, sdpMLineIndex ->
                        loopback.acceptRemoteCandidate(candidate, sdpMid, sdpMLineIndex)
                    },
                )
                // Use the sender's native factory for both peers. Android's
                // WebRTC NetworkMonitor is process-global, and a second
                // factory can miss the already-active emulator network.
                loopback = WebRtcLoopbackReceiver(checkNotNull(session))
                loopbackReceiver = loopback
                loopback.connect()
                loopback.awaitConnectedAndFirstFrame(CONNECTION_TIMEOUT_MS)
                Thread.sleep(STREAM_DURATION_MS)
                check(!projectionStopped.get()) { "Android가 테스트 도중 화면 공유를 중지했습니다." }
                recordSuccess()
            } catch (error: Throwable) {
                recordFailure("${error.javaClass.simpleName}: ${error.message.orEmpty()}".take(500))
            } finally {
                try {
                    loopbackReceiver?.release()
                } catch (_: Throwable) {
                    // Continue releasing the projection sender.
                }
                loopbackReceiver = null
                try {
                    session?.release()
                } catch (_: Throwable) {
                    // The instrumentation assertion will still report the earlier result.
                }
                session = null
                stopNow()
            }
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun projectionDataFrom(intent: Intent?): Intent? {
        if (intent == null) return null
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(ProjectionSmokeContract.EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(ProjectionSmokeContract.EXTRA_RESULT_DATA)
        }
    }

    private fun recordSuccess() {
        getSharedPreferences(ProjectionSmokeContract.PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(ProjectionSmokeContract.RESULT, ProjectionSmokeContract.RESULT_SUCCESS)
            .remove(ProjectionSmokeContract.DETAIL)
            .commit()
    }

    private fun recordFailure(detail: String) {
        getSharedPreferences(ProjectionSmokeContract.PREFERENCES, MODE_PRIVATE)
            .edit()
            .putString(ProjectionSmokeContract.RESULT, ProjectionSmokeContract.RESULT_FAILURE)
            .putString(ProjectionSmokeContract.DETAIL, detail)
            .commit()
    }

    private fun stopNow() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    companion object {
        private const val CHANNEL_ID = "projection_smoke_test"
        private const val NOTIFICATION_ID = 9140
        private const val CONNECTION_TIMEOUT_MS = 25_000L
        private const val STREAM_DURATION_MS = 8_000L
    }
}
