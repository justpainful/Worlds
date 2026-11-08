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
class JoinWorkspaceUiTest {
    @get:Rule val compose = createComposeRule()
    private val profile = AccountProfile("user", "device", "Person", "https://identity.example")
    private val invite = InvitePreview(profile, "wi_synthetic_token_123456789", true, null, "space", "Team", "guest", 2_000_000_000_000L, null)
    private fun runtime() = AccountSyncRuntime(credentials = { SyncCredentials(profile.baseUrl, profile.userId, profile.deviceId, "token") }, makeSession = { _, _, _, _ -> error("unused") })
    @Test fun previewRequiresExplicitJoinAndShowsActualResult() {
        val gateway = object : JoinWorkspaceGateway {
            var accepts = 0
            override fun preview(link: String): InvitePreview { assertTrue(link.contains("wi_")); return invite }
            override fun accept(preview: InvitePreview): AcceptedInvite { accepts++; return AcceptedInvite(Workspace("space", "Team", "guest", 2), false, null) }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { JoinWorkspaceScreen(profile.baseUrl, {}, gateway, rt) } }
            compose.onNodeWithTag("join_link").performTextInput("https://other.example/join/wi_synthetic_token_123456789")
            compose.onNodeWithTag("join_preview").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("join_preview_workspace").fetchSemanticsNodes().isNotEmpty() }
            assertEquals(0, gateway.accepts)
            if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
                Thread.sleep(400)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-join-preview.png")).use { it.readBytes() }
            }
            compose.onNodeWithTag("join_accept").performScrollTo().performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("join_success").fetchSemanticsNodes().isNotEmpty() }
            assertEquals(1, gateway.accepts)
            compose.onNodeWithTag("join_link").assertDoesNotExist()
        } finally { rt.accountChange { } }
    }
    @Test fun ambiguousAcceptanceCannotBeRetriedWithoutReturning() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val gateway = object : JoinWorkspaceGateway {
            var accepts = 0
            override fun preview(link: String) = invite
            override fun accept(preview: InvitePreview): AcceptedInvite { accepts++; throw IOException("response lost") }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { JoinWorkspaceScreen(profile.baseUrl, {}, gateway, rt) } }
            compose.onNodeWithTag("join_link").performTextInput("wi_synthetic_token_123456789")
            compose.onNodeWithTag("join_preview").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("join_accept").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("join_accept").performScrollTo().performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.join_uncertain)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("join_accept").assertIsNotEnabled()
            compose.onNodeWithTag("join_link").assertIsNotEnabled()
            assertEquals(1, gateway.accepts)
        } finally { rt.accountChange { } }
    }
    @Test fun definitiveRevocationShowsItsReasonAndAllowsCheckingAgain() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        val gateway = object : JoinWorkspaceGateway {
            override fun preview(link: String) = invite
            override fun accept(preview: InvitePreview): AcceptedInvite { throw IdentityApiException(410, "invite_revoked") }
        }
        val rt = runtime()
        try {
            compose.setContent { WorldsTheme { JoinWorkspaceScreen(profile.baseUrl, {}, gateway, rt) } }
            compose.onNodeWithTag("join_link").performTextInput("wi_synthetic_token_123456789")
            compose.onNodeWithTag("join_preview").performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithTag("join_accept").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("join_accept").performScrollTo().performClick()
            compose.waitUntil(15_000) { compose.onAllNodesWithText(app.getString(R.string.join_revoked)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithTag("join_preview").assertIsEnabled()
            compose.onNodeWithTag("join_link").assertIsEnabled()
        } finally { rt.accountChange { } }
    }

}
