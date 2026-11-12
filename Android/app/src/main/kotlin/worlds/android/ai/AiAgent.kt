package worlds.android.ai

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONObject

/** A failed HTTP answer: its status and body. */
data class AiHttpFailure(val code: Int, val body: String?)

/**
 * Sends one request. A 2xx answer streams its body lines to `onLine` (return
 * false to stop reading) and returns null; any other status returns its code
 * and body. The real one is [AiClient.transport]; tests use a fake.
 */
interface AiTransport {
    suspend fun send(request: AiHttpRequest, onLine: suspend (String) -> Boolean): AiHttpFailure?
}

/** A tool's text output and whether it failed. */
data class AiToolResult(val output: String, val isError: Boolean)

/** One tool step of a reply, as the chat shows it. [ok] is null while the tool runs. */
data class AiToolStep(val tool: String, val ok: Boolean?)

/** What the loop reports while it runs, in the desktop's LoopEvent shape. */
sealed class AiAgentEvent {
    data class Delta(val text: String) : AiAgentEvent()
    data class ToolStarted(val name: String) : AiAgentEvent()
    data class ToolFinished(val name: String, val ok: Boolean) : AiAgentEvent()
    /** The model refused tools; the reply continues as plain chat. */
    object ChatOnly : AiAgentEvent()
}

data class AiAgentOutcome(val text: String, val steps: List<AiToolStep>, val turns: Int, val chatOnly: Boolean)

/**
 * Worlds' own tool loop for API providers, mirroring the desktop's
 * providers/agent.rs: send the conversation and the tool definitions, run the
 * tool calls the model asks for, send the results back, and repeat until the
 * model answers. A model that rejects tools gets one retry without them and
 * the chat continues as chat only.
 */
object AiAgent {
    /** Most model turns one reply may take (the desktop's MAX_TURNS). */
    const val MAX_TURNS = 24
    /** Most tool calls one reply may make. */
    const val MAX_TOOL_CALLS = 60

    suspend fun run(
        provider: AiProvider,
        model: String,
        system: String,
        history: List<AiMsg>,
        tools: List<AiToolDef>,
        transport: AiTransport,
        host: suspend (name: String, input: JSONObject) -> AiToolResult,
        sink: suspend (AiAgentEvent) -> Unit,
    ): AiAgentOutcome {
        val msgs = ArrayList(history)
        var useTools = tools.isNotEmpty()
        var chatOnly = false
        val steps = ArrayList<AiToolStep>()
        val texts = ArrayList<String>()
        var saidAnything = false
        var turns = 0
        var calls = 0
        while (turns < MAX_TURNS) {
            currentCoroutineContext().ensureActive()
            val offered = if (useTools) tools else emptyList()
            val request = AiToolWire.request(provider, model, system, msgs, offered)
            val stream = AiTurnStream(provider.kind)
            val failure = transport.send(request) { line ->
                var keepReading = true
                for (event in stream.line(line)) {
                    when (event) {
                        is AiStreamEvent.Delta -> sink(AiAgentEvent.Delta(event.text))
                        is AiStreamEvent.Done -> keepReading = false
                        is AiStreamEvent.Failure -> throw AiError.Stream(provider.displayName, event.message)
                    }
                }
                keepReading
            }
            if (failure != null) {
                if (useTools && AiToolWire.noToolSupport(failure.code, failure.body)) {
                    // Retry once without tools; the chat stays chat only from here on.
                    useTools = false
                    chatOnly = true
                    sink(AiAgentEvent.ChatOnly)
                    continue
                }
                throw AiRequests.httpError(provider, failure.code, failure.body, model)
            }
            for (event in stream.end()) {
                when (event) {
                    is AiStreamEvent.Delta -> sink(AiAgentEvent.Delta(event.text))
                    is AiStreamEvent.Failure -> throw AiError.Stream(provider.displayName, event.message)
                    is AiStreamEvent.Done -> Unit
                }
            }
            val turn = stream.turn()
            turns++
            if (turn.text.isNotBlank()) {
                saidAnything = true
                texts.add(turn.text.trim())
            }
            if (turn.calls.isEmpty()) {
                if (texts.isEmpty() && steps.isEmpty()) throw AiError.Malformed(provider.displayName)
                break
            }
            msgs.add(turn.toMsg())
            val results = ArrayList<AiPart>()
            for (call in turn.calls) {
                currentCoroutineContext().ensureActive()
                if (++calls > MAX_TOOL_CALLS) throw AiError.TooManySteps(MAX_TOOL_CALLS)
                sink(AiAgentEvent.ToolStarted(call.name))
                steps.add(AiToolStep(call.name, null))
                val result = if (offered.any { it.name == call.name }) {
                    try {
                        host(call.name, call.input)
                    } catch (e: kotlinx.coroutines.CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        AiToolResult("Error: ${e.message ?: e.javaClass.simpleName}", true)
                    }
                } else {
                    AiToolResult("Error: there is no tool named ${call.name}", true)
                }
                steps[steps.size - 1] = AiToolStep(call.name, !result.isError)
                sink(AiAgentEvent.ToolFinished(call.name, !result.isError))
                results.add(AiPart.ToolResult(call.id, result.output, result.isError))
            }
            msgs.add(AiMsg("user", results))
            if (saidAnything) sink(AiAgentEvent.Delta("\n\n"))
            if (turns >= MAX_TURNS) throw AiError.TooManySteps(MAX_TURNS)
        }
        // The last thing the model said is the answer; earlier narration is kept only when the last turn said nothing.
        val text = texts.lastOrNull().orEmpty().ifEmpty { texts.joinToString("\n\n") }
        return AiAgentOutcome(text, steps, turns, chatOnly)
    }
}
