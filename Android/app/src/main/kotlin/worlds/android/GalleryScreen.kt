package worlds.android

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.content.ContentBlock
import worlds.content.ContentStore
import worlds.content.Resource
import worlds.content.ResourceDocument

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun GalleryScreen(document: ResourceDocument, databaseName: String, busy: Boolean, imageStatus: Int?,
    onBack: () -> Unit, onAdd: () -> Unit, onExport: (String) -> Unit,
    onAction: (Resource, String, String, (Boolean) -> Unit) -> Unit,
    onLayout: (Resource, String, (Boolean) -> Unit) -> Unit,
    onRename: () -> Unit, onTrash: () -> Unit, modifier: Modifier = Modifier) {
    val gallery = document.resource
    val galleryItems = remember(document.blocks) { document.blocks.filter { runCatching { JSONObject(it.content).optString("type") == "galleryItem" }.getOrDefault(false) } }
    val view = remember(gallery.metadata) { runCatching { JSONObject(gallery.metadata).optJSONObject("gallery")?.optString("view") }.getOrNull().let { if (it == "list") "list" else "grid" } }
    var preview by remember(gallery.id) { mutableStateOf<ContentBlock?>(null) }
    var remove by remember(gallery.id) { mutableStateOf<ContentBlock?>(null) }
    var trash by remember(gallery.id) { mutableStateOf(false) }
    var failure by remember(gallery.id) { mutableStateOf(false) }
    preview?.let { item ->
        val attrs = remember(item.content) { runCatching { JSONObject(item.content).optJSONObject("attrs") }.getOrNull() }
        val mime = attrs?.optString("mime").orEmpty()
        AlertDialog(onDismissRequest = { preview = null }, title = { Text(galleryName(item), maxLines = 2, overflow = TextOverflow.Ellipsis) }, text = {
            if (mime.startsWith("video/") || mime.startsWith("audio/")) GalleryMediaPlayer(attrs?.optString("attachmentId").orEmpty(), mime.startsWith("video/"), databaseName)
            else ImageBlock(item.content, databaseName)
        }, confirmButton = { TextButton(onClick = { preview = null }) { Text(stringResource(R.string.close)) } })
    }
    remove?.let { item -> AlertDialog(onDismissRequest = { if (!busy) remove = null }, title = { Text(stringResource(R.string.gallery_remove)) }, text = { Text(stringResource(R.string.gallery_remove_confirm, galleryName(item))) },
        confirmButton = { TextButton(enabled = !busy, onClick = { onAction(gallery, item.id, "remove") { success -> if (success) remove = null; failure = !success } }) { Text(stringResource(R.string.gallery_remove)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = { remove = null }) { Text(stringResource(R.string.cancel)) } }) }
    if (trash) AlertDialog(onDismissRequest = { trash = false }, title = { Text(stringResource(R.string.move_to_trash)) }, text = { Text(stringResource(R.string.gallery_trash_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { trash = false; onTrash() }) { Text(stringResource(R.string.move_to_trash)) } }, dismissButton = { TextButton(onClick = { trash = false }) { Text(stringResource(R.string.cancel)) } })
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
        BoxWithConstraints(modifier.fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            val columns = if (view == "list") 1 else if (maxWidth >= 720.dp) 4 else if (maxWidth >= 420.dp) 3 else 2
            val rows = galleryItems.chunked(columns)
            LazyColumn(Modifier.widthIn(max = 1100.dp).fillMaxSize().padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(vertical = 20.dp)) {
                item {
                    TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        WorldsGlyph(R.drawable.ic_image, tint = MaterialTheme.colorScheme.primary)
                        Text(gallery.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                    }
                    Text(stringResource(R.string.gallery_item_count, galleryItems.size), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        FilledTonalButton(enabled = !busy, onClick = onAdd) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.gallery_add)) }
                        TextButton(enabled = !busy, onClick = { onLayout(gallery, if (view == "grid") "list" else "grid") { failure = !it } }) { WorldsActionLabel(R.drawable.ic_list, stringResource(if (view == "grid") R.string.gallery_list else R.string.gallery_grid)) }
                        var menu by remember { mutableStateOf(false) }
                        Box { TextButton(enabled = !busy, onClick = { menu = true }) { WorldsActionLabel(R.drawable.ic_ellipsis_vertical, stringResource(R.string.page_actions)) }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_pen_line) }, onClick = { menu = false; onRename() })
                                DropdownMenuItem(text = { Text(stringResource(R.string.move_to_trash)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, onClick = { menu = false; trash = true })
                            }
                        }
                    }
                    imageStatus?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    if (failure) Text(stringResource(R.string.gallery_error), color = MaterialTheme.colorScheme.error)
                    HorizontalDivider()
                }
                if (galleryItems.isEmpty()) item { Text(stringResource(R.string.gallery_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 24.dp)) }
                items(rows, key = { row -> row.first().id }) { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        row.forEach { item ->
                            GalleryTile(item, databaseName, busy, Modifier.weight(1f), { preview = item }, { remove = item }, { onExport(item.id) }, { action -> onAction(gallery, item.id, action) { failure = !it } })
                        }
                        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

private fun galleryName(item: ContentBlock): String = runCatching { JSONObject(item.content).optJSONObject("attrs")?.optString("name").orEmpty() }.getOrDefault("")

@Composable private fun GalleryTile(item: ContentBlock, databaseName: String, busy: Boolean, modifier: Modifier, preview: () -> Unit, remove: () -> Unit, export: () -> Unit, move: (String) -> Unit) {
    val attrs = remember(item.content) { runCatching { JSONObject(item.content).optJSONObject("attrs") }.getOrNull() }
    val id = attrs?.optString("attachmentId").orEmpty()
    val mime = attrs?.optString("mime").orEmpty()
    val context = LocalContext.current.applicationContext
    val image by produceState<android.graphics.Bitmap?>(null, id, databaseName) {
        value = if (mime.startsWith("image/")) withContext(Dispatchers.IO) { runCatching { ContentStore(context, databaseName).use { store ->
            val file = store.privateFile(id); if (file != null) decodeFileImage(file, 512) else store.imageBytes(id)?.let { decodePageImage(it, 512) }
        } }.getOrNull() } else null
    }
    Column(modifier) {
        Surface(Modifier.fillMaxWidth().height(140.dp).clickable(enabled = !busy, onClick = preview), color = MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.medium) {
            Box(contentAlignment = Alignment.Center) {
                if (image != null) Image(image!!.asImageBitmap(), contentDescription = galleryName(item), modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                else Text(stringResource(when { mime.startsWith("video/") -> R.string.gallery_video; mime.startsWith("audio/") -> R.string.gallery_audio; else -> R.string.image_unavailable }), modifier = Modifier.padding(8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(galleryName(item).ifBlank { stringResource(R.string.untitled) }, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
            var menu by remember(item.id) { mutableStateOf(false) }
            val optionsLabel = stringResource(R.string.gallery_item_options)
            Box { IconButton(enabled = !busy, onClick = { menu = true }, modifier = Modifier.semantics { contentDescription = optionsLabel }) { WorldsGlyph(R.drawable.ic_ellipsis_vertical) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.gallery_view)) }, onClick = { menu = false; preview() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.gallery_move_first)) }, onClick = { menu = false; move("first") })
                    DropdownMenuItem(text = { Text(stringResource(R.string.gallery_move_last)) }, onClick = { menu = false; move("last") })
                    DropdownMenuItem(text = { Text(stringResource(R.string.gallery_export)) }, onClick = { menu = false; export() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.gallery_remove)) }, onClick = { menu = false; remove() })
                }
            }
        }
    }
}
