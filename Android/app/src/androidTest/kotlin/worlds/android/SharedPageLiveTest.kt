package worlds.android

import android.util.Base64
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.Workspace
import worlds.sync.AndroidSyncStore
import worlds.sync.SyncDocumentKey
import worlds.sync.SyncSession
import worlds.sync.SyncSocket
import worlds.sync.SyncTransport
import worlds.sync.SyncWire
import worlds.sync.YrsNative
import worlds.sync.OfflineEditor
import java.net.URL
import java.net.HttpURLConnection
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/** Opt-in UI test against local development Workers over adb reverse. */
@RunWith(AndroidJUnit4::class)
class SharedPageLiveTest {
    @get:Rule val compose = createComposeRule()
    @Test fun editsSharedParagraphFromTheUiAndAnotherSessionReceivesIt() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveSync") == "1")
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val suffix = UUID.randomUUID().toString()
        val workspace = "ws-$suffix"; val page = "page-$suffix"; val user = "alice-$suffix"; val other = "bob-$suffix"
        val authority = "https://identity.example"
        val storeName = "shared-ui-$suffix.db"
        val store = AndroidSyncStore(app, storeName)
        fun token(id: String, ttl: Int = 3600) = JSONObject(URL("http://127.0.0.1:18791/dev/token?sub=$id&ttl=$ttl").readText()).getString("token")
        val aliceToken = AtomicReference(token(user, 44)); val aliceExpiry = AtomicLong(System.currentTimeMillis() + 44_000)
        val bobToken = token(other); val refreshes = AtomicInteger(0); val authentications = AtomicInteger(0); val connections = AtomicInteger(0)
        val dropConnection = AtomicReference<() -> Unit>()
        val key = SyncDocumentKey(user, workspace, page, 0, authority)
        val snapshot = Base64.decode("AQmJBgAHAQdkZWZhdWx0AwdoZWFkaW5nBwCJBgAGBgCJBgEEYm9sZAJ7fYaJBgIEbGluax97ImhyZWYiOiJodHRwczovL2V4YW1wbGUudGVzdCJ9hIkGAwZB8J+YgEKGiQYHBGJvbGQEbnVsbIaJBggEbGluawRudWxsKACJBgAFbGV2ZWwBfQIoAIkGAANiaWQBdwZibG9jazEA", Base64.DEFAULT)
        store.bindEndpoint(key, "http://127.0.0.1:18790")
        store.append(key, snapshot, local = true)
        val runtime = AccountSyncRuntime(
            credentials = { SyncCredentials(authority, user, "device", aliceToken.get(), aliceExpiry.get()) },
            freshCredentials = { _, _ ->
                val fresh = token(user); val expires = System.currentTimeMillis() + 3_600_000
                aliceToken.set(fresh); aliceExpiry.set(expires); refreshes.incrementAndGet()
                SyncCredentials(authority, user, "device", fresh, expires)
            },
            offlineEdit = { doc, base, bid, start, end, text, draft -> OfflineEditor.replaceBlockText(store, doc, base, bid, start, end, text, draft) },
            offlineAppend = { doc, bid, text -> OfflineEditor.appendParagraph(store, doc, bid, text) },
            recoveredText = { store.recovered(it) },
            deleteRecoveredText = { doc, id -> store.deleteRecovered(doc, id) },
            saveRecoveredText = { doc, draft -> store.saveRecoveredText(doc, draft) },
            writeWorkingDraft = { doc, token, draft -> store.saveWorkingDraft(doc, token, draft) },
            removeWorkingDraft = { doc, token -> store.discardWorkingDraft(doc, token); Unit },
            bindEndpoint = { doc, endpoint -> store.bindEndpoint(doc, endpoint) },
            releaseEmptyEndpoint = { doc, endpoint -> store.releaseEmptyEndpoint(doc, endpoint) },
            rememberAccess = { doc, device, endpoint, access -> store.rememberAccess(doc, device, endpoint, access) },
            forgetAccess = { doc -> store.forgetAccess(doc) },
            cachedPages = { server, account, device -> store.cachedPages(server, account, device) },
            loadCached = { doc -> store.load(doc).let { replica -> replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) } } },
            allowLoopbackForTests = true,
            makeSession = { doc, server, bearer, callback -> SyncSession(store, doc, { listener ->
                val forwarded = object : SyncSocket.Listener {
                    override fun onAuthenticated(level: String) { authentications.incrementAndGet(); listener.onAuthenticated(level) }
                    override fun onFrame(frame: SyncWire.Frame) = listener.onFrame(frame)
                    override fun onClosed(code: Int) = listener.onClosed(code)
                    override fun onFailure() = listener.onFailure()
                }
                val socket = SyncSocket(server, doc.workspace, doc.page, doc.account, bearer, forwarded, allowInsecureLoopback = true)
                connections.incrementAndGet()
                dropConnection.set { socket.close(); listener.onClosed(1006) }
                object : SyncTransport {
                    override fun start() = socket.start()
                    override fun send(frame: SyncWire.Frame) = socket.send(frame)
                    override fun close() = socket.close()
                }
            }, callback) },
        )
        val remote = AtomicReference<ByteArray>()
        val otherKey = SyncDocumentKey(other, workspace, page, 0, authority)
        val observer = object : SyncSession.Listener {
            override fun onState(channel: Int, snapshot: ByteArray) { if (channel == SyncWire.CONTENT) remote.set(snapshot) }
            override fun onAccess(level: String) { }
            override fun onAttention(channel: Int, archiveId: String, reason: String) { }
            override fun onClosed(code: Int?) { }
            override fun onError() { }
        }
        val peer = SyncSession(store, otherKey, { callback -> SyncSocket("http://127.0.0.1:18790", workspace, page, other, bobToken, callback, allowInsecureLoopback = true) }, observer)
        val retryDelay = AtomicLong(5_000)
        val controller = SharedPageController(runtime, authority, workspace, retryDelay = { retryDelay.get() })
        try {
            peer.start()
            compose.setContent { WorldsTheme { SharedPageScreen(authority, Workspace(workspace, "Team", "owner", 2), {}, controller) } }
            compose.onNodeWithTag("shared_server").performTextInput("http://127.0.0.1:18790")
            compose.onNodeWithTag("shared_page_id").performTextInput(page)
            compose.onNodeWithText(app.getString(R.string.shared_open)).performClick()
            compose.waitUntil(30_000) { controller.state.value.access == "edit" && controller.state.value.blocks.any { it.text == "A😀B" } }
            assertEquals(page, store.cachedPages(authority, user, "device").single().page)
            compose.onNodeWithTag("shared_block_block1").assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-qa.png").close()
            }
            compose.onNodeWithTag("shared_block_block1").performClick()
            compose.onNodeWithTag("shared_draft").performTextClearance()
            compose.onNodeWithTag("shared_draft").performTextInput("AXB")
            compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
            compose.onNodeWithTag("shared_discard_title").assertIsDisplayed()
            compose.onNodeWithTag("shared_discard_cancel").performClick()
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(30_000) {
                val state = remote.get() ?: return@waitUntil false
                val contents = runCatching { JSONObject(YrsNative.editorJson(state)).getJSONArray("content").getJSONObject(0).getJSONArray("content") }.getOrNull() ?: return@waitUntil false
                (0 until contents.length()).joinToString("") { contents.getJSONObject(it).getString("text") } == "AXB" && store.pending(key).isEmpty()
            }
            compose.onNodeWithTag("shared_add_paragraph").performScrollTo().performClick()
            compose.onNodeWithTag("shared_draft").performTextInput("New shared paragraph")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(30_000) {
                val state = remote.get() ?: return@waitUntil false
                val blocks = runCatching { JSONObject(YrsNative.editorJson(state)).getJSONArray("content") }.getOrNull() ?: return@waitUntil false
                (0 until blocks.length()).any { index ->
                    val block = blocks.getJSONObject(index)
                    block.optString("type") == "paragraph" && block.optJSONArray("content")?.optJSONObject(0)?.optString("text") == "New shared paragraph"
                } && store.pending(key).isEmpty()
            }
            compose.onNodeWithTag("shared_history").performClick()
            compose.waitUntil(20_000) { controller.state.value.historyVisible && !controller.state.value.historyLoading }
            compose.onNodeWithTag("shared_version_create").performClick()
            compose.onNodeWithTag("shared_version_name").performTextInput("Checkpoint")
            compose.onNodeWithTag("shared_version_confirm").performClick()
            compose.waitUntil(20_000) { controller.state.value.versions.any { it.label == "Checkpoint" } }
            val versionId = controller.state.value.versions.single { it.label == "Checkpoint" }.id
            compose.onNodeWithTag("shared_version_$versionId").assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(800)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-history.png").close()
            }
            compose.onNodeWithTag("shared_version_$versionId").performClick()
            compose.waitUntil(20_000) { controller.state.value.historyPreview != null }
            compose.onAllNodesWithTag("shared_history_preview_block")[0].assertIsDisplayed().assertTextEquals("AXB")
            compose.onNodeWithText(app.getString(R.string.close)).performClick()
            compose.onNodeWithTag("shared_block_block1").performClick()
            compose.onNodeWithTag("shared_draft").performTextClearance()
            compose.onNodeWithTag("shared_draft").performTextInput("Later revision")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(30_000) { controller.state.value.blocks.firstOrNull()?.text == "Later revision" && store.pending(key).isEmpty() }
            compose.onNodeWithTag("shared_history").performClick()
            compose.waitUntil(20_000) { controller.state.value.historyVisible && !controller.state.value.historyLoading }
            compose.onNodeWithTag("shared_version_$versionId").performClick()
            compose.waitUntil(20_000) { controller.state.value.historyPreview != null }
            compose.onNodeWithTag("shared_version_restore").performClick()
            compose.onNodeWithTag("shared_version_restore_confirm").assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(500); InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-restore.png").close()
            }
            compose.onNodeWithTag("shared_version_restore_confirm").performClick()
            compose.waitUntil(30_000) {
                val state = remote.get() ?: return@waitUntil false
                val contents = runCatching { JSONObject(YrsNative.editorJson(state)).getJSONArray("content").getJSONObject(0).getJSONArray("content") }.getOrNull() ?: return@waitUntil false
                !controller.state.value.historyVisible && (0 until contents.length()).joinToString("") { contents.getJSONObject(it).getString("text") } == "AXB" && store.pending(key).isEmpty()
            }
            compose.onNodeWithTag("shared_history").performClick()
            compose.waitUntil(20_000) { !controller.state.value.historyLoading && controller.state.value.versions.any { it.label == "Before restore" } }
            val backupId = controller.state.value.versions.first { it.label == "Before restore" }.id
            val backup = worlds.sync.SharedHistory(allowInsecureLoopback = true).state("http://127.0.0.1:18790", workspace, page, aliceToken.get(), backupId)
            val backupNodes = JSONObject(YrsNative.editorJson(backup)).getJSONArray("content").getJSONObject(0).getJSONArray("content")
            assertEquals("Later revision", (0 until backupNodes.length()).joinToString("") { backupNodes.getJSONObject(it).getString("text") })
            compose.onNodeWithText(app.getString(R.string.close)).performClick()
            compose.waitUntil(30_000) { refreshes.get() >= 1 && authentications.get() >= 2 }
            retryDelay.set(15_000)
            dropConnection.get().invoke()
            compose.waitUntil(30_000) { controller.state.value.offline && controller.state.value.blocks.any { it.text == "AXB" } }
            compose.onNodeWithText(app.getString(R.string.shared_offline)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-offline.png").close()
            }
            compose.onNodeWithTag("shared_add_paragraph").performScrollTo().performClick()
            compose.onNodeWithTag("shared_draft").performTextInput("Created offline")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(10_000) { controller.state.value.draft == null && controller.state.value.offline && store.pending(key).size == 1 }
            compose.waitUntil(30_000) {
                val current = remote.get() ?: return@waitUntil false
                val blocks = runCatching { JSONObject(YrsNative.editorJson(current)).getJSONArray("content") }.getOrNull() ?: return@waitUntil false
                (0 until blocks.length()).any { index -> blocks.getJSONObject(index).optJSONArray("content")?.optJSONObject(0)?.optString("text") == "Created offline" } && store.pending(key).isEmpty()
            }
            retryDelay.set(5_000)
            dropConnection.get().invoke()
            compose.waitUntil(30_000) { controller.state.value.offline }
            compose.onNodeWithTag("shared_block_block1").performClick()
            compose.onNodeWithTag("shared_draft").performTextClearance()
            compose.onNodeWithTag("shared_draft").performTextInput("AXZ")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(15_000) { controller.state.value.draft == null && store.pending(key).size == 1 }
            compose.waitUntil(30_000) {
                val state = remote.get() ?: return@waitUntil false
                val contents = runCatching { JSONObject(YrsNative.editorJson(state)).getJSONArray("content").getJSONObject(0).getJSONArray("content") }.getOrNull() ?: return@waitUntil false
                (0 until contents.length()).joinToString("") { contents.getJSONObject(it).getString("text") } == "AXZ" && store.pending(key).isEmpty()
            }
            assertTrue(connections.get() >= 2)
            val grant = URL("http://127.0.0.1:18791/dev/grant").openConnection() as HttpURLConnection
            grant.requestMethod = "POST"; grant.doOutput = true; grant.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject().put("userId", user).put("workspaceId", workspace).put("docId", page).put("level", "none")
            grant.outputStream.use { it.write(body.toString().toByteArray()) }
            assertEquals(200, grant.responseCode); grant.disconnect()
            retryDelay.set(15_000)
            dropConnection.get().invoke()
            compose.waitUntil(30_000) { controller.state.value.offline && controller.state.value.blocks.any { it.text == "AXZ" } }
            compose.onNodeWithTag("shared_block_block1").performClick()
            compose.onNodeWithTag("shared_draft").performTextClearance()
            compose.onNodeWithTag("shared_draft").performTextInput("AXQ")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(15_000) { controller.state.value.draft == null && store.pending(key).size == 1 }
            compose.waitUntil(30_000) { controller.state.value.disconnected && controller.state.value.revoked }
            compose.waitUntil(15_000) { controller.state.value.recovered.any { it.text == "AXQ" } }
            compose.onNodeWithText("AXQ").assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.shared_recovered_copy)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.shared_recovered_delete)).performClick()
            compose.onNodeWithText(app.getString(R.string.shared_recovered_delete_confirm)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
            assertTrue(store.pending(key).isEmpty())
            assertTrue(store.load(key).updates.isEmpty())
            assertTrue(store.cachedPages(authority, user, "device").isEmpty())
            assertEquals("AXQ", store.recovered(key).single().text)
            val restored = URL("http://127.0.0.1:18791/dev/grant").openConnection() as HttpURLConnection
            restored.requestMethod = "POST"; restored.doOutput = true; restored.setRequestProperty("Content-Type", "application/json")
            restored.outputStream.use { it.write(JSONObject().put("userId", user).put("workspaceId", workspace).put("docId", page).put("level", "edit").toString().toByteArray()) }
            assertEquals(200, restored.responseCode); restored.disconnect()
            controller.open("http://127.0.0.1:18790", page)
            compose.waitUntil(30_000) { controller.state.value.access == "edit" && controller.state.value.blocks.any { it.text == "AXZ" } && controller.state.value.recovered.any { it.text == "AXQ" } }
            val recoveredId = controller.state.value.recovered.single { it.text == "AXQ" }.id
            compose.onNodeWithTag("restore_recovery_$recoveredId").performScrollTo().performClick()
            compose.onNodeWithTag("confirm_restore_recovery").performClick()
            compose.onNodeWithTag("shared_draft").assertTextEquals("AXQ")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(30_000) {
                val state = remote.get() ?: return@waitUntil false
                val contents = runCatching { JSONObject(YrsNative.editorJson(state)).getJSONArray("content").getJSONObject(0).getJSONArray("content") }.getOrNull() ?: return@waitUntil false
                (0 until contents.length()).joinToString("") { contents.getJSONObject(it).getString("text") } == "AXQ" && store.pending(key).isEmpty()
            }
            assertTrue(store.recovered(key).any { it.id == recoveredId })
        } finally {
            controller.close(); peer.closeAndWait(); runtime.accountChange { }
            store.close(); app.deleteDatabase(storeName)
        }
    }
}
