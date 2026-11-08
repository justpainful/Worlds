package worlds.android

import android.util.Base64
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.Workspace
import worlds.sync.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class SharedVersionRestoreUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun reorderedVersionIsRejectedBeforeBackupOrAnyEdit() {
        val test = InstrumentationRegistry.getInstrumentation(); val app = test.targetContext.applicationContext
        val fixture = JSONObject(test.context.assets.open("restore-fixture.json").bufferedReader().use { it.readText() })
        fun field(name: String) = Base64.decode(fixture.getString(name), Base64.DEFAULT)
        val name = "restore-ui-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(app, name)
        val authority = "https://identity.example"; val key = SyncDocumentKey("user", "space", "page", 0, authority)
        store.append(key, field("reordered"), local = false)
        val backups = AtomicInteger()
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(it, "user", "device", "token") },
            historyListOverride = { _, _, _, _ -> listOf(SharedVersion("v1", 1L, "Earlier", listOf("user"), 10L)) },
            historyStateOverride = { _, _, _, _, _ -> field("version") },
            historyCreateOverride = { _, _, _, _, _ -> backups.incrementAndGet(); SharedVersion("backup", 2L, null, emptyList(), 10L) },
            makeSession = { doc, _, _, listener -> SyncSession(store, doc, { callback -> object : SyncTransport {
                override fun start() {
                    callback.onAuthenticated("edit")
                    callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0)))
                    callback.onFrame(SyncWire.Frame.Sync(0, 1, byteArrayOf(0, 0)))
                    callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0)))
                }
                override fun send(frame: SyncWire.Frame): Boolean { if (frame is SyncWire.Frame.Update) callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, "")); return true }
                override fun close() = Unit
            } }, listener) })
        val controller = SharedPageController(runtime, authority, "space")
        try {
            controller.open("https://sync.example", "page")
            compose.setContent { WorldsTheme { SharedPageScreen(authority, Workspace("space", "Team", "owner", 1), {}, controller) } }
            compose.waitUntil(20_000) { controller.state.value.access == "edit" && controller.state.value.blocks.size == 2 }
            compose.onNodeWithTag("shared_history").performClick()
            compose.waitUntil(20_000) { controller.state.value.versions.isNotEmpty() && !controller.state.value.historyLoading }
            compose.onNodeWithTag("shared_version_v1").performClick()
            compose.waitUntil(20_000) { controller.state.value.historyPreview != null }
            compose.onNodeWithTag("shared_version_restore").performClick()
            compose.onNodeWithTag("shared_version_restore_confirm").assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                compose.waitForIdle(); Thread.sleep(300)
                test.uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-restore-confirmation.png").close()
            }
            compose.onNodeWithTag("shared_version_restore_confirm").performClick()
            compose.waitUntil(20_000) { controller.state.value.historyRestoreConflict && !controller.state.value.historySaving }
            assertTrue(controller.state.value.historyError)
            compose.onNodeWithText(app.getString(R.string.shared_history_restore_failed)).assertIsDisplayed()
            assertEquals(0, backups.get()); assertTrue(store.pending(key).isEmpty())
            assertEquals(listOf("b", "a"), controller.state.value.blocks.map { it.id })
        } finally { controller.close(); runtime.accountChange { }; store.close(); app.deleteDatabase(name) }
    }
}
