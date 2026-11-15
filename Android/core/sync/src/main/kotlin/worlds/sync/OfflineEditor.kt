package worlds.sync

/** Caller must serialize this operation against sessions and account changes for the document. */
object OfflineEditor {
    fun duplicateTextBlock(store: AndroidSyncStore, key: SyncDocumentKey, base: ByteArray, source: String, blockId: String): ByteArray {
        require(key.channel == SyncWire.CONTENT)
        val replica = store.load(key)
        val current = replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) }
        require(YrsNative.blockIdentity(base, source).contentEquals(YrsNative.blockIdentity(current, source))) { "Block no longer exists" }
        val duplicate = YrsNative.duplicateTextBlock(current, source, blockId)
        val merged = YrsNative.merge(current, duplicate.update)
        store.append(key, duplicate.update, local = true, draft = DraftCapture(blockId, duplicate.text))
        return merged
    }
    /** A shared pack item's field changes, queued like any offline edit and sent when the page reconnects. */
    fun setFields(store: AndroidSyncStore, key: SyncDocumentKey, set: org.json.JSONObject, remove: List<String>): ByteArray {
        require(key.channel == SyncWire.CONTENT)
        val replica = store.load(key)
        var current = replica.snapshot ?: byteArrayOf()
        for (update in replica.updates) current = YrsNative.merge(current, update.bytes)
        val update = YrsNative.setFields(current, set, remove)
        val merged = YrsNative.merge(current, update)
        store.append(key, update, local = true)
        return merged
    }
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
