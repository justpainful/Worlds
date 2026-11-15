package worlds.android

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class HtmlPageDocumentTest {
    private fun compose(source: String, state: Any? = null, lang: String = "en") =
        HtmlPageDocument.compose(source, state, lang, "/*base*/", "/*runtime*/", "<meta data-extra>")

    @Test fun fragmentGetsTheAppLanguageAndTheBaseFirst() {
        val doc = compose("<p>Hello</p>", lang = "ar")
        assertTrue(doc.startsWith("<!doctype html><html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\">"))
        assertTrue(doc.indexOf("<meta data-extra>") < doc.indexOf("data-worlds-base"))
        assertTrue(doc.indexOf("data-worlds-base") < doc.indexOf("/*runtime*/"))
        assertTrue(doc.indexOf("/*runtime*/") < doc.indexOf("<p>Hello</p>"))
        assertTrue(compose("<p>x</p>", lang = "de").startsWith("<!doctype html><html lang=\"en\"><head>"))
    }

    @Test fun fullDocumentKeepsItsOwnLanguageAndStylesWin() {
        val doc = compose("<!DOCTYPE html><HTML Lang=\"en\"><Head><title>T</title><style>p{}</style></head><body><p>x</p></body></html>",
            JSONObject().put("n", 1), "ar")
        assertTrue(doc.startsWith("<!DOCTYPE html><HTML Lang=\"en\"><Head>"))
        assertFalse(doc.contains("dir=\"rtl\""))
        val base = doc.indexOf("data-worlds-base")
        assertTrue(base > doc.indexOf("<Head>") && base < doc.indexOf("<title>"))
        assertTrue(doc.contains("\"state\":{\"n\":1}"))
    }

    @Test fun documentWithoutLanguageOrHeadGetsBoth() {
        val doc = compose("<html class=\"x\"><body><header>h</header></body></html>", lang = "ar")
        assertTrue(doc.startsWith("<!doctype html><html class=\"x\" lang=\"ar\" dir=\"rtl\"><head><meta charset"))
        assertTrue(doc.contains("</head><body><header>h</header>"))
        // A data-lang attribute is not the page's language.
        assertTrue(compose("<html data-lang=\"fr\"><p>x</p></html>").contains("<html data-lang=\"fr\" lang=\"en\">"))
    }

    @Test fun savedStateCannotCloseTheBootScript() {
        val doc = compose("<p>x</p>", "</script><script>alert(1)</script>")
        assertFalse(doc.contains("</script><script>alert(1)"))
        val boot = Regex("window.__worldsBoot=(.*?);</script>").find(doc)!!.groupValues[1]
        assertEquals("</script><script>alert(1)</script>", JSONObject(boot).getString("state"))
        assertEquals("en", JSONObject(boot).getString("lang"))
    }

    @Test fun nonAsciiBeforeTheTagKeepsIndexes() {
        val doc = compose("<!-- İİİ عربي --><html><head></head><body>ok</body></html>")
        assertTrue(doc.contains("<!-- İİİ عربي --><html lang=\"en\"><head><meta charset"))
        assertTrue(doc.endsWith("</head><body>ok</body></html>"))
    }

    @Test fun readsSourceAndStateFromMetadata() {
        assertEquals("<p>a</p>" to null, HtmlPageDocument.read("""{"html":{"source":"<p>a</p>","state":null}}"""))
        val (source, state) = HtmlPageDocument.read("""{"html":{"source":"s","state":{"done":[1]}}}""")
        assertEquals("s", source); assertEquals("""{"done":[1]}""", state.toString())
        assertEquals("" to null, HtmlPageDocument.read("not json"))
        assertTrue(HtmlPageDocument.isPageId("a1_B-2")); assertFalse(HtmlPageDocument.isPageId("../x")); assertFalse(HtmlPageDocument.isPageId(""))
    }

    @Test fun sharedRuntimeStillSpeaksTheMessagesTheBridgeExpects() {
        val runtime = File("../../src/htmlpage/runtime.js").readText()
        listOf("worldsHtmlPage = 1", "type: \"save\"", "type: \"openPage\"", "type: \"openLink\"", "window.__worldsBoot").forEach { assertTrue(it, runtime.contains(it)) }
        val css = File("../../src/htmlpage/base.css").readText()
        listOf("instrument-sans.woff2", "plex-arabic-400.woff2", "plex-arabic-600.woff2", "plex-mono-500.woff2").forEach { assertTrue(it, css.contains("/_w/fonts/$it")) }
    }
}
