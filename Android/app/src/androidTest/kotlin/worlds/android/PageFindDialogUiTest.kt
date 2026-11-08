package worlds.android

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import worlds.content.ContentBlock
import worlds.content.Resource
import worlds.content.ResourceDocument
import java.util.Locale

class PageFindDialogUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun arabicLargeTextCanNavigateAndRevealMatch() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext
        val config = Configuration(app.resources.configuration).apply { setLocale(Locale.forLanguageTag("ar")); fontScale = 1.5f }
        val context = app.createConfigurationContext(config)
        val resource = Resource("doc", "صفحة", "page", null, 0.0, "{}", "[]", 1, null, 0, 0)
        val blocks = listOf(ContentBlock("one", """{"type":"paragraph","content":[{"type":"text","text":"هذه تجربة أولى"}]}"""),
            ContentBlock("two", """{"type":"paragraph","content":[{"type":"text","text":"هذه تجربة ثانية"}]}"""))
        var shown: String? = null
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalContext provides context, LocalResources provides context.resources, LocalConfiguration provides config,
                LocalLayoutDirection provides LayoutDirection.Rtl, LocalDensity provides Density(density, 1.5f)) {
                val session = remember { PageFindSession("تجربة") }
                WorldsTheme { PageFindDialog(ResourceDocument(resource, blocks), session, false, {}, { _, _, _, _, _, done -> done(null) }) { _, match -> shown = match.blockId; true } }
            }
        }
        compose.waitUntil(20_000) { compose.onAllNodesWithText(context.getString(R.string.find_count, 1, 2)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(context.getString(R.string.find_next)).performScrollTo().performSemanticsAction(SemanticsActions.OnClick) { check(it()) }
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithText(context.getString(R.string.find_count, 2, 2)).performScrollTo().assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText(context.getString(R.string.find_show_block)).performScrollTo().assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(500)
            instrumentation.uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-find-ar-large.png").close()
        }
        compose.onNodeWithText(context.getString(R.string.find_show_block)).performClick()
        compose.runOnIdle { check(shown == "two") }
    }
}
