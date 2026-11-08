package worlds.android

import android.util.Base64
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.runtime.CompositionLocalProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.Workspace
import worlds.sync.AndroidSyncStore
import worlds.sync.DraftCapture
import worlds.sync.SyncDocumentKey
import worlds.sync.SyncSession
import worlds.sync.SyncTransport
import worlds.sync.SyncWire
import worlds.sync.YrsNative
import worlds.sync.OfflineEditor
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SharedRecoveryUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun editorAddsParagraphAndQueuesItForPeer() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val name = "shared-append-${UUID.randomUUID()}.db"
        val authority = "https://identity.example"
        val key = SyncDocumentKey("user", "space", "page", 0, authority)
        val store = AndroidSyncStore(app, name)
        val remote = java.util.concurrent.atomic.AtomicReference<ByteArray>(byteArrayOf())
        val runtime = AccountSyncRuntime(
            credentials = { SyncCredentials(authority, "user", "device", "token") },
            writeWorkingDraft = { doc, token, draft -> store.saveWorkingDraft(doc, token, draft) },
            removeWorkingDraft = { doc, token -> store.discardWorkingDraft(doc, token); Unit },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() {
                    callback.onAuthenticated("edit")
                    callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
                    callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0)))
                }
                override fun send(frame: SyncWire.Frame): Boolean {
                    if (frame is SyncWire.Frame.Update && frame.channel == 0) {
                        remote.set(YrsNative.merge(remote.get(), frame.data))
                        callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, ""))
                    }
                    return true
                }
                override fun close() { }
            } }, listener) },
        )
        val controller = SharedPageController(runtime, authority, "space")
        try {
            controller.open("https://sync.example", "page")
            compose.setContent { WorldsTheme { SharedPageScreen(authority, Workspace("space", "Team", "owner", 1), {}, controller) } }
            compose.waitUntil(20_000) { controller.state.value.access == "edit" && controller.state.value.snapshot != null }
            compose.onNodeWithTag("shared_add_paragraph").performScrollTo().performClick()
            compose.onNodeWithTag("shared_draft").performTextInput("Shared paragraph مرحبا")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { controller.state.value.draft == null && controller.state.value.blocks.any { it.text == "Shared paragraph مرحبا" } && store.pending(key).isEmpty() }
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                compose.waitForIdle(); Thread.sleep(300)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-append.png")).use { it.readBytes() }
            }
            val json = org.json.JSONObject(YrsNative.editorJson(remote.get()))
            val paragraph = json.getJSONArray("content").getJSONObject(0)
            assertEquals("paragraph", paragraph.getString("type"))
            assertEquals("Shared paragraph مرحبا", paragraph.getJSONArray("content").getJSONObject(0).getString("text"))
            assertTrue(paragraph.getJSONObject("attrs").getString("bid").isNotBlank())
            val firstId = paragraph.getJSONObject("attrs").getString("bid")
            compose.onNodeWithTag("shared_block_actions_$firstId").performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.insert_heading_after)).performClick()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                compose.waitForIdle(); Thread.sleep(300)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-heading-editor.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("shared_heading_level_2").performClick()
            compose.onNodeWithTag("shared_draft").performTextInput("Shared heading")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { controller.state.value.draft == null && controller.state.value.blocks.size == 2 && store.pending(key).isEmpty() }
            val blocks = org.json.JSONObject(YrsNative.editorJson(remote.get())).getJSONArray("content")
            assertEquals(firstId, blocks.getJSONObject(0).getJSONObject("attrs").getString("bid"))
            assertEquals("heading", blocks.getJSONObject(1).getString("type"))
            assertEquals(2, blocks.getJSONObject(1).getJSONObject("attrs").getInt("level"))
            assertEquals("Shared heading", blocks.getJSONObject(1).getJSONArray("content").getJSONObject(0).getString("text"))
            val output = app.cacheDir.resolve("shared-online-${UUID.randomUUID()}.md")
            try {
                compose.onNodeWithTag("shared_markdown").performScrollTo().performClick()
                compose.onNodeWithText(app.getString(R.string.shared_markdown_explanation)).assertIsDisplayed()
                if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                    compose.waitForIdle(); Thread.sleep(300)
                    android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-markdown.png")).use { it.readBytes() }
                }
                compose.onNodeWithTag("shared_markdown_save").performClick()
                val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
                compose.waitUntil(20_000) { automation.rootInActiveWindow?.packageName?.toString() == "com.google.android.documentsui" }
                automation.executeShellCommand("input keyevent 4").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertTrue(controller.beginMarkdownExport())
                controller.finishMarkdownExport(app, android.net.Uri.fromFile(output))
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertEquals(R.string.markdown_export_success, controller.state.value.markdownStatus)
                assertEquals("Shared paragraph مرحبا\n\n## Shared heading\n", output.readText())
            } finally { output.delete() }
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                compose.waitForIdle(); Thread.sleep(300)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-heading.png")).use { it.readBytes() }
            }
        } finally {
            controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { }
            store.close(); app.deleteDatabase(name)
        }
    }

    @Test fun offlineEditorAddsParagraphAndKeepsRejectedText() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val name = "shared-append-offline-${UUID.randomUUID()}.db"
        val authority = "https://identity.example"
        val endpoint = "https://sync.example"
        val key = SyncDocumentKey("user", "space", "page", 0, authority)
        val store = AndroidSyncStore(app, name)
        val seed = YrsNative.appendParagraph(byteArrayOf(), "existing", "Existing")
        store.bindEndpoint(key, endpoint); store.append(key, seed, local = false)
        store.rememberAccess(key, "device", endpoint, "edit")
        val runtime = AccountSyncRuntime(
            credentials = { throw java.io.IOException("offline") },
            offlinePrincipal = { SyncPrincipal(authority, "user", "device") },
            cachedPages = { server, account, device -> store.cachedPages(server, account, device) },
            loadCached = { doc -> store.load(doc).let { replica -> replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) } } },
            offlineAppend = { doc, bid, text -> OfflineEditor.appendParagraph(store, doc, bid, text) },
            offlineInsert = { doc, base, bid, text, kind, level, after -> OfflineEditor.insertTextBlock(store, doc, base, bid, text, kind, level, after) },
            recoveredText = { store.recovered(it) },
            writeWorkingDraft = { doc, token, draft -> store.saveWorkingDraft(doc, token, draft) },
            removeWorkingDraft = { doc, token -> store.discardWorkingDraft(doc, token); Unit },
            makeSession = { _, _, _, _ -> error("offline") },
        )
        val controller = SharedPageController(runtime, authority, "space", retryDelay = { 30_000 })
        try {
            controller.open(endpoint, "page")
            compose.setContent { WorldsTheme { SharedPageScreen(authority, Workspace("space", "Team", "owner", 1), {}, controller) } }
            compose.waitUntil(20_000) { controller.state.value.offline && controller.state.value.access == "edit" }
            compose.onNodeWithTag("shared_add_paragraph").performScrollTo().performClick()
            compose.onNodeWithTag("shared_draft").performTextInput("Offline draft")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { controller.state.value.draft == null && controller.state.value.blocks.any { it.text == "Offline draft" } && store.pending(key).size == 1 }
            compose.onNodeWithTag("shared_block_actions_existing").performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.insert_heading_after)).performClick()
            compose.onNodeWithTag("shared_heading_level_3").performClick()
            compose.onNodeWithTag("shared_draft").performTextInput("Offline heading")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { controller.state.value.draft == null && controller.state.value.blocks.size == 3 && store.pending(key).size == 2 }
            assertEquals(listOf("Existing", "Offline heading", "Offline draft"), controller.state.value.blocks.map { it.text })
            val output = app.cacheDir.resolve("shared-offline-${UUID.randomUUID()}.md")
            try {
                assertTrue(controller.beginMarkdownExport())
                controller.finishMarkdownExport(app, android.net.Uri.fromFile(output))
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertEquals(R.string.markdown_export_success, controller.state.value.markdownStatus)
                assertEquals("Existing\n\n### Offline heading\n\nOffline draft\n", output.readText())
                controller.edit(controller.state.value.blocks.first())
                controller.updateDraft("Unsaved change")
                assertTrue(controller.beginMarkdownExport())
                controller.finishMarkdownExport(app, android.net.Uri.fromFile(output))
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertEquals("Existing\n\n### Offline heading\n\nOffline draft\n", output.readText())
                controller.cancelDraft()
                assertTrue(controller.beginMarkdownExport())
                val missingParent = app.cacheDir.resolve("missing-${UUID.randomUUID()}/page.md")
                controller.finishMarkdownExport(app, android.net.Uri.fromFile(missingParent))
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertEquals(R.string.markdown_export_error, controller.state.value.markdownStatus)
                assertFalse(missingParent.exists())
                assertTrue(controller.beginMarkdownExport())
                runtime.accountChange { }
                controller.finishMarkdownExport(app, android.net.Uri.fromFile(output))
                assertEquals(R.string.markdown_export_interrupted, controller.state.value.markdownStatus)
                assertEquals("Existing\n\n### Offline heading\n\nOffline draft\n", output.readText())
            } finally { output.delete() }
            store.purgeRevokedPage(key)
            assertTrue(store.recovered(key).any { it.text == "Offline draft" })
            assertTrue(store.recovered(key).any { it.text == "Offline heading" })
        } finally {
            controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { }
            store.close(); app.deleteDatabase(name)
        }
    }

    @Test fun reviewAndSaveRecoveredTextOnItsOriginalBlock() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val name = "recovery-edit-ui-${UUID.randomUUID()}.db"
        val authority = "https://identity.example"
        val key = SyncDocumentKey("user", "space", "page", 0, authority)
        val store = AndroidSyncStore(app, name)
        val base = Base64.decode("AQmJBgAHAQdkZWZhdWx0AwdoZWFkaW5nBwCJBgAGBgCJBgEEYm9sZAJ7fYaJBgIEbGluax97ImhyZWYiOiJodHRwczovL2V4YW1wbGUudGVzdCJ9hIkGAwZB8J+YgEKGiQYHBGJvbGQEbnVsbIaJBggEbGluawRudWxsKACJBgAFbGV2ZWwBfQIoAIkGAANiaWQBdwZibG9jazEA", Base64.DEFAULT)
        store.append(key, base, local = false)
        store.saveRecoveredText(key, DraftCapture("block1", "My recovered paragraph"))
        val entry = store.recovered(key).single()
        val runtime = AccountSyncRuntime(
            credentials = { SyncCredentials(authority, "user", "device", "token") },
            recoveredText = { store.recovered(it) },
            writeWorkingDraft = { doc, token, draft -> store.saveWorkingDraft(doc, token, draft) },
            removeWorkingDraft = { doc, token -> store.discardWorkingDraft(doc, token); Unit },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() {
                    callback.onAuthenticated("edit")
                    callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
                    callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0)))
                }
                override fun send(frame: SyncWire.Frame): Boolean {
                    if (frame is SyncWire.Frame.Update) callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, ""))
                    return true
                }
                override fun close() { }
            } }, listener) },
        )
        val controller = SharedPageController(runtime, authority, "space")
        try {
            controller.open("https://sync.example", "page")
            compose.setContent { WorldsTheme { CompositionLocalProvider(LocalAppearancePreferences provides AppearancePreferences(direction = "rtl", suggestions = false)) { SharedPageScreen(authority, Workspace("space", "Team", "owner", 1), {}, controller) } } }
            compose.waitUntil(20_000) { controller.state.value.access == "edit" && controller.state.value.recovered.any { it.id == entry.id } }
            compose.onNodeWithTag("restore_recovery_${entry.id}").performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.shared_recovered_edit_explanation)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-recovery-edit.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("confirm_restore_recovery").performClick()
            compose.onNodeWithTag("shared_draft").assertIsDisplayed()
            assertEquals("My recovered paragraph", compose.onNodeWithTag("shared_draft").fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.EditableText].text)
            val layouts = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            compose.onNodeWithTag("shared_draft").performSemanticsAction(SemanticsActions.GetTextLayoutResult) { action -> check(action(layouts)) }
            assertEquals(androidx.compose.ui.text.style.ResolvedTextDirection.Rtl, layouts.first().getParagraphDirection(0))
            assertEquals("A😀B", controller.state.value.blocks.single().text)
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { controller.state.value.draft == null && controller.state.value.blocks.singleOrNull()?.text == "My recovered paragraph" && store.pending(key).isEmpty() }
            assertTrue(store.recovered(key).any { it.id == entry.id })
        } finally {
            controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { }
            store.close(); app.deleteDatabase(name)
        }
    }
}
