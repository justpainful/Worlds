package worlds.android

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.view.MotionEvent
import android.webkit.CookieManager
import android.webkit.WebMessage
import android.webkit.WebMessagePort
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.json.JSONObject
import worlds.content.Resource
import java.io.ByteArrayInputStream

/**
 * An HTML page (docs/HTML_PAGES.md), rendered read only. The page runs in a
 * WebView with JavaScript but no network, no file or content access, no
 * storage and no JavaScript interface: it reaches Worlds only through one
 * message port, for saved state, links the person taps and other pages.
 */
@Composable internal fun HtmlPageScreen(resource: Resource, busy: Boolean, onBack: () -> Unit, onSaveState: (String, String) -> Unit, onOpenPage: (String) -> Unit,
    onRename: () -> Unit, onTrash: () -> Unit, modifier: Modifier = Modifier) {
    val (source, state) = remember(resource.metadata) { HtmlPageDocument.read(resource.metadata) }
    val lang = if (LocalConfiguration.current.locales[0]?.language == "ar") "ar" else "en"
    var trash by remember(resource.id) { mutableStateOf(false) }
    if (trash) AlertDialog(onDismissRequest = { trash = false }, title = { Text(stringResource(R.string.move_to_trash)) }, text = { Text(stringResource(R.string.html_page_trash_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { trash = false; onTrash() }) { Text(stringResource(R.string.move_to_trash)) } }, dismissButton = { TextButton(onClick = { trash = false }) { Text(stringResource(R.string.cancel)) } })
    CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) { Column(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 24.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            WorldsBackButton(onBack)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                WorldsTile(worldsTile(HtmlPageDocument.KIND), 44.dp)
                Text(resource.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                var menu by remember { mutableStateOf(false) }
                Box { WorldsActionButton(enabled = !busy, onClick = { menu = true }) { WorldsActionLabel(R.drawable.ic_ellipsis_vertical, stringResource(R.string.page_actions)) }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, onClick = { menu = false; onRename() })
                        DropdownMenuItem(text = { Text(stringResource(R.string.move_to_trash)) }, onClick = { menu = false; trash = true })
                    }
                }
            }
            Text(stringResource(R.string.html_page_source_on_desktop), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (source.isBlank()) Text(stringResource(R.string.html_page_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 24.dp))
        // A new frame only when the page itself or the language changes; saved state alone keeps the running page.
        else key(resource.id, source, lang) {
            HtmlPageFrame(resource.id, source, state, lang, { onSaveState(resource.id, it) }, onOpenPage, Modifier.fillMaxWidth().weight(1f))
        }
    } }
}

/** Base styles with the fonts inlined, and the runtime, read once from the assets the build copies from src/htmlpage. */
internal object HtmlPageAssets {
    @Volatile private var loaded: Pair<String, String>? = null
    private val FONTS = listOf("instrument-sans.woff2", "plex-arabic-400.woff2", "plex-arabic-600.woff2", "plex-mono-500.woff2")
    fun load(context: Context): Pair<String, String> = loaded ?: synchronized(this) {
        loaded ?: run {
            val assets = context.applicationContext.assets
            var css = assets.open("htmlpage/base.css").use { String(it.readBytes(), Charsets.UTF_8) }
            for (font in FONTS) {
                val data = assets.open("htmlpage/$font").use { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) }
                css = css.replace("/_w/fonts/$font", "data:font/woff2;base64,$data")
            }
            (css + EDGE to assets.open("htmlpage/runtime.js").use { String(it.readBytes(), Charsets.UTF_8) }).also { loaded = it }
        }
    }

    /** On the desktop the frame sits in the page column; full screen it needs the screen's own edge. The page's styles still win. */
    private const val EDGE = "\nbody { padding-inline: 16px; }\n"

    /** The frame's own policy, as on the desktop's whtml: protocol; fonts arrive inline. */
    const val CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; " +
        "font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"

    /**
     * Hands the runtime's messages to the port Worlds sends after the page
     * loads; until then they wait. Height reports are not needed full screen.
     */
    const val BRIDGE = """<script>(function(){var port=null,queue=[];window.addEventListener("message",function(e){var d=e.data;""" +
        """if(!port&&d==="worlds-port"&&e.ports&&e.ports.length===1){port=e.ports[0];queue.forEach(function(m){port.postMessage(m);});queue=null;e.stopImmediatePropagation();return;}""" +
        """if(e.source===window&&d&&d.worldsHtmlPage===1&&d.type!=="height"){var m=JSON.stringify(d);if(port)port.postMessage(m);else if(queue.length<64)queue.push(m);}},true);})();</script>"""

    /** An origin no request can reach: the network is blocked, and nothing is served from it. */
    const val ORIGIN = "https://page.worlds.invalid"
}

@SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
@Composable private fun HtmlPageFrame(id: String, source: String, state: Any?, lang: String, onSave: (String) -> Unit, onOpenPage: (String) -> Unit, modifier: Modifier) {
    val context = LocalContext.current
    val latestSave by rememberUpdatedState(onSave)
    val latestOpenPage by rememberUpdatedState(onOpenPage)
    val bridge = remember(id) { HtmlPageBridge(context, { latestSave(it) }, { latestOpenPage(it) }) }
    DisposableEffect(bridge) { onDispose { bridge.close() } }
    val address = "${HtmlPageAssets.ORIGIN}/page/$id"
    AndroidView(modifier = modifier, factory = { viewContext ->
        WebView(viewContext).apply {
            setBackgroundColor(0xFF1C1C1E.toInt())
            settings.apply {
                javaScriptEnabled = true
                blockNetworkLoads = true
                allowFileAccess = false
                allowContentAccess = false
                domStorageEnabled = false
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                setGeolocationEnabled(false)
                safeBrowsingEnabled = false
                mediaPlaybackRequiresUserGesture = true
            }
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
            setOnTouchListener { _, event -> if (event.actionMasked == MotionEvent.ACTION_UP) bridge.tapped(); false }
            webViewClient = object : WebViewClient() {
                // The page never navigates: links go through the runtime, everything else stays put.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
                // Nothing loads from anywhere: the document is inline and its fonts are data. Only the
                // document itself passes, which WebView loads as data under the page's address.
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.isForMainFrame && (request.url.scheme == "data" || request.url.toString() == address)) null
                    else WebResourceResponse("text/plain", "utf-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
                override fun onPageFinished(view: WebView, url: String?) { bridge.connect(view) }
            }
            val (css, runtime) = HtmlPageAssets.load(viewContext)
            val extra = "<meta http-equiv=\"Content-Security-Policy\" content=\"${HtmlPageAssets.CSP}\">${HtmlPageAssets.BRIDGE}"
            val document = HtmlPageDocument.compose(source, state, lang, css, runtime, extra)
            loadDataWithBaseURL(address, document, "text/html", "utf-8", null)
        }
    }, onRelease = { it.stopLoading(); it.destroy() })
}

/** The native end of the page's port: checks every message, keeps state after a pause, opens links only right after a tap. */
private class HtmlPageBridge(private val context: Context, private val save: (String) -> Unit, private val openPage: (String) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private var port: WebMessagePort? = null
    private var lastTap = 0L
    private var pending: String? = null
    private val flush = Runnable { pending?.let { pending = null; save(it) } }

    fun tapped() { lastTap = SystemClock.uptimeMillis() }

    fun connect(view: WebView) {
        if (port != null) return
        val (native, page) = view.createWebMessageChannel()
        native.setWebMessageCallback(object : WebMessagePort.WebMessageCallback() {
            override fun onMessage(port: WebMessagePort, message: WebMessage) { message.data?.let(::receive) }
        }, main)
        port = native
        view.postWebMessage(WebMessage("worlds-port", arrayOf(page)), Uri.parse(HtmlPageAssets.ORIGIN))
    }

    private fun receive(data: String) {
        if (data.length > 8 * HtmlPageDocument.MAX_STATE_BYTES) return
        val message = runCatching { JSONObject(data) }.getOrNull() ?: return
        if (message.optInt("worldsHtmlPage") != 1) return
        when (message.optString("type")) {
            "save" -> {
                val state = message.opt("state") as? String ?: return
                if (state.toByteArray(Charsets.UTF_8).size > HtmlPageDocument.MAX_STATE_BYTES) return
                pending = state
                main.removeCallbacks(flush)
                main.postDelayed(flush, 400)
            }
            "openPage" -> {
                val id = message.opt("id") as? String ?: return
                if (HtmlPageDocument.isPageId(id)) openPage(id)
            }
            "openLink" -> {
                val url = message.opt("url") as? String ?: return
                if (SystemClock.uptimeMillis() - lastTap > 2000) return
                val uri = Uri.parse(url)
                if (uri.scheme?.lowercase() !in setOf("http", "https", "mailto")) return
                lastTap = 0
                try { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: ActivityNotFoundException) {}
            }
        }
    }

    /** Leaving the page keeps a save that was still waiting. */
    fun close() {
        main.removeCallbacks(flush)
        flush.run()
        port?.close(); port = null
    }
}
