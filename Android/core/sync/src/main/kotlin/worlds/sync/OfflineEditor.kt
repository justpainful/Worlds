package worlds.sync

/** Caller must serialize this operation against sessions and account changes for the document. */
object OfflineEditor {
    fun replaceBlockText(store: AndroidSyncStore, key: SyncDocumentKey, base: ByteArray, blockId: String, start: Int, end: Int, text: String, draftText: String? = null): ByteArray {
        require(key.channel == SyncWire.CONTENT)
        val replica = store.load(key)
        var current = replica.snapshot ?: byteArrayOf()
        for (update in replica.updates) current = YrsNative.merge(current, update.bytes)
        require(YrsNative.blockIdentity(base, blockId).contentEquals(YrsNative.blockIdentity(current, blockId))) { "Block no longer exists" }
        val update = YrsNative.replaceBlockText(base, blockId, start, end, text)
        val merged = YrsNative.merge(current, update)
        store.append(key, update, local = true, draft = draftText?.let { DraftCapture(blockId, it) })
        return merged
    }
}
