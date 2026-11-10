package worlds.identity

import org.json.JSONObject
import java.io.IOException

class ReauthenticationRequired : IOException("Sign in again to continue")
class RefreshUncertain(cause: Throwable) : IOException("Session refresh could not be confirmed; sign in again", cause)

data class EmailChallenge(val id: String, val expiresAt: Long)
data class AccountProfile(val userId: String, val deviceId: String, val displayName: String, val baseUrl: String)
data class Workspace(val id: String, val name: String, val role: String, val memberCount: Int)
data class WorkspaceMember(val userId: String, val name: String, val email: String, val role: String)
data class WorkspaceMembers(val profile: AccountProfile, val members: List<WorkspaceMember>)
data class WorkspacePageAccess(val id: String, val level: String)
data class WorkspacePages(val profile: AccountProfile, val pages: List<WorkspacePageAccess>)
data class WorkspaceGroup(val id: String, val name: String)
data class PermissionEntry(val type: String, val principalId: String, val level: String, val pageId: String, val inherited: Boolean)
data class PagePermissions(val profile: AccountProfile, val pageId: String, val myLevel: String, val inherit: Boolean, val mirrored: Boolean, val entries: List<PermissionEntry>)

data class WorkspaceInvite(val id: String, val role: String, val expiresAt: Long, val uses: Int, val maxUses: Int?, val active: Boolean, val pageId: String?)
class CreatedInvite(val id: String, val url: String) { override fun toString() = "CreatedInvite(id=$id, url=[redacted])" }
class InvitePreview(val profile: AccountProfile, internal val token: String, val valid: Boolean, val reason: String?, val workspaceId: String?, val workspaceName: String?, val role: String?, val expiresAt: Long?, val pageLevel: String?) {
    override fun toString() = "InvitePreview(valid=$valid, workspaceId=$workspaceId, token=[redacted])"
}
data class AcceptedInvite(val workspace: Workspace, val alreadyMember: Boolean, val pageId: String?)



/** Secrets are intentionally excluded from the generated representation. */
class AccessSession internal constructor(val profile: AccountProfile, val accessToken: String, val expiresAt: Long) {
    override fun toString() = "AccessSession(profile=$profile, expiresAt=$expiresAt, accessToken=[redacted])"
}

/** The identity service's email and device-bound session contract. Methods perform blocking I/O. */
class IdentityService(baseUrl: String, private val store: EncryptedSessionStore, private val transport: IdentityTransport = HttpsIdentityTransport(),
    private val networkAvailable: () -> Boolean = { true }, private val now: () -> Long = System::currentTimeMillis) {
    private val base = canonicalBaseUrl(baseUrl)

    fun startEmail(email: String): EmailChallenge {
        require(email.isNotBlank() && email.length <= 320)
        val result = transport.request(base, "POST", "/auth/email/start", JSONObject().put("email", email.trim()), null)
        return EmailChallenge(requiredString(result, "challengeId", 128), result.getLong("expiresAt"))
    }

    fun verifyEmail(challengeId: String, code: String, deviceName: String): AccessSession = synchronized(LOCK) {
        require(challengeId.isNotBlank() && challengeId.length <= 128 && code.matches(Regex("[0-9]{6}")))
        require(deviceName.isNotBlank() && deviceName.length <= 80)
        val key = DeviceKey.generate()
        val device = JSONObject().put("name", deviceName).put("platform", "android").put("publicKey", key.publicKey())
        val result = transport.request(base, "POST", "/auth/email/verify", JSONObject().put("challengeId", challengeId).put("code", code).put("device", device), null)
        val user = result.getJSONObject("user")
        require(requiredString(user, "id", 128) == requiredString(result, "userId", 128))
        val record = recordFromResponse(result, key.export(), false, user.optString("displayName", ""))
        store.write(record)
        view(record)
    }

    /** A quarantined record is never retried: the server may already have rotated its token. */
    fun session(): AccessSession? = synchronized(LOCK) {
        val record = store.read() ?: return@synchronized null
        requireBase(record)
        if (record.optBoolean("refreshInFlight", false)) throw ReauthenticationRequired()
        view(record)
    }

    fun refresh(): AccessSession = synchronized(LOCK) {
        val old = store.read() ?: throw ReauthenticationRequired()
        requireBase(old)
        if (old.optBoolean("refreshInFlight", false)) throw ReauthenticationRequired()
        val deviceId = requiredString(old, "deviceId", 128)
        val userId = requiredString(old, "userId", 128)
        val token = requiredString(old, "refreshToken", 8192)
        val seed = requiredString(old, "deviceKey", 256)
        if (!networkAvailable()) throw IOException("Network unavailable before session refresh")
        val timestamp = now()
        val signature = DeviceKey.load(seed).sign(refreshMessage(deviceId, timestamp, token))
        val pending = JSONObject(old.toString()).put("refreshInFlight", true)
        store.write(pending) // Must reach durable storage before the one-time token is sent.
        try {
            val body = JSONObject().put("refreshToken", token).put("deviceId", deviceId).put("ts", timestamp).put("signature", signature)
            val result = transport.request(base, "POST", "/auth/refresh", body, null)
            val record = recordFromResponse(result, seed, false, old.optString("displayName", ""))
            require(requiredString(record, "userId", 128) == userId && requiredString(record, "deviceId", 128) == deviceId)
            store.write(record)
            view(record)
        } catch (e: Exception) { throw RefreshUncertain(e) }
    }

    /** Refresh before authenticated requests when the saved access token is near expiry. */
    fun activeSession(minValidityMillis: Long = 30_000): AccessSession = synchronized(LOCK) {
        require(minValidityMillis in 0..3_600_000)
        val current = session() ?: throw ReauthenticationRequired()
        if (current.expiresAt <= now() + minValidityMillis) refresh() else current
    }

    fun listWorkspaces(): List<Workspace> = synchronized(LOCK) {
        val session = activeSession()
        val response = transport.requestArray(base, "/workspaces", session.accessToken)
        require(response.length() <= 2000) { "Too many workspaces" }
        (0 until response.length()).map { parseWorkspace(response.getJSONObject(it)) }
    }

    /** The server may commit a creation even if the response is lost; callers must reconcile before retrying. */
    fun createWorkspace(name: String): Workspace = synchronized(LOCK) {
        val clean = name.trim(); require(clean.isNotEmpty() && clean.length <= 80)
        val session = activeSession()
        parseWorkspace(transport.request(base, "POST", "/workspaces", JSONObject().put("name", clean), session.accessToken))
    }

    fun workspaceMembers(workspace: String, expected: AccountProfile? = null): WorkspaceMembers = synchronized(LOCK) {
        val id = pathId(workspace)
        val current = activeSession()
        require(expected == null || sameAccount(current.profile, expected)) { "Account or device changed" }
        val result = transport.requestArray(base, "/workspaces/$id/members", current.accessToken)
        require(result.length() <= 2000)
        val members = (0 until result.length()).map { i ->
            val item = result.getJSONObject(i)
            val user = pathId(requiredString(item, "userId", 128))
            val role = requiredString(item, "role", 16); require(role in setOf("owner", "admin", "member", "guest"))
            val name = item.optString("displayName", ""); val email = item.optString("email", "")
            require(name.length <= 256 && email.length <= 320)
            WorkspaceMember(user, name, email, role)
        }
        require(members.count { it.userId == current.profile.userId } == 1 && members.map { it.userId }.distinct().size == members.size)
        WorkspaceMembers(current.profile, members)
    }

    fun setMemberRole(workspace: String, target: String, role: String, expected: AccountProfile) = synchronized(LOCK) {
        val id = pathId(workspace); val user = pathId(target)
        require(role in setOf("admin", "member", "guest") && user != expected.userId)
        val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val response = transport.request(base, "PATCH", "/workspaces/$id/members/$user", JSONObject().put("role", role), current.accessToken)
        require(response.getString("userId") == user && response.getString("role") == role)
    }

    fun removeMember(workspace: String, target: String, expected: AccountProfile) = synchronized(LOCK) {
        val id = pathId(workspace); val user = pathId(target); require(user != expected.userId)
        val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val response = transport.request(base, "DELETE", "/workspaces/$id/members/$user", null, current.accessToken)
        require(response.optBoolean("ok", false))
    }

    /** The access endpoint returns mirrored page identifiers, not page titles. */
    fun workspacePages(workspace: String, expected: AccountProfile? = null): WorkspacePages = synchronized(LOCK) {
        val id = pathId(workspace); val current = activeSession()
        require(expected == null || sameAccount(current.profile, expected)) { "Account or device changed" }
        val response = transport.request(base, "GET", "/workspaces/$id/access", null, current.accessToken)
        require(response.getString("role") in setOf("owner", "admin", "member", "guest"))
        val docs = response.getJSONArray("docs"); require(docs.length() <= 20_000)
        val entries = (0 until docs.length()).map { i ->
            val entry = docs.getJSONObject(i); val doc = pathId(requiredString(entry, "docId", 128))
            val level = requiredString(entry, "level", 16); require(level in setOf("none", "view", "comment", "edit", "full"))
            WorkspacePageAccess(doc, level)
        }
        require(entries.map { it.id }.distinct().size == entries.size)
        WorkspacePages(current.profile, entries.filter { it.level != "none" }.sortedBy { it.id })
    }

    fun pagePermissions(workspace: String, page: String, expected: AccountProfile? = null): PagePermissions = synchronized(LOCK) {
        val id = pathId(workspace); val doc = pathId(page); val current = activeSession()
        require(expected == null || sameAccount(current.profile, expected)) { "Account or device changed" }
        val result = transport.request(base, "GET", "/workspaces/$id/pages/$doc/permissions", null, current.accessToken)
        require(result.getString("pageId") == doc)
        val level = accessLevel(result.getString("myLevel")); require(level != "none")
        val entries = result.getJSONArray("entries"); require(entries.length() <= 20_000)
        val rows = (0 until entries.length()).map { index ->
            val entry = entries.getJSONObject(index); val type = entry.getString("principalType"); val principal = permissionPrincipal(type, entry.getString("principalId"))
            val source = pathId(entry.getString("pageId")); val inherited = entry.getBoolean("inherited")
            require(inherited == (source != doc))
            PermissionEntry(type, principal, accessLevel(entry.getString("level")), source, inherited)
        }
        require(rows.map { it.type to it.principalId }.distinct().size == rows.size)
        PagePermissions(current.profile, doc, level, result.getBoolean("inherit"), result.getBoolean("mirrored"), rows)
    }

    fun workspaceGroups(workspace: String, expected: AccountProfile): List<WorkspaceGroup> = synchronized(LOCK) {
        val id = pathId(workspace); val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val result = transport.requestArray(base, "/workspaces/$id/groups", current.accessToken); require(result.length() <= 2000)
        val groups = (0 until result.length()).map { i -> val o = result.getJSONObject(i); WorkspaceGroup(pathId(o.getString("id")), requiredString(o, "name", 60)) }
        require(groups.map { it.id }.distinct().size == groups.size); groups
    }

    fun setPagePermission(workspace: String, page: String, type: String, principal: String, level: String, expected: AccountProfile) = synchronized(LOCK) {
        val id = pathId(workspace); val doc = pathId(page); val target = permissionPrincipal(type, principal); accessLevel(level)
        val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val body = JSONObject().put("principalType", type).put("principalId", target).put("level", level)
        require(transport.request(base, "PUT", "/workspaces/$id/pages/$doc/permissions", body, current.accessToken).optBoolean("ok"))
    }
    fun removePagePermission(workspace: String, page: String, type: String, principal: String, expected: AccountProfile) = synchronized(LOCK) {
        val id = pathId(workspace); val doc = pathId(page); val target = permissionPrincipal(type, principal)
        val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        require(transport.request(base, "DELETE", "/workspaces/$id/pages/$doc/permissions/$type/$target", null, current.accessToken).optBoolean("ok"))
    }
    fun setPageInheritance(workspace: String, page: String, inherit: Boolean, expected: AccountProfile) = synchronized(LOCK) {
        val id = pathId(workspace); val doc = pathId(page); val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val result = transport.request(base, "PATCH", "/workspaces/$id/pages/$doc", JSONObject().put("inherit", inherit), current.accessToken)
        require(result.optBoolean("ok") && result.getBoolean("inherit") == inherit)
    }
    private fun permissionPrincipal(type: String, principal: String): String = when (type) {
        "workspace" -> principal.also { require(it == "*") }; "user", "group" -> pathId(principal); else -> throw IllegalArgumentException("Invalid principal")
    }
    private fun accessLevel(level: String) = level.also { require(it in setOf("none", "view", "comment", "edit", "full")) }

    fun listInvites(workspace: String, expected: AccountProfile): List<WorkspaceInvite> = synchronized(LOCK) {
        val id = pathId(workspace); val current = activeSession()
        require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val result = transport.requestArray(base, "/workspaces/$id/invites", current.accessToken)
        require(result.length() <= 100)
        (0 until result.length()).map { i ->
            val item = result.getJSONObject(i); val inviteId = pathId(requiredString(item, "id", 128))
            val role = requiredString(item, "role", 16); require(role in setOf("admin", "member", "guest"))
            val expires = item.getLong("expiresAt"); val uses = item.getInt("uses")
            val maxUses = if (item.isNull("maxUses")) null else item.getInt("maxUses")
            val pageId = if (item.isNull("pageId")) null else pathId(item.getString("pageId"))
            require(expires > 0 && uses >= 0 && (maxUses == null || maxUses in 1..1000))
            WorkspaceInvite(inviteId, role, expires, uses, maxUses, item.getBoolean("active"), pageId)
        }
    }

    /** The secret URL is returned once. A lost response must be reconciled against the list. */
    fun createInvite(workspace: String, role: String, expected: AccountProfile): CreatedInvite = synchronized(LOCK) {
        val id = pathId(workspace); require(role in setOf("admin", "member", "guest"))
        val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val result = transport.request(base, "POST", "/workspaces/$id/invites", JSONObject().put("role", role), current.accessToken)
        require(result.getString("role") == role)
        val inviteId = pathId(requiredString(result, "id", 128)); val token = requiredString(result, "token", 256)
        require(token.matches(Regex("wi_[A-Za-z0-9_-]{20,128}")))
        val url = requiredString(result, "url", 2048); val uri = java.net.URI(url)
        require(uri.scheme.equals("https", true) && !uri.host.isNullOrBlank() && uri.userInfo == null && uri.query == null && uri.fragment == null && uri.rawPath == "/join/$token")
        CreatedInvite(inviteId, url)
    }

    fun revokeInvite(workspace: String, invite: String, expected: AccountProfile) = synchronized(LOCK) {
        val id = pathId(workspace); val target = pathId(invite)
        val current = activeSession(); require(sameAccount(current.profile, expected)) { "Account or device changed" }
        val result = transport.request(base, "DELETE", "/workspaces/$id/invites/$target", null, current.accessToken)
        require(result.optBoolean("ok", false))
    }

    /** Only the extracted token is sent, always to this configured identity server. */
    fun previewInvite(link: String): InvitePreview = synchronized(LOCK) {
        val token = inviteToken(link); val current = activeSession()
        val result = transport.request(base, "GET", "/invites/$token", null, null)
        if (!result.getBoolean("valid")) {
            val reason = result.optString("reason", "invite_not_found")
            require(reason in setOf("invite_not_found", "invite_revoked", "invite_expired", "invite_used_up"))
            InvitePreview(current.profile, token, false, reason, null, null, null, null, null)
        } else {
            val workspace = result.getJSONObject("workspace"); val id = pathId(requiredString(workspace, "id", 128)); val name = requiredString(workspace, "name", 80)
            val role = requiredString(result, "role", 16); require(role in setOf("admin", "member", "guest"))
            val expires = result.getLong("expiresAt"); require(expires > 0)
            val pageLevel = if (result.isNull("pageLevel")) null else result.getString("pageLevel").also { require(it in setOf("view", "comment", "edit", "full")) }
            InvitePreview(current.profile, token, true, null, id, name, role, expires, pageLevel)
        }
    }

    /** A response can be lost after acceptance; callers should reconcile membership before retrying. */
    fun acceptInvite(preview: InvitePreview): AcceptedInvite = synchronized(LOCK) {
        require(preview.valid && preview.workspaceId != null && inviteToken(preview.token) == preview.token)
        val current = activeSession(); require(sameAccount(current.profile, preview.profile)) { "Account or device changed" }
        val result = transport.request(base, "POST", "/invites/${preview.token}/accept", null, current.accessToken)
        val workspace = parseWorkspace(result.getJSONObject("workspace")); require(workspace.id == preview.workspaceId)
        val pageId = if (result.isNull("pageId")) null else pathId(result.getString("pageId"))
        AcceptedInvite(workspace, result.getBoolean("alreadyMember"), pageId)
    }

    private fun inviteToken(link: String): String {
        require(link.length <= 2048)
        val token = link.trim().substringBefore('?').substringBefore('#').trimEnd('/').substringAfterLast('/')
        require(token.matches(Regex("wi_[A-Za-z0-9_-]{8,253}"))) { "Invalid invitation" }
        return token
    }

    private fun pathId(value: String): String { require(value.matches(Regex("[A-Za-z0-9_-]{1,128}"))); return value }
    private fun sameAccount(a: AccountProfile, b: AccountProfile) = a.baseUrl == b.baseUrl && a.userId == b.userId && a.deviceId == b.deviceId

    private fun parseWorkspace(obj: JSONObject): Workspace {
        val id = requiredString(obj, "id", 128); val name = requiredString(obj, "name", 80)
        val role = requiredString(obj, "role", 40); val count = obj.getInt("memberCount")
        require(count >= 0)
        return Workspace(id, name, role, count)
    }

    /** Only clear the local record once the service confirms device revocation. */
    fun logout() = synchronized(LOCK) {
        val record = store.read() ?: return@synchronized
        requireBase(record)
        transport.request(base, "POST", "/auth/logout", JSONObject(), requiredString(record, "accessToken", 8192))
        store.clear()
    }

    private fun requireBase(record: JSONObject) { require(requiredString(record, "baseUrl", 2048) == base) { "Session belongs to another identity server" } }
    private fun recordFromResponse(result: JSONObject, deviceKey: String, inFlight: Boolean, displayName: String): JSONObject {
        val userId = requiredString(result, "userId", 128); val deviceId = requiredString(result, "deviceId", 128)
        val access = requiredString(result, "accessToken", 8192); val refresh = requiredString(result, "refreshToken", 8192)
        val accessExpiry = result.getLong("accessTokenExpiresAt"); val refreshExpiry = result.getLong("refreshTokenExpiresAt")
        require(accessExpiry > 0 && refreshExpiry > 0 && displayName.length <= 256)
        return JSONObject().put("baseUrl", base).put("userId", userId).put("deviceId", deviceId).put("accessToken", access)
            .put("refreshToken", refresh).put("accessTokenExpiresAt", accessExpiry).put("refreshTokenExpiresAt", refreshExpiry)
            .put("deviceKey", deviceKey).put("refreshInFlight", inFlight).put("displayName", displayName)
    }
    private fun view(record: JSONObject): AccessSession {
        val profile = AccountProfile(requiredString(record, "userId", 128), requiredString(record, "deviceId", 128), record.optString("displayName", ""), base)
        return AccessSession(profile, requiredString(record, "accessToken", 8192), record.getLong("accessTokenExpiresAt"))
    }
    companion object {
        private val LOCK = Any()
        private fun requiredString(obj: JSONObject, name: String, max: Int): String {
            val value = obj.getString(name)
            require(value.isNotBlank() && value.length <= max && value.none { it == '\r' || it == '\n' })
            return value
        }
    }
}
