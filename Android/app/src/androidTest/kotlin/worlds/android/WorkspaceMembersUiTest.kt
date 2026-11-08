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
class WorkspaceMembersUiTest {
    @get:Rule val compose = createComposeRule()
    @Test fun ownerChangesRoleAndReconcilesUncertainRemoval() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val profile = AccountProfile("owner", "device", "Owner", "https://identity.example")
        val gateway = object : WorkspaceMembersGateway {
            var items = listOf(WorkspaceMember("owner", "Owner", "owner@example.test", "owner"), WorkspaceMember("guest", "Sara", "sara@example.test", "guest"))
            override fun list(expected: AccountProfile?): WorkspaceMembers { require(expected == null || expected == profile); return WorkspaceMembers(profile, items) }
            override fun setRole(expected: AccountProfile, target: String, role: String) { require(expected == profile); items = items.map { if (it.userId == target) it.copy(role = role) else it } }
            override fun remove(expected: AccountProfile, target: String) { require(expected == profile); items = items.filterNot { it.userId == target }; throw IOException("response lost after removal") }
        }
        val runtime = AccountSyncRuntime(credentials = { SyncCredentials(profile.baseUrl, profile.userId, profile.deviceId, "token") }, makeSession = { _, _, _, _ -> error("unused") })
        try {
            compose.setContent { WorldsTheme { WorkspaceMembersScreen(profile.baseUrl, Workspace("space", "Team", "owner", 2), {}, gateway, runtime) } }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("member_guest").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("member_actions_owner").assertDoesNotExist()
            compose.onNodeWithTag("member_actions_guest").performClick()
            compose.onNodeWithTag("member_role_guest_admin").performClick()
            compose.onNodeWithTag("members_confirm").performClick()
            compose.waitUntil(15_000) { gateway.items.single { it.userId == "guest" }.role == "admin" }
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.workspace_admin)).fetchSemanticsNodes().isNotEmpty() }
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-members.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("member_actions_guest").performClick()
            compose.onNodeWithTag("member_remove_guest").performClick()
            compose.onNodeWithText(app.getString(R.string.members_remove_confirm, "Sara")).assertIsDisplayed()
            compose.onNodeWithTag("members_confirm").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.members_uncertain)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("member_actions_guest").assertIsNotEnabled()
            compose.onNodeWithTag("members_refresh").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("member_guest").fetchSemanticsNodes().isEmpty() }
        } finally { runtime.accountChange { } }
    }

    @Test fun roleRulesMatchTheServer() {
        assertTrue(allowedMemberRoles("admin", "owner", false).isEmpty())
        assertTrue(allowedMemberRoles("admin", "admin", false).isEmpty())
        assertEquals(listOf("member"), allowedMemberRoles("admin", "guest", false))
        assertTrue(allowedMemberRoles("owner", "admin", true).isEmpty())
        assertFalse(canRemoveMember("admin", "admin", false))
        assertTrue(canRemoveMember("admin", "guest", false))
        assertFalse(canRemoveMember("owner", "owner", false))
    }
}
