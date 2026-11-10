package worlds.identity

import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class IdentityTransportPatchTest {
    @Test fun patchUsesTlsAndDoesNotFollowRedirects() {
        val cert = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
        val serverTls = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTls = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        val client = OkHttpClient.Builder().sslSocketFactory(clientTls.sslSocketFactory(), clientTls.trustManager)
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
        val server = MockWebServer()
        server.useHttps(serverTls.sslSocketFactory(), false); server.start()
        try {
            val transport = HttpsIdentityTransport(client)
            val base = server.url("/").toString()
            server.enqueue(MockResponse().setBody("""{"userId":"target","role":"member"}"""))
            val result = transport.request(base, "PATCH", "/workspaces/space/members/target", JSONObject().put("role", "member"), "synthetic-token")
            assertEquals("member", result.getString("role"))
            val request = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("PATCH", request.method); assertEquals("/workspaces/space/members/target", request.path)
            assertEquals("Bearer synthetic-token", request.getHeader("Authorization"))
            assertEquals("member", JSONObject(request.body.readUtf8()).getString("role"))
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "/redirected").setBody("{}"))
            val failure = runCatching { transport.request(base, "PATCH", "/workspaces/space/members/target", JSONObject().put("role", "guest"), "synthetic-token") }.exceptionOrNull()
            assertEquals(302, (failure as IdentityApiException).status)
            server.takeRequest(5, TimeUnit.SECONDS)
            assertNull(server.takeRequest(1, TimeUnit.SECONDS))
        } finally { server.shutdown() }
    }
}
