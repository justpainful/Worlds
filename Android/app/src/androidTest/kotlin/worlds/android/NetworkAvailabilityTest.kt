package worlds.android

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.json.JSONObject
import worlds.identity.EncryptedSessionStore
import worlds.identity.IdentityService
import worlds.identity.IdentityTransport
import java.io.File
import java.io.IOException
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class NetworkAvailabilityTest {
    @Test fun matchesExplicitEmulatorNetworkState() {
        val expected = InstrumentationRegistry.getArguments().getString("networkExpected")
        assumeTrue(expected == "online" || expected == "offline")
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext
        assertEquals(expected == "online", networkAvailable(app))
        val id = UUID.randomUUID().toString()
        val alias = "worlds.test.network.$id"; val file = "network-test-$id"
        val vault = EncryptedSessionStore(app, alias, file)
        val refreshes = AtomicInteger()
        val transport = IdentityTransport { _, _, path, _, _ ->
            val n = if (path == "/auth/refresh") refreshes.incrementAndGet() else 0
            JSONObject().put("userId", "test-user").put("deviceId", "test-device")
                .put("accessToken", "access-$n").put("refreshToken", "refresh-$n")
                .put("accessTokenExpiresAt", if (n == 0) 1_800_000_000_000L else 4_000_000_000_000L)
                .put("refreshTokenExpiresAt", 4_000_000_000_000L)
                .put("user", JSONObject().put("id", "test-user").put("displayName", "Test"))
        }
        try {
            val service = IdentityService("https://identity.example", vault, transport, networkAvailable = { networkAvailable(app) }, now = { 1_800_000_000_001L })
            service.verifyEmail("challenge", "123456", "Emulator")
            if (expected == "offline") {
                assertTrue(runCatching { service.activeSession() }.exceptionOrNull() is IOException)
                assertEquals(0, refreshes.get())
                assertNotNull(service.session())
            } else {
                assertEquals("access-1", service.activeSession().accessToken)
                assertEquals(1, refreshes.get())
            }
        } finally {
            File(app.noBackupFilesDir, file).delete()
            KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
        }
    }
}
