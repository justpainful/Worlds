package worlds.android

import org.junit.Assert.*
import org.junit.Test

class WhatsNewTest {
    @Test fun freshInstallOnlyRemembersItsVersion() {
        assertEquals(WhatsNewStep.Remember, whatsNewStep("1.1.0", null, freshInstall = true))
    }
    @Test fun updateFromBeforeLastVersionWasKeptShows() {
        assertEquals(WhatsNewStep.Show, whatsNewStep("1.1.0", null, freshInstall = false))
    }
    @Test fun showsOncePerVersion() {
        assertEquals(WhatsNewStep.Show, whatsNewStep("1.1.0", "1.0.1", freshInstall = false))
        // After Continue the version is stored, so the next start shows nothing.
        assertEquals(WhatsNewStep.Nothing, whatsNewStep("1.1.0", "1.1.0", freshInstall = false))
        assertEquals(WhatsNewStep.Show, whatsNewStep("1.2.0", "1.1.0", freshInstall = false))
    }
    @Test fun downgradeAndBlankVersionShowNothing() {
        assertEquals(WhatsNewStep.Nothing, whatsNewStep("1.0.1", "1.1.0", freshInstall = false))
        assertEquals(WhatsNewStep.Nothing, whatsNewStep("", null, freshInstall = false))
    }
    @Test fun comparesVersionsByNumber() {
        assertTrue(versionNewer("1.10.0", "1.9.3"))
        assertTrue(versionNewer("2.0", "1.9.9"))
        assertFalse(versionNewer("1.1.0-beta.1", "1.1.0"))
        assertFalse(versionNewer("1.1.0", "1.1.0"))
    }
    @Test fun readsEachLanguageOfTheChangelogFile() {
        val raw = "version: 1.1.0\r\ntitle: عنوان || Title\r\nsummary: ملخص || Summary\r\n" +
            "feature: x :: y :: z\r\n\r\n# highlights\r\n- new: أول || First\r\n- fixed: ثاني || Second\r\n\r\n# accounts\r\n- new: لا || Not a highlight\r\n"
        val en = parseReleaseNotes(raw, arabic = false)
        assertEquals("Title", en.title)
        assertEquals("Summary", en.summary)
        assertEquals(listOf("First", "Second"), en.highlights)
        val ar = parseReleaseNotes(raw, arabic = true)
        assertEquals("عنوان", ar.title)
        assertEquals(listOf("أول", "ثاني"), ar.highlights)
    }
}
