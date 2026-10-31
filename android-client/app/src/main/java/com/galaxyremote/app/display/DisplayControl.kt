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
    @Volatile private var directTouch: ShellTouchClient? = null
    val inputBackendSummary: String get() = if (directTouch != null)
        if (directTouch?.isActive == true) "Shizuku 직접 터치 후보 · 단일 포인터 · 실기기 미검증"
        else "직접 터치 중단 · 새 입력 차단 · 복구/재설정 필요"
        else "기존 접근성 입력"
    @Volatile private var service: IPanelService? = null
    @Volatile private var connected = false
    private val gate = PanelTrialGate()
    @Volatile private var binding = false
    @Volatile var status = "Shizuku 미연결 · 물리 패널 OFF와 복구는 미검증입니다."
        private set
    @Volatile private var latestDiagnostics = "아직 명령을 조회하지 않았습니다."
    @Volatile private var recoveryDiagnostics = "아직 4번 사전 검사 결과가 없습니다."
    val gateSummary: String get() = gate.summary()
    @Volatile private var directDiagnostics = "직접 터치 후보를 아직 준비하지 않았습니다."
    val inputDiagnostics: String get() = "입력 경로: $inputBackendSummary\n$directDiagnostics\n\n" + com.galaxyremote.app.interaction.InteractionDiagnostics.trace.diagnostics()
    val diagnostics: String get() = inputDiagnostics + "\n\n" + gate.diagnostics() + "\n\n최근 4번 사전 검사 결과 (참고)\n" +
        recoveryDiagnostics + "\n\n최근 작업 진단\n" + latestDiagnostics
    @Volatile var commandSummary = "명령 지원 여부 미확인 · OFF 시험 차단"
        private set
    @Volatile private var inspectionDiagnostics = ""
    private var wakeLock: PowerManager.WakeLock? = null
    private var initialized = false
    @Volatile private var pending = false
    @Volatile private var deadline = 0L
    private lateinit var args: Shizuku.UserServiceArgs

    private fun lost(reason: String) {
        directTouch?.close()
        service = null; binding = false; gate.invalidate(reason); pending = false
        commandSummary = "명령 지원 여부 미확인 · OFF 시험 차단"
        releaseInputAndWake()
        status = reason + " 실제 패널 복구 여부는 직접 확인하세요."
        latestDiagnostics = "$latestDiagnostics\n\n$reason"
    }
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            if (!binder.isBinderAlive) { lost(PanelMessages.failure(IllegalStateException("SERVICE_BIND_FAILED"))); return }
            service = IPanelService.Stub.asInterface(binder)
            binding = false; gate.invalidate("shell 서비스가 새로 연결됐습니다.")
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
                gate.invalidate("Shizuku 권한 결과가 변경됐습니다.")
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
        gate.invalidate("shell 서비스 재연결을 요청했습니다."); binding = true
        status = "shell 서비스 연결을 요청했습니다."
        try { Shizuku.bindUserService(args, connection) }
        catch (error: Exception) { binding = false; throw IllegalStateException("SERVICE_BIND_FAILED", error) }
        monitor.schedule({ if (binding && service == null) {
            binding = false; recordFailure(IllegalStateException("SERVICE_BIND_FAILED"))
        } }, 10, TimeUnit.SECONDS)
    }

    private fun publish(wire: String, recoveryTicket: Long? = null): String {
        val report = JSONObject(wire)
        check(report.optInt("panelReport") == 1) { "SERVICE_BIND_FAILED" }
        status = report.getString("summary")
        latestDiagnostics = report.getString("diagnostics")
        commandSummary = report.optString("supportSummary", "명령 지원 여부 미확인")
        if (recoveryTicket != null) {
            recoveryDiagnostics = latestDiagnostics
            if (!gate.complete(recoveryTicket, report.optBoolean("success") && report.optBoolean("trialReady"))) {
                status += "\n" + gate.summary()
            }
        }
        return status
    }
    fun recordFailure(error: Throwable): String {
        // Keep the original invalidation reason when a delayed OFF reaches a closed gate.
        if (!error.message.orEmpty().contains("RECOVERY_NOT_VERIFIED") || gate.ticket() != null) {
            gate.invalidate(PanelMessages.failure(error))
        }
        status = PanelMessages.failure(error) + "\n" + gate.summary()
        latestDiagnostics = (if (inspectionDiagnostics.isNotBlank()) "최근 조회 진단 (참고)\n$inspectionDiagnostics\n\n" else "") + error.stackTraceToString()
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
        gate.invalidate("3번 명령·매핑을 다시 조회했습니다.")
        commandSummary = "명령 지원 여부 미확인 · 조회 중"
        val result = bound().inspect()
        inspectionDiagnostics = JSONObject(result).getString("diagnostics")
        return publish(result)
    }
    fun checkRecovery(): String {
        val ticket = gate.invalidate("4번 사전 검사를 진행 중입니다.")
        commandSummary = "명령 지원 여부 미확인 · 사전 검사 중"
        val result = bound().checkRecovery()
        inspectionDiagnostics = JSONObject(result).getString("diagnostics")
        return publish(result, ticket)
    }
    val inTrial: Boolean get() = pending
    val trialReady: Boolean get() = gate.ticket() != null && connected && !pending && service?.asBinder()?.isBinderAlive == true && hasPermission()

    fun cancelTrial() { gate.invalidate("사용자가 예약된 OFF 시험을 취소했습니다.") }

    fun trialTicket(): Long {
        check(trialReady) { "RECOVERY_NOT_VERIFIED" }
        return gate.ticket() ?: error("RECOVERY_NOT_VERIFIED")
    }

    @Synchronized fun turnOff(seconds: Int, verified: Boolean, ticket: Long, useDirectTouch: Boolean = false): String {
        check(connected) { "ACTIVE_CONNECTION_REQUIRED" }
        check(!pending) { "RESTORE_FIRST" }
        gate.requireCurrent(ticket)
        ShellTouchPolicy.requireOffDuration(useDirectTouch, seconds)
        val remote = bound()
        remote.arm(owner, verified)
        directTouch?.close(); directTouch = null
        val touchTrial = if (useDirectTouch) remote.prepareTouch(owner, true) else null
        if (touchTrial != null) directDiagnostics = remote.touchDiagnostics()
        RemoteAccessibilityService.stopTouch()
        wakeLock?.acquire((seconds + 10) * 1000L)
        pending = true; gate.invalidate("한 번의 OFF 시험에 사전 검사를 사용했습니다.")
        deadline = android.os.SystemClock.elapsedRealtime() + seconds * 1000L
        com.galaxyremote.app.interaction.InteractionDiagnostics.trace.phase(com.galaxyremote.app.interaction.InteractionTrace.Phase.OFF_REQUESTED)
        return try {
            val report = remote.turnOff(seconds)
            if (touchTrial != null) directTouch = ShellTouchClient(remote, touchTrial) { directDiagnostics = it }
            publish(report)
        } catch (error: Exception) {
            restore(); throw error
        }
    }
    @Synchronized fun startTouchOnlyTrial(ticket: Long): String {
        check(connected) { "ACTIVE_CONNECTION_REQUIRED" }
        check(!pending) { "RESTORE_FIRST" }
        gate.requireCurrent(ticket)
        val remote = bound()
        remote.arm(owner, true)
        val trial = remote.prepareTouch(owner, true)
        directDiagnostics = remote.touchDiagnostics()
        RemoteAccessibilityService.stopTouch()
        pending = true; gate.invalidate("30초 화면 ON 직접 터치 비교에 사전 검사를 사용했습니다.")
        deadline = android.os.SystemClock.elapsedRealtime() + 30_000
        wakeLock?.acquire(40_000)
        directTouch?.close(); directTouch = ShellTouchClient(remote, trial) { directDiagnostics = it }
        status = "30초 동안 Shizuku 직접 터치를 비교합니다. 화면 전원 OFF 명령은 실행하지 않았습니다. 대상 앱 반응은 직접 확인하세요."
        return status
    }
    fun releaseDirectPointers() { directTouch?.cancelPointers() }
    fun routeDirectTouch(command: JSONObject, finish: (Boolean, String?) -> Unit): Boolean {
        val client = directTouch ?: return false
        if (!client.accepts(command.optString("type"))) return false
        if (!connected || !pending || !hasPermission() || android.os.SystemClock.elapsedRealtime() >= deadline) {
            client.close(); finish(false, "SHELL_TOUCH_STALE"); return true
        }
        client.submit(command, finish)
        return true
    }
    @Synchronized fun restore(reason: String = "복구·입력 해제를 요청했습니다."): String {
        com.galaxyremote.app.interaction.InteractionDiagnostics.trace.phase(com.galaxyremote.app.interaction.InteractionTrace.Phase.RESTORE_REQUESTED)
        directTouch?.close()
        releaseInputAndWake(); gate.invalidate(reason)
        var restoreAccepted = false
        val result = try {
            service?.restore()?.let {
                restoreAccepted = JSONObject(it).optBoolean("success")
                try { directDiagnostics = service?.touchDiagnostics() ?: directDiagnostics } catch (_: Exception) { }
                publish(it)
            } ?: "shell 서비스가 없습니다. 외부·시간 제한 복구 경로와 실제 패널을 확인하세요."
        } catch (error: Exception) { recordFailure(error) + " 외부 복구 경로를 확인하세요." }
        if (restoreAccepted) directTouch = null
        pending = false; status = result
        return result
    }
    @Synchronized fun sessionConnected(value: Boolean) {
        connected = value
        if (!value && BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) {
            directTouch?.close()
            gate.invalidate("WebRTC 연결이 끊겼거나 세션을 교체했습니다.")
            io.execute { restore("WebRTC 연결 해제에 따른 안전 복구를 처리했습니다.") }
        }
    }
    @Synchronized private fun releaseInputAndWake() {
        RemoteAccessibilityService.stopTouch()
        wakeLock?.let { if (it.isHeld) it.release() }
    }
}
