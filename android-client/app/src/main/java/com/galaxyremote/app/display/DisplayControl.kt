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
import rikka.shizuku.Shizuku
import java.util.concurrent.Executors

/** Process-local owner. No browser-controlled permission grant or arbitrary command API. */
object DisplayControl {
    private val io = Executors.newSingleThreadExecutor()
    private val owner = Binder()
    @Volatile private var service: IPanelService? = null
    @Volatile private var connected = false
    @Volatile var status = "Shizuku not bound; all hardware behavior UNVERIFIED"
        private set
    private var wakeLock: PowerManager.WakeLock? = null
    private var initialized = false
    @Volatile private var pending = false
    @Volatile private var deadline = 0L
    private lateinit var args: Shizuku.UserServiceArgs
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            service = IPanelService.Stub.asInterface(binder)
            status = "Shell service bound. Run recovery preflight."
        }
        override fun onServiceDisconnected(name: ComponentName) {
            service = null; pending = false; releaseInputAndWake()
            status = "Service lost; independent timed recovery must be checked physically."
        }
    }
    @Synchronized fun initialize(context: Context) {
        if (initialized || !BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) return
        initialized = true
        args = Shizuku.UserServiceArgs(ComponentName(context, PanelService::class.java))
            .daemon(true).processNameSuffix("panel_shell").version(1)
        wakeLock = context.getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GalaxyRemote:panel-test")
        Shizuku.addBinderDeadListener {
            service = null; pending = false; releaseInputAndWake()
            status = "Shizuku stopped. OFF disabled; physical restoration UNVERIFIED."
        }
        Executors.newSingleThreadScheduledExecutor().scheduleWithFixedDelay({
            if (pending) {
                val allowed = try { Shizuku.pingBinder() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED } catch (_: Exception) { false }
                if (!connected || !allowed || android.os.SystemClock.elapsedRealtime() >= deadline) {
                    io.execute { status = restore() }
                } else {
                    try { service?.heartbeat() } catch (_: Exception) { io.execute { status = restore() } }
                }
            }
        }, 1, 1, java.util.concurrent.TimeUnit.SECONDS)
    }
    fun bind() {
        check(BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL)
        check(Shizuku.pingBinder()) { "Start Shizuku with wireless debugging first" }
        check(Shizuku.getUid() == 2000) { "Only non-root shell Shizuku is supported" }
        check(Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) { "Grant Shizuku permission locally first" }
        Shizuku.bindUserService(args, connection)
    }
    fun work(action: () -> String, complete: (String) -> Unit) {
        io.execute {
            val result = try { action() } catch (e: Exception) { "FAILED: ${e.message}" }
            status = result; complete(result)
        }
    }
    private fun bound(): IPanelService {
        check(BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL)
        check(Shizuku.pingBinder() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED) { "SHIZUKU_UNAVAILABLE_OR_DENIED" }
        return service ?: error("Bind Shizuku service first")
    }
    fun inspect() = bound().inspect()
    fun checkRecovery() = bound().checkRecovery()
    @Synchronized fun turnOff(seconds: Int, verified: Boolean): String {
        check(connected) { "An active WebRTC connection is required" }
        check(!pending) { "Restore the previous trial first" }
        val remote = bound()
        remote.arm(owner, verified)
        wakeLock?.acquire((seconds + 10) * 1000L)
        pending = true
        deadline = android.os.SystemClock.elapsedRealtime() + seconds * 1000L
        return try { remote.turnOff(seconds) } catch (e: Exception) {
            restore(); throw e
        }
    }
    @Synchronized fun restore(): String {
        releaseInputAndWake()
        val result = try { service?.restore() ?: "No service; verify timed fallback physically" }
            catch (e: Exception) { "Restore unavailable: ${e.message}; check physical panel" }
        pending = false
        return result
    }
    fun sessionConnected(value: Boolean) {
        connected = value
        if (!value && BuildConfig.DISPLAY_CONTROL_EXPERIMENTAL) io.execute { status = restore() }
    }
    @Synchronized private fun releaseInputAndWake() {
        RemoteAccessibilityService.stopTouch()
        wakeLock?.let { if (it.isHeld) it.release() }
    }
}
