package worlds.android.ai

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import javax.net.ssl.SSLException

/**
 * Talks to one provider over HTTPS (or HTTP for local servers). Replies stream
 * as text deltas. The API key only ever travels in request headers; it is never
 * logged or put into error messages.
 */
class AiClient(private val provider: AiProvider) {

    private fun checkReady(model: String?) {
        if (!AiRequests.isValidBase(provider.baseUrl)) throw AiError.BadUrl(provider.displayName)
        val preset = aiPreset(provider.id)
        if ((preset?.requiresKey ?: false) && provider.apiKey.isNullOrBlank()) throw AiError.NoKey(provider.displayName)
        if (model != null && model.isBlank()) throw AiError.NoModel(provider.displayName)
    }

    private fun open(request: AiHttpRequest, readTimeoutMs: Int): HttpURLConnection {
        val conn = URL(request.url).openConnection() as HttpURLConnection
        conn.requestMethod = request.method
        conn.connectTimeout = 20_000
        conn.readTimeout = readTimeoutMs
        conn.useCaches = false
        conn.setRequestProperty("User-Agent", "Worlds-Android")
        request.headers.forEach { (name, value) -> conn.setRequestProperty(name, value) }
        if (request.body != null) {
            conn.doOutput = true
            val bytes = request.body.toByteArray(Charsets.UTF_8)
            conn.setFixedLengthStreamingMode(bytes.size)
            conn.outputStream.use { it.write(bytes) }
        }
        return conn
    }

    private fun translate(error: Throwable): Throwable = when (error) {
        is AiError -> error
        is UnknownHostException, is ConnectException, is NoRouteToHostException, is SocketTimeoutException ->
            AiError.Offline(provider.displayName, AiRequests.host(provider.baseUrl), AiRequests.isLocal(provider.baseUrl))
        is SSLException -> AiError.Offline(provider.displayName, AiRequests.host(provider.baseUrl), AiRequests.isLocal(provider.baseUrl))
        is IOException -> AiError.Offline(provider.displayName, AiRequests.host(provider.baseUrl), AiRequests.isLocal(provider.baseUrl))
        is org.json.JSONException -> AiError.Malformed(provider.displayName)
        else -> error
    }

    /** The models this provider offers to this key, from its own list endpoint. */
    suspend fun listModels(): List<AiModelOption> = withContext(Dispatchers.IO) {
        checkReady(null)
        var conn: HttpURLConnection? = null
        try {
            conn = open(AiRequests.listModels(provider), 30_000)
            val code = conn.responseCode
            if (code !in 200..299) {
                val body = conn.errorStream?.bufferedReader()?.use { it.readText() }
                throw AiRequests.httpError(provider, code, body, null)
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            AiRequests.parseModels(body).sortedBy { it.id.lowercase() }
        } catch (error: Throwable) {
            throw translate(error)
        } finally {
            conn?.disconnect()
        }
    }

    /** Streams the reply as text deltas. Cancelling the collector closes the connection. */
    fun streamChat(model: String, system: String, turns: List<AiTurn>): Flow<String> = channelFlow {
        checkReady(model)
        val request = AiRequests.chat(provider, model, system, turns)
        withContext(Dispatchers.IO) {
            var conn: HttpURLConnection? = null
            // Blocking reads do not notice cancellation, so a watcher closes the socket.
            val watcher = launch { try { awaitCancellation() } finally { conn?.disconnect() } }
            try {
                val connection = open(request, 120_000)
                conn = connection
                val code = connection.responseCode
                if (code !in 200..299) {
                    val body = connection.errorStream?.bufferedReader()?.use { it.readText() }
                    throw AiRequests.httpError(provider, code, body, model)
                }
                val parser = AiStreamParser(provider.kind)
                var received = false
                connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
                    loop@ while (true) {
                        ensureActive()
                        val line = reader.readLine() ?: break
                        for (event in parser.line(line)) {
                            when (event) {
                                is AiStreamEvent.Delta -> { received = true; send(event.text) }
                                is AiStreamEvent.Done -> break@loop
                                is AiStreamEvent.Failure -> throw AiError.Stream(provider.displayName, event.message)
                            }
                        }
                    }
                }
                if (!received) throw AiError.Malformed(provider.displayName)
            } catch (error: Throwable) {
                ensureActive()
                throw translate(error)
            } finally {
                watcher.cancel()
            }
        }
    }
}
