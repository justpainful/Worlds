package worlds.android

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.*
import worlds.sync.CachedPage

@RunWith(AndroidJUnit4::class)
class WorkspacePagesUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun selectingAuthorizedPageRequiresValidSyncEndpoint() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val profile = AccountProfile("user", "device", "Person", "https://identity.example")
        val gateway = object : WorkspacePagesGateway {
            var calls = 0
            override fun list(expected: AccountProfile?): WorkspacePages { calls++; require(expected == null || expected == profile); return WorkspacePages(profile, listOf(WorkspacePageAccess("page-a", "view"), WorkspacePageAccess("page-b", "edit"))) }
        }
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(profile.baseUrl, profile.userId, profile.deviceId, "token") }, makeSession = { _, _, _, _ -> error("unused") })
        val endpoint = mutableStateOf(""); var target: CachedPage? = null; var manual = false
        try {
            compose.setContent { WorldsTheme { WorkspacePagesScreen(profile.baseUrl, Workspace("space", "Team", "member", 2), endpoint.value, { endpoint.value = it }, {}, { target = it }, { manual = true }, gateway, runtime) } }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("workspace_page_page-a").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("workspace_page_page-a").performClick()
            compose.onNodeWithText(app.getString(R.string.pages_invalid_server)).assertIsDisplayed()
            assertNull(target)
            compose.onNodeWithTag("pages_server").performTextInput("https://sync.example")
            compose.onNodeWithTag("workspace_page_page-b").performClick()
            assertEquals("page-b", target!!.page); assertEquals("edit", target!!.level); assertEquals("https://sync.example", target!!.endpoint)
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(800)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-workspace-pages.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("pages_refresh").performClick()
            compose.waitUntil(15_000) { gateway.calls >= 2 }
            compose.onNodeWithTag("pages_manual").performClick(); assertTrue(manual)
        } finally { runtime.accountChange { } }
    }
}
