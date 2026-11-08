package worlds.android

import android.net.Uri
import android.view.LayoutInflater
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import worlds.content.ContentStore

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@Composable internal fun SlideVideo(id: String, databaseName: String, modifier: Modifier = Modifier, cover: Boolean = false, onPlayer: (ExoPlayer?) -> Unit = {}) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var loaded by remember(id, databaseName) { mutableStateOf(false) }
    var file by remember(id, databaseName) { mutableStateOf<java.io.File?>(null) }
    LaunchedEffect(id, databaseName) {
        file = withContext(Dispatchers.IO) { runCatching { ContentStore(context.applicationContext, databaseName).use { it.galleryMediaFile(id) ?: it.privateFile(id) } }.getOrNull() }
        loaded = true
    }
    Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        val source = file
        if (source != null) {
            var failed by remember(id, source) { mutableStateOf(false) }
            val player = remember(id, source) { ExoPlayer.Builder(context).build().apply { setMediaItem(MediaItem.fromUri(Uri.fromFile(source))); playWhenReady = false } }
            DisposableEffect(player, lifecycle) {
                val listener = object : Player.Listener { override fun onPlayerError(error: PlaybackException) { failed = true } }
                val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) player.pause() }
                player.addListener(listener); lifecycle.addObserver(observer); onPlayer(player); player.prepare()
                onDispose { lifecycle.removeObserver(observer); player.removeListener(listener); player.release(); onPlayer(null) }
            }
            AndroidView(factory = { ctx -> (LayoutInflater.from(ctx).inflate(R.layout.slide_video_player, null) as PlayerView).apply { this.player = player } },
                update = { it.player = player; it.resizeMode = if (cover) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT }, modifier = Modifier.fillMaxSize())
            if (failed) Text(stringResource(R.string.gallery_playback_error), color = Color.White, style = MaterialTheme.typography.labelSmall)
        } else if (loaded) Text(stringResource(R.string.gallery_playback_error), color = Color.White, style = MaterialTheme.typography.labelSmall)
    }
}
