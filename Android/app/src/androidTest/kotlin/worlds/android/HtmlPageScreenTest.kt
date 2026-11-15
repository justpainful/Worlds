package worlds.android

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import worlds.content.ContentStore
import worlds.content.Resource
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** The desktop's starter page (src/htmlpage/compose.ts, starterHtml "en"): a checklist kept with worlds.save. */
private const val STARTER = """<h1>My week</h1>
<div class="w-grid" style="--w-min: 160px">
  <div class="w-card w-stat"><b id="done">0</b><span>Tasks done</span></div>
  <div class="w-card w-stat"><b id="left">3</b><span>Left</span></div>
</div>
<div class="w-card">
  <h3>Today</h3>
  <label><input type="checkbox" data-task="0"> Review chapter 3</label><br>
  <label><input type="checkbox" data-task="1"> Finish homework 4</label><br>
  <label><input type="checkbox" data-task="2"> Return the library book</label>
  <div class="w-bar" id="bar" style="--value: 0; margin-top: 12px"></div>
</div>
<script>
  const boxes = [...document.querySelectorAll("[data-task]")];
  const done = new Set((worlds.state && worlds.state.done) || []);
  const show = () => {
    boxes.forEach((b) => (b.checked = done.has(Number(b.dataset.task))));
    document.getElementById("done").textContent = done.size;
    document.getElementById("left").textContent = boxes.length - done.size;
    document.getElementById("bar").style.setProperty("--value", done.size / boxes.length);
  };
  boxes.forEach((b) => b.addEventListener("change", () => {
    const n = Number(b.dataset.task);
    b.checked ? done.add(n) : done.delete(n);
    worlds.save({ done: [...done] });
    show();
  }));
  show();
</script>"""

class HtmlPageScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun webView(): WebView? {
        var found: WebView? = null
        instrumentation.runOnMainSync {
            fun search(view: View): WebView? = when (view) {
                is WebView -> view
                is ViewGroup -> (0 until view.childCount).firstNotNullOfOrNull { search(view.getChildAt(it)) }
                else -> null
            }
            found = search(compose.activity.window.decorView)
        }
        return found
    }

    /** Runs `script` in the page and returns its JSON result. */
    private fun eval(web: WebView, script: String): String {
        val latch = CountDownLatch(1)
        var result = "null"
        instrumentation.runOnMainSync { web.evaluateJavascript(script) { result = it ?: "null"; latch.countDown() } }
        check(latch.await(10, TimeUnit.SECONDS)) { "script timed out" }
        return result
    }

    private fun waitFor(timeout: Long = 20_000, what: String, detail: () -> String = { "" }, condition: () -> Boolean) {
        val end = System.currentTimeMillis() + timeout
        while (System.currentTimeMillis() < end) { if (runCatching(condition).getOrDefault(false)) return; Thread.sleep(100) }
        fail("Timed out waiting for $what ${runCatching(detail).getOrElse { it.toString() }}")
    }

    @Test fun starterPageRunsUnderTheBaseStylesKeepsTicksAndReachesNothing() {
        val app = instrumentation.targetContext
        val database = "html-page-ui-test.db"
        app.deleteDatabase(database)
        val store = ContentStore(app, database)
        val page = store.create("html", "My week", metadata = JSONObject().put("html", JSONObject().put("source", STARTER).put("state", JSONObject.NULL)).toString())
        val saved = CopyOnWriteArrayList<String>()
        var shown by mutableStateOf<Resource?>(page)
        compose.setContent {
            WorldsTheme {
                androidx.compose.material3.Surface {
                    shown?.let { resource ->
                        HtmlPageScreen(resource, false, {}, { id, state -> saved += state; store.saveHtmlState(id, state) }, {}, {}, {})
                    }
                }
            }
        }

        // Worlds' own header sits above the page.
        compose.onNodeWithText(app.getString(R.string.html_page_source_on_desktop)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.back)).assertIsDisplayed()
        // The page's own script ran.
        var web: WebView? = null
        waitFor(what = "the page's script", detail = { web?.let { eval(it, "location.href + ' ' + document.documentElement.outerHTML.length + ' ' + document.body.innerText.slice(0, 400)") } ?: "no web view" }) {
            web = webView(); web != null && eval(web!!, "document.getElementById('left').textContent") == "\"3\"" }
        val view = web!!
        // Worlds' base styles are first, and its fonts load from inside the document.
        assertEquals("\"rgb(28, 28, 30)\"", eval(view, "getComputedStyle(document.documentElement).backgroundColor"))
        eval(view, "document.fonts.load('600 16px \"W Arabic\"', 'ع').then(f => window.__fonts = f.length); 0")
        waitFor(what = "the bundled fonts") { eval(view, "window.__fonts || 0") != "0" }
        // Nothing loads from the network.
        eval(view, "fetch('https://example.com/').then(() => window.__net = 'loaded', () => window.__net = 'blocked'); 0")
        waitFor(what = "the blocked request") { eval(view, "window.__net || ''") != "\"\"" }
        assertEquals("\"blocked\"", eval(view, "window.__net"))
        // A page that sets no language gets the app's.
        val arabic = app.resources.configuration.locales[0].language == "ar"
        assertEquals(if (arabic) "\"ar rtl\"" else "\"en \"", eval(view, "document.documentElement.lang + ' ' + document.documentElement.dir"))

        // Ticking a box saves through worlds.save into the page's metadata.
        eval(view, "document.querySelector('[data-task=\"1\"]').click(); 0")
        waitFor(what = "the saved state") { saved.isNotEmpty() }
        assertEquals(JSONArray().put(1).toString(), JSONObject(saved.last()).getJSONArray("done").toString())
        val stored = requireNotNull(store.load(page.id)).resource
        assertEquals("""{"done":[1]}""", HtmlPageDocument.read(stored.metadata).second.toString())
        assertEquals(STARTER, HtmlPageDocument.read(stored.metadata).first)

        // Opening the page again shows the tick.
        compose.runOnIdle { shown = null }
        compose.waitForIdle()
        compose.runOnIdle { shown = stored }
        compose.waitForIdle()
        waitFor(what = "the reopened page", detail = { webView().let { w -> if (w == null) "no web view" else "same=${w === view} " + eval(w, "document.getElementById('done') && (document.getElementById('done').textContent + ' ' + JSON.stringify(worlds.state))") } }) {
            val again = webView()
            again != null && again !== view && eval(again, "document.querySelector('[data-task=\"1\"]').checked && document.getElementById('done').textContent") == "\"1\""
        }
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(500)
            instrumentation.uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-html-page.png").close()
        }
        store.close()
        app.deleteDatabase(database)
    }
}
