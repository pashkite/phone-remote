package com.galaxyremote.app.interaction

/** Typed internal boundary for future separately approved shell injection; no shell command API. */
interface PointerBackend {
    val experimental: Boolean
    fun begin(sessionId: String)
    fun accept(sessionId: String, sequence: Long, events: List<PointerEvent>): Boolean
    fun release()
}
