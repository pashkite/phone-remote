package com.galaxyremote.app

import android.content.Context
import android.content.Intent
import com.galaxyremote.app.streaming.*
import android.os.PowerManager
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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
import org.webrtc.RtpParameters
import org.webrtc.RtpSender
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SoftwareVideoDecoderFactory
import org.webrtc.SurfaceTextureHelper
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
    private val captureFactory: (Intent, () -> Unit) -> CaptureEngine = { permission, stopped -> MediaProjectionCapture(permission, stopped) },
    private val onControlResult: ((JSONObject, (Boolean, String?) -> Unit) -> Unit)? = null,
) {
    private val preferences = RemotePreferences(context)
    private val eglBase: EglBase
    private val factory: PeerConnectionFactory
    private lateinit var captureEngine: CaptureEngine
    private var requestedQuality = StreamQuality.DEFAULT
    private var appliedQuality = StreamQuality.DEFAULT
    private val statsExecutor = Executors.newSingleThreadScheduledExecutor()
    private var statsFuture: java.util.concurrent.ScheduledFuture<*>? = null
    private var lastStatsAt = 0L
    private var lastCaptureFrames = 0L
    private var lastSentFrames: Long? = null
    private var lastSentBytes = 0L
    private var lastEncodeTime: Double? = null
    private var overloadSamples = 0
    private var encoderOverloaded = false
    private var encoderRecoverySamples = 0
    private var lastCpuTime = 0L
    private var lastSendDelay = 0.0
    private var lastPacketsSent = 0L
    private var rtpLimitsApplied = false
    private val thermalLimiter = ThermalLimiter()
    private var lastCaptureWidth = 0
    private var lastCaptureHeight = 0
    private lateinit var surfaceTextureHelper: SurfaceTextureHelper
    private lateinit var videoSource: VideoSource
    private lateinit var videoTrack: VideoTrack
    @Volatile private var peerConnection: PeerConnection? = null
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
    @Volatile private var pendingSessionId: String? = null
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
            // VP8 is the baseline; H.264 is advertised only when libwebrtc supports it.
            // The browser must explicitly opt in, keeping VP8 in its offer.
            .setVideoEncoderFactory(CompatibleVideoEncoderFactory(eglBase.eglBaseContext))
            .setVideoDecoderFactory(Vp8OnlyVideoDecoderFactory())
            .createPeerConnectionFactory()

        try {
            preferences.markNativeStage("screen-capturer-create")
            captureEngine = captureFactory(projectionPermission, onProjectionStopped)
            preferences.markNativeStage("surface-helper-create")
            surfaceTextureHelper = SurfaceTextureHelper.create(
                "GalaxyRemoteScreenCapture",
                eglBase.eglBaseContext,
            )
            videoSource = factory.createVideoSource(true)
            captureEngine.initialize(surfaceTextureHelper, context.applicationContext, videoSource.capturerObserver)
            val (captureWidth, captureHeight) = captureSize(StreamQuality.DEFAULT.shortEdge)
            // ScreenCapturerAndroid intentionally ignores its fps argument. Without
            // an output adapter, a 120 Hz Galaxy can feed up to 120 frames/second
            // into WebRTC and overload the native codec path.
            val (initialWidth, initialHeight) = captureSize(StreamQuality.DEFAULT.shortEdge)
            videoSource.adaptOutputFormat(initialWidth, initialHeight, 1)
            preferences.markNativeStage("screen-capture-start")
            captureEngine.start(captureWidth, captureHeight, StreamQuality.DEFAULT.fps)
            lastCaptureWidth = captureWidth; lastCaptureHeight = captureHeight
            preferences.markNativeStage("video-track-create")
            videoTrack = factory.createVideoTrack("galaxy-screen", videoSource)
            videoTrack.setEnabled(false)
            preferences.markNativeStage("waiting-for-pc-offer")
        } catch (error: Exception) {
            statsExecutor.shutdownNow()
            if (::captureEngine.isInitialized) runCatching { captureEngine.release() }
            if (::videoTrack.isInitialized) runCatching { videoTrack.dispose() }
            if (::videoSource.isInitialized) runCatching { videoSource.dispose() }
            if (::surfaceTextureHelper.isInitialized) runCatching { surfaceTextureHelper.dispose() }
            runCatching { factory.dispose() }
            runCatching { eglBase.release() }
            throw error
        }
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
        val (activeWidth, activeHeight) = captureSize(StreamQuality.DEFAULT.shortEdge)
        videoSource.adaptOutputFormat(activeWidth, activeHeight, StreamQuality.DEFAULT.fps)
        preferences.markNativeStage("answer-add-video-track")
        videoSender = peer.addTrack(videoTrack, listOf("galaxy-screen-stream"))
        val sender = videoSender ?: throw IllegalStateException("화면 영상 전송기를 만들지 못했습니다.")
        val senderParameters = sender.parameters
        senderParameters.encodings.forEach { encoding ->
            encoding.maxBitrateBps = StreamQuality.DEFAULT.bitrateBps
            encoding.maxFramerate = StreamQuality.DEFAULT.fps
        }
        rtpLimitsApplied = sender.setParameters(senderParameters)
        requestedQuality = StreamQuality.DEFAULT
        applyQuality()
        startTelemetry(peer)
        preferences.markNativeStage("answer-set-remote-sdp")
        peer.setRemoteDescription(
            SimpleSdpObserver(
                onSuccess = success@{
                    if (peerConnection !== peer || pendingSessionId != sessionId) return@success
                    remoteDescriptionSet = true
                    flushPendingRemoteCandidates(peer)
                    createAnswer(peer, sessionId)
                },
                onFailure = { error -> if (peerConnection === peer && pendingSessionId == sessionId) onConnectionState(false, "PC 연결 요청을 읽지 못했습니다: $error") },
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
        requestedQuality = StreamQuality.resolve(shortEdge, fps)
        applyQuality()
        return "${appliedQuality.shortEdge}p · ${appliedQuality.fps}fps · ${appliedQuality.bitrateBps}bps"
    }

    @Synchronized fun refreshCapture() = applyQuality()

    private fun thermalStatus(): Int = if (Build.VERSION.SDK_INT >= 29)
        context.getSystemService(PowerManager::class.java).currentThermalStatus else 0

    private fun applyQuality() {
        val quality = StreamQuality.resolve(requestedQuality.shortEdge, requestedQuality.fps, thermalLimiter.update(thermalStatus(), android.os.SystemClock.elapsedRealtime()), encoderOverloaded)
        val (width, height) = captureSize(quality.shortEdge)
        videoSender?.let { sender ->
            val parameters = sender.parameters
            parameters.degradationPreference = RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
            parameters.encodings.forEach { it.maxBitrateBps = quality.bitrateBps; it.maxFramerate = quality.fps }
            rtpLimitsApplied = sender.setParameters(parameters)
        }
        if (width != lastCaptureWidth || height != lastCaptureHeight) {
            captureEngine.resize(width, height, quality.fps)
            lastCaptureWidth = width; lastCaptureHeight = height
        }
        // ScreenCapturerAndroid ignores fps. Adaptation AND RTP maxFramerate bound output.
        videoSource.adaptOutputFormat(width, height, if (peerConnection == null) 1 else quality.fps)
        appliedQuality = quality
    }

    private fun startTelemetry(peer: PeerConnection) {
        lastStatsAt = 0; overloadSamples = 0; encoderOverloaded = false; encoderRecoverySamples = 0
        statsFuture = statsExecutor.scheduleWithFixedDelay({
            synchronized(this) {
                if (peerConnection !== peer) return@synchronized
                val safe = StreamQuality.resolve(requestedQuality.shortEdge, requestedQuality.fps, thermalLimiter.update(thermalStatus(), android.os.SystemClock.elapsedRealtime()), encoderOverloaded)
                if (safe != appliedQuality || !rtpLimitsApplied) try { applyQuality() } catch (_: Exception) { /* Retry on next bounded sample. */ }
                peer.getStats { report -> try { statsExecutor.execute { synchronized(this) {
                    if (peerConnection !== peer) return@synchronized
                    val now = android.os.SystemClock.elapsedRealtime()
                    val seconds = (now - lastStatsAt) / 1000.0
                    val outbound = report.statsMap.values.firstOrNull { it.type == "outbound-rtp" && (it.members["kind"] == "video" || it.members["mediaType"] == "video") }?.members ?: return@synchronized
                    fun number(key: String) = (outbound[key] as? Number)?.toDouble() ?: 0.0
                    val frames = (outbound["framesEncoded"] as? Number)?.toLong()
                    val bytes = number("bytesSent").toLong()
                    val encodeTime = (outbound["totalEncodeTime"] as? Number)?.toDouble()
                    val captures = captureEngine.frames
                    val cpu = android.os.Process.getElapsedCpuTime()
                    val previousFrames = lastSentFrames
                    val previousEncode = lastEncodeTime
                    val sent = if (frames != null && previousFrames != null && frames >= previousFrames) frames - previousFrames else null
                    val packets = number("packetsSent").toLong()
                    val delay = number("totalPacketSendDelay")
                    if (lastStatsAt > 0 && seconds > 0 && bytes >= lastSentBytes) {
                        val encodeMs = if (sent != null && sent > 0 && encodeTime != null && previousEncode != null && encodeTime >= previousEncode) (encodeTime - previousEncode) * 1000 / sent else null
                        val overloaded = outbound["qualityLimitationReason"] == "cpu" || (encodeMs != null && encodeMs > 900.0 / appliedQuality.fps)
                        overloadSamples = if (overloaded) overloadSamples + 1 else 0
                        encoderRecoverySamples = if (!overloaded) encoderRecoverySamples + 1 else 0
                        if (overloadSamples >= 3) encoderOverloaded = true
                        if (encoderRecoverySamples >= 15) encoderOverloaded = false
                        val codec = report.statsMap[outbound["codecId"]]?.members?.get("mimeType")
                        val data = JSONObject().put("captureEngine", captureEngine.name)
                            .put("captureFps", (captures - lastCaptureFrames).coerceAtLeast(0) / seconds)
                            .put("sendFps", if (sent != null) sent / seconds else JSONObject.NULL).put("sendKbps", (bytes - lastSentBytes) * 8 / seconds / 1000)
                            .put("encodeMs", encodeMs ?: JSONObject.NULL)
                            .put("sendQueueMs", if (packets > lastPacketsSent) (delay - lastSendDelay).coerceAtLeast(0.0) * 1000 / (packets - lastPacketsSent) else JSONObject.NULL)
                            .put("encoder", outbound["encoderImplementation"] ?: JSONObject.NULL)
                            .put("hardwareEncoder", outbound["powerEfficientEncoder"] ?: JSONObject.NULL)
                            .put("codec", codec ?: JSONObject.NULL).put("thermal", thermalStatus())
                            .put("encoderOverloaded", encoderOverloaded)
                            .put("cpuCorePercent", (cpu - lastCpuTime).coerceAtLeast(0) / (seconds * 10))
                            .put("configuredEdge", appliedQuality.shortEdge).put("configuredFps", appliedQuality.fps)
                            .put("configuredBitrate", appliedQuality.bitrateBps).put("rtpLimitsApplied", rtpLimitsApplied)
                            .put("width", number("frameWidth")).put("height", number("frameHeight"))
                        if (controlChannel?.bufferedAmount()?.let { it < 16384 } == true)
                            sendJson(JSONObject().put("type", "streamMetrics").put("v", 1).put("data", data))
                        try {
                            if (StreamQuality.resolve(requestedQuality.shortEdge, requestedQuality.fps, thermalLimiter.update(thermalStatus(), android.os.SystemClock.elapsedRealtime()), encoderOverloaded) != appliedQuality) applyQuality()
                        } catch (_: Exception) { sendNotice("영상 제한 설정을 적용하지 못했습니다.") }
                    }
                    lastStatsAt = now; lastCaptureFrames = captures; lastSentFrames = frames; lastSentBytes = bytes
                    lastEncodeTime = encodeTime; lastCpuTime = cpu; lastSendDelay = delay; lastPacketsSent = packets
                } } } catch (_: java.util.concurrent.RejectedExecutionException) { /* Released session. */ } }
            }
        }, 0, 2, TimeUnit.SECONDS)
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
        val code = audio.start(context, captureEngine.projection)
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
        statsFuture?.cancel(false); statsFuture = null
        RemoteAccessibilityService.endPointerSession()
        RemoteAccessibilityService.stopTouch()
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
        statsExecutor.shutdownNow()
        try { captureEngine.release() } catch (_: Exception) { /* projection may already be stopped */ }
        videoTrack.dispose()
        videoSource.dispose()
        surfaceTextureHelper.dispose()
        factory.dispose()
        eglBase.release()
        preferences.clearNativeStage()
    }

    private fun createAnswer(peer: PeerConnection, sessionId: String) {
        if (peerConnection !== peer || pendingSessionId != sessionId) return
        preferences.markNativeStage("answer-create-local-sdp")
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }
        peer.createAnswer(
            SimpleSdpObserver(
                onCreateSuccess = created@{ answer ->
                    if (peerConnection !== peer || pendingSessionId != sessionId) return@created
                    preferences.markNativeStage("answer-set-local-sdp")
                    peer.setLocalDescription(
                        SimpleSdpObserver(
                            onSuccess = {
                                preferences.markNativeStage("answer-trickle-ready")
                                emitAnswer(peer, sessionId)
                            },
                            onFailure = { error -> if (peerConnection === peer && pendingSessionId == sessionId) onConnectionState(false, "연결 응답을 만들지 못했습니다: $error") },
                        ),
                        answer,
                    )
                },
                onFailure = { error -> if (peerConnection === peer && pendingSessionId == sessionId) onConnectionState(false, "연결 응답을 만들지 못했습니다: $error") },
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
        RemoteAccessibilityService.beginPointerSession(pendingSessionId ?: "") { code ->
            sendJson(JSONObject().put("type", "inputError").put("code", code))
            if (code.startsWith("LIVE_GESTURE_")) {
                sendNotice(when (code) {
                    "LIVE_GESTURE_CANCELLED" -> "Android가 터치·드래그를 취소했습니다. 화면 ON과 OFF 결과를 비교하고 앱의 입력 진단을 확인하세요."
                    "LIVE_GESTURE_REJECTED" -> "Android가 터치·드래그 접수를 거절했습니다. 앱의 입력 진단을 확인하세요."
                    else -> "터치·드래그 처리 중 오류가 발생했습니다. 앱의 입력 진단을 확인하세요."
                })
            }
        }
        commands = RemoteCommandProcessor(
            send = { value ->
                sendJson(value)
                if (value.optString("status") == "failed" && value.optString("code").startsWith("SHELL_")) {
                    sendNotice(if (value.optString("code") == "SHELL_SINGLE_POINTER_ONLY")
                        "이 Shizuku 터치 후보는 단일 포인터만 지원합니다. 멀티터치 시험은 지원하지 않습니다."
                        else "Shizuku 직접 터치를 전달하지 못했습니다. 즉시 복구 후 입력 진단을 확인하세요.")
                }
                if (value.optString("status") in setOf("completed", "failed")) RemoteDiagnostics.record(context, "command", mapOf("status" to value.optString("status"), "code" to value.optString("code")))
            },
            handle = { command, finish ->
                com.galaxyremote.app.interaction.InteractionDiagnostics.trace.received(command.optString("type"))
                if (onControlResult != null) onControlResult.invoke(command) { ok, code ->
                    if (!ok && code?.startsWith("SHELL_") == true) {
                        sendJson(JSONObject().put("type", "inputError").put("code", code))
                        sendNotice(if (code == "SHELL_SINGLE_POINTER_ONLY") "Shizuku 후보는 단일 포인터만 지원합니다." else "Shizuku 직접 터치가 실패했습니다. 복구 후 진단을 확인하세요.")
                    }
                    if (!ok && command.optString("type") == "pointerFrame") sendJson(JSONObject().put("type","inputError").put("code",code ?: "INPUT_REJECTED"))
                    finish(ok, code)
                }
                else finish(onControl(command), null)
            },
        )
        fun capabilities() {
            val features = JSONArray().put("multiTouchExperimental").put("streamMetrics").put("quality720").put("lowLatencyInput").put("commandAck").put("clipboard").put("files").put("diagnostics").put("standby").put("liveTouch")
            if (Build.VERSION.SDK_INT >= 29) features.put("pcmAudio")
            sendJson(JSONObject().put("type", "capabilities").put("v", 1).put("inputSessionId", pendingSessionId).put("features", features))
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
                    if (command.optString("type") == "pointerFrame" && (command.optInt("v") != 1 || command.optString("sessionId") != pendingSessionId)) {
                        sendJson(JSONObject().put("type","inputError").put("code","SESSION_MISMATCH")); return
                    }
                    commands?.receive(command)
                } catch (_: Exception) { RemoteDiagnostics.record(context, "protocol", mapOf("code" to "INVALID_MESSAGE")) }
            }
        })
        if (channel.state() == DataChannel.State.OPEN) capabilities()
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
        return StreamQuality.size(width, height, shortEdge)
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
                PeerConnection.IceConnectionState.DISCONNECTED -> {
                    com.galaxyremote.app.display.DisplayControl.sessionConnected(false)
                    RemoteAccessibilityService.stopTouch()
                }
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
                PeerConnection.PeerConnectionState.DISCONNECTED -> {
                    com.galaxyremote.app.display.DisplayControl.sessionConnected(false)
                    RemoteAccessibilityService.stopTouch()
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


}

private class CompatibleVideoEncoderFactory(
    eglContext: EglBase.Context,
) : VideoEncoderFactory {
    private val delegate = DefaultVideoEncoderFactory(eglContext, true, true)

    override fun createEncoder(info: VideoCodecInfo): VideoEncoder? {
        return if (CodecPolicy.allowed(info.name)) delegate.createEncoder(info) else null
    }

    override fun getSupportedCodecs(): Array<VideoCodecInfo> {
        return delegate.supportedCodecs.filter { CodecPolicy.allowed(it.name) }.sortedBy { CodecPolicy.rank(it.name) }.toTypedArray()
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
