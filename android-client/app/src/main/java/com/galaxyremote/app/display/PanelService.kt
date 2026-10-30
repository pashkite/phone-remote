package com.galaxyremote.app.display

import android.os.IBinder
import android.os.Process
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Runs as shell through Shizuku. Fixed built-in display 0 only, never root. */
class PanelService : IPanelService.Stub() {
    private val lease = PanelLease()
    private val timer = Executors.newSingleThreadScheduledExecutor()
    private var owner: IBinder? = null
    private var death: IBinder.DeathRecipient? = null
    private var recovery: String? = null
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
    private fun run(vararg args: String): String {
        val p = ProcessBuilder(*args).redirectErrorStream(true).start()
        // Command output is small (help and display state only); bound both IO and runtime.
        val reader = Executors.newSingleThreadExecutor()
        val output = reader.submit<String> { p.inputStream.bufferedReader().use { it.readText().take(65536) } }
        try {
            check(p.waitFor(4, TimeUnit.SECONDS)) { "COMMAND_TIMEOUT" }
            val text = output.get(1, TimeUnit.SECONDS)
            check(p.exitValue() == 0 && !Regex("(?i)unknown command|error:|exception|permission denial").containsMatchIn(text)) { "COMMAND_FAILED: ${text.take(240)}" }
            return text
        } finally { p.destroy(); reader.shutdownNow() }
    }
    @Synchronized override fun inspect(): String {
        shellOnly()
        val help = run("/system/bin/cmd", "display", "help")
        recovery = when {
            help.contains("power-reset") -> "power-reset"
            help.contains("power-on") -> "power-on"
            else -> null
        }
        check(help.contains("power-off") && recovery != null) { "UNSUPPORTED_FIRMWARE" }
        return "Recovery=$recovery; fixed display=0. Physical mapping and actual recovery require local verification.\n" +
            run("/system/bin/dumpsys", "display")
    }
    @Synchronized override fun checkRecovery(): String {
        shellOnly(); check(!off) { "RESTORE_FIRST" }
        inspect()
        lease.checked(false)
        val result = run("/system/bin/cmd", "display", recovery!!, "0")
        lease.checked(true)
        return "Recovery command accepted while ON; this is NOT proof of recovery from OFF.\n$result"
    }
    @Synchronized override fun arm(owner: IBinder, externalRecoveryVerified: Boolean) {
        shellOnly(); check(!off) { "RESTORE_FIRST" }
        lease.arm(externalRecoveryVerified)
        this.owner?.let { old -> death?.let { old.unlinkToDeath(it, 0) } }
        val recipient = IBinder.DeathRecipient { synchronized(this) { restoreInternal() } }
        owner.linkToDeath(recipient, 0)
        this.owner = owner; death = recipient
    }
    @Synchronized override fun turnOff(seconds: Int): String {
        shellOnly(); check(owner?.isBinderAlive == true) { "OWNER_GONE" }
        lease.requireOff(seconds)
        val restore = recovery ?: error("RECOVERY_NOT_VERIFIED")
        // Independent fixed-command process: survives app/UserService death on platforms
        // which leave shell children alive. Survival is explicitly a device-test requirement.
        fallback = ProcessBuilder("/system/bin/sh", "-c", "sleep $seconds; /system/bin/cmd display $restore 0")
            .redirectOutput(java.io.File("/dev/null")).redirectError(java.io.File("/dev/null")).start()
        check(fallback!!.isAlive) { "WATCHDOG_NOT_STARTED" }
        off = true // restore even if OFF partially succeeds or command times out
        lastHeartbeat = android.os.SystemClock.elapsedRealtime()
        scheduled = timer.schedule({ synchronized(this) { restoreInternal() } }, seconds.toLong(), TimeUnit.SECONDS)
        try { run("/system/bin/cmd", "display", "power-off", "0") }
        catch (e: Exception) { restoreInternal(); throw e }
        return "OFF requested for at most ${seconds}s; hardware OFF and frame continuity are UNVERIFIED."
    }
    private fun restoreInternal(): String {
        lease.reset()
        val command = recovery ?: return "No override acquired"
        return try {
            val result = run("/system/bin/cmd", "display", command, "0")
            off = false
            scheduled?.cancel(false); scheduled = null
            // Do not kill the independent fallback: it remains a final bounded reset.
            "Restore command accepted; verify physical panel. $result"
        } catch (e: Exception) { "RESTORE_FAILED: ${e.message}; independent fallback retained" }
    }
    @Synchronized override fun restore(): String { shellOnly(); return restoreInternal() }
    @Synchronized override fun heartbeat() { shellOnly(); lastHeartbeat = android.os.SystemClock.elapsedRealtime() }
    @Synchronized override fun destroy() {
        restoreInternal(); timer.shutdownNow(); kotlin.system.exitProcess(0)
    }
}
