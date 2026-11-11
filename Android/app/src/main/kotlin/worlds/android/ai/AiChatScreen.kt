package worlds.android.ai

import worlds.android.WorldsBackButton
import worlds.android.AlertDialog
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.android.R
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph
import worlds.android.WorldsTile
import worlds.content.ContentStore
import worlds.content.MarkdownExport
import worlds.content.Resource
import java.text.DateFormat
import java.util.Date
import java.util.UUID

private const val SYSTEM_PROMPT = "You are the assistant inside Worlds, a local first workspace for pages, documents, spreadsheets, drawings and study. Answer clearly. Use Markdown when it helps. When the person attaches pages they appear inside <document> tags."

private fun newThread(providerId: String, modelId: String): ChatThread {
    val now = System.currentTimeMillis()
    return ChatThread(UUID.randomUUID().toString(), "New conversation", providerId, modelId, emptyList(), now, now)
}

@Composable
fun AiChatScreen(
    databaseName: String = "worlds-content.db",
    onBack: () -> Unit,
    onCreatePage: (title: String, content: String) -> Unit,
    modifier: Modifier = Modifier,
    showBack: Boolean = true
) {
    val context = LocalContext.current
    val store = remember { ContentStore(context, databaseName) }
    val providers = remember { AiProviderStore(context) }
    val conversations = remember { AiConversationStore(context) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var pages by remember { mutableStateOf<List<Resource>>(emptyList()) }
    var thread by remember { mutableStateOf<ChatThread?>(null) }
    var savedThreadId by rememberSaveable { mutableStateOf<String?>(null) }
    var inputQuery by rememberSaveable { mutableStateOf("") }
    var attachments by remember { mutableStateOf<List<ChatAttachment>>(emptyList()) }
    var streamJob by remember { mutableStateOf<Job?>(null) }
    var showAttachmentPicker by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    var showSettings by rememberSaveable { mutableStateOf(false) }
    var history by remember { mutableStateOf<List<ChatThread>>(emptyList()) }
    var choices by remember { mutableStateOf<List<AiModelChoice>>(emptyList()) }
    var anyConfigured by remember { mutableStateOf(true) }
    var settingsVersion by remember { mutableIntStateOf(0) }
    val isStreaming = streamJob != null

    // Models offered by every provider that is set up on this device, and the default for new conversations.
    LaunchedEffect(settingsVersion) {
        val (list, configured, default) = withContext(Dispatchers.IO) {
            val out = ArrayList<AiModelChoice>()
            var configuredCount = 0
            for (preset in AI_PROVIDER_PRESETS) {
                if (!providers.isConfigured(preset.id)) continue
                configuredCount++
                val settings = providers.settings(preset.id)
                val models = settings.models.ifEmpty { if (settings.model.isNotBlank()) listOf(AiModelOption(settings.model, settings.model)) else emptyList() }
                models.forEach { out.add(AiModelChoice(preset.id, preset.displayName, it.id, it.name)) }
                if (settings.model.isNotBlank() && models.none { it.id == settings.model }) out.add(AiModelChoice(preset.id, preset.displayName, settings.model, settings.model))
            }
            val defaultId = providers.defaultProviderId?.takeIf { providers.isConfigured(it) } ?: AI_PROVIDER_PRESETS.firstOrNull { providers.isConfigured(it.id) }?.id
            Triple(out, configuredCount > 0, defaultId?.let { it to providers.settings(it).model })
        }
        choices = list
        anyConfigured = configured
        val current = thread
        if (current == null) {
            val restored = withContext(Dispatchers.IO) { (savedThreadId?.let { conversations.load(it) }) ?: conversations.list().firstOrNull() }
            thread = restored ?: newThread(default?.first.orEmpty(), default?.second.orEmpty())
        } else if (current.messages.isEmpty() && default != null) {
            // An empty conversation follows the settings the person just chose.
            thread = current.copy(providerId = default.first, modelId = default.second)
        } else if (current.providerId.isBlank() && default != null) {
            thread = current.copy(providerId = default.first, modelId = default.second)
        }
        savedThreadId = thread?.id
    }

    LaunchedEffect(Unit) {
        pages = withContext(Dispatchers.IO) { store.list() }
    }

    val messages = thread?.messages.orEmpty()
    LaunchedEffect(messages.size, messages.lastOrNull()?.content?.length) {
        if (messages.isNotEmpty()) listState.scrollToItem(messages.size - 1, Int.MAX_VALUE / 2)
    }

    fun persist(updated: ChatThread) {
        scope.launch(Dispatchers.IO) { runCatching { conversations.save(updated) } }
    }

    fun updateMessage(id: String, transform: (ChatMessage) -> ChatMessage) {
        val current = thread ?: return
        thread = current.copy(messages = current.messages.map { if (it.id == id) transform(it) else it })
    }

    fun send() {
        val current = thread ?: return
        val userMsg = ChatMessage(UUID.randomUUID().toString(), "user", inputQuery.trim(), System.currentTimeMillis(), attachments)
        val replyId = UUID.randomUUID().toString()
        val reply = ChatMessage(replyId, "assistant", "", System.currentTimeMillis(), isStreaming = true)
        val turns = (current.messages + userMsg).toTurns()
        val title = if (current.messages.none { it.role == "user" }) chatTitle(userMsg.content.ifBlank { attachments.firstOrNull()?.name.orEmpty() }) else current.title
        thread = current.copy(title = title, messages = current.messages + userMsg + reply, updatedAt = System.currentTimeMillis())
        inputQuery = ""
        attachments = emptyList()
        persist(thread!!)

        streamJob = scope.launch {
            try {
                if (current.providerId.isBlank()) throw AiError.NoProvider()
                val provider = withContext(Dispatchers.IO) { providers.provider(current.providerId) } ?: throw AiError.NoProvider()
                AiClient(provider).streamChat(current.modelId, SYSTEM_PROMPT, turns).collect { delta ->
                    updateMessage(replyId) { it.copy(content = it.content + delta) }
                }
                updateMessage(replyId) { it.copy(isStreaming = false, timestamp = System.currentTimeMillis()) }
            } catch (e: CancellationException) {
                updateMessage(replyId) { it.copy(isStreaming = false) }
                val partial = thread?.messages?.firstOrNull { it.id == replyId }
                if (partial != null && partial.content.isBlank()) thread = thread?.let { t -> t.copy(messages = t.messages.filterNot { it.id == replyId }) }
            } catch (e: Exception) {
                val message = (e as? AiError)?.message ?: "The reply failed: ${e.message ?: e.javaClass.simpleName}"
                val partial = thread?.messages?.firstOrNull { it.id == replyId }
                if (partial != null && partial.content.isNotBlank()) {
                    updateMessage(replyId) { it.copy(isStreaming = false) }
                    thread = thread?.let { t -> t.copy(messages = t.messages + ChatMessage(UUID.randomUUID().toString(), "assistant", message, System.currentTimeMillis(), error = true)) }
                } else {
                    updateMessage(replyId) { it.copy(content = message, isStreaming = false, error = true) }
                }
            } finally {
                streamJob = null
                val finished = thread?.copy(updatedAt = System.currentTimeMillis())
                if (finished != null) withContext(NonCancellable + Dispatchers.IO) { runCatching { conversations.save(finished) } }
            }
        }
    }

    BackHandler(enabled = !showSettings, onBack = onBack)

    if (showSettings) {
        AiProviderSettingsScreen(onBack = { showSettings = false; settingsVersion++ }, modifier = modifier)
        return
    }

    if (showAttachmentPicker) {
        AlertDialog(
            onDismissRequest = { showAttachmentPicker = false },
            title = { WorldsActionLabel(R.drawable.ic_link, "Attach page context") },
            text = {
                if (pages.isEmpty()) Text("No pages yet.")
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 380.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    items(pages, key = { it.id }) { page ->
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    scope.launch {
                                        val doc = withContext(Dispatchers.IO) { store.load(page.id) }
                                        val markdown = if (doc != null) MarkdownExport.page(doc) else ""
                                        val att = ChatAttachment(
                                            id = page.id,
                                            name = page.title.ifBlank { "Untitled" },
                                            mime = "text/markdown",
                                            size = markdown.length.toLong(),
                                            content = markdown
                                        )
                                        if (attachments.none { it.id == att.id }) attachments = attachments + att
                                        showAttachmentPicker = false
                                    }
                                }
                        ) {
                            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                WorldsGlyph(R.drawable.ic_file_text)
                                Text(page.title.ifBlank { "Untitled" }, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAttachmentPicker = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    if (showHistory) {
        AlertDialog(
            onDismissRequest = { showHistory = false },
            title = { WorldsActionLabel(R.drawable.ic_history, "Conversations") },
            text = {
                if (history.isEmpty()) Text("No saved conversations yet.")
                LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    items(history, key = { it.id }) { item ->
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = if (item.id == thread?.id) MaterialTheme.colorScheme.surfaceContainerHighest else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                            modifier = Modifier.fillMaxWidth().clickable(enabled = !isStreaming) {
                                thread = item; savedThreadId = item.id; showHistory = false
                            }
                        ) {
                            Row(Modifier.padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(item.title, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    val providerName = aiPreset(item.providerId)?.displayName ?: "No provider"
                                    Text(listOf(providerName, item.modelId).filter { it.isNotBlank() }.joinToString(", "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                IconButton(
                                    onClick = {
                                        scope.launch(Dispatchers.IO) { conversations.delete(item.id) }
                                        history = history.filterNot { it.id == item.id }
                                        if (item.id == thread?.id && !isStreaming) thread = newThread(item.providerId, item.modelId)
                                    },
                                    enabled = !(isStreaming && item.id == thread?.id),
                                    modifier = Modifier.semantics { contentDescription = "Delete conversation" }
                                ) { WorldsGlyph(R.drawable.ic_trash_2, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showHistory = false }) { Text("Done") } }
        )
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (showBack) WorldsBackButton(onBack)
                Column(Modifier.weight(1f, fill = false)) {
                    Text("AI Assistant", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    val current = thread
                    if (current != null && current.messages.isNotEmpty()) {
                        Text(current.title, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            Row {
                IconButton(onClick = {
                    scope.launch { history = withContext(Dispatchers.IO) { conversations.list() }; showHistory = true }
                }, modifier = Modifier.semantics { contentDescription = "Conversations" }) { WorldsGlyph(R.drawable.ic_history) }
                IconButton(
                    onClick = {
                        val current = thread
                        if (current != null && current.messages.isNotEmpty()) {
                            scope.launch {
                                val default = withContext(Dispatchers.IO) { providers.defaultProviderId?.takeIf { providers.isConfigured(it) }?.let { it to providers.settings(it).model } }
                                thread = newThread(default?.first ?: current.providerId, default?.second ?: current.modelId)
                                savedThreadId = thread?.id
                            }
                        }
                    },
                    enabled = !isStreaming,
                    modifier = Modifier.semantics { contentDescription = "New conversation" }
                ) { WorldsGlyph(R.drawable.ic_plus) }
                IconButton(onClick = { showSettings = true }, enabled = !isStreaming, modifier = Modifier.semantics { contentDescription = "AI providers and keys" }) {
                    WorldsGlyph(R.drawable.ic_settings_2)
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))

        val current = thread
        if (current != null && current.messages.isEmpty()) {
            EmptyConversation(
                configured = anyConfigured,
                providerName = aiPreset(current.providerId)?.displayName,
                model = current.modelId,
                onSetUp = { showSettings = true },
                modifier = Modifier.weight(1f)
            )
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(vertical = 16.dp)
            ) {
                items(messages, key = { it.id }) { msg ->
                    MessageBubble(
                        message = msg,
                        onExport = {
                            val name = thread?.title?.takeIf { it.isNotBlank() && it != "New conversation" }
                                ?: ("AI note, " + DateFormat.getDateInstance(DateFormat.SHORT).format(Date()))
                            onCreatePage(name, msg.content)
                        },
                        onOpenSettings = { showSettings = true }
                    )
                }
            }
        }

        val selectedProvider = current?.providerId.orEmpty()
        val selectedModel = current?.modelId.orEmpty()
        val label = when {
            selectedProvider.isBlank() -> "Choose a model"
            selectedModel.isBlank() -> (aiPreset(selectedProvider)?.displayName ?: selectedProvider) + ", choose a model"
            else -> choices.firstOrNull { it.providerId == selectedProvider && it.modelId == selectedModel }?.modelName ?: selectedModel
        }
        AiComposer(
            text = inputQuery,
            onTextChange = { inputQuery = it },
            modelLabel = label,
            choices = choices,
            selectedProviderId = selectedProvider,
            selectedModelId = selectedModel,
            onChoose = { choice ->
                thread = thread?.copy(providerId = choice.providerId, modelId = choice.modelId)
                thread?.let { if (it.messages.isNotEmpty()) persist(it) }
                scope.launch(Dispatchers.IO) {
                    providers.save(choice.providerId, providers.settings(choice.providerId).copy(model = choice.modelId))
                    providers.defaultProviderId = choice.providerId
                }
            },
            onOpenSettings = { showSettings = true },
            attachments = attachments,
            onRemoveAttachment = { att -> attachments = attachments.filterNot { it.id == att.id } },
            onAddAttachment = { showAttachmentPicker = true },
            onSend = { send() },
            onStop = { streamJob?.cancel() },
            isStreaming = isStreaming
        )
    }
}

@Composable
private fun EmptyConversation(configured: Boolean, providerName: String?, model: String, onSetUp: () -> Unit, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            WorldsTile(R.drawable.pi_sparkles, 56.dp)
            if (!configured || providerName == null) {
                Text("Connect an AI provider", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                Text(
                    "Use your own key from Anthropic, OpenAI, Gemini, Groq, DeepSeek, Mistral, xAI or OpenRouter, or a local server such as Ollama or LM Studio.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center
                )
                Button(onClick = onSetUp) { WorldsActionLabel(R.drawable.ic_key_round, "Set up a provider") }
            } else if (model.isBlank()) {
                Text("Choose a model", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                Text("Load the models $providerName offers and pick one.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                Button(onClick = onSetUp) { WorldsActionLabel(R.drawable.ic_sliders_horizontal, "Choose a model") }
            } else {
                Text("Ask anything", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                Text(
                    "Replies come from $model on $providerName. Attach pages with the link button to give it context.",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    onExport: () -> Unit,
    onOpenSettings: () -> Unit
) {
    val isUser = message.role == "user"
    val clipboard = LocalClipboardManager.current

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier.widthIn(max = 560.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Surface(
                shape = RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (isUser) 16.dp else 4.dp,
                    bottomEnd = if (isUser) 4.dp else 16.dp
                ),
                color = when {
                    message.error -> MaterialTheme.colorScheme.errorContainer
                    isUser -> MaterialTheme.colorScheme.primary
                    else -> MaterialTheme.colorScheme.surfaceVariant
                }
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (message.attachments.isNotEmpty()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            message.attachments.forEach { att ->
                                val ink = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                                Surface(shape = RoundedCornerShape(6.dp), color = Color.Black.copy(alpha = 0.2f)) {
                                    Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        WorldsGlyph(R.drawable.ic_file_text, modifier = Modifier.size(14.dp), tint = ink)
                                        Text(att.name, style = MaterialTheme.typography.labelSmall, color = ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                            }
                        }
                    }

                    if (message.isStreaming && message.content.isEmpty()) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                            Text("Waiting for the reply", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else {
                        SelectionContainer {
                            MarkdownMessageText(
                                text = message.content,
                                color = when {
                                    message.error -> MaterialTheme.colorScheme.onErrorContainer
                                    isUser -> MaterialTheme.colorScheme.onPrimary
                                    else -> MaterialTheme.colorScheme.onSurface
                                }
                            )
                        }
                    }
                }
            }

            if (message.error) {
                TextButton(onClick = onOpenSettings) { WorldsActionLabel(R.drawable.ic_key_round, "AI providers and keys") }
            } else if (!isUser && !message.isStreaming && message.content.isNotBlank()) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { clipboard.setText(AnnotatedString(message.content)) }) {
                        WorldsActionLabel(R.drawable.ic_files, "Copy")
                    }
                    TextButton(onClick = onExport) {
                        WorldsActionLabel(R.drawable.ic_file_text, "Create page")
                    }
                }
            }
        }
    }
}

@Composable
private fun MarkdownMessageText(
    text: String,
    color: Color
) {
    val parts = text.split("```")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        parts.forEachIndexed { index, part ->
            if (index % 2 == 1) {
                val lines = part.trim('\n').lines()
                val first = lines.firstOrNull()?.trim().orEmpty()
                val hasLang = lines.size > 1 && first.isNotEmpty() && !first.contains(' ')
                val lang = if (hasLang) first else ""
                val code = if (hasLang) lines.drop(1).joinToString("\n") else part.trim('\n')
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(Modifier.padding(10.dp)) {
                        if (lang.isNotBlank()) {
                            Text(lang, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Spacer(Modifier.height(4.dp))
                        }
                        Text(code, fontFamily = FontFamily.Monospace, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
                    }
                }
            } else if (part.isNotBlank()) {
                Text(part.trim(), style = MaterialTheme.typography.bodyMedium, color = color, lineHeight = 22.sp)
            }
        }
    }
}
