package worlds.android.ai

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.android.R
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph
import worlds.content.ContentStore
import worlds.content.MarkdownExport
import worlds.content.Resource
import java.text.DateFormat
import java.util.Date
import java.util.UUID

@Composable
fun AiChatScreen(
    databaseName: String = "worlds-content.db",
    onBack: () -> Unit,
    onCreatePage: (title: String, content: String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val store = remember { ContentStore(context, databaseName) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var pages by remember { mutableStateOf<List<Resource>>(emptyList()) }
    var selectedModel by remember { mutableStateOf(DEFAULT_AI_MODELS.first()) }
    var inputQuery by remember { mutableStateOf("") }
    var attachments by remember { mutableStateOf<List<ChatAttachment>>(emptyList()) }
    var isStreaming by remember { mutableStateOf(false) }
    var showAttachmentPicker by remember { mutableStateOf(false) }

    var messages by remember {
        mutableStateOf(
            listOf(
                ChatMessage(
                    id = "intro-1",
                    role = "assistant",
                    content = "Welcome to Worlds AI. You can ask questions, brainstorm ideas, analyze your notes, or generate drafts. Attach pages from your library using the paperclip icon.",
                    timestamp = System.currentTimeMillis()
                )
            )
        )
    }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            pages = store.list()
        }
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    BackHandler(onBack = onBack)

    if (showAttachmentPicker) {
        AlertDialog(
            onDismissRequest = { showAttachmentPicker = false },
            title = { WorldsActionLabel(R.drawable.ic_link, "Attach page context") },
            text = {
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
                                        attachments = attachments + att
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

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing)
    ) {
        // Top Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onBack) {
                    WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back))
                }
                Text("AI Assistant", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            }

            IconButton(
                onClick = {
                    messages = listOf(
                        ChatMessage(
                            id = UUID.randomUUID().toString(),
                            role = "assistant",
                            content = "New conversation started. How can I help you?",
                            timestamp = System.currentTimeMillis()
                        )
                    )
                }
            ) {
                WorldsGlyph(R.drawable.ic_refresh_cw)
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))

        // Message List
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
                        val title = "AI Note - " + DateFormat.getDateInstance(DateFormat.SHORT).format(Date())
                        onCreatePage(title, msg.content)
                    }
                )
            }
            if (isStreaming) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        Text("Thinking...", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        // Composer
        AiComposer(
            text = inputQuery,
            onTextChange = { inputQuery = it },
            selectedModel = selectedModel,
            models = DEFAULT_AI_MODELS,
            onSelectModel = { selectedModel = it },
            attachments = attachments,
            onRemoveAttachment = { att -> attachments = attachments.filterNot { it.id == att.id } },
            onAddAttachment = { showAttachmentPicker = true },
            onSend = {
                val userMsg = ChatMessage(
                    id = UUID.randomUUID().toString(),
                    role = "user",
                    content = inputQuery.trim(),
                    timestamp = System.currentTimeMillis(),
                    attachments = attachments
                )
                messages = messages + userMsg
                val currentHistory = messages
                val currentAttachments = attachments
                inputQuery = ""
                attachments = emptyList()
                isStreaming = true

                scope.launch {
                    val client = AiClient()
                    try {
                        val reply = client.sendMessage(
                            modelId = selectedModel.id,
                            history = currentHistory.filter { it.id != userMsg.id },
                            newMessage = userMsg
                        )
                        val assistantMsg = ChatMessage(
                            id = UUID.randomUUID().toString(),
                            role = "assistant",
                            content = reply,
                            timestamp = System.currentTimeMillis()
                        )
                        messages = messages + assistantMsg
                    } catch (e: Exception) {
                        val errorMsg = ChatMessage(
                            id = UUID.randomUUID().toString(),
                            role = "assistant",
                            content = "Error: " + (e.message ?: "Failed to generate response"),
                            timestamp = System.currentTimeMillis(),
                            error = true
                        )
                        messages = messages + errorMsg
                    } finally {
                        isStreaming = false
                    }
                }
            },
            isStreaming = isStreaming
        )
    }
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    onExport: () -> Unit
) {
    val isUser = message.role == "user"
    val clipboard = LocalClipboardManager.current

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier.widthIn(max = 320.dp),
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
                    // Attachments inside bubble
                    if (message.attachments.isNotEmpty()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            message.attachments.forEach { att ->
                                Surface(shape = RoundedCornerShape(6.dp), color = Color.Black.copy(alpha = 0.2f)) {
                                    Text(
                                        "📄 " + att.name,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (isUser) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }

                    // Markdown rendering
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

            // Message actions for assistant
            if (!isUser && !message.error) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { clipboard.setText(AnnotatedString(message.content)) }) {
                        Text("Copy", style = MaterialTheme.typography.labelSmall)
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
    // Parse text paragraphs and code blocks
    val parts = text.split("```")
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        parts.forEachIndexed { index, part ->
            if (index % 2 == 1) {
                // Code block
                val lines = part.trim().lines()
                val lang = lines.firstOrNull()?.trim().orEmpty()
                val code = if (lines.size > 1) lines.drop(1).joinToString("\n") else part
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
            } else {
                // Regular markdown text
                if (part.isNotBlank()) {
                    Text(part.trim(), style = MaterialTheme.typography.bodyMedium, color = color, lineHeight = 22.sp)
                }
            }
        }
    }
}
