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
class WorkspaceInvitesUiTest {
    @get:Rule val compose = createComposeRule()
    private val profile = AccountProfile("owner", "device", "Owner", "https://identity.example")
    private val workspace = Workspace("space", "Team", "owner", 1)
    private fun runtime() = AccountSyncRuntime(credentials = { SyncCredentials(profile.baseUrl, profile.userId, profile.deviceId, "token") }, makeSession = { _, _, _, _ -> error("unused") })
    @Test fun createsOneTimeLinkAndRevokesOnlyAfterConfirmation() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val gateway = object : WorkspaceInvitesGateway {
            var items = emptyList<WorkspaceInvite>()
            override fun list(expected: AccountProfile?): InviteSnapshot { require(expected == null || expected == profile); return InviteSnapshot(profile, "owner", items) }
            override fun create(expected: AccountProfile, role: String): CreatedInvite { require(expected == profile); items = listOf(WorkspaceInvite("invite1", role, 2_000_000_000_000, 0, null, true, null)); return CreatedInvite("invite1", "https://identity.example/join/wi_synthetic_token_for_testing") }
            override fun revoke(expected: AccountProfile, id: String) { require(expected == profile); items = items.map { if (it.id == id) it.copy(active = false) else it } }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { WorkspaceInvitesScreen(profile.baseUrl, workspace, {}, gateway, rt) } }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("invite_create").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("invite_create").performClick()
            compose.onNodeWithTag("invite_role_guest").performClick()
            compose.onNodeWithTag("invite_create_confirm").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("invite_secret").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(app.getString(R.string.invites_link_once)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.close)).performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("invite_invite1").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("invite_secret").assertDoesNotExist()
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-invites.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("invite_revoke_invite1").performClick()
            compose.onNodeWithText(app.getString(R.string.invites_revoke_confirm)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
            assertTrue(gateway.items.single().active)
            compose.onNodeWithTag("invite_revoke_invite1").performClick()
            compose.onNodeWithTag("invite_revoke_confirm").performClick()
            compose.waitUntil(15_000) { !gateway.items.single().active }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("invite_revoke_invite1").fetchSemanticsNodes().isEmpty() }
        } finally { rt.accountChange { } }
    }
    @Test fun adminCannotInviteAdminAndUncertainCreationRequiresRefresh() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val gateway = object : WorkspaceInvitesGateway {
            var attempts = 0
            override fun list(expected: AccountProfile?) = InviteSnapshot(profile, "admin", emptyList())
            override fun create(expected: AccountProfile, role: String): CreatedInvite { attempts++; throw IOException("response lost") }
            override fun revoke(expected: AccountProfile, id: String) { error("unused") }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { WorkspaceInvitesScreen(profile.baseUrl, workspace, {}, gateway, rt) } }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("invite_create").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("invite_create").performClick()
            compose.onNodeWithTag("invite_role_admin").assertDoesNotExist()
            compose.onNodeWithTag("invite_create_confirm").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.invites_uncertain)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("invite_create").assertIsNotEnabled()
            assertEquals(1, gateway.attempts)
            compose.onNodeWithTag("invites_refresh").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.invites_uncertain)).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("invite_create").assertIsEnabled()
        } finally { rt.accountChange { } }
    }
    @Test fun createdLinkSurvivesAListRefreshFailureUntilUserClosesIt() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val gateway = object : WorkspaceInvitesGateway {
            var loads = 0
            override fun list(expected: AccountProfile?): InviteSnapshot { loads++; if (loads == 2) throw IOException("list unavailable"); return InviteSnapshot(profile, "owner", emptyList()) }
            override fun create(expected: AccountProfile, role: String) = CreatedInvite("invite1", "https://identity.example/join/wi_synthetic_token_for_testing")
            override fun revoke(expected: AccountProfile, id: String) { error("unused") }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { WorkspaceInvitesScreen(profile.baseUrl, workspace, {}, gateway, rt) } }
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("invite_create").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("invite_create").performClick()
            compose.onNodeWithTag("invite_create_confirm").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("invite_secret").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("invite_secret").assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.close)).performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.invites_uncertain)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("invite_create").assertIsNotEnabled()
            compose.onNodeWithTag("invites_refresh").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.invites_uncertain)).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithTag("invite_create").assertIsEnabled()
        } finally { rt.accountChange { } }
    }

}
