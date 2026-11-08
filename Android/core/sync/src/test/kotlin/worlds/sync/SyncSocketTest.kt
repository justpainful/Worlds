package worlds.sync

import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class SyncSocketTest {
    private class Events : SyncSocket.Listener {
        val events = LinkedBlockingQueue<Any>()
        override fun onAuthenticated(level: String) { events.add(level) }
        override fun onFrame(frame: SyncWire.Frame) { events.add(frame) }
        override fun onClosed(code: Int) { events.add(code) }
        override fun onFailure() { events.add("failure") }
        fun next(): Any = requireNotNull(events.poll(5, TimeUnit.SECONDS))
    }

    @Test fun authenticatesAndPassesRealBinaryFramesWithoutTreatingSendAsAck() {
        MockWebServer().use { server ->
            val received = LinkedBlockingQueue<SyncWire.Frame>()
            server.enqueue(MockResponse().addHeader("Sec-WebSocket-Protocol", SyncWire.PROTOCOL).withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(SyncWire.encode(SyncWire.Frame.AuthState("edit", "user")).toByteString())
                    webSocket.send(SyncWire.encode(SyncWire.Frame.Sync(0, 0, byteArrayOf(0))).toByteString())
                }
                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    val frame = SyncWire.decode(bytes.toByteArray())
                    received.add(frame)
                    if (frame is SyncWire.Frame.Update) webSocket.send(SyncWire.encode(SyncWire.Frame.Ack(frame.batchId, 0, "")).toByteString())
                }
            }))
            val events = Events()
            val socket = SyncSocket(server.url("/").newBuilder().host("127.0.0.1").build().toString(), "space", "page", "user", "secret", events, allowInsecureLoopback = true)
            assertFalse(socket.send(SyncWire.Frame.QueryAwareness))
            socket.start()
            assertEquals("edit", events.next())
            assertTrue(events.next() is SyncWire.Frame.Sync)
            assertTrue(socket.send(SyncWire.Frame.Update(12, 0, byteArrayOf(1, 2))))
            assertEquals(12L, (received.poll(5, TimeUnit.SECONDS) as SyncWire.Frame.Update).batchId)
            assertEquals(12L, (events.next() as SyncWire.Frame.Ack).batchId)
            val request = server.takeRequest(5, TimeUnit.SECONDS)!!
            assertEquals("/v1/workspaces/space/docs/page/sync", request.path)
            assertEquals("Bearer secret", request.getHeader("Authorization"))
            socket.close()
        }
    }

    @Test fun rejectsWrongIdentityBeforeDeliveringDocument() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().addHeader("Sec-WebSocket-Protocol", SyncWire.PROTOCOL).withWebSocketUpgrade(object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send(SyncWire.encode(SyncWire.Frame.AuthState("full", "other")).toByteString())
                }
            }))
            val events = Events()
            val socket = SyncSocket(server.url("/").newBuilder().host("127.0.0.1").build().toString(), "space", "page", "user", "secret", events, allowInsecureLoopback = true)
            socket.start()
            assertEquals("failure", events.next())
            assertFalse(socket.send(SyncWire.Frame.QueryAwareness))
        }
    }

    @Test fun rejectsInsecureAndCredentialBearingUrls() {
        for (url in listOf("http://example.com/", "https://user:pass@example.com/", "https://example.com/?token=x")) {
            try { SyncSocket(url, "s", "p", "u", "secret", Events()); fail(url) } catch (_: IllegalArgumentException) { }
        }
    }

    @Test fun forbiddenUpgradeIsReportedAsRevocation() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(403).addHeader("Content-Type", "application/json").setBody("{\"error\":\"no access to this document\"}"))
            val events = Events()
            val socket = SyncSocket(server.url("/").newBuilder().host("127.0.0.1").build().toString(), "space", "page", "user", "secret", events, allowInsecureLoopback = true)
            socket.start()
            assertEquals(4403, events.next())
            assertFalse(socket.send(SyncWire.Frame.QueryAwareness))
        }
    }

    @Test fun unrelatedForbiddenResponseDoesNotPurgeReplica() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(403).setBody("proxy denied"))
            val events = Events()
            val socket = SyncSocket(server.url("/").newBuilder().host("127.0.0.1").build().toString(), "space", "page", "user", "secret", events, allowInsecureLoopback = true)
            socket.start()
            assertEquals("failure", events.next())
        }
    }

    @Test fun unauthorizedUpgradeRequestsTokenRecovery() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401))
            val events = Events()
            val socket = SyncSocket(server.url("/").newBuilder().host("127.0.0.1").build().toString(), "space", "page", "user", "secret", events, allowInsecureLoopback = true)
            socket.start()
            assertEquals(4401, events.next())
        }
    }
}
