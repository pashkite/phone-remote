package com.galaxyremote.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        val preferences = RemotePreferences(context)
        if (!preferences.listenerEnabled || preferences.credentials == null) return
        ContextCompat.startForegroundService(
            context,
            Intent(context, ConnectionListenerService::class.java)
                .setAction(ConnectionListenerService.ACTION_START),
        )
    }
}
