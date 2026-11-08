package worlds.identity

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.json.JSONObject
import org.json.JSONArray
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.Executors

@RunWith(AndroidJUnit4::class)
class IdentityServiceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val id = UUID.randomUUID().toString()
    private val alias = "worlds.test.$id"
    private val file = "identity-test-$id"
    private lateinit var vault: EncryptedSessionStore
    private lateinit var server: FakeServer
    private lateinit var service: IdentityService
    @Before fun setup() { vault = EncryptedSessionStore(context, alias, file); server = FakeServer(); service = IdentityService("https://identity.example", vault, server) { 1_700_000_000_000 } }
    @After fun cleanup() { vault.clear(); KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) } }

    @Test fun emailSignInEncryptedPersistenceSignedRefreshAndLogout() {
        val challenge = service.startEmail("person@example.test")
        val first = service.verifyEmail(challenge.id, "123456", "Test device")
        assertEquals("user-1", first.profile.userId)
        val bytes = File(context.noBackupFilesDir, file).readText()
        assertFalse(bytes.contains("refresh-1")); assertFalse(bytes.contains("access-1")); assertFalse(bytes.contains(server.publicKey))
        assertFalse(first.toString().contains("access-1"))
        val reopened = IdentityService("https://identity.example/", EncryptedSessionStore(context, alias, file), server) { 1_700_000_000_000 }
        assertEquals("access-1", reopened.session()!!.accessToken)
        val next = reopened.refresh(); assertEquals("access-2", next.accessToken); assertEquals(1, server.refreshes)
        reopened.logout(); assertNull(reopened.session()); assertTrue(server.loggedOut)
    }

    @Test fun uncertainRotationIsNeverRetriedEvenAfterRestart() {
        service.verifyEmail("challenge", "123456", "Test device")
        server.loseResponse = true
        assertTrue(runCatching { service.refresh() }.exceptionOrNull() is RefreshUncertain)
        assertEquals(1, server.refreshes)
        val reopened = IdentityService("https://identity.example", EncryptedSessionStore(context, alias, file), server)
        assertTrue(runCatching { reopened.refresh() }.exceptionOrNull() is ReauthenticationRequired)
        assertTrue(runCatching { reopened.session() }.exceptionOrNull() is ReauthenticationRequired)
        assertEquals(1, server.refreshes)
    }

    @Test fun concurrentRefreshesRotateSequentiallyAndWrongServerCannotUseSession() {
        service.verifyEmail("challenge", "123456", "Test device")
        val pool = Executors.newFixedThreadPool(2)
        try {
            val a = pool.submit<AccessSession> { service.refresh() }
            val b = pool.submit<AccessSession> { IdentityService("https://identity.example", EncryptedSessionStore(context, alias, file), server).refresh() }
            assertEquals(setOf("access-2", "access-3"), setOf(a.get().accessToken, b.get().accessToken))
            assertEquals(2, server.refreshes)
            assertTrue(runCatching { IdentityService("https://other.example", vault, server).session() }.isFailure)
        } finally { pool.shutdownNow() }
    }

    @Test fun requiresHttpsAndRejectsUnsafeServerAddresses() {
        assertEquals("https://example.com:443", canonicalBaseUrl("https://EXAMPLE.com:443/"))
        for (value in listOf("http://example.com", "https://a.example/path", "https://user:pass@example.com", "https://example.com/?q=x"))
            assertTrue(runCatching { canonicalBaseUrl(value) }.isFailure)
    }

    @Test fun listsAndCreatesWorkspacesUsingFreshAuthenticatedSession() {
        service.verifyEmail("challenge", "123456", "Test device")
        val expired = IdentityService("https://identity.example", vault, server) { 1_800_000_000_001 }
        assertTrue(expired.listWorkspaces().isEmpty())
        assertEquals(1, server.refreshes)
        val created = expired.createWorkspace("  Study  ")
        assertEquals("Study", created.name)
        assertEquals("owner", created.role)
        assertEquals(listOf(created), expired.listWorkspaces())
    }

    @Test fun activeSessionCanRefreshAheadOfSocketExpiry() {
        service.verifyEmail("challenge", "123456", "Test device")
        val approaching = IdentityService("https://identity.example", vault, server) { 1_800_000_000_000L - 45_000 }
        assertEquals("access-1", approaching.activeSession(30_000).accessToken)
        assertEquals(0, server.refreshes)
        assertEquals("access-2", approaching.activeSession(60_000).accessToken)
        assertEquals(1, server.refreshes)
    }

    @Test fun knownOfflineStateDoesNotQuarantineOrSendRefreshToken() {
        service.verifyEmail("challenge", "123456", "Test device")
        var online = false
        val expired = IdentityService("https://identity.example", vault, server, networkAvailable = { online }) { 1_800_000_000_001L }
        assertTrue(runCatching { expired.activeSession() }.exceptionOrNull() is IOException)
        assertEquals(0, server.refreshes)
        assertEquals("access-1", expired.session()!!.accessToken)
        val reopened = IdentityService("https://identity.example", EncryptedSessionStore(context, alias, file), server, networkAvailable = { online }) { 1_800_000_000_001L }
        assertEquals("user-1", reopened.session()!!.profile.userId)
        online = true
        assertEquals("access-2", reopened.refresh().accessToken)
        assertEquals(1, server.refreshes)
    }

    @Test fun localIdentityWorkerContract() {
        val args = InstrumentationRegistry.getArguments()
        val challenge = args.getString("worlds_challenge")
        val code = args.getString("worlds_code")
        assumeTrue(!challenge.isNullOrBlank() && !code.isNullOrBlank())
        // This test-only transport reaches a local development Worker via adb reverse.
        // Production transport accepts HTTPS only.
        val local = object : IdentityTransport {
            override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject =
                exchange(method, path, body, bearer) as JSONObject
            override fun requestArray(baseUrl: String, path: String, bearer: String): JSONArray =
                exchange("GET", path, null, bearer) as JSONArray
            private fun exchange(method: String, path: String, body: JSONObject?, bearer: String?): Any {
            val connection = URL("http://127.0.0.1:18787$path").openConnection() as HttpURLConnection
            return try {
                connection.requestMethod = method
                connection.connectTimeout = 10_000; connection.readTimeout = 10_000
                if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
                if (body != null) {
                    connection.doOutput = true; connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val result = stream?.bufferedReader()?.use { org.json.JSONTokener(it.readText()).nextValue() } ?: JSONObject()
                if (status !in 200..299) throw IdentityApiException(status, (result as? JSONObject)?.optString("error", "http_error") ?: "http_error")
                result
            } finally { connection.disconnect() }
            }
        }
        val client = IdentityService("https://identity.example", vault, local)
        val signedIn = client.verifyEmail(challenge!!, code!!, "Android emulator")
        assertEquals(signedIn.profile.userId, local.request("", "GET", "/me", null, signedIn.accessToken).getString("id"))
        val renewed = client.refresh()
        assertEquals(signedIn.profile.userId, renewed.profile.userId)
        assertTrue(client.listWorkspaces().isEmpty())
        val created = client.createWorkspace("Local test workspace")
        assertEquals("owner", created.role)
        assertEquals(listOf(created), client.listWorkspaces())
        client.logout()
        assertNull(client.session())
        assertEquals(401, (runCatching { local.request("", "GET", "/me", null, renewed.accessToken) }.exceptionOrNull() as IdentityApiException).status)
    }

    @Test fun membersAreBoundToAccountAndMutationsUseTheContract() {
        val fake = FakeServer()
        var members = JSONArray().put(JSONObject().put("userId", "user-1").put("role", "owner").put("displayName", "Owner").put("email", "owner@example.test"))
            .put(JSONObject().put("userId", "user-2").put("role", "guest").put("displayName", "Sara").put("email", "sara@example.test"))
        val transport = object : IdentityTransport {
            override fun requestArray(baseUrl: String, path: String, bearer: String): JSONArray {
                assertEquals("/workspaces/space/members", path); assertEquals("access-1", bearer); return JSONArray(members.toString())
            }
            override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject {
                if (path.startsWith("/auth/")) return fake.request(baseUrl, method, path, body, bearer)
                assertEquals("/workspaces/space/members/user-2", path); assertEquals("access-1", bearer)
                return when (method) {
                    "PATCH" -> { val role = body!!.getString("role"); members.getJSONObject(1).put("role", role); JSONObject().put("userId", "user-2").put("role", role) }
                    "DELETE" -> { members = JSONArray().put(members.getJSONObject(0)); JSONObject().put("ok", true) }
                    else -> error("Unexpected method")
                }
            }
        }
        val client = IdentityService("https://identity.example", vault, transport) { 1_700_000_000_000 }
        val profile = client.verifyEmail("challenge", "123456", "Test").profile
        assertEquals("guest", client.workspaceMembers("space").members[1].role)
        client.setMemberRole("space", "user-2", "member", profile)
        assertEquals("member", client.workspaceMembers("space", profile).members[1].role)
        assertTrue(runCatching { client.setMemberRole("space", "user-2", "admin", profile.copy(deviceId = "other")) }.isFailure)
        assertTrue(runCatching { client.removeMember("space/other", "user-2", profile) }.isFailure)
        client.removeMember("space", "user-2", profile)
        assertEquals(1, client.workspaceMembers("space", profile).members.size)
    }

    @Test fun inviteCreationListsAndRevocationStayBoundToAccount() {
        val fake = FakeServer(); val token = "wi_abcdefghijklmnopqrstuvwxyz123456"
        var active = false
        val transport = object : IdentityTransport {
            override fun requestArray(baseUrl: String, path: String, bearer: String): JSONArray {
                assertEquals("/workspaces/space/invites", path); assertEquals("access-1", bearer)
                return if (!active) JSONArray() else JSONArray().put(JSONObject().put("id", "inv1").put("role", "guest").put("expiresAt", 1_800_000_000_000L).put("uses", 0).put("maxUses", JSONObject.NULL).put("pageId", JSONObject.NULL).put("active", true))
            }
            override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject {
                if (path.startsWith("/auth/")) return fake.request(baseUrl, method, path, body, bearer)
                assertEquals("access-1", bearer)
                return when (method) {
                    "POST" -> { assertEquals("/workspaces/space/invites", path); assertEquals("guest", body!!.getString("role")); active = true; JSONObject().put("id", "inv1").put("token", token).put("url", "https://identity.example/join/$token").put("role", "guest") }
                    "DELETE" -> { assertEquals("/workspaces/space/invites/inv1", path); active = false; JSONObject().put("ok", true) }
                    else -> error("Unexpected method")
                }
            }
        }
        val client = IdentityService("https://identity.example", vault, transport) { 1_700_000_000_000 }
        val profile = client.verifyEmail("challenge", "123456", "Test").profile
        val link = client.createInvite("space", "guest", profile)
        assertTrue(link.url.endsWith(token)); assertFalse(link.toString().contains(token))
        assertEquals("guest", client.listInvites("space", profile).single().role)
        assertTrue(runCatching { client.revokeInvite("space", "inv1", profile.copy(deviceId = "other")) }.isFailure)
        client.revokeInvite("space", "inv1", profile)
        assertTrue(client.listInvites("space", profile).isEmpty())
    }

    @Test fun previewAndAcceptUseConfiguredServerAndAccount() {
        val fake = FakeServer(); val token = "wi_abcdefghijklmnopqrstuvwxyz123456"; var accepts = 0
        val transport = object : IdentityTransport {
            override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject {
                assertEquals("https://identity.example", baseUrl)
                if (path.startsWith("/auth/")) return fake.request(baseUrl, method, path, body, bearer)
                return when (method) {
                    "GET" -> { assertEquals("/invites/$token", path); assertNull(bearer); JSONObject().put("valid", true).put("workspace", JSONObject().put("id", "space").put("name", "Team")).put("role", "guest").put("expiresAt", 1_800_000_000_000L).put("pageLevel", JSONObject.NULL) }
                    "POST" -> { assertEquals("/invites/$token/accept", path); assertEquals("access-1", bearer); accepts++; JSONObject().put("workspace", JSONObject().put("id", "space").put("name", "Team").put("role", "guest").put("memberCount", 2)).put("alreadyMember", false).put("pageId", JSONObject.NULL) }
                    else -> error("Unexpected method")
                }
            }
        }
        val client = IdentityService("https://identity.example", vault, transport) { 1_700_000_000_000 }
        val profile = client.verifyEmail("challenge", "123456", "Test").profile
        val preview = client.previewInvite("https://elsewhere.example/join/$token?source=test")
        assertFalse(preview.toString().contains(token)); assertEquals("Team", preview.workspaceName)
        val forged = InvitePreview(profile.copy(deviceId = "other"), token, true, null, "space", "Team", "guest", 1_800_000_000_000L, null)
        assertTrue(runCatching { client.acceptInvite(forged) }.isFailure); assertEquals(0, accepts)
        assertEquals("space", client.acceptInvite(preview).workspace.id); assertEquals(1, accepts)
        assertTrue(runCatching { client.previewInvite("https://elsewhere.example/join/../../bad") }.isFailure)
    }

    @Test fun pageAccessOmitsForbiddenEntriesAndBindsAccount() {
        val fake = FakeServer()
        val transport = object : IdentityTransport {
            override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject {
                if (path.startsWith("/auth/")) return fake.request(baseUrl, method, path, body, bearer)
                assertEquals("GET", method); assertEquals("/workspaces/space/access", path); assertEquals("access-1", bearer)
                return JSONObject().put("role", "member").put("defaultLevel", "edit").put("docs", JSONArray()
                    .put(JSONObject().put("docId", "visible").put("level", "view"))
                    .put(JSONObject().put("docId", "hidden").put("level", "none"))
                    .put(JSONObject().put("docId", "editable").put("level", "edit")))
            }
        }
        val client = IdentityService("https://identity.example", vault, transport) { 1_700_000_000_000 }
        val profile = client.verifyEmail("challenge", "123456", "Test").profile
        val pages = client.workspacePages("space", profile).pages
        assertEquals(listOf("editable", "visible"), pages.map { it.id })
        assertTrue(pages.none { it.id == "hidden" })
        assertTrue(runCatching { client.workspacePages("space", profile.copy(deviceId = "other")) }.isFailure)
        assertTrue(runCatching { client.workspacePages("space/other", profile) }.isFailure)
    }

    @Test fun pagePermissionsPreserveInheritanceAndUseBoundMutations() {
        val fake = FakeServer(); val calls = mutableListOf<String>()
        val transport = object : IdentityTransport {
            override fun requestArray(baseUrl: String, path: String, bearer: String): JSONArray {
                assertEquals("/workspaces/space/groups", path); return JSONArray().put(JSONObject().put("id", "group1").put("name", "Design"))
            }
            override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject {
                if (path.startsWith("/auth/")) return fake.request(baseUrl, method, path, body, bearer)
                assertEquals("access-1", bearer); calls.add("$method $path")
                return when (method) {
                    "GET" -> JSONObject().put("pageId", "page").put("myLevel", "full").put("inherit", true).put("mirrored", true).put("entries", JSONArray().put(JSONObject().put("principalType", "user").put("principalId", "user-2").put("level", "view").put("pageId", "parent").put("inherited", true)))
                    "PUT" -> { assertEquals("*", body!!.getString("principalId")); JSONObject().put("ok", true) }
                    "DELETE" -> JSONObject().put("ok", true)
                    "PATCH" -> JSONObject().put("ok", true).put("inherit", body!!.getBoolean("inherit"))
                    else -> error("Unexpected method")
                }
            }
        }
        val client = IdentityService("https://identity.example", vault, transport) { 1_700_000_000_000 }
        val profile = client.verifyEmail("challenge", "123456", "Test").profile
        val permission = client.pagePermissions("space", "page", profile)
        assertTrue(permission.entries.single().inherited); assertEquals("parent", permission.entries.single().pageId)
        assertEquals("Design", client.workspaceGroups("space", profile).single().name)
        client.setPagePermission("space", "page", "workspace", "*", "view", profile)
        client.removePagePermission("space", "page", "workspace", "*", profile)
        client.setPageInheritance("space", "page", false, profile)
        val before = calls.size
        assertTrue(runCatching { client.setPageInheritance("space", "page", true, profile.copy(deviceId = "other")) }.isFailure)
        assertEquals(before, calls.size)
        assertTrue(runCatching { client.setPagePermission("space", "page", "workspace", "invalid", "view", profile) }.isFailure)
    }

    private class FakeServer : IdentityTransport {
        var publicKey = ""; var refreshes = 0; var loseResponse = false; var loggedOut = false
        private var token = "refresh-1"
        private val workspaces = JSONArray()
        override fun requestArray(baseUrl: String, path: String, bearer: String): JSONArray {
            assertEquals("/workspaces", path); assertEquals("access-${refreshes + 1}", bearer)
            return JSONArray(workspaces.toString())
        }
        override fun request(baseUrl: String, method: String, path: String, body: JSONObject?, bearer: String?): JSONObject {
            return when (path) {
                "/auth/email/start" -> JSONObject().put("challengeId", "challenge").put("expiresAt", 1_800_000_000_000L)
                "/auth/email/verify" -> {
                    assertEquals("123456", body!!.getString("code")); publicKey = body.getJSONObject("device").getString("publicKey")
                    tokens(1).put("user", JSONObject().put("id", "user-1").put("displayName", "Person"))
                }
                "/auth/refresh" -> {
                    val payload = body!!; assertEquals(token, payload.getString("refreshToken")); assertEquals("device-1", payload.getString("deviceId"))
                    val message = refreshMessage("device-1", payload.getLong("ts"), token).toByteArray(Charsets.UTF_8)
                    val verifier = Ed25519Signer(); verifier.init(false, Ed25519PublicKeyParameters(unb64(publicKey), 0)); verifier.update(message, 0, message.size)
                    assertTrue(verifier.verifySignature(unb64(payload.getString("signature"))))
                    refreshes++; token = "refresh-${refreshes + 1}"
                    if (loseResponse) throw IOException("response lost")
                    tokens(refreshes + 1)
                }
                "/auth/logout" -> { assertEquals("access-${refreshes + 1}", bearer); loggedOut = true; JSONObject().put("ok", true) }
                "/workspaces" -> {
                    assertEquals("access-${refreshes + 1}", bearer)
                    JSONObject().put("id", "workspace-1").put("name", body!!.getString("name")).put("role", "owner").put("memberCount", 1).also { workspaces.put(it) }
                }
                else -> error("Unexpected route")
            }
        }
        private fun tokens(n: Int) = JSONObject().put("userId", "user-1").put("deviceId", "device-1").put("accessToken", "access-$n")
            .put("refreshToken", "refresh-$n").put("accessTokenExpiresAt", 1_800_000_000_000L).put("refreshTokenExpiresAt", 1_900_000_000_000L)
    }
}
