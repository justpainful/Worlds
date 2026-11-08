package worlds.android

import android.util.Base64
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SharedRecoveryUiTest {
    @get:Rule val compose = createComposeRule()

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
            compose.onNodeWithTag("shared_draft").assertIsDisplayed().assertTextEquals("My recovered paragraph")
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
