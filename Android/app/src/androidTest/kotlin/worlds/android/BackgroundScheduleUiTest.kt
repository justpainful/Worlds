package worlds.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.Workspace
import worlds.sync.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class BackgroundScheduleUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun schedulingFailureIsVisibleAndRetryClearsIt() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val name = "background-ui-${UUID.randomUUID()}.db"; val store = AndroidSyncStore(context, name)
        val fail = AtomicBoolean(true)
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(it, "user", "device", "token") },
            ensureSweepWork = { if (fail.get()) error("scheduler unavailable") },
            makeSession = { key, _, _, listener -> SyncSession(store, key, { callback -> object : SyncTransport {
                override fun start() { callback.onAuthenticated("edit"); callback.onFrame(SyncWire.Frame.Sync(0, 0, byteArrayOf(0))); callback.onFrame(SyncWire.Frame.Sync(1, 0, byteArrayOf(0))) }
                override fun send(frame: SyncWire.Frame): Boolean { if (frame is SyncWire.Frame.Update) callback.onFrame(SyncWire.Frame.Ack(frame.batchId, 0, "")); return true }
                override fun close() = Unit
            } }, listener) })
        val controller = SharedPageController(runtime, "https://identity.example", "space")
        try {
            controller.open("https://sync.example", "page")
            compose.setContent { WorldsTheme { SharedPageScreen("https://identity.example", Workspace("space", "Team", "owner", 1), {}, controller) } }
            compose.waitUntil(20_000) { controller.state.value.access == "edit" && controller.state.value.backgroundScheduleFailed }
            compose.onNodeWithTag("shared_background_error").assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                compose.waitForIdle(); Thread.sleep(300)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-background-sync-error.png").close()
            }
            fail.set(false); compose.onNodeWithTag("shared_background_retry").performClick()
            compose.waitUntil(20_000) { !controller.state.value.backgroundScheduleFailed && !controller.state.value.backgroundScheduleRetrying }
            compose.onNodeWithTag("shared_background_error").assertDoesNotExist()
        } finally { controller.close(); runtime.accountChange { }; store.close(); context.deleteDatabase(name) }
    }
}
