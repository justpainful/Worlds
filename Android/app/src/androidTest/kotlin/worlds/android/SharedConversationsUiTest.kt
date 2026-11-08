package worlds.android

import android.util.Base64
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.Workspace
import worlds.sync.*
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SharedConversationsUiTest {
    @get:Rule val compose = createComposeRule()
    private val fixture = "AQ3o1I6DAwAnAQd0aHJlYWRzB3RocmVhZDEBKADo1I6DAwACaWQBdwd0aHJlYWQxKADo1I6DAwAFcXVvdGUBdw1Qcm9qZWN0IG5vdGVzKADo1I6DAwAJY3JlYXRlZEJ5AXcEc2FyYSgA6NSOgwMACWNyZWF0ZWRBdAF7Qni8/laAAAAoAOjUjoMDAAhyZXNvbHZlZAF5JwDo1I6DAwAIY29tbWVudHMABwDo1I6DAwYBKADo1I6DAwcCaWQBdwJjMSgA6NSOgwMHBmF1dGhvcgF3BHNhcmEoAOjUjoMDBwRib2R5AXcXUGxlYXNlIHJldmlldyB0aGlzIHBhZ2UoAOjUjoMDBwljcmVhdGVkQXQBe0J4vP5WgAAAKAEGcGVvcGxlBHNhcmEBdgIEbmFtZXcEU2FyYQVjb2xvcncHIzEyMzQ1NgA="

    @Test fun readsYjsThreadAndPersistsReplyAsAuthenticatedAuthor() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val db = "comments-ui-${UUID.randomUUID()}.db"
        val store = AndroidSyncStore(app, db)
        val auth = "https://identity.example"
        val initial = Base64.decode(fixture, Base64.DEFAULT)
        assertThrows(IllegalArgumentException::class.java) { YrsNative.changeComment(initial, "delete", "thread1", "user", comment = "c1") }
        val reply = YrsNative.changeComment(initial, "reply", "thread1", "user", body = "Another response")
        val withReply = YrsNative.merge(initial, reply)
        assertThrows(IllegalArgumentException::class.java) { YrsNative.changeComment(withReply, "delete", "thread1", "sara", comment = "c1") }
        val key = SyncDocumentKey("user", "space", "page", SyncWire.COMMENTS, auth)
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(auth, "user", "device", "token") },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() {
                    callback.onAuthenticated("comment")
                    callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
                    callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0)))
                    callback.onFrame(SyncWire.Frame.Sync(1, 1, initial))
                }
                override fun send(frame: SyncWire.Frame): Boolean {
                    if (frame is SyncWire.Frame.Update) callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, ""))
                    return true
                }
                override fun close() { }
            } }, listener) })
        val controller = SharedPageController(runtime, auth, "space")
        try {
            controller.open("https://sync.example", "page")
            compose.setContent { WorldsTheme { SharedPageScreen(auth, Workspace("space", "Team", "owner", 1), {}, controller) } }
            compose.waitUntil(20_000) { controller.state.value.access == "comment" && controller.state.value.conversations.size == 1 }
            compose.onNodeWithTag("shared_conversations").performScrollTo().performClick()
            compose.onNodeWithText("Sara").assertIsDisplayed()
            compose.onNodeWithText("Please review this page").assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-comments.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("conversation_reply_thread1").performClick()
            compose.onNodeWithTag("conversation_reply_text").performTextInput("Reviewed on Android")
            compose.onNodeWithTag("conversation_send").performClick()
            compose.waitUntil(20_000) { controller.state.value.conversations.firstOrNull()?.comments?.size == 2 && store.pending(key).isEmpty() }
            val comment = controller.state.value.conversations.single().comments.last()
            assertEquals("user", comment.author); assertEquals("Reviewed on Android", comment.body)
            val replica = store.load(key)
            var snapshot = replica.snapshot ?: byteArrayOf()
            replica.updates.forEach { snapshot = YrsNative.merge(snapshot, it.bytes) }
            val saved = org.json.JSONObject(YrsNative.commentsJson(snapshot)).getJSONObject("threads").getJSONObject("thread1").getJSONArray("comments")
            assertEquals(2, saved.length()); assertEquals("user", saved.getJSONObject(1).getString("author"))
            compose.onNodeWithTag("conversation_edit_c1").assertDoesNotExist()
            compose.onNodeWithTag("conversation_edit_${comment.id}").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_edit_text").performTextReplacement("Edited on Android")
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                compose.waitForIdle()
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-edit-comment.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("conversation_edit_save").performClick()
            compose.waitUntil(20_000) { controller.state.value.conversations.single().comments.last().body == "Edited on Android" && store.pending(key).isEmpty() }
            assertTrue(controller.state.value.conversations.single().comments.last().editedAt > 0)
            compose.onNodeWithTag("conversation_delete_c1").assertDoesNotExist()
            compose.onNodeWithTag("conversation_delete_${comment.id}").performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.conversations_delete_confirm)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-delete-comment.png")).use { it.readBytes() }
            }
            compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
            assertEquals(2, controller.state.value.conversations.single().comments.size)
            compose.onNodeWithTag("conversation_delete_${comment.id}").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_delete_confirm").performClick()
            compose.waitUntil(20_000) { controller.state.value.conversations.single().comments.size == 1 && store.pending(key).isEmpty() }
        } finally { controller.close(); runtime.accountChange { }; store.close(); app.deleteDatabase(db) }
    }
    @Test fun localWorkersAcceptCommenterReplyAndDeliverToPeer() {
        org.junit.Assume.assumeTrue(InstrumentationRegistry.getArguments().getString("liveSync") == "1")
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val suffix = UUID.randomUUID().toString(); val space = "ws-$suffix"; val page = "page-$suffix"; val user = "commenter-$suffix"
        val auth = "https://identity.example"; val endpoint = "http://127.0.0.1:18790"; val db = "comments-live-$suffix.db"
        val store = AndroidSyncStore(app, db)
        fun token(id: String) = org.json.JSONObject(java.net.URL("http://127.0.0.1:18791/dev/token?sub=$id").readText()).getString("token")
        val grant = java.net.URL("http://127.0.0.1:18791/dev/grant").openConnection() as java.net.HttpURLConnection
        grant.requestMethod = "POST"; grant.doOutput = true; grant.setRequestProperty("Content-Type", "application/json")
        grant.outputStream.use { it.write(org.json.JSONObject().put("userId", user).put("workspaceId", space).put("docId", page).put("level", "comment").toString().toByteArray()) }
        assertEquals(200, grant.responseCode); grant.disconnect()
        val initial = Base64.decode(fixture, Base64.DEFAULT)
        val peerKey = SyncDocumentKey("sara", space, page, SyncWire.COMMENTS, auth)
        store.append(peerKey, initial, local = true)
        val remote = java.util.concurrent.atomic.AtomicReference<ByteArray>()
        val peer = SyncSession(store, peerKey.copy(channel = SyncWire.CONTENT), { cb -> SyncSocket(endpoint, space, page, "sara", token("sara"), cb, allowInsecureLoopback = true) }, object : SyncSession.Listener {
            override fun onState(channel: Int, snapshot: ByteArray) { if (channel == SyncWire.COMMENTS) remote.set(snapshot) }
            override fun onAccess(level: String) { }
            override fun onAttention(channel: Int, archiveId: String, reason: String) { }
            override fun onClosed(code: Int?) { }
            override fun onError() { }
        })
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(auth, user, "device", token(user)) }, allowLoopbackForTests = true,
            makeSession = { doc, server, bearer, callback -> SyncSession(store, doc, { cb -> SyncSocket(server, space, page, user, bearer, cb, allowInsecureLoopback = true) }, callback) })
        val controller = SharedPageController(runtime, auth, space)
        try {
            peer.start()
            compose.waitUntil(30_000) { store.pending(peerKey).isEmpty() && remote.get() != null }
            controller.open(endpoint, page)
            val activeController = androidx.compose.runtime.mutableStateOf(controller)
            compose.setContent { WorldsTheme { SharedPageScreen(auth, Workspace(space, "Team", "member", 2), {}, activeController.value, onOpenNotification = {}) } }
            compose.waitUntil(30_000) { controller.state.value.access == "comment" && controller.state.value.conversations.size == 1 }
            compose.onNodeWithTag("shared_conversations").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_reply_thread1").performClick()
            compose.onNodeWithTag("conversation_reply_text").performTextInput("Hello from Android")
            compose.onNodeWithTag("conversation_send").performClick()
            val userKey = SyncDocumentKey(user, space, page, SyncWire.COMMENTS, auth)
            compose.waitUntil(30_000) {
                val bytes = remote.get() ?: return@waitUntil false
                val array = runCatching { org.json.JSONObject(YrsNative.commentsJson(bytes)).getJSONObject("threads").getJSONObject("thread1").getJSONArray("comments") }.getOrNull() ?: return@waitUntil false
                array.length() == 2 && array.getJSONObject(1).optString("author") == user && array.getJSONObject(1).optString("body") == "Hello from Android" && store.pending(userKey).isEmpty()
            }
            val inbox = SharedNotifications(allowInsecureLoopback = true)
            val peerToken = token("sara")
            var notice: SyncNotice? = null
            compose.waitUntil(30_000) {
                notice = runCatching { inbox.list(endpoint, peerToken).items.firstOrNull { it.workspace == space && it.page == page && it.kind == "reply" } }.getOrNull()
                notice != null
            }
            assertNull(notice!!.readAt)
            inbox.markRead(endpoint, peerToken, listOf(notice!!.id))
            assertNotNull(inbox.list(endpoint, peerToken).items.single { it.id == notice!!.id }.readAt)
            val replyId = controller.state.value.conversations.single().comments.last().id
            compose.onNodeWithTag("conversation_edit_$replyId").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_edit_text").performTextReplacement("Edited for @Sara")
            compose.onNodeWithTag("conversation_edit_save").performClick()
            compose.waitUntil(30_000) {
                val bytes = remote.get() ?: return@waitUntil false
                val comment = runCatching { org.json.JSONObject(YrsNative.commentsJson(bytes)).getJSONObject("threads").getJSONObject("thread1").getJSONArray("comments").getJSONObject(1) }.getOrNull() ?: return@waitUntil false
                comment.optString("body") == "Edited for @Sara" && comment.optLong("editedAt") > 0 && comment.getJSONArray("mentions").optString(0) == "sara" && store.pending(userKey).isEmpty()
            }
            compose.onNodeWithTag("conversation_delete_c1").assertDoesNotExist()
            compose.onNodeWithTag("conversation_delete_$replyId").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_delete_confirm").performClick()
            compose.waitUntil(30_000) {
                val bytes = remote.get() ?: return@waitUntil false
                val comments = runCatching { org.json.JSONObject(YrsNative.commentsJson(bytes)).getJSONObject("threads").getJSONObject("thread1").getJSONArray("comments") }.getOrNull() ?: return@waitUntil false
                comments.length() == 1 && store.pending(userKey).isEmpty()
            }
            compose.onNodeWithTag("conversation_new").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_new_text").performTextInput("Hello @Sara, a new conversation")
            compose.onNodeWithTag("conversation_new_send").performScrollTo().performClick()
            compose.waitUntil(30_000) { controller.state.value.conversations.size == 2 }
            val newThread = controller.state.value.conversations.single { it.id != "thread1" }.id
            compose.waitUntil(30_000) {
                val bytes = remote.get() ?: return@waitUntil false
                val thread = runCatching { org.json.JSONObject(YrsNative.commentsJson(bytes)).getJSONObject("threads").getJSONObject(newThread) }.getOrNull() ?: return@waitUntil false
                val comment = thread.getJSONArray("comments").getJSONObject(0)
                comment.optString("author") == user && comment.getJSONArray("mentions").optString(0) == "sara" && store.pending(userKey).isEmpty()
            }
            compose.onNodeWithTag("conversation_resolve_$newThread").performScrollTo().performClick()
            compose.waitUntil(30_000) {
                val bytes = remote.get() ?: return@waitUntil false
                runCatching { org.json.JSONObject(YrsNative.commentsJson(bytes)).getJSONObject("threads").getJSONObject(newThread).optBoolean("resolved") }.getOrDefault(false) && store.pending(userKey).isEmpty()
            }
            compose.onNodeWithTag("conversation_resolve_$newThread").performScrollTo().performClick()
            compose.waitUntil(30_000) {
                val bytes = remote.get() ?: return@waitUntil false
                val thread = runCatching { org.json.JSONObject(YrsNative.commentsJson(bytes)).getJSONObject("threads").getJSONObject(newThread) }.getOrNull() ?: return@waitUntil false
                !thread.optBoolean("resolved") && thread.isNull("resolvedBy") && store.pending(userKey).isEmpty()
            }
            compose.onNodeWithTag("conversation_new").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_new_text").performTextInput("A temporary conversation")
            compose.onNodeWithTag("conversation_new_send").performScrollTo().performClick()
            compose.waitUntil(30_000) { controller.state.value.conversations.size == 3 }
            val temporary = controller.state.value.conversations.single { it.id != "thread1" && it.id != newThread }
            compose.onNodeWithTag("conversation_delete_${temporary.comments.single().id}").performScrollTo().performClick()
            compose.onNodeWithTag("conversation_delete_confirm").performClick()
            compose.waitUntil(30_000) {
                val bytes = remote.get() ?: return@waitUntil false
                val threads = runCatching { org.json.JSONObject(YrsNative.commentsJson(bytes)).getJSONObject("threads") }.getOrNull() ?: return@waitUntil false
                !threads.has(temporary.id) && store.pending(userKey).isEmpty()
            }
            var mention: SyncNotice? = null
            compose.waitUntil(30_000) {
                mention = runCatching { inbox.list(endpoint, peerToken).items.firstOrNull { it.workspace == space && it.page == page && it.kind == "mention" } }.getOrNull()
                mention != null
            }
            assertTrue(peer.closeAndWait())
            val peerRuntime = AccountSyncRuntime(credentials = { SyncCredentials(auth, "sara", "sara-device", peerToken) }, allowLoopbackForTests = true,
                makeSession = { doc, server, bearer, callback -> SyncSession(store, doc, { cb -> SyncSocket(server, space, page, "sara", bearer, cb, allowInsecureLoopback = true) }, callback) })
            val peerController = SharedPageController(peerRuntime, auth, space)
            try {
                peerController.open(endpoint, page)
                compose.runOnIdle { activeController.value = peerController }
                compose.waitUntil(30_000) { peerController.state.value.access == "edit" && peerController.state.value.commentsSynced }
                compose.onNodeWithTag("shared_notices").performScrollTo().performClick()
                compose.waitUntil(30_000) { peerController.state.value.notices.any { it.id == mention!!.id } }
                compose.onNodeWithTag("notice_${mention!!.id}").performScrollTo().performClick()
                compose.waitUntil(30_000) { peerController.state.value.focusedThread == newThread }
                compose.onNodeWithTag("conversation_target").assertIsDisplayed()
                compose.onNodeWithText("Hello @Sara, a new conversation").assertIsDisplayed()
            } finally { peerController.close(); peerRuntime.accountChange { } }
        } finally { controller.close(); peer.closeAndWait(); runtime.accountChange { }; store.close(); app.deleteDatabase(db) }
    }

}
