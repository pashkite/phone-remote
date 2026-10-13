package com.galaxyremote.app

import android.app.Application
import android.os.Process
import kotlin.system.exitProcess

class GalaxyRemoteApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        cacheDir.listFiles()?.filter { it.name.startsWith("remote-receive-") || it.name.startsWith("remote-send-") }?.forEach { it.delete() }
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            try {
                RemoteDiagnostics.record(this, "crash", mapOf("code" to error.javaClass.simpleName))
                RemotePreferences(this).recordRuntimeError(
                    RemotePreferences.runtimeDiagnostic("앱 실행", error),
                )
            } catch (_: Throwable) {
                // Never hide the original crash if local diagnostics cannot be saved.
            }

            if (previousHandler != null) {
                previousHandler.uncaughtException(thread, error)
            } else {
                Process.killProcess(Process.myPid())
                exitProcess(10)
            }
        }
    }
}
