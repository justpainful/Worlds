package worlds.android

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import worlds.content.StreamInfo
import java.util.concurrent.atomic.AtomicBoolean

@RunWith(AndroidJUnit4::class)
class StreamPlayerTest {
    @get:Rule val compose = createComposeRule()
    @Test fun localProgressiveStreamActuallyStartsAndPauses() {
        val data = InstrumentationRegistry.getInstrumentation().context.assets.open("gallery-video.mp4").use { it.readBytes() }
        val server = MockWebServer(); repeat(10) { server.enqueue(MockResponse().setHeader("Content-Type", "video/mp4").setBody(Buffer().write(data))) }; server.start()
        val url = server.url("/clip.mp4").toString()
        val ready = AtomicBoolean(false); val playing = AtomicBoolean(false)
        var player: ExoPlayer? = null
        try {
            compose.setContent { WorldsTheme { StreamPlayer(StreamInfo(url, "progressive")) { current ->
                player = current
                current?.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(state: Int) { ready.set(state == Player.STATE_READY) }
                    override fun onIsPlayingChanged(value: Boolean) { playing.set(value) }
                })
            } } }
            compose.waitUntil(30_000) { ready.get() }
            compose.runOnIdle { checkNotNull(player).play() }
            compose.waitUntil(15_000) { playing.get() }
            compose.runOnIdle { checkNotNull(player).pause() }
            compose.waitUntil(15_000) { !playing.get() }
        } finally { server.shutdown() }
    }
}
