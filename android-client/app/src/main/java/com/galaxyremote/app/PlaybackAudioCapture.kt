package com.galaxyremote.app

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import androidx.core.content.ContextCompat

/** Captures permitted app playback only. No microphone source is opened. */
class PlaybackAudioCapture(private val send: (ByteArray) -> Boolean, private val failed: (String) -> Unit) {
    @Volatile private var running = false
    private var record: AudioRecord? = null
    private var worker: Thread? = null
    fun start(context: Context, projection: MediaProjection?): String? {
        close()
        if (Build.VERSION.SDK_INT < 29) return "ANDROID_10_REQUIRED"
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return "AUDIO_PERMISSION_REQUIRED"
        if (projection == null) return "PROJECTION_REQUIRED"
        try {
            val config = AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME).addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build()
            val audio = AudioRecord.Builder().setAudioFormat(AudioFormat.Builder().setSampleRate(48000)
                .setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(19200).setAudioPlaybackCaptureConfig(config).build()
            record = audio
            if (audio.state != AudioRecord.STATE_INITIALIZED) { close(); return "AUDIO_INIT_FAILED" }
            audio.startRecording(); running = true
            worker = Thread({
                val bytes = ByteArray(1920) // 20ms at 48kHz, signed little-endian PCM16
                try {
                    while (running) {
                        val read = audio.read(bytes, 0, bytes.size, AudioRecord.READ_BLOCKING)
                        if (read < 0) { if (running) failed("AUDIO_READ_FAILED"); break }
                        if (read > 0 && running) send(bytes.copyOf(read))
                    }
                } catch (_: Exception) { if (running) failed("AUDIO_CAPTURE_FAILED") }
                finally { running = false }
            }, "GalaxyPlaybackAudio").also { it.start() }
            return null
        } catch (_: SecurityException) { close(); return "AUDIO_PERMISSION_DENIED" }
        catch (_: Exception) { close(); return "AUDIO_CAPTURE_FAILED" }
    }
    fun close() {
        running = false
        try { record?.stop() } catch (_: Exception) { }
        if (Thread.currentThread() !== worker) try { worker?.join(500) } catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        record?.release(); record = null; worker = null
    }
}
