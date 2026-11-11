package worlds.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import worlds.content.Resource
import worlds.content.StreamEditing
import worlds.content.StreamInfo

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun StreamScreen(resource: Resource, busy: Boolean, onBack: () -> Unit,
    onUpdate: (Resource, String, (Boolean) -> Unit) -> Unit, onRename: () -> Unit, onTrash: () -> Unit, modifier: Modifier = Modifier) {
    val info = remember(resource.metadata) { StreamEditing.read(resource.metadata) }
    var editTarget by remember(resource.id) { mutableStateOf<Resource?>(null) }
    var trash by remember(resource.id) { mutableStateOf(false) }
    editTarget?.let { target -> StreamEditDialog(target, busy, false, { editTarget = null }) { _, url, done ->
        onUpdate(target, url) { success -> if (success) editTarget = null; done(success) }
    } }
    if (trash) AlertDialog(onDismissRequest = { trash = false }, title = { Text(stringResource(R.string.move_to_trash)) }, text = { Text(stringResource(R.string.stream_trash_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { trash = false; onTrash() }) { Text(stringResource(R.string.move_to_trash)) } }, dismissButton = { TextButton(onClick = { trash = false }) { Text(stringResource(R.string.cancel)) } })
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
        Box(modifier.fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 1000.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                WorldsBackButton(onBack)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    WorldsTile(R.drawable.pi_film, 44.dp)
                    Text(resource.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Text(stringResource(R.string.stream_external), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilledTonalButton(enabled = !busy, onClick = { editTarget = resource }) { WorldsActionLabel(R.drawable.ic_link, stringResource(R.string.stream_edit)) }
                    var menu by remember { mutableStateOf(false) }
                    Box { WorldsActionButton(enabled = !busy, onClick = { menu = true }) { WorldsActionLabel(R.drawable.ic_ellipsis_vertical, stringResource(R.string.page_actions)) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, onClick = { menu = false; onRename() })
                            DropdownMenuItem(text = { Text(stringResource(R.string.move_to_trash)) }, onClick = { menu = false; trash = true })
                        }
                    }
                }
                HorizontalDivider()
                if (info == null) Text(stringResource(R.string.stream_invalid), color = MaterialTheme.colorScheme.error)
                else {
                    Text(stringResource(when (info.format) { "hls" -> R.string.stream_hls; "dash" -> R.string.stream_dash; else -> R.string.stream_progressive }), style = MaterialTheme.typography.labelMedium)
                    if (info.url.startsWith("http://", true)) Text(stringResource(R.string.stream_http), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    StreamPlayer(info)
                }
            }
        }
    }
}

@Composable internal fun StreamEditDialog(resource: Resource?, busy: Boolean, creating: Boolean, onDismiss: () -> Unit,
    save: (String, String, (Boolean) -> Unit) -> Unit) {
    var title by rememberSaveable(resource?.id) { mutableStateOf("") }
    var url by rememberSaveable(resource?.id) { mutableStateOf(resource?.let { StreamEditing.read(it.metadata)?.url }.orEmpty()) }
    var failed by rememberSaveable(resource?.id) { mutableStateOf(false) }
    val valid = remember(url) { runCatching { StreamEditing.parseUrl(url) }.isSuccess }
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(stringResource(if (creating) R.string.stream_add else R.string.stream_edit)) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = url, onValueChange = { if (it.length <= 8192) url = it }, enabled = !busy, singleLine = true, label = { Text(stringResource(R.string.stream_link)) },
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
            if (creating) OutlinedTextField(value = title, onValueChange = { if (it.length <= 512) title = it }, enabled = !busy, singleLine = true, label = { Text(stringResource(R.string.stream_name)) }, modifier = Modifier.fillMaxWidth())
            Text(stringResource(R.string.stream_remote_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (failed) Text(stringResource(R.string.stream_save_error), color = MaterialTheme.colorScheme.error)
        }
    }, confirmButton = { TextButton(enabled = !busy && valid, onClick = { save(title, url.trim()) { failed = !it } }) { Text(stringResource(if (creating) R.string.create else R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.cancel)) } })
}

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable internal fun StreamPlayer(info: StreamInfo, onPlayer: (ExoPlayer?) -> Unit = {}) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var state by remember(info) { mutableStateOf(Player.STATE_BUFFERING) }
    var failed by remember(info) { mutableStateOf(false) }
    var retry by remember(info) { mutableIntStateOf(0) }
    val player = remember(info, retry) {
        ExoPlayer.Builder(context).build().apply {
            val builder = MediaItem.Builder().setUri(info.url)
            when (info.format) { "hls" -> builder.setMimeType(MimeTypes.APPLICATION_M3U8); "dash" -> builder.setMimeType(MimeTypes.APPLICATION_MPD) }
            setMediaItem(builder.build()); playWhenReady = false
        }
    }
    DisposableEffect(player, lifecycle) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) { state = playbackState }
            override fun onPlayerError(error: PlaybackException) { failed = true }
        }
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
        player.addListener(listener); lifecycle.addObserver(observer); onPlayer(player); player.prepare()
        onDispose { lifecycle.removeObserver(observer); player.removeListener(listener); player.release(); onPlayer(null) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AndroidView(factory = { ctx -> PlayerView(ctx).apply { this.player = player; useController = true } }, update = { it.player = player },
            modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f))
        when {
            failed -> { Text(stringResource(R.string.stream_play_error), color = MaterialTheme.colorScheme.error); TextButton(onClick = { failed = false; retry++ }) { WorldsActionLabel(R.drawable.ic_refresh_cw, stringResource(R.string.retry)) } }
            state == Player.STATE_BUFFERING || state == Player.STATE_IDLE -> Text(stringResource(R.string.stream_connecting), color = MaterialTheme.colorScheme.onSurfaceVariant)
            else -> Text(stringResource(R.string.stream_ready), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
    }
}
