package worlds.sync

import org.json.JSONArray
import org.json.JSONObject

/** Yjs v1 state operations. Each snapshot includes any updates awaiting causal dependencies. */
object YrsNative {
    init { System.loadLibrary("worlds_sync_native") }
    @JvmStatic external fun stateVector(snapshot: ByteArray): ByteArray
    @JvmStatic external fun diff(snapshot: ByteArray, remoteStateVector: ByteArray): ByteArray
    @JvmStatic external fun merge(snapshot: ByteArray, update: ByteArray): ByteArray
    @JvmStatic private external fun commentsJsonBytes(snapshot: ByteArray): ByteArray
    @JvmStatic private external fun replyCommentBytes(snapshot: ByteArray, request: ByteArray): ByteArray
    fun commentsJson(snapshot: ByteArray): String = commentsJsonBytes(snapshot).toString(Charsets.UTF_8)
    fun changeComment(snapshot: ByteArray, action: String, thread: String, author: String, body: String? = null, resolved: Boolean? = null, comment: String? = null, expectedBody: String? = null): ByteArray {
        val request = JSONObject().put("action", action).put("thread", thread).put("id", java.util.UUID.randomUUID().toString()).put("author", author).put("createdAt", System.currentTimeMillis())
        if (body != null) request.put("body", body)
        if (resolved != null) request.put("resolved", resolved)
        if (comment != null) request.put("comment", comment)
        if (expectedBody != null) request.put("expectedBody", expectedBody)
        return replyCommentBytes(snapshot, request.toString().toByteArray(Charsets.UTF_8))
    }
    @JvmStatic private external fun restoreVersionBytes(snapshot: ByteArray, version: ByteArray): ByteArray
    /** Computes a version restore against the supplied Yjs base without mutating it. */
    fun restoreVersion(snapshot: ByteArray, version: ByteArray): ByteArray = restoreVersionBytes(snapshot, version)
    @JvmStatic private external fun editorJsonBytes(snapshot: ByteArray): ByteArray
    @JvmStatic private external fun replaceTextBytes(snapshot: ByteArray, request: ByteArray): ByteArray
    @JvmStatic private external fun replaceBlockTextBytes(snapshot: ByteArray, request: ByteArray): ByteArray
    @JvmStatic private external fun blockIdentityBytes(snapshot: ByteArray, bid: ByteArray): ByteArray

    internal fun blockIdentity(snapshot: ByteArray, blockId: String): ByteArray = blockIdentityBytes(snapshot, blockId.toByteArray(Charsets.UTF_8))

    /** Tiptap-compatible JSON for the shared document's default XML fragment. */
    fun editorJson(snapshot: ByteArray): String = editorJsonBytes(snapshot).toString(Charsets.UTF_8)

    /** Produces a Yjs update for one XmlText, using UTF-16 offsets and XML child indices. */
    fun replaceText(snapshot: ByteArray, path: List<Int>, start: Int, end: Int, text: String): ByteArray {
        require(path.isNotEmpty() && path.all { it >= 0 } && start >= 0 && end >= start)
        validateText(text)
        val request = JSONObject().put("path", JSONArray(path)).put("start", start).put("end", end).put("text", text)
        return replaceTextBytes(snapshot, request.toString().toByteArray(Charsets.UTF_8))
    }

    /** Edits a paragraph or heading by stable block id, relative to the supplied base snapshot. */
    fun replaceBlockText(snapshot: ByteArray, blockId: String, start: Int, end: Int, text: String): ByteArray {
        require(blockId.isNotBlank() && start >= 0 && end >= start)
        validateText(text)
        val request = JSONObject().put("bid", blockId).put("start", start).put("end", end).put("text", text)
        return replaceBlockTextBytes(snapshot, request.toString().toByteArray(Charsets.UTF_8))
    }

    private fun validateText(text: String) {
        var index = 0
        while (index < text.length) {
            val char = text[index]
            if (char.isHighSurrogate()) {
                require(index + 1 < text.length && text[index + 1].isLowSurrogate())
                index += 2
            } else {
                require(!char.isLowSurrogate())
                index++
            }
        }
    }
}
