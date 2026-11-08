package worlds.sync

/** Caller must serialize this operation against sessions and account changes for the document. */
object OfflineEditor {
    fun appendParagraph(store: AndroidSyncStore, key: SyncDocumentKey, blockId: String, text: String): ByteArray {
        return insertTextBlock(store, key, byteArrayOf(), blockId, text, "paragraph", 1, null)
    }

    fun insertTextBlock(store: AndroidSyncStore, key: SyncDocumentKey, base: ByteArray, blockId: String, text: String, kind: String, level: Int, after: String?): ByteArray {
        require(key.channel == SyncWire.CONTENT)
        val replica = store.load(key)
        var current = replica.snapshot ?: byteArrayOf()
        for (update in replica.updates) current = YrsNative.merge(current, update.bytes)
        if (after != null) require(YrsNative.blockIdentity(base, after).contentEquals(YrsNative.blockIdentity(current, after))) { "Anchor no longer exists" }
        val update = YrsNative.insertTextBlock(current, blockId, text, kind, level, after)
        val merged = YrsNative.merge(current, update)
        store.append(key, update, local = true, draft = DraftCapture(blockId, text))
        return merged
    }
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
