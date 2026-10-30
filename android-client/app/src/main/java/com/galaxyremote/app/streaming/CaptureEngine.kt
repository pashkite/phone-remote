package com.galaxyremote.app.streaming

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import org.webrtc.CapturerObserver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.util.concurrent.atomic.AtomicLong

/** Produces WebRTC frames. Future shell implementations must handle consent, surfaces and cleanup. */
interface CaptureEngine {
    val name: String
    val projection: MediaProjection?
    val frames: Long
    fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver)
    fun start(width: Int, height: Int, fps: Int)
    fun resize(width: Int, height: Int, fps: Int)
    fun release()
}

class MediaProjectionCapture(permission: Intent, stopped: () -> Unit) : CaptureEngine {
    private val counter = AtomicLong()
    private val capturer = ScreenCapturerAndroid(permission, object : MediaProjection.Callback() {
        override fun onStop() { stopped() }
    })
    override val name = "MediaProjection"
    override val projection: MediaProjection? get() = capturer.mediaProjection
    override val frames get() = counter.get()
    override fun initialize(helper: SurfaceTextureHelper, context: Context, observer: CapturerObserver) {
        capturer.initialize(helper, context, object : CapturerObserver {
            override fun onCapturerStarted(success: Boolean) = observer.onCapturerStarted(success)
            override fun onCapturerStopped() = observer.onCapturerStopped()
            override fun onFrameCaptured(frame: VideoFrame) {
                counter.incrementAndGet()
                observer.onFrameCaptured(frame) // borrowed frame; no copy or retained frame queue
            }
        })
    }
    override fun start(width: Int, height: Int, fps: Int) = capturer.startCapture(width, height, fps)
    override fun resize(width: Int, height: Int, fps: Int) = capturer.changeCaptureFormat(width, height, fps)
    override fun release() {
        try { capturer.stopCapture() }
        catch (_: InterruptedException) { Thread.currentThread().interrupt() }
        finally { capturer.dispose() }
    }
}
