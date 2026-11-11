package worlds.android

import androidx.compose.ui.test.onNodeWithContentDescription
import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import worlds.content.ContentStore
import worlds.identity.EmailChallenge
import worlds.identity.RefreshUncertain
import worlds.identity.IdentityApiException
import worlds.identity.Workspace
import java.io.IOException
import java.util.UUID

class AccountScreenTest {
    @get:Rule val compose = createComposeRule()
    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
    private val db = "account-ui-${UUID.randomUUID()}.db"
    private lateinit var home: HomeModel
    private lateinit var account: AccountModel
    private lateinit var gateway: FakeGateway
    @Before fun setup() { home = HomeModel(app, db); gateway = FakeGateway(); account = AccountModel(app, gateway) }
    @After fun cleanup() { home.close(); app.deleteDatabase(db) }

    @Test fun connectsRefreshesAndSignsOutWithoutChangingLocalPages() {
        ContentStore(app, db).use { it.create("page", "Keep this page") }
        compose.setContent { WorldsTheme { Home(home, account) } }
        compose.waitUntil(20_000) { !home.state.value.loading && account.state.value.stage == AccountStage.SIGN_IN }
        compose.onNodeWithContentDescription(app.getString(R.string.library_more_actions)).performClick()
        compose.onNodeWithText(app.getString(R.string.account_title)).performClick()
        compose.onNodeWithText(app.getString(R.string.account_server)).performTextInput("http://invalid.test")
        compose.onNodeWithText(app.getString(R.string.account_email)).performTextInput("person@example.test")
        compose.onNodeWithText(app.getString(R.string.account_send_code)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.account_invalid_input)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.account_server)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.account_server)).performTextInput("https://identity.example")
        compose.onNodeWithText(app.getString(R.string.account_send_code)).performScrollTo().performClick()
        try { compose.waitUntil(5_000) { account.state.value.stage == AccountStage.CODE } } catch (error: AssertionError) { throw AssertionError("Account state ${account.state.value}, server=${gateway.lastServer}, email=${gateway.lastEmail}", error) }
        compose.onNodeWithText(app.getString(R.string.account_code)).performTextInput("١٢٣٤٥٦")
        compose.onNodeWithText(app.getString(R.string.account_verify)).performScrollTo().performClick()
        compose.waitUntil(20_000) { account.state.value.stage == AccountStage.CONNECTED && account.state.value.workspaceAttempted && !account.state.value.workspaceBusy }
        compose.onNodeWithText("Test person").assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.account_refresh)).performClick()
        compose.waitUntil(20_000) { gateway.refreshed && !account.state.value.busy }
        compose.onNodeWithText(app.getString(R.string.account_logout)).performClick()
        compose.onNodeWithText(app.getString(R.string.account_logout_confirm)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
        check(!gateway.loggedOut)
        compose.onNodeWithText(app.getString(R.string.account_logout)).performClick()
        compose.onNodeWithTag("confirm_account_logout").performClick()
        compose.waitUntil(20_000) { account.state.value.stage == AccountStage.SIGN_IN }
        check(gateway.loggedOut)
        ContentStore(app, db).use { check(it.list().single().title == "Keep this page") }
    }

    @Test fun networkFailureKeepsSignInFormAvailable() {
        gateway.failStart = true
        compose.setContent { WorldsTheme { AccountScreen(account) {} } }
        compose.waitUntil(20_000) { account.state.value.stage == AccountStage.SIGN_IN }
        compose.onNodeWithText(app.getString(R.string.account_server)).performTextInput("https://identity.example")
        compose.onNodeWithText(app.getString(R.string.account_email)).performTextInput("person@example.test")
        compose.onNodeWithText(app.getString(R.string.account_send_code)).performScrollTo().performClick()
        try { compose.waitUntil(5_000) { account.state.value.error == AccountError.NETWORK && !account.state.value.busy } } catch (error: AssertionError) { throw AssertionError("Account state ${account.state.value}, server=${gateway.lastServer}, email=${gateway.lastEmail}", error) }
        compose.onNodeWithText(app.getString(R.string.account_network_error)).performScrollTo().assertIsDisplayed()
        check(account.state.value.stage == AccountStage.SIGN_IN)
    }

    @Test fun uncertainRefreshRequiresSignInAgain() {
        gateway.restoreInfo = AccountInfo("https://identity.example", "Test person", 1_900_000_000_000)
        account = AccountModel(app, gateway)
        compose.setContent { WorldsTheme { AccountScreen(account) {} } }
        compose.waitUntil(20_000) { account.state.value.stage == AccountStage.CONNECTED && account.state.value.workspaceAttempted && !account.state.value.workspaceBusy }
        gateway.failRefresh = true
        compose.onNodeWithText(app.getString(R.string.account_refresh)).performClick()
        compose.waitUntil(20_000) { account.state.value.stage == AccountStage.SIGN_IN && !account.state.value.busy }
        compose.onNodeWithText(app.getString(R.string.account_reauth)).assertIsDisplayed()
    }

    @Test fun revokedAccountReturnsToSignIn() {
        gateway.restoreInfo = AccountInfo("https://identity.example", "Test person", 1_900_000_000_000)
        gateway.revoked = true
        account = AccountModel(app, gateway)
        compose.setContent { WorldsTheme { AccountScreen(account) {} } }
        compose.waitUntil(20_000) { account.state.value.stage == AccountStage.SIGN_IN && account.state.value.error == AccountError.REAUTH }
        compose.onNodeWithText(app.getString(R.string.account_reauth)).performScrollTo().assertIsDisplayed()
    }

    @Test fun unavailableWorkspaceServiceKeepsCachedPagesAccessible() {
        gateway.restoreInfo = AccountInfo("https://identity.example", "Test person", 1_900_000_000_000)
        gateway.failWorkspaces = true
        account = AccountModel(app, gateway)
        compose.setContent { WorldsTheme { AccountScreen(account) {} } }
        compose.waitUntil(20_000) { account.state.value.workspaceAttempted && !account.state.value.workspaceBusy }
        check(account.state.value.stage == AccountStage.CONNECTED)
        check(account.state.value.workspaceError == AccountError.NETWORK)
        compose.onNodeWithTag("open_cached_pages").performScrollTo().assertIsDisplayed()
    }

    @Test fun uncertainWorkspaceCreationRequiresRefreshBeforeAnotherAttempt() {
        gateway.restoreInfo = AccountInfo("https://identity.example", "Test person", 1_900_000_000_000)
        account = AccountModel(app, gateway)
        compose.setContent { WorldsTheme { AccountScreen(account, pagesGatewayOverride = object : WorkspacePagesGateway {
            override fun list(expected: worlds.identity.AccountProfile?) = worlds.identity.WorkspacePages(worlds.identity.AccountProfile("user", "device", "Person", "https://identity.example"), emptyList())
        }) {} } }
        compose.waitUntil(20_000) { account.state.value.workspaces != null && !account.state.value.workspaceBusy }
        compose.onNodeWithText(app.getString(R.string.workspace_empty)).performScrollTo().assertIsDisplayed()
        gateway.loseCreateResponse = true
        compose.onNodeWithText(app.getString(R.string.workspace_create)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.workspace_name)).performTextInput("Team space")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { account.state.value.creationUncertain && !account.state.value.workspaceBusy }
        compose.onNodeWithText(app.getString(R.string.workspace_create_uncertain)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.workspace_create)).performScrollTo().assertIsNotEnabled()
        compose.onNodeWithText(app.getString(R.string.workspace_reload)).performScrollTo().performClick()
        compose.waitUntil(20_000) { !account.state.value.needsReconcile && account.state.value.workspaces?.size == 1 }
        compose.onNodeWithText("Team space").performScrollTo().assertIsDisplayed()
        check(gateway.createdCount == 1)
        if (InstrumentationRegistry.getArguments().getString("worlds_capture") == "1") {
            val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            app.cacheDir.resolve("workspace-qa.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
        }
        compose.onNodeWithTag("open_shared_workspace-1").performScrollTo().performClick()
        compose.onNodeWithTag("pages_manual").performClick()
        compose.onNodeWithTag("shared_server").assertIsDisplayed()
        compose.onNodeWithTag("shared_page_id").assertIsDisplayed()
    }

    private class FakeGateway : AccountGateway {
        var refreshed = false; var loggedOut = false; var failRefresh = false; var failStart = false; var failWorkspaces = false; var loseCreateResponse = false; var revoked = false; var createdCount = 0; val workspaces = mutableListOf<Workspace>(); var lastServer = ""; var lastEmail = ""; var restoreInfo: AccountInfo? = null
        override fun restore() = RestoredAccount(restoreInfo?.server, restoreInfo)
        override fun start(server: String, email: String): EmailChallenge {
            lastServer = server; lastEmail = email
            if (failStart) throw IOException("test")
            check(server == "https://identity.example" && email == "person@example.test")
            return EmailChallenge("challenge", 1_900_000_000_000)
        }
        override fun verify(server: String, challenge: String, code: String): AccountInfo {
            check(challenge == "challenge" && code == "123456")
            return AccountInfo(server, "Test person", 1_900_000_000_000)
        }
        override fun refresh(server: String): AccountInfo {
            if (failRefresh) throw RefreshUncertain(IOException("test"))
            refreshed = true; return AccountInfo(server, "Test person", 1_900_000_000_000)
        }
        override fun logout(server: String) { loggedOut = true }
        override fun listWorkspaces(server: String): List<Workspace> { if (revoked) throw IdentityApiException(401, "invalid_token"); if (failWorkspaces) throw IOException("offline"); return workspaces.toList() }
        override fun createWorkspace(server: String, name: String): Workspace {
            val workspace = Workspace("workspace-${++createdCount}", name, "owner", 1)
            workspaces.add(workspace)
            if (loseCreateResponse) throw IOException("response lost")
            return workspace
        }
    }
}
