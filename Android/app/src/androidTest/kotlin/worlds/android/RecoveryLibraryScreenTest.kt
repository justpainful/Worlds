package worlds.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.sync.AndroidSyncStore
import worlds.sync.DraftCapture
import worlds.sync.SyncDocumentKey
import java.util.UUID
import java.util.Locale

@RunWith(AndroidJUnit4::class)
class RecoveryLibraryScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun recoveredTextRemainsAccessibleAfterWorkspaceRemoval() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext
        val arabic = InstrumentationRegistry.getArguments().getString("arabicUi") == "1"
        val configuration = android.content.res.Configuration(app.resources.configuration).apply { if (arabic) setLocale(Locale("ar")) }
        val displayContext = app.createConfigurationContext(configuration)
        val name = "recovery-ui-${UUID.randomUUID()}.db"
        val authority = "https://identity.example"
        val key = SyncDocumentKey("user", "removed-workspace", "project-notes", 0, authority)
        val store = AndroidSyncStore(app, name)
        try {
            store.saveRecoveredText(key, DraftCapture("block", "A saved idea from the project"))
            val runtime = AccountSyncRuntime(
                credentials = { SyncCredentials(authority, "user", "device", "token") },
                makeSession = { _, _, _, _ -> error("No shared page should open") },
                accountRecovery = { server, user, before -> store.recoveredForAccount(server, user, before) },
                deleteRecoveredText = { doc, id -> store.deleteRecovered(doc, id) },
            )
            compose.setContent {
                CompositionLocalProvider(LocalContext provides displayContext, LocalConfiguration provides configuration,
                    LocalLayoutDirection provides if (arabic) LayoutDirection.Rtl else LayoutDirection.Ltr) {
                    WorldsTheme { RecoveryLibraryScreen(authority, {}, runtime) }
                }
            }
            compose.waitUntil(10_000) { compose.onAllNodes(androidx.compose.ui.test.hasText("A saved idea from the project")).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("A saved idea from the project").assertIsDisplayed()
            compose.onNodeWithText(displayContext.getString(R.string.shared_recovered_workspace, "removed-workspace")).assertIsDisplayed()
            compose.onNodeWithText(displayContext.getString(R.string.shared_recovered_copy)).performClick()
            val clipboard = app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            assertTrue(clipboard.primaryClip?.getItemAt(0)?.text.toString() == "A saved idea from the project")
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                instrumentation.uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-recovery-qa.png").close()
            }
            compose.onNodeWithText(displayContext.getString(R.string.shared_recovered_delete)).performClick()
            compose.onNodeWithTag("delete_recovery_message").assertIsDisplayed()
            compose.onNodeWithTag("cancel_delete_recovery").performClick()
            assertTrue(store.recovered(key).isNotEmpty())
            compose.onNodeWithText(displayContext.getString(R.string.shared_recovered_delete)).performClick()
            compose.onNodeWithTag("confirm_delete_recovery").performClick()
            compose.waitUntil(10_000) { store.recovered(key).isEmpty() }
        } finally { store.close(); app.deleteDatabase(name) }
    }
}
