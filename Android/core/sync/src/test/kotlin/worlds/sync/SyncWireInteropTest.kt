package worlds.sync

import java.io.File

/** Runs without Android so protocol compatibility can be checked independently. */
fun main(args: Array<String>) {
    val payload = byteArrayOf(0, 1, 127, -128, -1)
    val examples = linkedMapOf<String, SyncWire.Frame>(
        "sync" to SyncWire.Frame.Sync(1, 2, payload),
        "awareness" to SyncWire.Frame.Awareness(payload),
        "query" to SyncWire.Frame.QueryAwareness,
        "auth" to SyncWire.Frame.AuthState("edit", "مستخدم 🚀"),
        "update" to SyncWire.Frame.Update(9007199254740991, 0, payload),
        "ack" to SyncWire.Frame.Ack(16384, 1, "refused"),
        "notice" to SyncWire.Frame.Notice("rights", "変更"),
        "refresh" to SyncWire.Frame.AuthRefresh("a.b.c"),
    )
    val fixtures = File(args.single()).readLines().associate { line ->
        val (name, hex) = line.split(' ', limit = 2)
        name to hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }
    check(fixtures.keys == examples.keys + "awareness_entries")
    for ((name, frame) in examples) {
        val fromLib0 = fixtures.getValue(name)
        check(SyncWire.encode(frame).contentEquals(fromLib0)) { "Kotlin encoding differs for $name" }
        check(SyncWire.encode(SyncWire.decode(fromLib0)).contentEquals(fromLib0)) { "Kotlin decoding differs for $name" }
    }
    val decoded = SyncWire.decode(fixtures.getValue("auth")) as SyncWire.Frame.AuthState
    check(decoded.userId == "مستخدم 🚀" && decoded.level == "edit")
    val update = SyncWire.decode(fixtures.getValue("update")) as SyncWire.Frame.Update
    check(update.batchId == 9007199254740991L && update.data.contentEquals(payload))
    val entries = listOf(SyncWire.AwarenessEntry(7, 3, "{\"user\":{\"id\":\"u\"}}"), SyncWire.AwarenessEntry(9, 1, "null"))
    check(SyncWire.encodeAwarenessEntries(entries).contentEquals(fixtures.getValue("awareness_entries")))
    check(SyncWire.decodeAwarenessEntries(fixtures.getValue("awareness_entries")) == entries)
    check(runCatching { SyncWire.decodeAwarenessEntries(byteArrayOf(2, 0)) }.isFailure)
    fun rejects(bytes: ByteArray) { check(runCatching { SyncWire.decode(bytes) }.isFailure) }
    rejects(byteArrayOf())
    rejects(byteArrayOf(9))
    rejects(byteArrayOf(2, 0))
    rejects(byteArrayOf(1, 3, 1))
    rejects(byteArrayOf(3, 1, -1, 0))
    rejects(byteArrayOf(0, 2, 0, 0))
    rejects(byteArrayOf(5, 0, 3, 0))
    rejects(ByteArray(9) { -1 })
    check(runCatching { SyncWire.encode(SyncWire.Frame.Update(-1, 0, payload)) }.isFailure)
    check(runCatching { SyncWire.encode(SyncWire.Frame.Sync(0, 3, payload)) }.isFailure)
    check(runCatching { SyncWire.decode(ByteArray(SyncWire.MAX_FRAME_BYTES + 1)) }.isFailure)
    println("9 lib0 fixtures and 12 malformed-input checks passed")
}
