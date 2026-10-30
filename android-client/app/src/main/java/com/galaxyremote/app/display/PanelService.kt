package com.galaxyremote.app.display

import android.os.IBinder
import android.os.Process
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Runs as shell through Shizuku. Fixed built-in display 0 only, never root. */
class PanelService : IPanelService.Stub() {
    private val lease = PanelLease()
    private val preflight = PanelPreflight(::query, lease)
    private val timer = Executors.newSingleThreadScheduledExecutor()
    private var owner: IBinder? = null
    private var death: IBinder.DeathRecipient? = null
    private var off = false
    private var fallback: java.lang.Process? = null
    private var scheduled: java.util.concurrent.ScheduledFuture<*>? = null
    private var lastHeartbeat = 0L

    init {
        timer.scheduleWithFixedDelay({ synchronized(this) {
            if (off && android.os.SystemClock.elapsedRealtime() - lastHeartbeat > 8000) restoreInternal()
        } }, 1, 1, TimeUnit.SECONDS)
    }

    private fun shellOnly() { check(Process.myUid() == 2000) { "SHELL_ONLY_NO_ROOT" } }

    /** Capture data, including nonzero status. Only control() interprets status as command success. */
    private fun query(command: PanelCommand): PanelCommandResult {
        val process = ProcessBuilder(command.arguments).redirectErrorStream(true).start()
        val reader = Executors.newSingleThreadExecutor()
        val output = reader.submit<Pair<String, Boolean>> {
            process.inputStream.bufferedReader().use { stream ->
                val kept = StringBuilder()
                val buffer = CharArray(2048)
                var truncated = false
                while (true) {
                    val count = stream.read(buffer)
                    if (count < 0) break
                    val remaining = (65536 - kept.length).coerceAtLeast(0)
                    kept.append(buffer, 0, minOf(count, remaining))
                    if (count > remaining) truncated = true
                }
                kept.toString() to truncated
            }
        }
        try {
            val finished = process.waitFor(4, TimeUnit.SECONDS)
            if (!finished) process.destroyForcibly()
            val captured = output.get(1, TimeUnit.SECONDS)
            return PanelCommandResult(if (finished) process.exitValue() else null, captured.first, !finished, captured.second)
        } finally {
            if (process.isAlive) process.destroyForcibly()
            process.inputStream.close()
            reader.shutdownNow()
        }
    }

    private fun control(command: PanelCommand): String {
        require(command in setOf(PanelCommand.OFF, PanelCommand.RESET, PanelCommand.ON))
        val result = query(command)
        check(result.controlSucceeded) {
            "${if (result.timedOut) "COMMAND_TIMEOUT" else "COMMAND_FAILED"}\n${result.diagnostics(command.arguments.joinToString(" "))}"
        }
        return result.diagnostics(command.arguments.joinToString(" "))
    }

    private fun wire(report: PanelReport): String = JSONObject().apply {
        put("panelReport", 1)
        put("summary", report.summary)
        put("diagnostics", report.diagnostics)
        put("success", report.success)
        put("trialReady", report.trialReady)
        put("supportSummary", preflight.inspection?.support?.summary() ?: "명령 지원 여부 미확인")
    }.toString()

    @Synchronized override fun inspect(): String {
        shellOnly(); check(!off) { "RESTORE_FIRST" }
        val inspection = preflight.inspect()
        val summary = "명령 조회 결과\n${inspection.support.summary()}\n" +
            "화면 상태 조회: ${if (inspection.display.controlSucceeded) "완료" else "실패 (명령 조회와 별도)"}\n실제 패널 매핑·OFF 이후 복구는 미검증입니다."
        return wire(PanelReport(summary, inspection.diagnostics(), inspection.support.known))
    }

    @Synchronized override fun checkRecovery(): String {
        shellOnly(); check(!off) { "RESTORE_FIRST" }
        return wire(preflight.checkRecovery())
    }

    @Synchronized override fun arm(owner: IBinder, externalRecoveryVerified: Boolean) {
        shellOnly(); check(!off) { "RESTORE_FIRST" }
        preflight.requireOffSupport()
        lease.arm(externalRecoveryVerified)
        this.owner?.let { old -> death?.let { old.unlinkToDeath(it, 0) } }
        val recipient = IBinder.DeathRecipient { synchronized(this) { restoreInternal() } }
        owner.linkToDeath(recipient, 0)
        this.owner = owner; death = recipient
    }

    @Synchronized override fun turnOff(seconds: Int): String {
        shellOnly(); check(owner?.isBinderAlive == true) { "OWNER_GONE" }
        preflight.requireOffSupport()
        lease.requireOff(seconds)
        val restore = preflight.recovery?.nameInHelp ?: error("RECOVERY_NOT_VERIFIED")
        // Built-in, bounded watchdog only. No caller-selected shell text or recovery fallback.
        fallback = ProcessBuilder("/system/bin/sh", "-c", "sleep $seconds; /system/bin/cmd display $restore 0")
            .redirectOutput(java.io.File("/dev/null")).redirectError(java.io.File("/dev/null")).start()
        check(fallback!!.isAlive) { "WATCHDOG_NOT_STARTED" }
        off = true // restore even if OFF partially succeeds or command times out
        lastHeartbeat = android.os.SystemClock.elapsedRealtime()
        scheduled = timer.schedule({ synchronized(this) { restoreInternal() } }, seconds.toLong(), TimeUnit.SECONDS)
        val result = try { control(PanelCommand.OFF) } catch (error: Exception) { restoreInternal(); throw error }
        return wire(PanelReport("최대 ${seconds}초 OFF를 요청했습니다." + " 실제 패널·영상·입력·복구는 미검증입니다.", result, true))
    }

    private fun restoreInternal(): String {
        lease.reset()
        val command = preflight.recovery ?: return wire(PanelReport("설정된 복구 명령이 없습니다. 실제 패널을 직접 확인하세요.", "No verified advertised recovery candidate", false))
        return try {
            val result = control(command)
            off = false
            scheduled?.cancel(false); scheduled = null
            // Keep the independent fallback as a final bounded reset.
            wire(PanelReport("복구 명령이 수락됐습니다. 실제 패널 ON 여부를 직접 확인하세요.", result, true))
        } catch (error: Exception) {
            wire(PanelReport("복구 명령이 실패했습니다. 외부 복구 경로를 사용하세요. 시간 제한 복구 장치는 유지합니다.", error.stackTraceToString(), false))
        }
    }
    @Synchronized override fun restore(): String { shellOnly(); return restoreInternal() }
    @Synchronized override fun heartbeat() { shellOnly(); lastHeartbeat = android.os.SystemClock.elapsedRealtime() }
    @Synchronized override fun destroy() {
        restoreInternal(); timer.shutdownNow(); kotlin.system.exitProcess(0)
    }
}
