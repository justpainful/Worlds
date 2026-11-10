package worlds.sync

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/** Binary envelope only. Yjs updates and awareness remain opaque to this codec. */
object SyncWire {
    const val PROTOCOL = "worlds-sync.v1"
    const val CONTENT = 0
    const val COMMENTS = 1
    const val MAX_FRAME_BYTES = 4 * 1024 * 1024

    sealed interface Frame {
        data class Sync(val channel: Int, val kind: Int, val data: ByteArray) : Frame
        data class Awareness(val data: ByteArray) : Frame
        data object QueryAwareness : Frame
        data class AuthState(val level: String, val userId: String) : Frame
        data class Update(val batchId: Long, val channel: Int, val data: ByteArray) : Frame
        data class Ack(val batchId: Long, val status: Int, val reason: String) : Frame
        data class Notice(val code: String, val message: String) : Frame
        data class AuthRefresh(val token: String) : Frame
    }

    data class AwarenessEntry(val clientId: Long, val clock: Long, val state: String)

    fun encodeAwarenessEntries(entries: List<AwarenessEntry>): ByteArray {
        val out = Writer()
        out.uint(entries.size.toLong())
        for (entry in entries) { out.uint(entry.clientId); out.uint(entry.clock); out.string(entry.state) }
        return out.result().also { require(it.size <= MAX_FRAME_BYTES) { "Awareness update too large" } }
    }

    fun decodeAwarenessEntries(bytes: ByteArray): List<AwarenessEntry> {
        require(bytes.size <= MAX_FRAME_BYTES) { "Awareness update too large" }
        val input = Reader(bytes)
        val count = input.uint()
        // Each entry needs at least one byte per integer and one for the string length.
        require(count <= input.remaining() / 3) { "Invalid awareness entry count" }
        val entries = ArrayList<AwarenessEntry>(count.toInt())
        repeat(count.toInt()) { entries.add(AwarenessEntry(input.uint(), input.uint(), input.string())) }
        require(input.finished()) { "Trailing bytes" }
        return entries
    }

    fun encode(frame: Frame): ByteArray {
        val out = Writer()
        when (frame) {
            is Frame.Sync -> { out.uint(0); out.channel(frame.channel); require(frame.kind in 0..2); out.uint(frame.kind.toLong()); out.bytes(frame.data) }
            is Frame.Awareness -> { out.uint(1); out.bytes(frame.data) }
            Frame.QueryAwareness -> out.uint(2)
            is Frame.AuthState -> { out.uint(3); out.string(frame.level); out.string(frame.userId) }
            is Frame.Update -> { out.uint(4); out.uint(frame.batchId); out.channel(frame.channel); out.bytes(frame.data) }
            is Frame.Ack -> { out.uint(5); out.uint(frame.batchId); require(frame.status in 0..2); out.uint(frame.status.toLong()); out.string(frame.reason) }
            is Frame.Notice -> { out.uint(6); out.string(frame.code); out.string(frame.message) }
            is Frame.AuthRefresh -> { out.uint(7); out.string(frame.token) }
        }
        return out.result().also { require(it.size <= MAX_FRAME_BYTES) { "Frame too large" } }
    }

    fun decode(bytes: ByteArray): Frame {
        require(bytes.size <= MAX_FRAME_BYTES) { "Frame too large" }
        val input = Reader(bytes)
        val result = when (input.uint()) {
            0L -> Frame.Sync(input.channel(), input.small(2), input.bytes())
            1L -> Frame.Awareness(input.bytes())
            2L -> Frame.QueryAwareness
            3L -> Frame.AuthState(input.string(), input.string())
            4L -> Frame.Update(input.uint(), input.channel(), input.bytes())
            5L -> Frame.Ack(input.uint(), input.small(2), input.string())
            6L -> Frame.Notice(input.string(), input.string())
            7L -> Frame.AuthRefresh(input.string())
            else -> throw IllegalArgumentException("Unknown message type")
        }
        require(input.finished()) { "Trailing bytes" }
        return result
    }

    // lib0 integers use unsigned base-128. JavaScript safely represents up to 2^53-1.
    private const val MAX_SAFE_INTEGER = 9007199254740991L

    private class Writer {
        private val output = ByteArrayOutputStream()
        fun uint(value: Long) {
            require(value in 0..MAX_SAFE_INTEGER) { "Invalid unsigned integer" }
            var remaining = value
            while (remaining > 127) {
                output.write(((remaining and 127) or 128).toInt())
                remaining = remaining ushr 7
            }
            output.write(remaining.toInt())
        }
        fun channel(value: Int) { require(value in CONTENT..COMMENTS); uint(value.toLong()) }
        fun bytes(value: ByteArray) { require(value.size <= MAX_FRAME_BYTES); uint(value.size.toLong()); output.write(value) }
        fun string(value: String) = bytes(value.toByteArray(Charsets.UTF_8))
        fun result(): ByteArray = output.toByteArray()
    }

    private class Reader(private val data: ByteArray) {
        private var position = 0
        fun uint(): Long {
            var value = 0L
            var shift = 0
            while (true) {
                require(position < data.size && shift <= 49) { "Invalid varUint" }
                val byte = data[position++].toInt() and 255
                value = value or ((byte and 127).toLong() shl shift)
                require(value <= MAX_SAFE_INTEGER) { "Integer exceeds JavaScript precision" }
                if (byte and 128 == 0) return value
                shift += 7
            }
        }
        fun small(max: Int): Int = uint().also { require(it <= max) }.toInt()
        fun channel(): Int = small(COMMENTS)
        fun bytes(): ByteArray {
            val size = uint()
            require(size <= data.size - position) { "Truncated byte array" }
            val end = position + size.toInt()
            return data.copyOfRange(position, end).also { position = end }
        }
        fun string(): String = try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes())).toString()
        } catch (e: CharacterCodingException) { throw IllegalArgumentException("Invalid UTF-8", e) }
        fun finished() = position == data.size
        fun remaining() = data.size - position
    }
}
