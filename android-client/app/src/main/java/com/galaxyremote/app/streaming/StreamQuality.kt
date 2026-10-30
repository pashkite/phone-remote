package com.galaxyremote.app.streaming

/** Short edge, not necessarily landscape height. Pure policy; no performance claims. */
data class StreamQuality(val shortEdge: Int, val fps: Int, val bitrateBps: Int) {
    companion object {
        val DEFAULT = resolve(1080, 30)
        fun resolve(edge: Int, rate: Int, thermal: Int = 0, encoderOverloaded: Boolean = false): StreamQuality {
            var e = edge.takeIf { it in setOf(540, 720, 1080, 1440) } ?: 1080
            var f = rate.takeIf { it in setOf(24, 30, 60) } ?: 30
            if (e == 1440) f = minOf(f, 30)
            if (thermal >= 4) { e = minOf(e, 540); f = minOf(f, 24) }
            else if (thermal >= 3 || encoderOverloaded) { e = minOf(e, 720); f = minOf(f, 30) }
            val base = when (e) { 540 -> 1_200_000; 720 -> 2_500_000; 1440 -> 7_000_000; else -> 4_500_000 }
            return StreamQuality(e, f, if (f == 60) (base * 1.7).toInt() else base)
        }
        fun size(width: Int, height: Int, edge: Int): Pair<Int, Int> {
            val scale = minOf(1.0, edge.toDouble() / minOf(width, height).coerceAtLeast(1))
            fun even(v: Int) = ((v * scale).toInt().coerceAtLeast(2) / 2) * 2
            return even(width) to even(height)
        }
    }
}

object CodecPolicy {
    fun allowed(name: String) = name.equals("VP8", true) || name.equals("H264", true)
    fun rank(name: String) = if (name.equals("VP8", true)) 0 else 1
    fun order(names: List<String>): List<String> = names.filter(::allowed).sortedBy(::rank)
}

/** Immediate thermal downgrade; require 30 seconds of cooler readings before recovery. */
class ThermalLimiter {
    private var ceiling = 0
    private var lastHot = 0L
    fun update(status: Int, nowMs: Long): Int {
        if (status >= ceiling) { ceiling = status; lastHot = nowMs }
        else if (nowMs - lastHot >= 30000) { ceiling = status; lastHot = nowMs }
        return ceiling
    }
}
