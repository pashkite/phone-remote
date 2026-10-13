package com.galaxyremote.app

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.Build
import android.util.DisplayMetrics
import android.view.WindowManager
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.CandidatePairChangeEvent
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SoftwareVideoDecoderFactory
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoCodecInfo
import org.webrtc.VideoDecoder
import org.webrtc.VideoDecoderFactory
import org.webrtc.VideoEncoder
import org.webrtc.VideoEncoderFactory
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

class WebRtcSession(
    private val context: Context,
    projectionPermission: Intent,
    private val onControl: (JSONObject) -> Boolean,
    private val onAnswerReady: (sessionId: String, sdp: String) -> Unit,
    private val onLocalCandidate: (
        sessionId: String,
        candidate: String,
        sdpMid: String?,
        sdpMLineIndex: Int,
    ) -> Unit,
    private val onConnectionState: (connected: Boolean, message: String) -> Unit,
    private val onProjectionStopped: () -> Unit,
    private val onControlResult: ((JSONObject, (Boolean, String?) -> Unit) -> Unit)? = null,
) {
    private val preferences = RemotePreferences(context)
    private val eglBase: EglBase
    private val factory: PeerConnectionFactory
    private lateinit var capturer: VideoCapturer
    private lateinit var surfaceTextureHelper: SurfaceTextureHelper
    private lateinit var videoSource: VideoSource
    private lateinit var videoTrack: VideoTrack
    private var peerConnection: PeerConnection? = null
    private var controlChannel: DataChannel? = null
    private var fileChannel: DataChannel? = null
    private var audioChannel: DataChannel? = null
    private var files: RemoteFileTransfer? = null
    private var commands: RemoteCommandProcessor? = null
    private val audio = PlaybackAudioCapture(
        send = { bytes -> audioChannel?.let { it.state() == DataChannel.State.OPEN && it.bufferedAmount() < 32768 && it.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), true)) } ?: false },
        failed = { code -> sendJson(JSONObject().put("type", "audioState").put("state", "failed").put("code", code)) },
    )
    private var videoSender: RtpSender? = null
    private var pendingSessionId: String? = null
    private val answerDelivered = AtomicBoolean(false)
    private var remoteDescriptionSet = false
    private val pendingRemoteCandidates = mutableListOf<IceCandidate>()

    init {
        preferences.markNativeStage("webrtc-initialize")
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                .setEnableInternalTracer(false)
                .createInitializationOptions(),
        )
        preferences.markNativeStage("egl-create")
        eglBase = EglBase.create()
        preferences.markNativeStage("peer-factory-create")
        factory = PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options())
            // Prefer the Galaxy hardware VP8 encoder and retain WebRTC's
            // software fallback. This keeps high-resolution screen sharing
            // responsive without reopening vendor H.264 negotiation issues.
            .setVideoEncoderFactory(Vp8OnlyVideoEncoderFactory(eglBase.eglBaseContext))
            .setVideoDecoderFactory(Vp8OnlyVideoDecoderFactory())
            .createPeerConnectionFactory()

        preferences.markNativeStage("screen-capturer-create")
        capturer = ScreenCapturerAndroid(
            projectionPermission,
            object : MediaProjection.Callback() {
                override fun onStop() {
                    onProjectionStopped()
                }
            },
        )
        preferences.markNativeStage("surface-helper-create")
        surfaceTextureHelper = SurfaceTextureHelper.create(
            "GalaxyRemoteScreenCapture",
            eglBase.eglBaseContext,
        )
        videoSource = factory.createVideoSource(true)
        capturer.initialize(surfaceTextureHelper, context.applicationContext, videoSource.capturerObserver)
        val (captureWidth, captureHeight) = captureSize(HIGH_QUALITY.shortEdge)
        // ScreenCapturerAndroid intentionally ignores its fps argument. Without
        // an output adapter, a 120 Hz Galaxy can feed up to 120 frames/second
        // into WebRTC and overload the native codec path.
        val (initialWidth, initialHeight) = captureSize(BALANCED_QUALITY.shortEdge)
        videoSource.adaptOutputFormat(initialWidth, initialHeight, 1)
        preferences.markNativeStage("screen-capture-start")
        capturer.startCapture(captureWidth, captureHeight, HIGH_QUALITY.fps)
        preferences.markNativeStage("video-track-create")
        videoTrack = factory.createVideoTrack("galaxy-screen", videoSource)
        videoTrack.setEnabled(false)
        preferences.markNativeStage("waiting-for-pc-offer")
    }

    @Synchronized
    fun answerOffer(sessionId: String, offerSdp: String, iceServers: JSONArray) {
        if (sessionId == pendingSessionId && peerConnection != null) return
        preferences.markNativeStage("answer-close-previous-peer")
        closePeer()
        pendingSessionId = sessionId
        answerDelivered.set(false)
        remoteDescriptionSet = false
        pendingRemoteCandidates.clear()

        val configuration = PeerConnection.RTCConfiguration(parseIceServers(iceServers)).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        }
        preferences.markNativeStage("answer-peer-create")
        val peer = factory.createPeerConnection(configuration, PeerObserver(sessionId))
            ?: throw IllegalStateException("WebRTC 연결을 만들지 못했습니다.")
        peerConnection = peer
        videoTrack.setEnabled(true)
        val (activeWidth, activeHeight) = captureSize(BALANCED_QUALITY.shortEdge)
        videoSource.adaptOutputFormat(activeWidth, activeHeight, BALANCED_QUALITY.fps)
        preferences.markNativeStage("answer-add-video-track")
        videoSender = peer.addTrack(videoTrack, listOf("galaxy-screen-stream"))
        val sender = videoSender ?: throw IllegalStateException("화면 영상 전송기를 만들지 못했습니다.")
        val senderParameters = sender.parameters
        senderParameters.encodings.forEach { encoding ->
            encoding.maxBitrateBps = BALANCED_QUALITY.bitrateBps
        }
        sender.setParameters(senderParameters)
        preferences.markNativeStage("answer-set-remote-sdp")
        peer.setRemoteDescription(
            SimpleSdpObserver(
                onSuccess = {
                    remoteDescriptionSet = true
                    flushPendingRemoteCandidates(peer)
                    createAnswer(peer, sessionId)
                },
                onFailure = { error -> onConnectionState(false, "PC 연결 요청을 읽지 못했습니다: $error") },
            ),
            SessionDescription(SessionDescription.Type.OFFER, offerSdp),
        )
    }

    @Synchronized
    fun addRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int) {
        if (candidate.isBlank()) return
        val iceCandidate = IceCandidate(sdpMid, sdpMLineIndex, candidate)
        val peer = peerConnection ?: run {
            pendingRemoteCandidates += iceCandidate
            return
        }
        if (remoteDescriptionSet) peer.addIceCandidate(iceCandidate)
        else pendingRemoteCandidates += iceCandidate
    }

    @Synchronized
    fun setQuality(shortEdge: Int, fps: Int): String {
        val safeShortEdge = shortEdge.takeIf { it in ALLOWED_SHORT_EDGES } ?: BALANCED_QUALITY.shortEdge
        val safeFps = fps.takeIf { it in ALLOWED_FRAME_RATES } ?: BALANCED_QUALITY.fps
        val (width, height) = captureSize(safeShortEdge)
        capturer.changeCaptureFormat(width, height, safeFps)
        videoSource.adaptOutputFormat(width, height, if (peerConnection == null) 1 else safeFps)
        videoSender?.let { sender ->
            val parameters = sender.parameters
            parameters.encodings.forEach { it.maxBitrateBps = bitrateFor(safeShortEdge, safeFps) }
            sender.setParameters(parameters)
        }
        return "${width}×${height} · ${safeFps}fps"
    }

    fun sendJson(value: JSONObject): Boolean {
        val channel = controlChannel ?: return false
        if (channel.state() != DataChannel.State.OPEN) return false
        return channel.send(DataChannel.Buffer(ByteBuffer.wrap(value.toString().toByteArray(Charsets.UTF_8)), false))
    }

    fun sendClipboard(text: String): Boolean {
        if (text.toByteArray(Charsets.UTF_8).size > 65536) return false
        return sendJson(JSONObject().put("type", "clipboard").put("v", 1).put("text", text))
    }

    fun setAudio(enabled: Boolean): String? {
        if (!enabled) { audio.close(); sendJson(JSONObject().put("type", "audioState").put("state", "stopped")); return null }
        if (audioChannel?.state() != DataChannel.State.OPEN) return "AUDIO_CHANNEL_UNAVAILABLE"
        val code = audio.start(context, (capturer as? ScreenCapturerAndroid)?.mediaProjection)
        sendJson(JSONObject().put("type", "audioState").put("state", if (code == null) "started" else "failed").put("code", code))
        return code
    }

    fun sendNotice(message: String) {
        val channel = controlChannel ?: return
        if (channel.state() != DataChannel.State.OPEN) return
        val payload = JSONObject().put("type", "notice").put("message", message).toString()
        channel.send(DataChannel.Buffer(ByteBuffer.wrap(payload.toByteArray(Charsets.UTF_8)), false))
    }

    /**
     * Creates the debug loopback peer on the sender's native factory.
     * libwebrtc's Android NetworkMonitor is process-global; a second factory
     * in one instrumentation process can miss the already-active network.
     */
    internal fun createLoopbackPeerForTesting(
        configuration: PeerConnection.RTCConfiguration,
        observer: PeerConnection.Observer,
    ): PeerConnection? = factory.createPeerConnection(configuration, observer)

    @Synchronized
    fun closePeer() {
        pendingSessionId = null
        commands?.close(); commands = null
        files?.close(); files = null
        audio.close()
        fileChannel?.close(); fileChannel = null
        audioChannel?.unregisterObserver(); audioChannel?.close(); audioChannel = null
        videoTrack.setEnabled(false)
        val (idleWidth, idleHeight) = captureSize(540)
        videoSource.adaptOutputFormat(idleWidth, idleHeight, 1)
        controlChannel?.unregisterObserver()
        controlChannel?.close()
        controlChannel = null
        peerConnection?.close()
        peerConnection?.dispose()
        peerConnection = null
        videoSender = null
        pendingSessionId = null
        answerDelivered.set(false)
        remoteDescriptionSet = false
        pendingRemoteCandidates.clear()
    }

    fun release() {
        preferences.markNativeStage("webrtc-release")
        closePeer()
        try {
            capturer.stopCapture()
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (_: Exception) {
            // Projection may already have been stopped by Android.
        }
        capturer.dispose()
        videoTrack.dispose()
        videoSource.dispose()
        surfaceTextureHelper.dispose()
        factory.dispose()
        eglBase.release()
        preferences.clearNativeStage()
    }

    private fun createAnswer(peer: PeerConnection, sessionId: String) {
        preferences.markNativeStage("answer-create-local-sdp")
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }
        peer.createAnswer(
            SimpleSdpObserver(
                onCreateSuccess = { answer ->
                    preferences.markNativeStage("answer-set-local-sdp")
                    peer.setLocalDescription(
                        SimpleSdpObserver(
                            onSuccess = {
                                preferences.markNativeStage("answer-trickle-ready")
                                emitAnswer(peer, sessionId)
                            },
                            onFailure = { error -> onConnectionState(false, "연결 응답을 만들지 못했습니다: $error") },
                        ),
                        answer,
                    )
                },
                onFailure = { error -> onConnectionState(false, "연결 응답을 만들지 못했습니다: $error") },
            ),
            constraints,
        )
    }

    private fun emitAnswer(peer: PeerConnection, sessionId: String) {
        if (sessionId != pendingSessionId || !answerDelivered.compareAndSet(false, true)) return
        val description = peer.localDescription ?: return
        preferences.markNativeStage("answer-ready")
        onAnswerReady(sessionId, description.description)
    }

    private fun flushPendingRemoteCandidates(peer: PeerConnection) {
        pendingRemoteCandidates.forEach(peer::addIceCandidate)
        pendingRemoteCandidates.clear()
    }

    private fun registerDataChannel(channel: DataChannel) {
        when (channel.label()) {
            "files" -> { files?.close(); fileChannel = channel; files = RemoteFileTransfer(context, channel); return }
            "audio-pcm" -> {
                audioChannel = channel
                channel.registerObserver(object : DataChannel.Observer {
                    override fun onBufferedAmountChange(previousAmount: Long) = Unit
                    override fun onMessage(buffer: DataChannel.Buffer) = Unit
                    override fun onStateChange() { if (channel.state() == DataChannel.State.CLOSED) audio.close() }
                }); return
            }
            "control" -> Unit
            else -> { channel.close(); return }
        }
        controlChannel?.unregisterObserver()
        controlChannel = channel
        commands?.close()
        commands = RemoteCommandProcessor(
            send = { value ->
                sendJson(value)
                if (value.optString("status") in setOf("completed", "failed")) RemoteDiagnostics.record(context, "command", mapOf("status" to value.optString("status"), "code" to value.optString("code")))
            },
            handle = { command, finish ->
                if (onControlResult != null) onControlResult.invoke(command, finish)
                else finish(onControl(command), null)
            },
        )
        fun capabilities() {
            val features = JSONArray().put("commandAck").put("clipboard").put("files").put("diagnostics").put("standby")
            if (Build.VERSION.SDK_INT >= 29) features.put("pcmAudio")
            sendJson(JSONObject().put("type", "capabilities").put("v", 1).put("features", features))
        }
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onStateChange() {
                if (channel.state() == DataChannel.State.OPEN) { capabilities(); sendNotice("원격 조작 채널이 연결됐어요.") }
            }
            override fun onMessage(buffer: DataChannel.Buffer) {
                if (buffer.binary || buffer.data.remaining() > 100000) return
                val data = ByteArray(buffer.data.remaining()); buffer.data.get(data)
                try {
                    val command = JSONObject(String(data, Charsets.UTF_8))
                    if (command.optString("type") == "hello") { capabilities(); return }
                    commands?.receive(command)
                } catch (_: Exception) { RemoteDiagnostics.record(context, "protocol", mapOf("code" to "INVALID_MESSAGE")) }
            }
        })
    }

    private fun parseIceServers(payload: JSONArray): List<PeerConnection.IceServer> {
        val servers = mutableListOf<PeerConnection.IceServer>()
        for (index in 0 until payload.length()) {
            val item = payload.optJSONObject(index) ?: continue
            val urlsValue = item.opt("urls")
            val urls = when (urlsValue) {
                is JSONArray -> (0 until urlsValue.length()).mapNotNull { urlsValue.optString(it).takeIf(String::isNotBlank) }
                is String -> listOf(urlsValue).filter(String::isNotBlank)
                else -> emptyList()
            }
            if (urls.isEmpty()) continue
            val builder = PeerConnection.IceServer.builder(urls)
            item.optString("username").takeIf(String::isNotBlank)?.let(builder::setUsername)
            item.optString("credential").takeIf(String::isNotBlank)?.let(builder::setPassword)
            servers += builder.createIceServer()
        }
        return servers
    }

    private fun captureSize(shortEdge: Int): Pair<Int, Int> {
        val windowManager = context.getSystemService(WindowManager::class.java)
        val width: Int
        val height: Int
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.currentWindowMetrics.bounds
            width = bounds.width()
            height = bounds.height()
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(metrics)
            width = metrics.widthPixels
            height = metrics.heightPixels
        }
        return scaledCaptureSize(width, height, shortEdge)
    }

    private fun scaledCaptureSize(width: Int, height: Int, shortEdge: Int): Pair<Int, Int> {
        val scale = minOf(1.0, shortEdge.toDouble() / minOf(width, height).coerceAtLeast(1))
        fun even(value: Double) = ((value.toInt().coerceAtLeast(2)) / 2) * 2
        return even(width * scale) to even(height * scale)
    }

    private fun bitrateFor(shortEdge: Int, fps: Int): Int {
        val base = when (shortEdge) {
            540 -> 1_200_000
            1440 -> 7_000_000
            else -> 4_500_000
        }
        return if (fps == 60) (base * 1.7).toInt() else base
    }

    private inner class PeerObserver(private val observerSessionId: String) : PeerConnection.Observer {
        override fun onSignalingChange(newState: PeerConnection.SignalingState?) = Unit

        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
            if (pendingSessionId != observerSessionId) return
            RemoteDiagnostics.record(context, "ice", mapOf("state" to (newState?.name ?: "UNKNOWN")))
            when (newState) {
                PeerConnection.IceConnectionState.CONNECTED,
                PeerConnection.IceConnectionState.COMPLETED,
                -> onConnectionState(true, "PC와 암호화된 연결이 완료됐어요.")
                PeerConnection.IceConnectionState.FAILED,
                PeerConnection.IceConnectionState.CLOSED,
                -> onConnectionState(false, "PC 연결이 종료됐습니다. 새 요청을 기다릴게요.")
                else -> Unit
            }
        }

        override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState?) = Unit

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
            if (pendingSessionId != observerSessionId) return
            RemoteDiagnostics.record(context, "peer", mapOf("state" to (newState?.name ?: "UNKNOWN")))
            when (newState) {
                PeerConnection.PeerConnectionState.CONNECTED ->
                    {
                        preferences.markNativeStage("streaming")
                        onConnectionState(true, "PC와 암호화된 연결이 완료됐어요.")
                    }
                PeerConnection.PeerConnectionState.FAILED,
                PeerConnection.PeerConnectionState.CLOSED,
                -> onConnectionState(false, "PC 연결이 종료됐습니다. 새 요청을 기다릴게요.")
                else -> Unit
            }
        }

        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit

        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) = Unit

        override fun onIceCandidate(candidate: IceCandidate?) {
            val sessionId = pendingSessionId ?: return
            if (sessionId != observerSessionId) return
            candidate ?: return
            onLocalCandidate(
                sessionId,
                candidate.sdp,
                candidate.sdpMid,
                candidate.sdpMLineIndex,
            )
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) = Unit
        override fun onAddStream(stream: MediaStream?) = Unit
        override fun onRemoveStream(stream: MediaStream?) = Unit
        override fun onDataChannel(channel: DataChannel?) {
            if (channel != null && pendingSessionId == observerSessionId) registerDataChannel(channel) else channel?.close()
        }
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) = Unit
        override fun onRemoveTrack(receiver: RtpReceiver?) = Unit
        override fun onTrack(transceiver: RtpTransceiver?) = Unit
    }

    companion object {
        private data class Quality(
            val label: String,
            val shortEdge: Int,
            val fps: Int,
            val bitrateBps: Int,
        )

        private val DATA_QUALITY = Quality("데이터 절약", 540, 24, 1_200_000)
        private val BALANCED_QUALITY = Quality("자동", 1080, 30, 4_500_000)
        private val SMOOTH_QUALITY = Quality("부드러움", 1080, 60, 8_000_000)
        private val HIGH_QUALITY = Quality("선명", 1440, 30, 7_000_000)
        private val ALLOWED_SHORT_EDGES = setOf(540, 1080, 1440)
        private val ALLOWED_FRAME_RATES = setOf(24, 30, 60)
    }
}

private class Vp8OnlyVideoEncoderFactory(
    eglContext: EglBase.Context,
) : VideoEncoderFactory {
    private val delegate = DefaultVideoEncoderFactory(eglContext, true, true)

    override fun createEncoder(info: VideoCodecInfo): VideoEncoder? {
        return if (isVp8(info)) delegate.createEncoder(info) else null
    }

    override fun getSupportedCodecs(): Array<VideoCodecInfo> {
        return delegate.supportedCodecs.filter(::isVp8).toTypedArray()
    }
}

private class Vp8OnlyVideoDecoderFactory : VideoDecoderFactory {
    private val delegate = SoftwareVideoDecoderFactory()

    override fun createDecoder(info: VideoCodecInfo): VideoDecoder? {
        return if (isVp8(info)) delegate.createDecoder(info) else null
    }

    override fun getSupportedCodecs(): Array<VideoCodecInfo> {
        return delegate.supportedCodecs.filter(::isVp8).toTypedArray()
    }
}

private fun isVp8(info: VideoCodecInfo): Boolean =
    info.name.equals("VP8", ignoreCase = true)

private class SimpleSdpObserver(
    onSuccess: () -> Unit = {},
    onCreateSuccess: (SessionDescription) -> Unit = {},
    onFailure: (String) -> Unit = {},
) : SdpObserver {
    private val setSuccessCallback = onSuccess
    private val createSuccessCallback = onCreateSuccess
    private val failureCallback = onFailure

    override fun onCreateSuccess(description: SessionDescription?) {
        if (description == null) failureCallback("빈 SDP") else createSuccessCallback(description)
    }

    override fun onSetSuccess() = setSuccessCallback()
    override fun onCreateFailure(error: String?) = failureCallback(error ?: "알 수 없는 오류")
    override fun onSetFailure(error: String?) = failureCallback(error ?: "알 수 없는 오류")
}
