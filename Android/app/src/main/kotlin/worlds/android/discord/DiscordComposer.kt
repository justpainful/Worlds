package worlds.android.discord

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.android.R
import worlds.android.WorldsActionLabel
import worlds.android.WorldsGlyph
import worlds.content.ContentStore
import worlds.content.Resource
import worlds.content.ResourceDocument
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

private val EMBED_COLORS = listOf(
    "Gold" to 0xD2A46E,
    "Sage" to 0x8DB39A,
    "Sky" to 0x7FA7D9,
    "Rose" to 0xD98C9A,
    "Blurple" to 0x5865F2
)

@Composable
fun DiscordComposer(
    initialDocument: ResourceDocument? = null,
    databaseName: String = "worlds-content.db",
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val store = remember { ContentStore(context, databaseName) }
    val scope = rememberCoroutineScope()

    var pages by remember { mutableStateOf<List<Resource>>(emptyList()) }
    var selectedPageId by remember { mutableStateOf(initialDocument?.resource?.id.orEmpty()) }
    var currentDoc by remember { mutableStateOf(initialDocument) }

    var webhookUrl by remember { mutableStateOf("") }
    var wrapInEmbed by remember { mutableStateOf(true) }
    var includeTitle by remember { mutableStateOf(true) }
    var selectedColor by remember { mutableStateOf(0xD2A46E) }

    var sending by remember { mutableStateOf(false) }
    var sendStatus by remember { mutableStateOf<String?>(null) }
    var isSuccess by remember { mutableStateOf(false) }

    var showPagePicker by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        withContext(Dispatchers.IO) {
            val list = store.list()
            pages = list
            if (currentDoc == null && list.isNotEmpty()) {
                selectedPageId = list.first().id
                currentDoc = store.load(list.first().id)
            }
        }
    }

    fun selectPage(id: String) {
        selectedPageId = id
        scope.launch {
            val doc = withContext(Dispatchers.IO) { store.load(id) }
            currentDoc = doc
            showPagePicker = false
        }
    }

    val (formattedContent, formattedEmbeds) = remember(currentDoc, wrapInEmbed, includeTitle, selectedColor) {
        val doc = currentDoc
        if (doc != null) {
            DiscordEmbedFormatter.formatPage(
                doc,
                DiscordOptions(
                    includeTitle = includeTitle,
                    wrapInEmbed = wrapInEmbed,
                    color = selectedColor
                )
            )
        } else {
            null to emptyList()
        }
    }

    BackHandler(onBack = onBack)

    if (showPagePicker) {
        AlertDialog(
            onDismissRequest = { showPagePicker = false },
            title = { WorldsActionLabel(R.drawable.ic_file_text, "Choose source page") },
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
                                .clickable { selectPage(page.id) }
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
                TextButton(onClick = { showPagePicker = false }) {
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
            .padding(horizontal = 24.dp, vertical = 20.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onBack) {
                WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back))
            }
            Text("Discord Dispatch", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }

        // Source page selector
        Text("Source Page", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
        OutlinedButton(
            onClick = { showPagePicker = true },
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(currentDoc?.resource?.title?.ifBlank { "Untitled" } ?: "Select page")
                WorldsGlyph(R.drawable.ic_chevron_right)
            }
        }

        // Destination picker
        DestinationPicker(
            webhookUrl = webhookUrl,
            onWebhookUrlChange = { webhookUrl = it },
            destinations = emptyList(),
            onSelectDestination = { dest ->
                if (dest.webhookUrl != null) webhookUrl = dest.webhookUrl
            }
        )

        // Options
        Text("Formatting Options", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
        Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Wrap in Discord Embed", style = MaterialTheme.typography.bodyMedium)
                    Switch(checked = wrapInEmbed, onCheckedChange = { wrapInEmbed = it })
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Include Page Title", style = MaterialTheme.typography.bodyMedium)
                    Switch(checked = includeTitle, onCheckedChange = { includeTitle = it })
                }

                if (wrapInEmbed) {
                    Text("Embed Accent Color", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        EMBED_COLORS.forEach { (name, colorVal) ->
                            val isSelected = selectedColor == colorVal
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .background(Color(colorVal or 0xFF000000.toInt()), CircleShape)
                                    .clickable { selectedColor = colorVal },
                                contentAlignment = Alignment.Center
                            ) {
                                if (isSelected) {
                                    WorldsGlyph(R.drawable.ic_check, tint = Color.White, modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                }
            }
        }

        // Live Preview
        Text("Message Preview", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
        DiscordPreview(
            content = formattedContent,
            embeds = formattedEmbeds
        )

        // Status feedback
        if (sendStatus != null) {
            Text(
                sendStatus.orEmpty(),
                color = if (isSuccess) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium
            )
        }

        // Send Button
        Button(
            onClick = {
                sending = true
                sendStatus = null
                scope.launch {
                    try {
                        dispatchToDiscord(
                            webhookUrl = webhookUrl.trim(),
                            payload = DiscordEmbedFormatter.buildPayloadJson(formattedContent, formattedEmbeds)
                        )
                        sendStatus = "Message sent successfully to Discord!"
                        isSuccess = true
                    } catch (e: Exception) {
                        sendStatus = "Failed: " + (e.message ?: "Unknown error")
                        isSuccess = false
                    } finally {
                        sending = false
                    }
                }
            },
            enabled = webhookUrl.startsWith("http") && !sending,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(12.dp)
        ) {
            if (sending) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary)
            } else {
                WorldsActionLabel(R.drawable.ic_send_horizontal, "Send to Discord")
            }
        }
    }
}

private suspend fun dispatchToDiscord(webhookUrl: String, payload: JSONObject) = withContext(Dispatchers.IO) {
    val url = URL(webhookUrl)
    val conn = url.openConnection() as HttpURLConnection
    conn.requestMethod = "POST"
    conn.setRequestProperty("Content-Type", "application/json")
    conn.setRequestProperty("User-Agent", "Worlds-Android/1.0")
    conn.doOutput = true
    conn.connectTimeout = 15000
    conn.readTimeout = 15000

    OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
        writer.write(payload.toString())
        writer.flush()
    }

    val code = conn.responseCode
    if (code !in 200..299) {
        val err = conn.errorStream?.bufferedReader()?.readText().orEmpty()
        throw IllegalStateException("HTTP $code: $err")
    }
}
