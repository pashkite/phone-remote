package com.galaxyremote.app.streaming

import org.junit.Assert.*
import org.junit.Test

class StreamingPolicyTest {
    @Test fun qualityLimitsAndFallbackAreSafe() {
        assertEquals(StreamQuality(1080, 30, 4500000), StreamQuality.DEFAULT)
        assertEquals(StreamQuality.DEFAULT, StreamQuality.resolve(-1, 999))
        assertEquals(2500000, StreamQuality.resolve(720, 30).bitrateBps)
        assertEquals(30, StreamQuality.resolve(1440, 60).fps)
        assertEquals(7650000, StreamQuality.resolve(1080, 60).bitrateBps)
        assertEquals(StreamQuality.resolve(720, 30), StreamQuality.resolve(1440, 60, 3))
        assertEquals(StreamQuality.resolve(540, 24), StreamQuality.resolve(1080, 60, 4))
        assertEquals(StreamQuality.resolve(720, 30), StreamQuality.resolve(1080, 60, 0, true))
        assertEquals(StreamQuality.DEFAULT, StreamQuality.resolve(1080, 30, 0, false))
    }
    @Test fun thermalRecoveryRequiresStableCooldown() {
        val limiter = ThermalLimiter()
        assertEquals(4, limiter.update(4, 1000))
        assertEquals(4, limiter.update(0, 15000))
        assertEquals(0, limiter.update(0, 31000))
        assertEquals(3, limiter.update(3, 32000))
        assertEquals(5, limiter.update(5, 33000))
    }
    @Test fun scalingPreservesRotationAndEvenDimensionsWithoutUpscaling() {
        assertEquals(1080 to 2400, StreamQuality.size(1440, 3200, 1080))
        assertEquals(2400 to 1080, StreamQuality.size(3200, 1440, 1080))
        assertEquals(720 to 1280, StreamQuality.size(720, 1280, 1440))
        val size = StreamQuality.size(1081, 2401, 720)
        assertEquals(0, size.first % 2); assertEquals(0, size.second % 2)
    }
    @Test fun codecBaselineOrdersVp8FirstAndNeverAdvertisesUnknownCodecs() {
        assertEquals(listOf("VP8", "H264"), CodecPolicy.order(listOf("H264", "AV1", "VP8")))
        assertEquals(listOf("VP8"), CodecPolicy.order(listOf("VP8")))
        assertFalse(CodecPolicy.allowed("h265"))
    }
    private data class Event(val phase: String, val id: String, val x: Int = 0)
    @Test fun queueCoalescesFloodWithoutReorderingBoundaries() {
        val queue = BoundedInputQueue<Event>(4) { if (it.phase == "move") it.id else null }
        assertTrue(queue.offer(Event("down", "a")))
        repeat(10000) { assertTrue(queue.offer(Event("move", "a", it))) }
        assertTrue(queue.offer(Event("up", "a")))
        assertEquals(3, queue.size)
        assertEquals("down", queue.poll()!!.phase)
        assertEquals(9999, queue.poll()!!.x)
        assertEquals("up", queue.poll()!!.phase)
        assertNull(queue.poll())
    }
    @Test fun queueBoundsDistinctGesturesAndCanCancelAllPendingWork() {
        val queue = BoundedInputQueue<Event>(3) { if (it.phase == "move") it.id else null }
        queue.offer(Event("down", "a")); queue.offer(Event("up", "a")); queue.offer(Event("down", "b"))
        assertFalse(queue.offer(Event("move", "b")))
        assertEquals(3, queue.size)
        queue.clear(); assertEquals(0, queue.size)
        assertTrue(queue.offer(Event("cancel", "b")))
        assertEquals("cancel", queue.poll()!!.phase)
    }
    @Test fun moveCoalescingDoesNotCrossPointerIdsOrUpDownBoundaries() {
        val queue = BoundedInputQueue<Event>(8) { if (it.phase == "move") it.id else null }
        listOf(Event("move", "a"), Event("move", "b"), Event("up", "b"), Event("down", "b"), Event("move", "b")).forEach { queue.offer(it) }
        assertEquals(5, queue.size)
        assertEquals(listOf("move", "move", "up", "down", "move"), List(5) { queue.poll()!!.phase })
    }
}
