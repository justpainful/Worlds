package worlds.sync

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** One authenticated document connection. The owner supplies persistence and a Yjs engine. */
interface SyncTransport {
    fun start()
    fun send(frame: SyncWire.Frame): Boolean
    fun close()
}

class SyncSocket(
    baseUrl: String,
    workspace: String,
    page: String,
    private val expectedUser: String,
    token: String,
    private val listener: Listener,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false).build(),
    internal val allowInsecureLoopback: Boolean = false,
) : SyncTransport {
    interface Listener {
        fun onAuthenticated(level: String)
        fun onFrame(frame: SyncWire.Frame)
        fun onClosed(code: Int)
        fun onFailure()
    }

    private val lock = Any()
    private var socket: WebSocket? = null
    private var started = false
    private var terminated = false
    private var authenticated = false
    private val request: Request

    init {
        require(workspace.isNotBlank() && page.isNotBlank() && expectedUser.isNotBlank())
        require(token.isNotBlank() && token.none { it == '\r' || it == '\n' })
        val base = baseUrl.toHttpUrl()
        require(base.username.isEmpty() && base.password.isEmpty() && base.query == null && base.fragment == null)
        require(base.isHttps || (allowInsecureLoopback && base.scheme == "http" && base.host in setOf("127.0.0.1", "::1", "localhost", "10.0.2.2")))
        val url = base.newBuilder().addPathSegment("v1").addPathSegment("workspaces")
            .addPathSegment(workspace).addPathSegment("docs").addPathSegment(page).addPathSegment("sync").build()
        request = Request.Builder().url(url).header("Authorization", "Bearer $token")
            .header("Sec-WebSocket-Protocol", SyncWire.PROTOCOL).build()
    }

    override fun start() = synchronized(lock) {
        check(!started && !terminated)
        started = true
        socket = client.newBuilder().followRedirects(false).followSslRedirects(false).build().newWebSocket(request, callbacks)
    }

    /** Never treats a successful send as a server acknowledgement. */
    override fun send(frame: SyncWire.Frame): Boolean = synchronized(lock) {
        if (terminated || !authenticated) return false
        require(frame is SyncWire.Frame.Sync || frame is SyncWire.Frame.Awareness ||
            frame is SyncWire.Frame.QueryAwareness || frame is SyncWire.Frame.Update || frame is SyncWire.Frame.AuthRefresh)
        socket?.send(SyncWire.encode(frame).toByteString()) ?: false
    }

    override fun close() = synchronized(lock) {
        if (!terminated) {
            terminated = true
            authenticated = false
            socket?.close(1000, "")
        }
    }

    private val callbacks = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (response.header("Sec-WebSocket-Protocol") != SyncWire.PROTOCOL) fail(webSocket)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            val frame = try { SyncWire.decode(bytes.toByteArray()) } catch (_: IllegalArgumentException) { fail(webSocket); return }
            synchronized(lock) {
                if (terminated) return
                if (frame is SyncWire.Frame.AuthState) {
                    if (frame.userId != expectedUser || frame.level !in setOf("full", "edit", "comment", "view")) {
                        fail(webSocket); return
                    }
                    authenticated = true
                    listener.onAuthenticated(frame.level)
                } else {
                    if (!authenticated || frame is SyncWire.Frame.Update || frame is SyncWire.Frame.QueryAwareness || frame is SyncWire.Frame.AuthRefresh) {
                        fail(webSocket); return
                    }
                    listener.onFrame(frame)
                }
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (text != "pong") fail(webSocket)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = synchronized(lock) {
            if (!terminated) { terminated = true; authenticated = false; listener.onClosed(code) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = synchronized(lock) {
            if (!terminated) {
                terminated = true
                authenticated = false
                val denied = response?.code == 403 && response.header("Content-Type")?.startsWith("application/json", ignoreCase = true) == true &&
                    runCatching { response.peekBody(4096).string().trim() == "{\"error\":\"no access to this document\"}" }.getOrDefault(false)
                when {
                    denied -> listener.onClosed(4403)
                    response?.code == 401 -> listener.onClosed(4401)
                    else -> listener.onFailure()
                }
            }
        }
    }

    private fun fail(webSocket: WebSocket) = synchronized(lock) {
        if (!terminated) { terminated = true; authenticated = false; webSocket.cancel(); listener.onFailure() }
    }
}
