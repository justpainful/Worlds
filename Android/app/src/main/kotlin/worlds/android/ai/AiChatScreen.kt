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
import androidx.compose.ui.platform.LocalResources
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

/** Added when the model is offered the Worlds tools. */
private const val TOOLS_PROMPT = "You can read and change the person's Worlds pages on this Android device with the Worlds tools. " +
    "Use them when the request is about their pages or tasks; answer directly when it is not. " +
    "Read a page before you change it, change the smallest set of blocks, and never invent page or block ids. " +
    "Pages and documents can be edited; other kinds can only be listed, read or renamed. " +
    "Every change you make in one reply can be undone by the person from the chat, so make the change instead of asking for permission, then say briefly what you changed."

private fun newThread(providerId: String, modelId: String): ChatThread {
    val now = System.currentTimeMillis()
    // A blank title stands for "New conversation" and is translated where it is shown.
    return ChatThread(UUID.randomUUID().toString(), "", providerId, modelId, emptyList(), now, now)
}

@Composable
private fun ChatThread.displayTitle(): String = if (hasPlaceholderTitle()) stringResource(R.string.ai_new_conversation) else title

@Composable
fun AiChatScreen(
    databaseName: String = "worlds-content.db",
    onBack: () -> Unit,
    onCreatePage: (title: String, content: String) -> Unit,
    modifier: Modifier = Modifier,
    showBack: Boolean = true,
    /** Opens a page the assistant changed. */
    onOpenPage: (pageId: String) -> Unit = {},
    /** The assistant changed or put back these pages; screens showing them should reload. */
    onWorkspaceChanged: (pageIds: Set<String>) -> Unit = {},
    /** A request to start with in the composer, such as a pack request (docs/PACKS.md). */
    initialPrompt: String = "",
) {
    val context = LocalContext.current
    val resources = LocalResources.current
    val store = remember { ContentStore(context, databaseName) }
    val providers = remember { AiProviderStore(context) }
    val conversations = remember { AiConversationStore(context) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var pages by remember { mutableStateOf<List<Resource>>(emptyList()) }
    var thread by remember { mutableStateOf<ChatThread?>(null) }
    var savedThreadId by rememberSaveable { mutableStateOf<String?>(null) }
    var inputQuery by rememberSaveable { mutableStateOf(initialPrompt) }
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
                val providerName = preset.label(context)
                models.forEach { out.add(AiModelChoice(preset.id, providerName, it.id, it.name)) }
                if (settings.model.isNotBlank() && models.none { it.id == settings.model }) out.add(AiModelChoice(preset.id, providerName, settings.model, settings.model))
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
    LaunchedEffect(messages.size, messages.lastOrNull()?.content?.length, messages.lastOrNull()?.steps?.size) {
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

        // Tools run over the same local store the rest of the app uses; a chat only conversation is sent without them.
        val runner = AiToolRunner(ContentStoreWorkspace(store))
        val offerTools = !current.chatOnly
        val history = AiRequests.cleanTurns(turns).map { AiMsg.text(it.role, it.content) }

        fun recordChanges() {
            val changes = runner.changes
            val before = thread?.messages?.firstOrNull { it.id == replyId }?.changes
            if (changes == before) return
            updateMessage(replyId) { it.copy(changes = changes) }
            // Saved at once, so the reply can still be undone if the app closes before it finishes.
            thread?.let { persist(it) }
        }

        fun onEvent(event: AiAgentEvent) {
            when (event) {
                is AiAgentEvent.Delta -> updateMessage(replyId) { it.copy(content = it.content + event.text) }
                is AiAgentEvent.ToolStarted -> updateMessage(replyId) { it.copy(steps = it.steps + AiToolStep(event.name, null)) }
                is AiAgentEvent.ToolFinished -> updateMessage(replyId) { msg ->
                    val index = msg.steps.indexOfLast { it.ok == null }
                    if (index < 0) msg else msg.copy(steps = msg.steps.toMutableList().also { it[index] = AiToolStep(event.name, event.ok) })
                }
                AiAgentEvent.ChatOnly -> {
                    updateMessage(replyId) { it.copy(chatOnly = true) }
                    thread = thread?.copy(chatOnly = true)
                }
            }
        }

        /** Steps still marked running when the reply stops count as not finished. */
        fun settle(msg: ChatMessage) = msg.copy(isStreaming = false, steps = msg.steps.map { if (it.ok == null) it.copy(ok = false) else it }, changes = runner.changes)

        streamJob = scope.launch {
            try {
                if (current.providerId.isBlank()) throw AiError.NoProvider()
                val provider = withContext(Dispatchers.IO) { providers.provider(current.providerId) } ?: throw AiError.NoProvider()
                if (current.modelId.isBlank()) throw AiError.NoModel(provider.displayName)
                val outcome = AiAgent.run(
                    provider = provider,
                    model = current.modelId,
                    system = if (offerTools) SYSTEM_PROMPT + "\n\n" + TOOLS_PROMPT else SYSTEM_PROMPT,
                    history = history,
                    tools = if (offerTools) AiTools.ALL else emptyList(),
                    transport = AiClient(provider).transport(),
                    host = { name, input ->
                        val result = withContext(Dispatchers.IO) { runner.call(name, input) }
                        recordChanges()
                        result
                    },
                    // Lines arrive on the network thread; chat state changes on the main thread.
                    sink = { event -> withContext(Dispatchers.Main.immediate) { onEvent(event) } },
                )
                updateMessage(replyId) { settle(it).copy(content = outcome.text.ifBlank { it.content.trim() }, timestamp = System.currentTimeMillis()) }
            } catch (e: CancellationException) {
                updateMessage(replyId) { settle(it) }
                val partial = thread?.messages?.firstOrNull { it.id == replyId }
                if (partial != null && partial.content.isBlank() && partial.steps.isEmpty() && partial.changes.isEmpty()) thread = thread?.let { t -> t.copy(messages = t.messages.filterNot { it.id == replyId }) }
            } catch (e: Exception) {
                val message = (e as? AiError)?.localized(context) ?: resources.getString(R.string.ai_reply_failed, e.message ?: e.javaClass.simpleName)
                updateMessage(replyId) { settle(it) }
                val partial = thread?.messages?.firstOrNull { it.id == replyId }
                if (partial != null && (partial.content.isNotBlank() || partial.steps.isNotEmpty() || partial.changes.isNotEmpty())) {
                    thread = thread?.let { t -> t.copy(messages = t.messages + ChatMessage(UUID.randomUUID().toString(), "assistant", message, System.currentTimeMillis(), error = true)) }
                } else {
                    updateMessage(replyId) { it.copy(content = message, error = true) }
                }
            } finally {
                streamJob = null
                val changed = runner.changes.map { it.pageId }.toSet()
                if (changed.isNotEmpty()) onWorkspaceChanged(changed)
                val finished = thread?.copy(updatedAt = System.currentTimeMillis())
                if (finished != null) withContext(NonCancellable + Dispatchers.IO) { runCatching { conversations.save(finished) } }
            }
        }
    }

    var undoing by remember { mutableStateOf<String?>(null) }

    /** Puts back every page one reply changed, like the desktop chat's Undo. */
    fun undo(message: ChatMessage) {
        if (message.changes.isEmpty() || message.undone || isStreaming || undoing != null) return
        undoing = message.id
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) { AiUndo.undo(ContentStoreWorkspace(store), message.changes) }
                if (result.undone.isNotEmpty()) updateMessage(message.id) { it.copy(undone = true) }
                if (result.failed.isNotEmpty()) {
                    val names = result.failed.joinToString(resources.getString(R.string.ai_list_separator)) { it.ifBlank { resources.getString(R.string.untitled) } }
                    thread = thread?.let { t -> t.copy(messages = t.messages + ChatMessage(UUID.randomUUID().toString(), "assistant", resources.getString(R.string.ai_undo_failed, names), System.currentTimeMillis(), error = true)) }
                }
                thread?.let { persist(it) }
                onWorkspaceChanged(message.changes.map { it.pageId }.toSet())
            } finally {
                undoing = null
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
            title = { WorldsActionLabel(R.drawable.ic_link, stringResource(R.string.ai_attach_page_context)) },
            text = {
                if (pages.isEmpty()) Text(stringResource(R.string.ai_no_pages))
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
                                            name = page.title.ifBlank { resources.getString(R.string.untitled) },
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
                                Text(page.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.bodyMedium)
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
        val deleteLabel = stringResource(R.string.ai_delete_conversation)
        AlertDialog(
            onDismissRequest = { showHistory = false },
            title = { WorldsActionLabel(R.drawable.ic_history, stringResource(R.string.ai_conversations)) },
            text = {
                if (history.isEmpty()) Text(stringResource(R.string.ai_no_conversations))
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
                                    Text(item.displayTitle(), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    val providerName = aiPreset(item.providerId)?.label() ?: stringResource(R.string.ai_no_provider)
                                    Text(listOf(providerName, item.modelId).filter { it.isNotBlank() }.joinToString(", "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                IconButton(
                                    onClick = {
                                        scope.launch(Dispatchers.IO) { conversations.delete(item.id) }
                                        history = history.filterNot { it.id == item.id }
                                        if (item.id == thread?.id && !isStreaming) thread = newThread(item.providerId, item.modelId)
                                    },
                                    enabled = !(isStreaming && item.id == thread?.id),
                                    modifier = Modifier.semantics { contentDescription = deleteLabel }
                                ) { WorldsGlyph(R.drawable.ic_trash_2, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showHistory = false }) { Text(stringResource(R.string.ai_done)) } }
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
                    Text(stringResource(R.string.ai_chat), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    val current = thread
                    if (current != null && current.messages.isNotEmpty()) {
                        Text(current.displayTitle(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            val conversationsLabel = stringResource(R.string.ai_conversations)
            val newConversationLabel = stringResource(R.string.ai_new_conversation)
            val settingsLabel = stringResource(R.string.ai_providers_and_keys)
            Row {
                IconButton(onClick = {
                    scope.launch { history = withContext(Dispatchers.IO) { conversations.list() }; showHistory = true }
                }, modifier = Modifier.semantics { contentDescription = conversationsLabel }) { WorldsGlyph(R.drawable.ic_history) }
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
                    modifier = Modifier.semantics { contentDescription = newConversationLabel }
                ) { WorldsGlyph(R.drawable.ic_plus) }
                IconButton(onClick = { showSettings = true }, enabled = !isStreaming, modifier = Modifier.semantics { contentDescription = settingsLabel }) {
                    WorldsGlyph(R.drawable.ic_settings_2)
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))

        val current = thread
        if (current != null && current.messages.isEmpty()) {
            EmptyConversation(
                configured = anyConfigured,
                providerName = aiPreset(current.providerId)?.label(),
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
                            val name = thread?.takeIf { !it.hasPlaceholderTitle() }?.title
                                ?: resources.getString(R.string.ai_note_title, DateFormat.getDateInstance(DateFormat.SHORT).format(Date()))
                            onCreatePage(name, msg.content)
                        },
                        onOpenSettings = { showSettings = true },
                        onUndo = { undo(msg) },
                        undoEnabled = !isStreaming && undoing == null,
                        onOpenPage = onOpenPage
                    )
                }
            }
        }

        val selectedProvider = current?.providerId.orEmpty()
        val selectedModel = current?.modelId.orEmpty()
        val label = when {
            selectedProvider.isBlank() -> stringResource(R.string.ai_choose_model)
            selectedModel.isBlank() -> stringResource(R.string.ai_provider_choose_model, aiPreset(selectedProvider)?.label() ?: selectedProvider)
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
                // Another model may support tools, so the conversation offers them again.
                thread = thread?.copy(providerId = choice.providerId, modelId = choice.modelId, chatOnly = false)
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
                Text(stringResource(R.string.ai_connect_provider), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                Text(
                    stringResource(R.string.ai_connect_provider_body),
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center
                )
                Button(onClick = onSetUp) { WorldsActionLabel(R.drawable.ic_key_round, stringResource(R.string.ai_set_up_provider)) }
            } else if (model.isBlank()) {
                Text(stringResource(R.string.ai_choose_model), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                Text(stringResource(R.string.ai_load_models_hint, providerName), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                Button(onClick = onSetUp) { WorldsActionLabel(R.drawable.ic_sliders_horizontal, stringResource(R.string.ai_choose_model)) }
            } else {
                Text(stringResource(R.string.ai_ask_anything), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onBackground)
                Text(
                    stringResource(R.string.ai_replies_from, model, providerName),
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
    onOpenSettings: () -> Unit,
    onUndo: () -> Unit = {},
    undoEnabled: Boolean = false,
    onOpenPage: (String) -> Unit = {}
) {
    val isUser = message.role == "user"
    val clipboard = LocalClipboardManager.current
    // A finished reply that only ran tools has no text bubble; its steps and changes say what happened.
    val showBubble = isUser || message.error || message.content.isNotBlank() || (message.isStreaming && message.steps.isEmpty()) ||
        (!message.isStreaming && message.steps.isEmpty())

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier.widthIn(max = 560.dp),
            horizontalAlignment = if (isUser) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            if (!isUser && message.steps.isNotEmpty()) ToolSteps(message.steps, live = message.isStreaming)
            if (!isUser && message.chatOnly) ChatOnlyNote()
            if (!isUser && message.isStreaming && message.steps.isNotEmpty() && message.content.isBlank()) {
                Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp)
                    Text(stringResource(R.string.ai_working), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (showBubble) Surface(
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
                            Text(stringResource(R.string.ai_waiting_reply), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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

            if (!isUser && message.changes.isNotEmpty() && !message.isStreaming) {
                ChangesRow(message, undoEnabled = undoEnabled, onUndo = onUndo, onOpenPage = onOpenPage)
            }

            if (message.error) {
                TextButton(onClick = onOpenSettings) { WorldsActionLabel(R.drawable.ic_key_round, stringResource(R.string.ai_providers_and_keys)) }
            } else if (!isUser && !message.isStreaming && message.content.isNotBlank()) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { clipboard.setText(AnnotatedString(message.content)) }) {
                        WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.ai_copy))
                    }
                    TextButton(onClick = onExport) {
                        WorldsActionLabel(R.drawable.ic_file_text, stringResource(R.string.ai_create_page))
                    }
                }
            }
        }
    }
}

/** The label and glyph for a tool step, matching the desktop chat's wording. Unknown tools show their own name. */
private fun toolLabel(tool: String): Pair<Int?, Int> = when (tool) {
    "workspace_overview" -> R.string.ai_tool_workspace_overview to R.drawable.ic_house
    "pages_list" -> R.string.ai_tool_pages_list to R.drawable.ic_files
    "pages_search" -> R.string.ai_tool_pages_search to R.drawable.ic_search
    "pages_read" -> R.string.ai_tool_pages_read to R.drawable.ic_file_text
    "pages_create" -> R.string.ai_tool_pages_create to R.drawable.ic_plus
    "pages_append_markdown" -> R.string.ai_tool_pages_append_markdown to R.drawable.ic_list_plus
    "blocks_update" -> R.string.ai_tool_blocks_update to R.drawable.ic_pencil
    "pages_rename" -> R.string.ai_tool_pages_rename to R.drawable.ic_pen_line
    "tasks_add" -> R.string.ai_tool_tasks_add to R.drawable.ic_list_todo
    "tasks_list" -> R.string.ai_tool_tasks_list to R.drawable.ic_list_todo
    else -> null to R.drawable.ic_settings_2
}

/** Tool steps: listed while the reply runs, folded behind a count once it is done, like the desktop chat. */
@Composable
private fun ToolSteps(steps: List<AiToolStep>, live: Boolean) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        if (!live) {
            TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    WorldsGlyph(R.drawable.ic_settings_2, modifier = Modifier.size(14.dp), tint = muted)
                    Text(stringResource(R.string.ai_steps, steps.size), style = MaterialTheme.typography.labelMedium, color = muted)
                    WorldsGlyph(if (expanded) R.drawable.ic_arrow_up else R.drawable.ic_arrow_down, modifier = Modifier.size(12.dp), tint = muted)
                }
            }
        }
        if (live || expanded) {
            val running = stringResource(R.string.ai_step_running)
            val finished = stringResource(R.string.ai_step_finished)
            val failed = stringResource(R.string.ai_step_failed)
            steps.forEach { step ->
                val (labelRes, glyph) = toolLabel(step.tool)
                val label = labelRes?.let { stringResource(it) } ?: step.tool
                val tint = if (step.ok == false) MaterialTheme.colorScheme.error else muted
                val state = when (step.ok) { null -> running; true -> finished; false -> failed }
                Row(
                    Modifier.padding(horizontal = 4.dp, vertical = 2.dp).semantics { contentDescription = "$label, $state" },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    WorldsGlyph(glyph, modifier = Modifier.size(14.dp), tint = tint)
                    Text(label, style = MaterialTheme.typography.bodySmall, color = tint)
                    when (step.ok) {
                        null -> CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp)
                        true -> WorldsGlyph(R.drawable.ic_check, modifier = Modifier.size(12.dp), tint = muted)
                        false -> WorldsGlyph(R.drawable.ic_x, modifier = Modifier.size(12.dp), tint = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatOnlyNote() {
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.secondaryContainer) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WorldsGlyph(R.drawable.ic_lightbulb, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSecondaryContainer)
            Text(stringResource(R.string.ai_chat_only_note), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
        }
    }
}

/** What one reply changed, with Open and Undo, like the desktop chat's result row. */
@Composable
private fun ChangesRow(message: ChatMessage, undoEnabled: Boolean, onUndo: () -> Unit, onOpenPage: (String) -> Unit) {
    val untitled = stringResource(R.string.untitled)
    val separator = stringResource(R.string.ai_list_separator)
    val names = message.changes.joinToString(separator) { it.title.ifBlank { untitled } }
    val openable = message.changes.firstOrNull { !(message.undone && it.created) }
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
        Row(Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(if (message.undone) R.string.ai_changes_undone else R.string.ai_changes_on, names),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false)
            )
            if (openable != null) {
                TextButton(onClick = { onOpenPage(openable.pageId) }) { WorldsActionLabel(R.drawable.ic_arrow_up_right, stringResource(R.string.ai_open_page)) }
            }
            if (!message.undone) {
                TextButton(onClick = onUndo, enabled = undoEnabled) { WorldsActionLabel(R.drawable.ic_undo_2, stringResource(R.string.ai_undo)) }
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
