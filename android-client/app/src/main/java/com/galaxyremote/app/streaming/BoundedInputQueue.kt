package com.galaxyremote.app.streaming

/** Coalesces only adjacent MOVE samples for the same gesture; boundaries stay ordered. */
class BoundedInputQueue<T>(private val capacity: Int, private val moveId: (T) -> String?) {
    private val queue = ArrayDeque<T>()
    init { require(capacity > 0) }
    val size get() = queue.size
    fun offer(value: T): Boolean {
        val id = moveId(value)
        if (id != null && queue.lastOrNull()?.let(moveId) == id) queue.removeLast()
        if (queue.size >= capacity) return false
        queue.addLast(value); return true
    }
    fun poll(): T? = queue.removeFirstOrNull()
    fun clear() = queue.clear()
}
