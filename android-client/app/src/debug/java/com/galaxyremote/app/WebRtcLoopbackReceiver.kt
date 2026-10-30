package com.galaxyremote.app

import org.json.JSONArray
import org.webrtc.CandidatePairChangeEvent
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoSink
import org.webrtc.VideoTrack
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/**
 * Debug-only browser substitute used by the Android 16 emulator test.
 *
 * The old smoke test only started MediaProjection. This peer creates a real
 * offer, negotiates the data channel, receives and decodes the screen track,
 * and requires an actual video frame before the test may pass.
 */
class WebRtcLoopbackReceiver(private val session: WebRtcSession) {
    private val connected = CountDownLatch(1)
    private val firstFrame = CountDownLatch(1)
    private val failure = AtomicReference<String?>(null)
    private val iceState = AtomicReference(PeerConnection.IceConnectionState.NEW)
    private val gatheringState = AtomicReference(PeerConnection.IceGatheringState.NEW)
    private val localCandidateCount = AtomicInteger(0)
    private val offerCandidateCount = AtomicInteger(0)
    private val answerCandidateCount = AtomicInteger(0)
    private val pendingRemoteCandidates = mutableListOf<IceCandidate>()
    @Volatile
    private var remoteDescriptionSet = false
    private var dataChannel: DataChannel? = null
    private var receivedTrack: VideoTrack? = null
    private val deliveredFrames = AtomicInteger(0)
    private val sink = VideoSink { deliveredFrames.incrementAndGet(); firstFrame.countDown() }
    fun awaitNewFrames(timeoutMs: Long) {
        val initial = deliveredFrames.get()
        val end = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < end) {
            failure.get()?.let { throw IllegalStateException(it) }
            if (deliveredFrames.get() > initial) return
            Thread.sleep(100)
        }
        error("No new decoded frame after quality/reconnect change")
    }
    private val peer: PeerConnection = session.createLoopbackPeerForTesting(
        PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        },
        PeerObserver(),
    ) ?: throw IllegalStateException("테스트 수신 PeerConnection을 만들지 못했습니다.")

    fun connect() {
        dataChannel = peer.createDataChannel("control", DataChannel.Init())
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"))
        }
        peer.createOffer(
            TestSdpObserver(
                onCreateSuccess = { offer ->
                    peer.setLocalDescription(
                        TestSdpObserver(),
                        offer,
                    )
                },
                onFailure = { fail("테스트 offer 생성 실패: $it") },
            ),
            constraints,
        )
    }

    fun acceptAnswer(answerSdp: String) {
        answerCandidateCount.set(candidateCount(answerSdp))
        peer.setRemoteDescription(
            TestSdpObserver(
                onSetSuccess = {
                    remoteDescriptionSet = true
                    synchronized(pendingRemoteCandidates) {
                        pendingRemoteCandidates.forEach { peer.addIceCandidate(it) }
                        pendingRemoteCandidates.clear()
                    }
                },
                onFailure = { fail("테스트 answer 적용 실패: $it") },
            ),
            SessionDescription(SessionDescription.Type.ANSWER, answerSdp),
        )
    }

    fun acceptRemoteCandidate(candidate: String, sdpMid: String?, sdpMLineIndex: Int) {
        if (candidate.isBlank()) return
        val remoteCandidate = IceCandidate(sdpMid, sdpMLineIndex, candidate)
        synchronized(pendingRemoteCandidates) {
            if (remoteDescriptionSet) peer.addIceCandidate(remoteCandidate)
            else pendingRemoteCandidates += remoteCandidate
        }
    }

    fun awaitConnectedAndFirstFrame(timeoutMs: Long) {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs)
        while (System.nanoTime() < deadline) {
            failure.get()?.let { throw IllegalStateException(it) }
            if (connected.count == 0L && firstFrame.count == 0L) return
            firstFrame.await(200, TimeUnit.MILLISECONDS)
        }
        failure.get()?.let { throw IllegalStateException(it) }
        throw IllegalStateException(
            "WebRTC loopback 시간 초과 " +
                "(연결=${connected.count == 0L}, 첫 프레임=${firstFrame.count == 0L}, " +
                "peer=${peer.connectionState()}, ice=${iceState.get()}, gather=${gatheringState.get()}, " +
                "후보=${localCandidateCount.get()}/${offerCandidateCount.get()}/${answerCandidateCount.get()})",
        )
    }

    fun release() {
        receivedTrack?.removeSink(sink)
        receivedTrack = null
        dataChannel?.close()
        dataChannel?.dispose()
        dataChannel = null
        synchronized(pendingRemoteCandidates) { pendingRemoteCandidates.clear() }
        peer.close()
        peer.dispose()
    }

    private fun sendGatheredOffer() {
        if (peer.iceGatheringState() != PeerConnection.IceGatheringState.COMPLETE) return
        val offer = peer.localDescription ?: return fail("테스트 local offer가 비어 있습니다.")
        offerCandidateCount.set(candidateCount(offer.description))
        try {
            session.answerOffer(TEST_SESSION_ID, offer.description, JSONArray())
        } catch (error: Throwable) {
            fail("테스트 offer 처리 실패: ${error.javaClass.simpleName}: ${error.message.orEmpty()}")
        }
    }

    private fun attachVideoTrack(track: VideoTrack?) {
        if (track == null || receivedTrack === track) return
        receivedTrack?.removeSink(sink)
        receivedTrack = track
        track.addSink(sink)
    }

    private fun fail(message: String) {
        failure.compareAndSet(null, message.take(500))
    }

    private inner class PeerObserver : PeerConnection.Observer {
        override fun onSignalingChange(newState: PeerConnection.SignalingState?) = Unit
        override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
            if (newState != null) iceState.set(newState)
        }
        override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
            if (newState != null) iceState.set(newState)
        }
        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
            when (newState) {
                PeerConnection.PeerConnectionState.CONNECTED -> connected.countDown()
                PeerConnection.PeerConnectionState.FAILED -> fail("테스트 PeerConnection 연결 실패")
                else -> Unit
            }
        }
        override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
        override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {
            if (newState != null) gatheringState.set(newState)
            if (newState == PeerConnection.IceGatheringState.COMPLETE) sendGatheredOffer()
        }
        override fun onIceCandidate(candidate: IceCandidate?) {
            if (candidate != null) localCandidateCount.incrementAndGet()
        }
        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent?) = Unit
        override fun onAddStream(stream: MediaStream?) = Unit
        override fun onRemoveStream(stream: MediaStream?) = Unit
        override fun onDataChannel(channel: DataChannel?) = Unit
        override fun onRenegotiationNeeded() = Unit
        override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {
            attachVideoTrack(receiver?.track() as? VideoTrack)
        }
        override fun onRemoveTrack(receiver: RtpReceiver?) = Unit
        override fun onTrack(transceiver: RtpTransceiver?) {
            attachVideoTrack(transceiver?.receiver?.track() as? VideoTrack)
        }
    }

    companion object {
        private const val TEST_SESSION_ID = "android-emulator-loopback"

        private fun candidateCount(sdp: String): Int =
            sdp.lineSequence().count { it.startsWith("a=candidate:") }
    }
}

private class TestSdpObserver(
    onSetSuccess: () -> Unit = {},
    onCreateSuccess: (SessionDescription) -> Unit = {},
    onFailure: (String) -> Unit = {},
) : SdpObserver {
    private val setSuccessCallback = onSetSuccess
    private val createSuccessCallback = onCreateSuccess
    private val failureCallback = onFailure

    override fun onCreateSuccess(description: SessionDescription?) {
        if (description == null) failureCallback("빈 SDP") else createSuccessCallback(description)
    }

    override fun onSetSuccess() = setSuccessCallback()
    override fun onCreateFailure(error: String?) = failureCallback(error ?: "알 수 없는 오류")
    override fun onSetFailure(error: String?) = failureCallback(error ?: "알 수 없는 오류")
}
