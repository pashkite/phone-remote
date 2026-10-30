package com.galaxyremote.app.interaction

data class PointerEvent(val id: String, val phase: String, val x: Double, val y: Double)
data class HeldPointer(val x: Double, val y: Double, val seenAt: Long)

/** Complete snapshots; missing pointers or malformed transitions fail closed. No Android dependency. */
class MultiPointerState {
    private var sequence = 0L
    private val held = linkedMapOf<String, HeldPointer>()
    val pointers: Map<String, HeldPointer> get() = held.toMap()
    fun apply(seq: Long, events: List<PointerEvent>, now: Long): Boolean {
        if (seq <= sequence || seq <= 0 || events.size > 5 || events.map { it.id }.distinct().size != events.size) return false
        if (events.any { !it.id.matches(Regex("[A-Za-z0-9:_-]{1,48}")) || !it.x.isFinite() || !it.y.isFinite() || it.x !in 0.0..1.0 || it.y !in 0.0..1.0 || it.phase !in setOf("down","move","up","cancel") }) return false
        if (!events.map { it.id }.containsAll(held.keys)) return false
        if (events.any { (it.phase == "down") == held.containsKey(it.id) }) return false
        val next = linkedMapOf<String,HeldPointer>()
        for (event in events) if (event.phase in setOf("down","move")) next[event.id] = HeldPointer(event.x,event.y,now)
        if (next.size > 5) return false
        sequence = seq; held.clear(); held.putAll(next); return true
    }
    fun expire(now: Long): Boolean {
        val expired = held.filterValues { now - it.seenAt >= 2000 }.keys
        expired.forEach(held::remove); return expired.isNotEmpty()
    }
    fun clear() = held.clear() // Preserve sequence: old packets cannot re-arm after a cancel.
    fun newSession() { held.clear(); sequence = 0 }
}
