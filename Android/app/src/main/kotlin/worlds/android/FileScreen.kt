package worlds.android

import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import worlds.content.ContentStore
import worlds.content.FileAttachment
import worlds.content.Resource

internal fun fileOpenIntent(context: android.content.Context, attachment: FileAttachment, file: java.io.File): Intent {
    val safeName = attachment.name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "-").ifBlank { "file" }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file, safeName)
    val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, attachment.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return Intent.createChooser(intent, context.getString(R.string.file_open))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun FileScreen(resource: Resource, databaseName: String, busy: Boolean, status: Int?, onBack: () -> Unit,
    onExport: () -> Unit, onRename: () -> Unit, onTrash: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val attachment = remember(resource.metadata) { FileAttachment.read(resource.metadata) }
    var loaded by remember(resource.id, resource.metadata) { mutableStateOf(false) }
    var file by remember(resource.id, resource.metadata) { mutableStateOf<java.io.File?>(null) }
    var thumbnail by remember(resource.id, resource.metadata) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var openError by remember(resource.id) { mutableStateOf(false) }
    var confirmTrash by remember(resource.id) { mutableStateOf(false) }
    var galleryOpen by remember(resource.id) { mutableStateOf(false) }
    var galleryLoading by remember(resource.id) { mutableStateOf(false) }
    var galleryBusy by remember(resource.id) { mutableStateOf(false) }
    var galleryFailed by remember(resource.id) { mutableStateOf(false) }
    var gallerySaved by remember(resource.id) { mutableStateOf(false) }
    var galleryNew by remember(resource.id) { mutableStateOf(false) }
    var galleryTitle by remember(resource.id) { mutableStateOf("") }
    var galleries by remember(resource.id) { mutableStateOf<List<Resource>>(emptyList()) }
    val scope = rememberCoroutineScope()
    fun loadGalleries() {
        galleryLoading = true; galleryFailed = false
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { ContentStore(context.applicationContext, databaseName).use { store ->
                val hidden = store.templateTreeIds(); store.list().filter { it.kind == "gallery" && it.id !in hidden }.sortedByDescending { it.updatedAt }
            } } }
            galleries = result.getOrDefault(emptyList()); galleryFailed = result.isFailure; galleryLoading = false
        }
    }
    fun addToGallery(target: Resource?) {
        if (galleryBusy) return
        galleryBusy = true; galleryFailed = false
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { ContentStore(context.applicationContext, databaseName).use { store ->
                if (target == null) store.createGalleryFromFile(resource.id, resource.revision, galleryTitle)
                else store.addFileToGallery(resource.id, resource.revision, target.id, target.revision)
            } } }
            galleryBusy = false; galleryFailed = result.isFailure
            if (result.isSuccess) { galleryOpen = false; galleryNew = false; gallerySaved = true }
        }
    }
    LaunchedEffect(resource.metadata, databaseName) {
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val source = attachment?.let { ContentStore(context.applicationContext, databaseName).use { store -> store.privateFile(it.id) } }
                val image = if (source != null && attachment?.mime?.startsWith("image/") == true) decodeFileImage(source, 1200) else null
                source to image
            }.getOrDefault(null to null)
        }
        file = result.first; thumbnail = result.second; loaded = true
    }
    if (confirmTrash) AlertDialog(onDismissRequest = { confirmTrash = false }, title = { Text(stringResource(R.string.move_to_trash)) }, text = { Text(stringResource(R.string.file_trash_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { confirmTrash = false; onTrash() }) { Text(stringResource(R.string.move_to_trash)) } }, dismissButton = { TextButton(onClick = { confirmTrash = false }) { Text(stringResource(R.string.cancel)) } })
    if (galleryOpen) AlertDialog(onDismissRequest = { if (!galleryBusy) { galleryOpen = false; galleryNew = false } }, title = { Text(stringResource(R.string.file_add_gallery)) }, text = {
        Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
            if (galleryLoading) CircularProgressIndicator(Modifier.padding(16.dp))
            if (galleryFailed) { Text(stringResource(R.string.file_gallery_error), color = MaterialTheme.colorScheme.error); TextButton(enabled = !galleryBusy, onClick = ::loadGalleries) { Text(stringResource(R.string.retry)) } }
            if (!galleryLoading && galleries.isEmpty() && !galleryFailed) Text(stringResource(R.string.file_gallery_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (!galleryNew) {
                galleries.forEach { gallery -> TextButton(enabled = !galleryBusy, onClick = { addToGallery(gallery) }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) { WorldsGlyph(R.drawable.ic_image); Text(gallery.title.ifBlank { stringResource(R.string.untitled) }) }
                } }
                TextButton(enabled = !galleryBusy && !galleryLoading, onClick = { galleryNew = true }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.gallery_new)) }
            } else OutlinedTextField(value = galleryTitle, onValueChange = { if (it.length <= 512) galleryTitle = it }, enabled = !galleryBusy, label = { Text(stringResource(R.string.page_title)) }, singleLine = true)
        }
    }, confirmButton = { if (galleryNew) TextButton(enabled = !galleryBusy && galleryTitle.isNotBlank(), onClick = { addToGallery(null) }) { Text(stringResource(R.string.create)) } },
        dismissButton = { TextButton(enabled = !galleryBusy, onClick = { galleryOpen = false; galleryNew = false }) { Text(stringResource(R.string.cancel)) } })
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
        Box(modifier.fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 900.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    WorldsGlyph(R.drawable.ic_file_text, tint = MaterialTheme.colorScheme.primary)
                    Text(resource.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    FilledTonalButton(enabled = !busy && file != null && attachment != null, onClick = {
                        openError = runCatching {
                            context.startActivity(fileOpenIntent(context, attachment!!, file!!))
                        }.isFailure
                    }) { WorldsActionLabel(R.drawable.ic_upload, stringResource(R.string.file_open)) }
                    TextButton(enabled = !busy && file != null, onClick = onExport) { WorldsActionLabel(R.drawable.ic_download, stringResource(R.string.file_save_copy)) }
                    if (attachment != null && (attachment.mime.startsWith("image/") || attachment.mime.startsWith("video/"))) TextButton(enabled = !busy && file != null, onClick = { galleryOpen = true; gallerySaved = false; loadGalleries() }) { WorldsActionLabel(R.drawable.ic_image, stringResource(R.string.file_add_gallery)) }
                    var menu by remember { mutableStateOf(false) }
                    Box { TextButton(enabled = !busy, onClick = { menu = true }) { WorldsActionLabel(R.drawable.ic_ellipsis_vertical, stringResource(R.string.page_actions)) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_pen_line) }, onClick = { menu = false; onRename() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.move_to_trash)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, onClick = { menu = false; confirmTrash = true })
                        }
                    }
                }
                if (openError) Text(stringResource(R.string.file_open_error), color = MaterialTheme.colorScheme.error)
                if (gallerySaved) Text(stringResource(R.string.file_gallery_success), color = MaterialTheme.colorScheme.onSurfaceVariant)
                status?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                HorizontalDivider()
                if (!loaded) Text(stringResource(R.string.file_loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else if (file == null || attachment == null) Text(stringResource(R.string.file_unavailable), color = MaterialTheme.colorScheme.error)
                else {
                    if (thumbnail != null) Image(thumbnail!!.asImageBitmap(), contentDescription = attachment.name, modifier = Modifier.fillMaxWidth().height(240.dp), contentScale = ContentScale.Fit)
                    else if (attachment.mime.startsWith("video/") || attachment.mime.startsWith("audio/")) GalleryMediaPlayer(attachment.id, attachment.mime.startsWith("video/"), databaseName)
                    else Text(stringResource(R.string.file_external_preview), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    HorizontalDivider()
                    FileFact(stringResource(R.string.file_name), attachment.name)
                    FileFact(stringResource(R.string.file_type), attachment.mime)
                    FileFact(stringResource(R.string.file_size), android.text.format.Formatter.formatFileSize(context, attachment.size))
                    FileFact(stringResource(R.string.file_added), java.text.DateFormat.getDateTimeInstance().format(java.util.Date(resource.createdAt)))
                }
            }
        }
    }
}

@Composable private fun FileFact(label: String, value: String) {
    Column { Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, style = MaterialTheme.typography.bodyLarge) }
}
