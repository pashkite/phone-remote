package com.galaxyremote.app.display

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Binder
import android.os.IBinder
import android.os.PowerManager
import com.galaxyremote.app.BuildConfig
import com.galaxyremote.app.RemoteAccessibilityService
import org.json.JSONObject
import rikka.shizuku.Shizuku
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Process-local owner. No browser-controlled grant or arbitrary command API. */
object DisplayControl {
    private val io = Executors.newSingleThreadExecutor()
    private val monitor = Executors.newSingleThreadScheduledExecutor()
    private val owner = Binder()
    @Volatile private var service: IPanelService? = null
    @Volatile private var connected = false
    @Volatile private var preflightReady = false
    @Volatile private var binding = false
    @Volatile var status = "Shizuku 미연결 · 물리 패널 OFF와 복구는 미검증입니다."
        private set
    @Volatile var diagnostics = "아직 명령을 조회하지 않았습니다."
        private set
    @Volatile var commandSummary = "명령 지원 여부 미확인 · OFF 시험 차단"
        private set
    private var inspectionDiagnostics = ""
    private var wakeLock: PowerManager.WakeLock? = null
    private var initialized = false
    @Volatile private var pending = false
    @Volatile private var deadline = 0L
    private lateinit var args: Shizuku.UserServiceArgs

    private fun lost(reason: String) {
        service = null; binding = false; preflightReady = false; pending = false
        commandSummary = "명령 지원 여부 미확인 · OFF 시험 차단"
        releaseInputAndWake()
        status = reason + " 실제 패널 복구 여부는 직접 확인하세요."
        diagnostics = "$diagnostics\n\n$reason"
    }
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            if (!binder.isBinderAlive) { lost(PanelMessages.failure(IllegalStateException("SERVICE_BIND_FAILED"))); return }
            service = IPanelService.Stub.asInterface(binder)
            binding = false; preflightReady = false
            status = "shell 서비스가 연결됐습니다. 명령 조회와 복구 사전 검사를 진행하세요."
        }
        override fun onServiceDisconnected(name: ComponentName) { lost(PanelMessages.failure(IllegalStateException("SERVICE_DISCONNECTED"))) }
        override fun onBindingDied(name: ComponentName) { lost(PanelMessages.failure(IllegalStateException("SERVICE_DISCONNECTED"))) }
        override fun onNullBinding(name: ComponentName) { lost(PanelMessages.failure(IllegalStateException("SERVICE_BIND_FAILED"))) }
    }

    @Synchronized fun initialize(context: Context) {
        if (initialized || !BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) return
        initialized = true
        // Replace a daemon from an older APK; otherwise the old inspect() bug survives updates.
        args = Shizuku.UserServiceArgs(ComponentName(context, PanelService::class.java))
            .daemon(true).processNameSuffix("panel_shell").version(BuildConfig.VERSION_CODE)
        wakeLock = context.getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GalaxyRemote:panel-test")
        Shizuku.addBinderDeadListener { lost("Shizuku가 중단됐습니다. OFF 시험은 차단됩니다.") }
        Shizuku.addRequestPermissionResultListener { requestCode, result ->
            if (requestCode == 202) {
                preflightReady = false
                status = if (result == PackageManager.PERMISSION_GRANTED) "Shizuku 권한이 승인됐습니다. shell 서비스를 연결하세요."
                    else "Shizuku 권한이 거부됐습니다. OFF 시험은 차단됩니다."
            }
        }
        monitor.scheduleWithFixedDelay({
            if (pending) {
                val allowed = hasPermission()
                if (!connected || !allowed || android.os.SystemClock.elapsedRealtime() >= deadline) {
                    io.execute { restore() }
                } else {
                    try { service?.heartbeat() } catch (_: Exception) { io.execute { restore() } }
                }
            }
        }, 1, 1, TimeUnit.SECONDS)
    }

    private fun hasPermission(): Boolean = try {
        Shizuku.pingBinder() && Shizuku.getUid() == 2000 && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
    } catch (_: Exception) { false }

    private fun authorize() {
        check(BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL)
        val running = try { Shizuku.pingBinder() } catch (_: Exception) { false }
        val uid = if (running) try { Shizuku.getUid() } catch (_: Exception) { null } else null
        val granted = running && try { Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED } catch (_: Exception) { false }
        PanelAccessPolicy.authorize(running, uid, granted)
    }

    fun requestPermission() {
        check(try { Shizuku.pingBinder() } catch (_: Exception) { false }) { "SHIZUKU_NOT_RUNNING" }
        Shizuku.requestPermission(202)
        status = "휴대폰에서 Shizuku 권한 요청을 확인하세요."
    }
    fun bind() {
        authorize()
        preflightReady = false; binding = true
        status = "shell 서비스 연결을 요청했습니다."
        try { Shizuku.bindUserService(args, connection) }
        catch (error: Exception) { binding = false; throw IllegalStateException("SERVICE_BIND_FAILED", error) }
        monitor.schedule({ if (binding && service == null) {
            binding = false; recordFailure(IllegalStateException("SERVICE_BIND_FAILED"))
        } }, 10, TimeUnit.SECONDS)
    }

    private fun publish(wire: String): String {
        val report = JSONObject(wire)
        check(report.optInt("panelReport") == 1) { "SERVICE_BIND_FAILED" }
        status = report.getString("summary")
        diagnostics = report.getString("diagnostics")
        commandSummary = report.optString("supportSummary", "명령 지원 여부 미확인")
        preflightReady = report.optBoolean("success") && report.optBoolean("trialReady")
        return status
    }
    fun recordFailure(error: Throwable): String {
        preflightReady = false
        commandSummary = "명령 지원 여부 미확인 · OFF 시험 차단"
        status = PanelMessages.failure(error)
        diagnostics = (if (inspectionDiagnostics.isNotBlank()) "최근 조회 진단 (참고)\n$inspectionDiagnostics\n\n" else "") + error.stackTraceToString()
        return status
    }
    fun work(action: () -> String, complete: (String) -> Unit) {
        io.execute {
            try { action() } catch (error: Exception) { recordFailure(error) }
            complete(status)
        }
    }
    private fun bound(): IPanelService {
        authorize()
        PanelAccessPolicy.requireService(service?.asBinder()?.isBinderAlive == true)
        return service!!
    }
    fun inspect(): String {
        preflightReady = false
        commandSummary = "명령 지원 여부 미확인 · 조회 중"
        val result = bound().inspect()
        inspectionDiagnostics = JSONObject(result).getString("diagnostics")
        return publish(result)
    }
    fun checkRecovery(): String {
        preflightReady = false
        commandSummary = "명령 지원 여부 미확인 · 사전 검사 중"
        val result = bound().checkRecovery()
        inspectionDiagnostics = JSONObject(result).getString("diagnostics")
        return publish(result)
    }
    val trialReady: Boolean get() = preflightReady && connected && !pending && service?.asBinder()?.isBinderAlive == true && hasPermission()

    @Synchronized fun turnOff(seconds: Int, verified: Boolean): String {
        check(connected) { "ACTIVE_CONNECTION_REQUIRED" }
        check(!pending) { "RESTORE_FIRST" }
        check(preflightReady) { "RECOVERY_NOT_VERIFIED" }
        val remote = bound()
        remote.arm(owner, verified)
        wakeLock?.acquire((seconds + 10) * 1000L)
        pending = true; preflightReady = false
        deadline = android.os.SystemClock.elapsedRealtime() + seconds * 1000L
        return try { publish(remote.turnOff(seconds)) } catch (error: Exception) {
            restore(); throw error
        }
    }
    @Synchronized fun restore(): String {
        releaseInputAndWake(); preflightReady = false
        val result = try {
            service?.restore()?.let(::publish) ?: "shell 서비스가 없습니다. 외부·시간 제한 복구 경로와 실제 패널을 확인하세요."
        } catch (error: Exception) { recordFailure(error) + " 외부 복구 경로를 확인하세요." }
        pending = false; status = result
        return result
    }
    fun sessionConnected(value: Boolean) {
        connected = value
        if (!value && BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) io.execute { restore() }
    }
    @Synchronized private fun releaseInputAndWake() {
        RemoteAccessibilityService.stopTouch()
        wakeLock?.let { if (it.isHeld) it.release() }
    }
}
