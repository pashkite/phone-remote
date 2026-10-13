package com.galaxyremote.app

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import org.json.JSONObject
import org.webrtc.DataChannel
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

class RemoteFileTransfer(private val context: Context, private val channel: DataChannel) {
    data class Offer(val id: String, val name: String, val size: Long, val hash: String)
    @Volatile var pendingOffer: Offer? = null
        private set
    @Volatile private var closed = false
    @Volatile private var sendingId: String? = null
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var incoming: Offer? = null
    private var destination: Uri? = null
    private var temp: File? = null
    private var output: FileOutputStream? = null
    private var bytes = 0L
    private var digest = MessageDigest.getInstance("SHA-256")
    private var outgoing: File? = null
    private var outgoingOffer: Offer? = null
    private val timeout = Runnable { cancel() }

    init {
        current = this
        channel.registerObserver(object : DataChannel.Observer {
            override fun onStateChange() { if (channel.state() == DataChannel.State.CLOSED) close() }
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onMessage(buffer: DataChannel.Buffer) {
                if (closed || buffer.data.remaining() > CHUNK + 20) return
                val data = ByteArray(buffer.data.remaining()); buffer.data.get(data)
                if (!buffer.binary) {
                    try {
                        val m = JSONObject(String(data, Charsets.UTF_8))
                        if (m.optString("type") == "cancel" && m.optString("id") == sendingId) sendingId = null
                    } catch (_: Exception) { }
                }
                try { io.execute { if (!closed) try { if (buffer.binary) chunk(data) else message(JSONObject(String(data, Charsets.UTF_8))) } catch (_: Exception) { cancelInternal(true) } } } catch (_: Exception) { }
            }
        })
    }
    private fun touch() { main.removeCallbacks(timeout); if (!closed) main.postDelayed(timeout, 60_000) }
    private fun send(message: JSONObject): Boolean = !closed && channel.state() == DataChannel.State.OPEN && channel.send(DataChannel.Buffer(ByteBuffer.wrap(message.put("v", 1).toString().toByteArray()), false))
    private fun reply(type: String, id: String) = send(JSONObject().put("type", type).put("id", id))
    private fun message(m: JSONObject) {
        if (m.optInt("v") != 1) throw IllegalArgumentException()
        val id = UUID.fromString(m.getString("id")).toString()
        when (m.optString("type")) {
            "offer" -> {
                if (pendingOffer != null || incoming != null || outgoing != null) { reply("cancel", id); return }
                val size = m.getLong("size"); val hash = m.getString("hash")
                require(size in 0..MAX_SIZE && hash.matches(Regex("[a-f0-9]{64}")))
                pendingOffer = Offer(id, safeName(m.getString("name")), size, hash); touch()
            }
            "accept" -> if (outgoingOffer?.id == id && sendingId == id) pump()
            "end" -> if (incoming?.id == id) finish()
            "complete" -> if (outgoingOffer?.id == id) { cancelInternal(false); status("파일 전송 완료") }
            "cancel" -> if (id == incoming?.id || id == pendingOffer?.id || id == outgoingOffer?.id) cancelInternal(false)
        }
    }
    fun accept(uri: Uri, id: String) {
        io.execute {
            val offer = pendingOffer ?: return@execute
            if (closed || offer.id != id) return@execute
            try {
                require(uri.scheme == "content")
                incoming = offer; pendingOffer = null; destination = uri
                temp = File.createTempFile("remote-receive-", ".part", context.cacheDir)
                output = FileOutputStream(temp!!); bytes = 0; digest = MessageDigest.getInstance("SHA-256")
                if (!reply("accept", offer.id)) throw IllegalStateException()
                touch(); status("파일 수신을 승인했습니다.")
            } catch (_: Exception) { cancelInternal(true) }
        }
    }
    fun sendFile(uri: Uri) {
        io.execute {
            if (closed || outgoing != null || pendingOffer != null || incoming != null) { status("현재 전송을 먼저 마쳐 주세요."); return@execute }
            try {
                require(uri.scheme == "content")
                var name = "download"
                context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                    if (c.moveToFirst()) { name = c.getString(0) ?: name; if (!c.isNull(1)) require(c.getLong(1) <= MAX_SIZE) }
                }
                val file = File.createTempFile("remote-send-", ".part", context.cacheDir); outgoing = file
                val md = MessageDigest.getInstance("SHA-256"); var total = 0L
                context.contentResolver.openInputStream(uri)!!.use { input -> file.outputStream().use { out ->
                    val b = ByteArray(CHUNK)
                    while (!closed) { val n = input.read(b); if (n < 0) break; total += n; require(total <= MAX_SIZE); out.write(b, 0, n); md.update(b, 0, n) }
                } }
                if (closed) { file.delete(); return@execute }
                val offer = Offer(UUID.randomUUID().toString(), safeName(name), total, md.digest().joinToString("") { "%02x".format(it) })
                outgoingOffer = offer; sendingId = offer.id
                if (!send(JSONObject().put("type", "offer").put("id", offer.id).put("name", offer.name).put("size", offer.size).put("hash", offer.hash))) throw IllegalStateException()
                touch(); status("PC에서 파일 수신을 승인해 주세요.")
            } catch (_: Exception) { cancelInternal(true); status("파일 전송 실패 · 최대 100MiB이며 선택한 파일만 접근합니다.") }
        }
    }
    private fun pump() {
        val offer = outgoingOffer ?: return; val file = outgoing ?: return
        file.inputStream().use { input ->
            val b = ByteArray(CHUNK); var offset = 0
            val uuid = UUID.fromString(offer.id)
            while (!closed && sendingId == offer.id) {
                val n = input.read(b); if (n < 0) break
                while (!closed && sendingId == offer.id && channel.bufferedAmount() > 262144) { Thread.sleep(10) }
                if (closed || sendingId != offer.id) return
                val chunk = ByteBuffer.allocate(n + 20).putLong(uuid.mostSignificantBits).putLong(uuid.leastSignificantBits).putInt(offset).put(b, 0, n)
                chunk.flip()
                if (!channel.send(DataChannel.Buffer(chunk, true))) throw IllegalStateException()
                offset += n; touch()
            }
        }
        if (!closed && sendingId == offer.id) reply("end", offer.id)
    }
    private fun chunk(data: ByteArray) {
        val offer = incoming ?: return
        require(data.size in 20..CHUNK + 20)
        val b = ByteBuffer.wrap(data); val id = UUID(b.long, b.long).toString(); val offset = b.int.toLong()
        if (id != offer.id) return
        require(offset == bytes && bytes + b.remaining() <= offer.size)
        output!!.write(data, 20, data.size - 20); digest.update(data, 20, data.size - 20); bytes += data.size - 20; touch()
    }
    private fun finish() {
        val offer = incoming ?: return
        require(bytes == offer.size && digest.digest().joinToString("") { "%02x".format(it) } == offer.hash)
        output?.close(); output = null
        val uri = destination ?: throw IllegalStateException()
        context.contentResolver.openOutputStream(uri, "wt")!!.use { target -> temp!!.inputStream().use { source ->
            val b = ByteArray(CHUNK)
            while (!closed) { val n = source.read(b); if (n < 0) break; target.write(b, 0, n) }
        } }
        if (closed) { removeDestination(); return }
        reply("complete", offer.id); destination = null; cancelInternal(false); status("파일 해시 검증 및 저장 완료")
    }
    fun cancel() { sendingId = null; try { io.execute { cancelInternal(true) } } catch (_: Exception) { } }
    private fun removeDestination() { destination?.let { try { android.provider.DocumentsContract.deleteDocument(context.contentResolver, it) } catch (_: Exception) { } }; destination = null }
    private fun cancelInternal(notify: Boolean) {
        val id = incoming?.id ?: pendingOffer?.id ?: outgoingOffer?.id
        if (notify && id != null) reply("cancel", id)
        main.removeCallbacks(timeout); sendingId = null; output?.close(); output = null; temp?.delete(); temp = null
        outgoing?.delete(); outgoing = null; outgoingOffer = null; incoming = null; pendingOffer = null; removeDestination()
    }
    fun close() {
        if (closed) return; closed = true; sendingId = null; main.removeCallbacks(timeout)
        if (current === this) current = null
        try { io.execute { cancelInternal(false) }; io.shutdown() } catch (_: Exception) { }
        channel.unregisterObserver()
    }
    private fun status(value: String) { main.post { android.widget.Toast.makeText(context, value, android.widget.Toast.LENGTH_LONG).show() } }
    companion object {
        const val MAX_SIZE = 104857600L
        private const val CHUNK = 16384
        @Volatile var current: RemoteFileTransfer? = null
            private set
        private fun safeName(name: String) = name.replace(Regex("[\\\\/\\p{Cntrl}]"), "_").trimStart('.').take(180).ifBlank { "download" }
    }
}
