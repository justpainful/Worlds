package worlds.android

import android.media.MediaPlayer
import android.view.SurfaceHolder
import android.view.SurfaceView
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import worlds.content.ContentStore

@Composable internal fun GalleryMediaPlayer(attachmentId: String, video: Boolean, databaseName: String) {
    val context = LocalContext.current.applicationContext
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var loaded by remember(attachmentId) { mutableStateOf(false) }
    var file by remember(attachmentId) { mutableStateOf<java.io.File?>(null) }
    var player by remember(attachmentId) { mutableStateOf<MediaPlayer?>(null) }
    var surfaceHolder by remember(attachmentId) { mutableStateOf<SurfaceHolder?>(null) }
    var ready by remember(attachmentId) { mutableStateOf(false) }
    var playing by remember(attachmentId) { mutableStateOf(false) }
    var failed by remember(attachmentId) { mutableStateOf(false) }
    var position by remember(attachmentId) { mutableIntStateOf(0) }
    var duration by remember(attachmentId) { mutableIntStateOf(0) }
    var aspect by remember(attachmentId) { mutableFloatStateOf(16f / 9f) }
    LaunchedEffect(attachmentId, databaseName) {
        file = withContext(Dispatchers.IO) { ContentStore(context, databaseName).use { it.galleryMediaFile(attachmentId) ?: it.privateFile(attachmentId) } }
        loaded = true
        if (file == null) failed = true
    }
    DisposableEffect(file, lifecycle) {
        val source = file
        val instance = if (source != null) MediaPlayer() else null
        player = instance
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP && ready && playing) {
                runCatching { instance?.pause() }; playing = false
            }
        }
        lifecycle.addObserver(observer)
        if (instance != null) {
            instance.setOnPreparedListener { media -> ready = true; duration = runCatching { media.duration }.getOrDefault(0).coerceAtLeast(0) }
            instance.setOnVideoSizeChangedListener { _, width, height -> if (width > 0 && height > 0) aspect = (width.toFloat() / height).coerceIn(0.25f, 4f) }
            instance.setOnCompletionListener { playing = false; position = duration }
            instance.setOnErrorListener { _, _, _ -> failed = true; playing = false; ready = false; true }
            runCatching { instance.setDataSource(source!!.absolutePath); instance.prepareAsync() }.onFailure { failed = true }
        }
        onDispose {
            lifecycle.removeObserver(observer)
            instance?.setOnPreparedListener(null); instance?.setOnCompletionListener(null); instance?.setOnErrorListener(null); instance?.setOnVideoSizeChangedListener(null)
            runCatching { instance?.release() }
            player = null; ready = false; playing = false
        }
    }
    LaunchedEffect(player, surfaceHolder) { runCatching { player?.setDisplay(surfaceHolder) } }
    LaunchedEffect(playing, player) {
        while (playing) {
            position = runCatching { player?.currentPosition ?: 0 }.getOrDefault(0).coerceIn(0, duration.coerceAtLeast(0))
            delay(250)
        }
    }
    Column(Modifier.fillMaxWidth()) {
        if (video) BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            val videoWidth = minOf(maxWidth, 200.dp * aspect)
            AndroidView(factory = { viewContext -> SurfaceView(viewContext).apply {
            holder.addCallback(object : SurfaceHolder.Callback {
                override fun surfaceCreated(surface: SurfaceHolder) { surfaceHolder = surface }
                override fun surfaceChanged(surface: SurfaceHolder, format: Int, width: Int, height: Int) { surfaceHolder = surface }
                override fun surfaceDestroyed(surface: SurfaceHolder) { surfaceHolder = null }
            })
            } }, modifier = Modifier.width(videoWidth).aspectRatio(aspect))
        }
        if (failed) Text(stringResource(R.string.gallery_playback_error), color = MaterialTheme.colorScheme.error)
        else if (!loaded || !ready) Text(stringResource(R.string.gallery_preparing), color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = ready && !failed, onClick = {
                val media = player ?: return@Button
                runCatching { if (playing) media.pause() else media.start(); playing = !playing }.onFailure { failed = true; playing = false }
            }) { Text(stringResource(if (playing) R.string.gallery_pause else R.string.gallery_play)) }
            Text(formatMediaTime(position) + " / " + formatMediaTime(duration), modifier = Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodySmall)
        }
        Slider(value = position.toFloat().coerceIn(0f, duration.coerceAtLeast(1).toFloat()), valueRange = 0f..duration.coerceAtLeast(1).toFloat(), enabled = ready && duration > 0,
            onValueChange = { value -> position = value.toInt(); runCatching { player?.seekTo(position) }.onFailure { failed = true } })
    }
}

private fun formatMediaTime(value: Int): String {
    val seconds = value.coerceAtLeast(0) / 1000
    return "%d:%02d".format(java.util.Locale.ROOT, seconds / 60, seconds % 60)
}
