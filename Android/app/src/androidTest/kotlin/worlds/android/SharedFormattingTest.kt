package worlds.android

import android.util.Base64
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextInputSelection
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.Workspace
import worlds.sync.AndroidSyncStore
import worlds.sync.OfflineEditor
import worlds.sync.SyncDocumentKey
import worlds.sync.YrsNative
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SharedFormattingTest {
    @get:Rule val compose = createComposeRule()
    private fun snapshot() = Base64.decode("AQmJBgAHAQdkZWZhdWx0AwdoZWFkaW5nBwCJBgAGBgCJBgEEYm9sZAJ7fYaJBgIEbGluax97ImhyZWYiOiJodHRwczovL2V4YW1wbGUudGVzdCJ9hIkGAwZB8J+YgEKGiQYHBGJvbGQEbnVsbIaJBggEbGluawRudWxsKACJBgAFbGV2ZWwBfQIoAIkGAANiaWQBdwZibG9jazEA", Base64.DEFAULT)
    private fun block(state: ByteArray): SharedBlock {
        val raw = JSONObject(YrsNative.editorJson(state)).getJSONArray("content").getJSONObject(0).toString()
        return SharedBlock("block1", raw, worlds.content.InlineEditing.text(raw), true)
    }

    @Test fun formattedDraftMatchesYjsAfterMixedScriptReplacement() {
        val base = snapshot(); val original = block(base)
        val draft = SharedDraft(original, base, "AعربيB")
        val preview = requireNotNull(sharedDraftPreview(draft))
        val update = YrsNative.replaceBlockText(base, "block1", 1, 3, "عربي")
        val actual = previewBlock(block(YrsNative.merge(base, update)).raw, false).text
        assertEquals(actual.text, preview.text)
        for (i in actual.text.indices) {
            val actualStyles = actual.spanStyles.filter { i >= it.start && i < it.end }.map { it.item }
            val previewStyles = preview.spanStyles.filter { i >= it.start && i < it.end }.map { it.item }
            assertEquals(actualStyles, previewStyles)
        }
        assertTrue(preview.spanStyles.any { it.item.fontWeight == FontWeight.Bold })
        val visual = annotatedVisualTransformation(preview)
        assertEquals(5, visual.filter(AnnotatedString(draft.text)).offsetMapping.originalToTransformed(5))
        assertTrue(visual.filter(AnnotatedString("stale text")).text.spanStyles.isEmpty())
        assertNull(sharedDraftPreview(draft.copy(isNew = true)))
    }

    @Test fun projectedStylesMatchYjsAtBoundariesAndAcrossMarks() {
        val encoded = "AQqgBgAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgHAKAGAAYGAKAGAQRib2xkAnt9hKAGAgJBQoagBgQEYm9sZARudWxshqAGBQZpdGFsaWMCe32EoAYGBvCfmIBDRIagBgoGaXRhbGljBG51bGzEoAYKoAYLAkVGKACgBgADYmlkAXcGYmxvY2sxAA=="
        val base = Base64.decode(encoded, Base64.DEFAULT); val original = block(base)
        for ((start, end, inserted) in listOf(Triple(0, 0, "ن"), Triple(2, 2, "X"), Triple(1, 6, "ع"), Triple(4, 6, ""), Triple(8, 8, "!"))) {
            val expectedText = requireNotNull(original.text).replaceRange(start, end, inserted)
            val projected = requireNotNull(sharedDraftPreview(SharedDraft(original, base, expectedText)))
            val update = YrsNative.replaceBlockText(base, "block1", start, end, inserted)
            val actual = previewBlock(block(YrsNative.merge(base, update)).raw, false).text
            assertEquals(actual.text, projected.text)
            for (i in actual.text.indices) {
                assertEquals("UTF-16 position $i for edit $start..$end", actual.spanStyles.filter { i >= it.start && i < it.end }.map { it.item }, projected.spanStyles.filter { i >= it.start && i < it.end }.map { it.item })
            }
        }
    }

    @Test fun formattingSurvivesLongTextPartBoundaries() {
        val raw = JSONObject().put("type", "paragraph").put("content", org.json.JSONArray().put(
            JSONObject().put("type", "text").put("text", "a".repeat(3999) + "😀" + "ب".repeat(50))
                .put("marks", org.json.JSONArray().put(JSONObject().put("type", "bold")))))
        val original = worlds.content.InlineEditing.text(raw.toString())
        val block = SharedBlock("long", raw.toString(), original, true)
        val text = original + "نهاية"
        val styled = requireNotNull(sharedDraftPreview(SharedDraft(block, byteArrayOf(), text)))
        val offsets = sharedTextPageOffsets(text)
        assertEquals(3999, offsets[1])
        val second = styled.subSequence(offsets[1], offsets[2])
        assertEquals(text.substring(offsets[1], offsets[2]), second.text)
        assertTrue(second.text.indices.all { i -> second.spanStyles.any { it.item.fontWeight == FontWeight.Bold && i >= it.start && i < it.end } })
    }

    @Test fun offlineEditorKeepsMarksWhenSavingReplacement() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val name = "shared-format-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(app, name)
        val authority = "https://identity.example"; val endpoint = "https://sync.example"
        val key = SyncDocumentKey("user", "space", "page", 0, authority)
        store.bindEndpoint(key, endpoint); store.append(key, snapshot(), local = false); store.rememberAccess(key, "device", endpoint, "edit")
        val runtime = AccountSyncRuntime(
            credentials = { throw java.io.IOException("offline") },
            offlinePrincipal = { SyncPrincipal(authority, "user", "device") },
            cachedPages = { server, account, device -> store.cachedPages(server, account, device) },
            loadCached = { doc -> store.load(doc).let { replica -> replica.updates.fold(replica.snapshot ?: byteArrayOf()) { state, update -> YrsNative.merge(state, update.bytes) } } },
            offlineEdit = { doc, base, bid, start, end, text, draft -> OfflineEditor.replaceBlockText(store, doc, base, bid, start, end, text, draft) },
            writeWorkingDraft = { doc, token, draft -> store.saveWorkingDraft(doc, token, draft) },
            removeWorkingDraft = { doc, token -> store.discardWorkingDraft(doc, token); Unit },
            makeSession = { _, _, _, _ -> error("offline") },
        )
        val controller = SharedPageController(runtime, authority, "space", retryDelay = { 30_000 })
        try {
            controller.open(endpoint, "page")
            compose.setContent { WorldsTheme { SharedPageScreen(authority, Workspace("space", "Team", "owner", 1), {}, controller) } }
            compose.waitUntil(20_000) { controller.state.value.offline && controller.state.value.blocks.any { it.id == "block1" } }
            compose.onNodeWithTag("shared_block_block1").performClick()
            compose.onNodeWithTag("shared_draft").performClick().performTextInputSelection(TextRange(1, 3))
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                compose.waitForIdle(); Thread.sleep(800)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-shared-formatted-editor.png").close()
            }
            compose.onNodeWithTag("shared_draft").performTextInput("عربي")
            compose.onNodeWithText(app.getString(R.string.save)).assertIsDisplayed().performClick()
            compose.waitUntil(20_000) { controller.state.value.draft == null && store.pending(key).size == 1 }
            val saved = requireNotNull(controller.state.value.snapshot)
            val actual = previewBlock(block(saved).raw, false).text
            assertEquals("AعربيB", actual.text)
            assertTrue(actual.spanStyles.any { it.item.fontWeight == FontWeight.Bold && it.start == 0 && it.end == actual.length })
        } finally {
            controller.close(); assertTrue(controller.awaitDraftBackups()); runtime.accountChange { }
            store.close(); app.deleteDatabase(name)
        }
    }
}
