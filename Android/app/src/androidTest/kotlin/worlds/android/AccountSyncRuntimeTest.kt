package worlds.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import worlds.sync.AndroidSyncStore
import worlds.sync.SyncSession
import worlds.sync.SyncSocket
import worlds.sync.SyncTransport
import worlds.sync.SyncWire
import worlds.sync.SyncDocumentKey
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class AccountSyncRuntimeTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private val name = "account-sync-${UUID.randomUUID()}.db"
    private lateinit var store: AndroidSyncStore
    private val transportClosed = AtomicBoolean(false)
    private val started = CountDownLatch(1)
    private val listener = object : SyncSession.Listener {
        override fun onState(channel: Int, snapshot: ByteArray) { }
        override fun onAccess(level: String) { }
        override fun onAttention(channel: Int, archiveId: String, reason: String) { fail("unexpected rejection") }
        override fun onClosed(code: Int?) { }
        override fun onError() { fail("unexpected session failure") }
    }
    @Before fun setup() { store = AndroidSyncStore(context, name) }
    @After fun cleanup() { store.close(); context.deleteDatabase(name) }

    @Test fun accountChangeClosesOldSocketAndBlocksNewOpensUntilFinished() {
        var signedIn = true
        val runtime = AccountSyncRuntime(
            credentials = { authority -> check(signedIn); SyncCredentials(authority, "user", "device", "secret") },
            makeSession = { key, _, _, callback ->
                SyncSession(store, key, { _: SyncSocket.Listener -> object : SyncTransport {
                    override fun start() { started.countDown() }
                    override fun send(frame: SyncWire.Frame) = true
                    override fun close() { transportClosed.set(true) }
                } }, callback)
            },
        )
        runtime.open("https://identity.example", "https://sync.example", "space", "page", listener)
        assertTrue(started.await(5, TimeUnit.SECONDS))
        try { runtime.open("https://identity.example", "https://other-sync.example", "space", "page", listener); fail("duplicate page session accepted") }
        catch (_: IllegalStateException) { }
        runtime.accountChange {
            assertTrue(transportClosed.get())
            try { runtime.open("https://identity.example", "https://sync.example", "space", "page2", listener); fail("opened during account change") }
            catch (_: IllegalStateException) { }
            signedIn = false
        }
        try { runtime.open("https://identity.example", "https://sync.example", "space", "page3", listener); fail("opened after sign out") }
        catch (_: IllegalStateException) { }
    }

    @Test fun rejectsCredentialsFromAnotherIdentityServer() {
        val runtime = AccountSyncRuntime(
            credentials = { SyncCredentials("https://other.example", "user", "device", "secret") },
            makeSession = { _, _, _, _ -> error("must not create a socket") },
        )
        try { runtime.open("https://identity.example", "https://sync.example", "space", "page", listener); fail("wrong authority accepted") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun neverOpensSocketForAnotherEndpointOrUnknownLegacyOrigin() {
        val key = SyncDocumentKey("user", "space", "page", 0, "https://identity.example")
        store.bindEndpoint(key, "https://sync-one.example")
        store.append(key, byteArrayOf(1), local = true)
        val runtime = AccountSyncRuntime(
            credentials = { SyncCredentials(it, "user", "device", "secret") },
            makeSession = { _, _, _, _ -> error("must not create a socket") },
            bindEndpoint = { document, endpoint -> store.bindEndpoint(document, endpoint) },
        )
        try { runtime.open("https://identity.example", "https://sync-two.example", "space", "page", listener); fail("different endpoint accepted") }
        catch (_: AndroidSyncStore.EndpointConflict) { }
        val legacy = key.copy(page = "legacy")
        store.append(legacy, byteArrayOf(2), local = true)
        try { runtime.open("https://identity.example", "https://sync-one.example", "space", "legacy", listener); fail("unknown legacy origin accepted") }
        catch (_: AndroidSyncStore.UnboundReplica) { }
        assertEquals(1, store.pending(key).size); assertEquals(1, store.pending(legacy).size)
    }

    @Test fun canceledOfflineSaveDoesNotWriteAfterAccountChange() {
        var called = false
        val runtime = AccountSyncRuntime(
            credentials = { SyncCredentials(it, "user", "device", "secret") },
            makeSession = { _, _, _, _ -> error("unused") },
            offlineEdit = { _, _, _, _, _, _, _ -> called = true; byteArrayOf() },
        )
        val principal = SyncPrincipal("https://identity.example", "user", "device")
        try { runtime.editOffline(principal, "space", "page", byteArrayOf(), "block", 0, 0, "text", "draft") { false }; fail("canceled save accepted") }
        catch (_: IllegalStateException) { }
        assertFalse(called)
    }
}
