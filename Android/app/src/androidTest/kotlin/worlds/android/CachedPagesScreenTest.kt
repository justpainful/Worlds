package worlds.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.sync.CachedPage
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class CachedPagesScreenTest {
    @get:Rule val compose = createComposeRule()
    @Test fun cachedPageOpensWithItsOriginalServerAndWorkspace() {
        val authority = "https://identity.example"
        val expected = CachedPage("team", "notes", "https://sync.example", "edit")
        val selected = AtomicReference<CachedPage>()
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(authority, "user", "device", "token") },
            makeSession = { _, _, _, _ -> error("No session should open while listing") },
            cachedPages = { _, _, _ -> listOf(expected) })
        compose.setContent { WorldsTheme { CachedPagesScreen(authority, {}, { selected.set(it) }, runtime) } }
        compose.waitUntil(10_000) { compose.onAllNodes(androidx.compose.ui.test.hasTestTag("cached_page_notes")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("cached_page_notes").assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
            Thread.sleep(500)
            android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-cached-pages.png")).use { it.readBytes() }
        }
        compose.onNodeWithTag("cached_page_notes").performClick()
        assertEquals(expected, selected.get())
    }
}
