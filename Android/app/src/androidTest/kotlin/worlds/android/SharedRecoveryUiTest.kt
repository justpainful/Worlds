package worlds.android

import android.util.Base64
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTextInputSelection
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

    @Test fun editorAddsParagraphAndQueuesItForPeer() = onlineEditorScenario(stress = false)

    @Test fun longSharedTextSyncsToPeer() = onlineEditorScenario(stress = true)

    @Test fun duplicateHeadingSyncsToPeerAndRemainsIndependent() = onlineEditorScenario(stress = false, duplicate = true)

    private fun onlineEditorScenario(stress: Boolean, duplicate: Boolean = false) {
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
            if (duplicate) {
                compose.onNodeWithTag("shared_permissions").assertContentDescriptionEquals(app.getString(R.string.access_title))
                compose.onNodeWithTag("shared_conversations").assertContentDescriptionEquals(app.getString(R.string.conversations_title))
                compose.onNodeWithTag("shared_notices").assertContentDescriptionEquals(app.getString(R.string.notices_title))
                compose.onNodeWithTag("shared_history").assertContentDescriptionEquals(app.getString(R.string.shared_history_title))
                compose.onNodeWithTag("shared_markdown").assertContentDescriptionEquals(app.getString(R.string.markdown_export))
                val strip = compose.onNodeWithTag("shared_action_strip").getUnclippedBoundsInRoot()
                assertTrue((strip.bottom - strip.top).value <= 56f)
                assertTrue(compose.onNodeWithTag("shared_block_$firstId").getUnclippedBoundsInRoot().top >= strip.bottom)
                val headingId = blocks.getJSONObject(1).getJSONObject("attrs").getString("bid")
                compose.onNodeWithTag("shared_block_actions_$headingId").performScrollTo().performClick()
                if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                    compose.waitForIdle(); Thread.sleep(300)
                    android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-duplicate.png")).use { it.readBytes() }
                }
                compose.onNodeWithTag("shared_duplicate_$headingId").performClick()
                compose.waitUntil(20_000) { controller.state.value.blocks.size == 3 && !controller.state.value.saving && store.pending(key).isEmpty() }
                val copied = org.json.JSONObject(YrsNative.editorJson(remote.get())).getJSONArray("content")
                assertEquals("heading", copied.getJSONObject(2).getString("type"))
                assertEquals(2, copied.getJSONObject(2).getJSONObject("attrs").getInt("level"))
                assertNotEquals(headingId, copied.getJSONObject(2).getJSONObject("attrs").getString("bid"))
                assertEquals("Shared heading", worlds.content.InlineEditing.text(copied.getJSONObject(2).toString()))
                controller.edit(controller.state.value.blocks.last())
                controller.updateDraft("Independent copy")
                controller.save()
                compose.waitUntil(20_000) { controller.state.value.draft == null && controller.state.value.blocks.last().text == "Independent copy" && store.pending(key).isEmpty() }
                val edited = org.json.JSONObject(YrsNative.editorJson(remote.get())).getJSONArray("content")
                assertEquals("Shared heading", worlds.content.InlineEditing.text(edited.getJSONObject(1).toString()))
                assertEquals("Independent copy", worlds.content.InlineEditing.text(edited.getJSONObject(2).toString()))
                return
            }
            if (stress) {
                controller.addTextBlock("paragraph")
                val original = "z".repeat(100_001) + "😀"
                controller.updateDraft(original)
                compose.waitUntil(20_000) { compose.onAllNodes(androidx.compose.ui.test.hasTestTag("shared_text_next")).fetchSemanticsNodes().isNotEmpty() }
                controller.save()
                compose.waitUntil(30_000) { controller.state.value.draft == null && controller.state.value.blocks.size == 3 && store.pending(key).isEmpty() }
                val peerCreated = org.json.JSONObject(YrsNative.editorJson(remote.get())).getJSONArray("content").getJSONObject(2)
                assertEquals(original, worlds.content.InlineEditing.text(peerCreated.toString()))
                controller.edit(controller.state.value.blocks.last())
                compose.onNodeWithTag("shared_draft").performTextInputSelection(androidx.compose.ui.text.TextRange(0))
                compose.onNodeWithTag("shared_draft").performTextInput("Peer 😀 ")
                val updated = "Peer 😀 " + original
                controller.save()
                compose.waitUntil(30_000) { controller.state.value.draft == null && controller.state.value.blocks.last().text == updated && store.pending(key).isEmpty() }
                val peerEdited = org.json.JSONObject(YrsNative.editorJson(remote.get())).getJSONArray("content").getJSONObject(2)
                assertEquals(updated, worlds.content.InlineEditing.text(peerEdited.toString()))
                return
            }
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
                if (InstrumentationRegistry.getArguments().getString("realPicker") == "1") {
                    val filename = "worlds-shared-test-${UUID.randomUUID()}.md"
                    val path = "/sdcard/Download/$filename"
                    try {
                        fun find(id: String) = automation.rootInActiveWindow?.findAccessibilityNodeInfosByViewId(id)?.firstOrNull()
                        fun filenameField() = automation.rootInActiveWindow?.findAccessibilityNodeInfosByViewId("android:id/title")?.firstOrNull { it.isEditable }
                        compose.waitUntil(20_000) { filenameField() != null && find("android:id/button1") != null }
                        check(find("com.google.android.documentsui:id/breadcrumb_text")?.text?.toString() == "Downloads")
                        val args = android.os.Bundle().apply { putCharSequence(android.view.accessibility.AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, filename) }
                        check(filenameField()!!.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_SET_TEXT, args))
                        check(find("android:id/button1")!!.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))
                        compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                        assertEquals(R.string.markdown_export_success, controller.state.value.markdownStatus)
                        val bytes = automation.executeShellCommand("cat $path").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
                        assertEquals("Shared paragraph مرحبا\n\n## Shared heading\n", bytes.toString(Charsets.UTF_8))
                    } finally {
                        automation.executeShellCommand("rm -f $path").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
                    }
                } else automation.executeShellCommand("input keyevent 4").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertTrue(controller.beginMarkdownExport())
                controller.finishMarkdownExport(app, android.net.Uri.fromFile(output))
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertEquals(R.string.markdown_export_success, controller.state.value.markdownStatus)
                assertEquals("Shared paragraph مرحبا\n\n## Shared heading\n", output.readText())
                compose.onNodeWithTag("shared_markdown").performScrollTo().performClick()
                compose.onNodeWithTag("shared_markdown_copy").performClick()
                compose.waitUntil(20_000) { controller.state.value.markdownStatus == R.string.markdown_copy_success }
                val clipboard = app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
                assertEquals("Shared paragraph مرحبا\n\n## Shared heading\n", clipboard.primaryClip!!.getItemAt(0).text.toString())
                val shared = java.util.concurrent.atomic.AtomicReference<String>()
                controller.deliverMarkdown(copy = false) { shared.set(it) }
                compose.waitUntil(20_000) { shared.get() != null && !controller.state.value.markdownExporting }
                val chooser = markdownShareIntent("Shared page", shared.get())
                val send = chooser.getParcelableExtra<android.content.Intent>(android.content.Intent.EXTRA_INTENT)!!
                assertEquals(android.content.Intent.ACTION_SEND, send.action)
                assertEquals("Shared paragraph مرحبا\n\n## Shared heading\n", send.getStringExtra(android.content.Intent.EXTRA_TEXT))
                if (InstrumentationRegistry.getArguments().getString("realShare") == "1") {
                    compose.onNodeWithTag("shared_markdown").performScrollTo().performClick()
                    compose.onNodeWithTag("shared_markdown_share").performClick()
                    compose.waitUntil(20_000) {
                        val active = automation.rootInActiveWindow?.packageName?.toString()
                        active != null && active != app.packageName
                    }
                    automation.executeShellCommand("input keyevent 4").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
                    compose.waitUntil(20_000) { automation.rootInActiveWindow?.packageName?.toString() == app.packageName }
                }
                controller.deliverMarkdown(copy = false) { error("No sharing target") }
                compose.waitUntil(20_000) { controller.state.value.markdownStatus == R.string.markdown_share_error }
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

    @Test fun offlineEditorAddsParagraphAndKeepsRejectedText() = offlineEditorScenario(stress = false)

    @Test fun longSharedTextCanBeEditedAndSavedOffline() = offlineEditorScenario(stress = true)

    @Test fun sharedToolbarSupportsArabicLargeTextOffline() = offlineEditorScenario(stress = false, rtl = true)

    @Test fun sharedDraftSavesWithKeyboardAndProtectsDiscardConfirmation() = offlineEditorScenario(stress = false, keyboard = true)

    private fun offlineEditorScenario(stress: Boolean, rtl: Boolean = false, keyboard: Boolean = false) {
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
            offlineEdit = { doc, base, bid, start, end, text, draft -> OfflineEditor.replaceBlockText(store, doc, base, bid, start, end, text, draft) },
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
            val config = android.content.res.Configuration(app.resources.configuration).apply { if (rtl) setLocale(java.util.Locale("ar")) }
            val localized = if (rtl) app.createConfigurationContext(config) else app
            compose.setContent {
                val currentDensity = androidx.compose.ui.platform.LocalDensity.current
                val registryOwner = requireNotNull(androidx.activity.compose.LocalActivityResultRegistryOwner.current)
                CompositionLocalProvider(
                    androidx.activity.compose.LocalActivityResultRegistryOwner provides registryOwner,
                    androidx.compose.ui.platform.LocalContext provides localized,
                    androidx.compose.ui.platform.LocalConfiguration provides config,
                    androidx.compose.ui.platform.LocalLayoutDirection provides if (rtl) androidx.compose.ui.unit.LayoutDirection.Rtl else androidx.compose.ui.unit.LayoutDirection.Ltr,
                    androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(currentDensity.density, if (rtl) 1.5f else currentDensity.fontScale),
                ) { WorldsTheme { SharedPageScreen(authority, Workspace("space", if (rtl) "مساحة الفريق" else "Team", "owner", 1), {}, controller) } }
            }
            compose.waitUntil(20_000) { controller.state.value.offline && controller.state.value.access == "edit" }
            if (rtl) {
                compose.onNodeWithTag("shared_permissions").assertContentDescriptionEquals(localized.getString(R.string.access_title)).assertIsNotEnabled()
                compose.onNodeWithTag("shared_conversations").assertIsNotEnabled()
                compose.onNodeWithTag("shared_notices").assertIsNotEnabled()
                compose.onNodeWithTag("shared_history").assertIsNotEnabled()
                compose.onNodeWithTag("shared_markdown").assertContentDescriptionEquals(localized.getString(R.string.markdown_export)).assertIsEnabled()
                if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                    compose.waitForIdle(); Thread.sleep(300)
                    android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-toolbar-ar.png")).use { it.readBytes() }
                }
                compose.onNodeWithTag("shared_markdown").performTouchInput { longClick() }
                compose.onNodeWithText(localized.getString(R.string.markdown_export)).assertIsDisplayed()
                return
            }
            if (keyboard) {
                fun key(meta: Int) {
                    val instrumentation = InstrumentationRegistry.getInstrumentation(); val now = android.os.SystemClock.uptimeMillis()
                    instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_S, 0, meta))
                    instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_UP, android.view.KeyEvent.KEYCODE_S, 0, meta))
                    compose.waitForIdle()
                }
                compose.onNodeWithTag("shared_block_existing").performClick()
                compose.onNodeWithTag("shared_draft").performClick().performTextInput(" edited")
                val ctrl = android.view.KeyEvent.META_CTRL_ON
                key(ctrl or android.view.KeyEvent.META_SHIFT_ON)
                assertTrue(controller.state.value.draft != null)
                compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
                compose.onNodeWithTag("shared_discard_title").assertIsDisplayed()
                key(ctrl)
                assertTrue(controller.state.value.draft != null)
                assertTrue(store.pending(key).isEmpty())
                compose.onNodeWithTag("shared_discard_cancel").performClick()
                compose.onNodeWithTag("shared_draft").performClick()
                key(ctrl)
                compose.waitUntil(20_000) { controller.state.value.draft == null && controller.state.value.blocks.single().text?.contains(" edited") == true && store.pending(key).size == 1 }
                return
            }
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
            if (stress) {
                controller.addTextBlock("paragraph")
                controller.updateDraft("x".repeat(100_001))
                compose.waitUntil(20_000) { compose.onAllNodes(androidx.compose.ui.test.hasTestTag("shared_text_next")).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithText(app.getString(R.string.shared_text_part, 1, 26)).performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("shared_text_next").performScrollTo().performClick()
                compose.onNodeWithText(app.getString(R.string.shared_text_part, 2, 26)).performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("shared_draft").performScrollTo().performTextReplacement("changed😀")
                val expected = "x".repeat(4_000) + "changed😀" + "x".repeat(92_001)
                assertEquals(expected, controller.state.value.draft!!.text)
                controller.cancelDraft()
                compose.waitUntil(20_000) { compose.onAllNodes(androidx.compose.ui.test.hasTestTag("shared_draft")).fetchSemanticsNodes().isEmpty() }
                controller.addTextBlock("paragraph")
                compose.waitUntil(20_000) { compose.onAllNodes(androidx.compose.ui.test.hasTestTag("shared_draft")).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithTag("shared_draft").performTextReplacement("x".repeat(100_001))
                compose.waitUntil(20_000) { controller.state.value.draft?.text?.length == 100_001 }
                compose.onNodeWithText(app.getString(R.string.shared_text_part, 26, 26)).performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("shared_text_jump").performScrollTo().performClick()
                compose.onNodeWithTag("shared_text_part_number").performTextReplacement("٢")
                compose.onNodeWithTag("shared_text_go_confirm").performClick()
                compose.onNodeWithText(app.getString(R.string.shared_text_part, 2, 26)).performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("shared_draft").performScrollTo().performTextReplacement("middle😀")
                val afterMiddle = "x".repeat(4_000) + "middle😀" + "x".repeat(92_001)
                assertEquals(afterMiddle, controller.state.value.draft!!.text)
                val offsets = sharedTextPageOffsets(afterMiddle)
                compose.onNodeWithTag("shared_text_jump").performScrollTo().performClick()
                compose.onNodeWithTag("shared_text_part_number").performTextReplacement((offsets.size - 1).toString())
                compose.onNodeWithTag("shared_text_go_confirm").performClick()
                compose.onNodeWithTag("shared_draft").performTextReplacement("changed😀")
                val pasted = afterMiddle.substring(0, offsets[offsets.size - 2]) + "changed😀"
                assertEquals(pasted, controller.state.value.draft!!.text)
                if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                    compose.waitForIdle(); Thread.sleep(300)
                    android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-long-text.png")).use { it.readBytes() }
                }
                controller.save()
                compose.waitUntil(30_000) { controller.state.value.draft == null && controller.state.value.blocks.size == 4 }
                assertEquals(pasted, controller.state.value.blocks.last().text)
                compose.waitForIdle()
                compose.onNodeWithTag("shared_markdown").performScrollTo().assertIsDisplayed()
                controller.edit(controller.state.value.blocks.last())
                compose.onNodeWithTag("shared_draft").performTextInputSelection(androidx.compose.ui.text.TextRange(0))
                compose.onNodeWithTag("shared_draft").performTextInput("BEGIN😀")
                val edited = "BEGIN😀" + pasted
                assertEquals(edited, controller.state.value.draft!!.text)
                controller.save()
                compose.waitUntil(30_000) { !controller.state.value.saving }
                check(controller.state.value.draft == null && controller.state.value.blocks.last().text == edited) {
                    "Long edit was not saved: error=${controller.state.value.error}, draft=${controller.state.value.draft != null}, actualLength=${controller.state.value.blocks.last().text?.length}, expectedLength=${edited.length}"
                }
                compose.waitForIdle()
                val replica = store.load(key)
                val snapshot = replica.updates.fold(replica.snapshot ?: byteArrayOf()) { saved, update -> YrsNative.merge(saved, update.bytes) }
                val persisted = org.json.JSONObject(YrsNative.editorJson(snapshot)).getJSONArray("content").getJSONObject(3)
                assertEquals(edited, worlds.content.InlineEditing.text(persisted.toString()))
                return
            }
            val output = app.cacheDir.resolve("shared-offline-${UUID.randomUUID()}.md")
            try {
                assertTrue(controller.beginMarkdownExport())
                controller.finishMarkdownExport(app, android.net.Uri.fromFile(output))
                compose.waitUntil(20_000) { !controller.state.value.markdownExporting }
                assertEquals(R.string.markdown_export_success, controller.state.value.markdownStatus)
                assertEquals("Existing\n\n### Offline heading\n\nOffline draft\n", output.readText())
                val copied = java.util.concurrent.atomic.AtomicReference<String>()
                controller.deliverMarkdown(copy = true) { copied.set(it) }
                compose.waitUntil(20_000) { controller.state.value.markdownStatus == R.string.markdown_copy_success }
                assertEquals("Existing\n\n### Offline heading\n\nOffline draft\n", copied.get())
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

    @Test fun sharedTextDeliveryRejectsLargeContent() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val name = "shared-large-${UUID.randomUUID()}.db"
        val authority = "https://identity.example"
        val endpoint = "https://sync.example"
        val key = SyncDocumentKey("user", "space", "page", 0, authority)
        val store = AndroidSyncStore(app, name)
        store.bindEndpoint(key, endpoint)
        store.append(key, YrsNative.appendParagraph(byteArrayOf(), "large", "x".repeat(MAX_SHARE_TEXT_CHARS + 1)), local = false)
        store.rememberAccess(key, "device", endpoint, "view")
        val runtime = AccountSyncRuntime(
            credentials = { throw java.io.IOException("offline") },
            offlinePrincipal = { SyncPrincipal(authority, "user", "device") },
            cachedPages = { server, account, device -> store.cachedPages(server, account, device) },
            loadCached = { doc -> store.load(doc).let { replica -> replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) } } },
            makeSession = { _, _, _, _ -> error("offline") },
        )
        val controller = SharedPageController(runtime, authority, "space", retryDelay = { 30_000 })
        try {
            controller.open(endpoint, "page")
            compose.waitUntil(20_000) { controller.state.value.offline && controller.state.value.access == "view" }
            val delivered = java.util.concurrent.atomic.AtomicBoolean(false)
            controller.deliverMarkdown(copy = false) { delivered.set(true) }
            compose.waitUntil(20_000) { controller.state.value.markdownStatus == R.string.shared_markdown_text_limit }
            assertFalse(delivered.get())
        } finally {
            controller.close(); runtime.accountChange { }; store.close(); app.deleteDatabase(name)
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
