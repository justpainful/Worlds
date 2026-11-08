package worlds.android

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.identity.*
import java.io.IOException

@RunWith(AndroidJUnit4::class)
class PagePermissionsUiTest {
    @get:Rule val compose = createComposeRule()
    private val profile = AccountProfile("owner", "device", "Owner", "https://identity.example")
    private val members = listOf(WorkspaceMember("owner", "Owner", "", "owner"), WorkspaceMember("guest", "Sara", "", "guest"))
    private val groups = listOf(WorkspaceGroup("group1", "Design"))
    private fun runtime() = AccountSyncRuntime(credentials = { SyncCredentials(profile.baseUrl, profile.userId, profile.deviceId, "token") }, makeSession = { _, _, _, _ -> error("unused") })
    @Test fun inheritedGuestAccessCanBeOverriddenAndUncertainRemovalReconciled() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val gateway = object : PageAccessGateway {
            var inherit = true
            var entries = listOf(PermissionEntry("user", "guest", "view", "parent", true))
            override fun list(expected: AccountProfile?): PageAccessSnapshot { require(expected == null || expected == profile); return PageAccessSnapshot(PagePermissions(profile, "page", "full", inherit, true, entries), members, groups) }
            override fun set(expected: AccountProfile, type: String, principal: String, level: String) { require(expected == profile); entries = listOf(PermissionEntry(type, principal, level, "page", false)) }
            override fun remove(expected: AccountProfile, type: String, principal: String) { entries = emptyList(); throw IOException("response lost") }
            override fun inherit(expected: AccountProfile, value: Boolean) { inherit = value }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { PagePermissionsScreen(profile.baseUrl, Workspace("space", "Team", "owner", 2), "page", {}, gateway, rt) } }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("access_menu_user_guest").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(app.getString(R.string.access_inherited)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-page-access.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("access_menu_user_guest").performClick()
            compose.onNodeWithTag("access_set_user_guest_full").assertDoesNotExist()
            compose.onNodeWithTag("access_remove_user_guest").assertDoesNotExist()
            compose.onNodeWithTag("access_set_user_guest_edit").performClick()
            compose.onNodeWithTag("access_confirm").performClick()
            compose.waitUntil(15_000) { gateway.entries.single().level == "edit" && !gateway.entries.single().inherited }
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.access_inherited)).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("access_menu_user_guest").performClick()
            compose.onNodeWithTag("access_remove_user_guest").performClick()
            compose.onNodeWithTag("access_confirm").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.access_uncertain)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("access_menu_user_guest").assertDoesNotExist()
            compose.onNodeWithTag("access_refresh").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("access_menu_user_guest").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("access_inherit").performClick()
            compose.onNodeWithTag("access_confirm").performClick()
            compose.waitUntil(15_000) { !gateway.inherit }
        } finally { rt.accountChange { } }
    }
    @Test fun viewAccessCannotChangePermissions() {
        val gateway = object : PageAccessGateway {
            override fun list(expected: AccountProfile?) = PageAccessSnapshot(PagePermissions(profile, "page", "view", true, true, emptyList()), members, groups)
            override fun set(expected: AccountProfile, type: String, principal: String, level: String) { error("not allowed") }
            override fun remove(expected: AccountProfile, type: String, principal: String) { error("not allowed") }
            override fun inherit(expected: AccountProfile, value: Boolean) { error("not allowed") }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { PagePermissionsScreen(profile.baseUrl, Workspace("space", "Team", "member", 2), "page", {}, gateway, rt) } }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("access_inherit").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("access_inherit").assertIsNotEnabled()
            compose.onNodeWithTag("access_menu_workspace_*").assertIsNotEnabled()
        } finally { rt.accountChange { } }
    }
}
