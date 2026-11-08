package worlds.android

import android.content.res.Configuration
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import worlds.content.Resource
import java.util.Locale

class DocumentTypographyUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun arabicLargeTextControlsRemainVisibleAndSave() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val app = instrumentation.targetContext
        val light = InstrumentationRegistry.getArguments().getString("lightUi") == "1"
        val config = Configuration(app.resources.configuration).apply {
            setLocale(Locale.forLanguageTag("ar"))
            uiMode = (uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or if (light) Configuration.UI_MODE_NIGHT_NO else Configuration.UI_MODE_NIGHT_YES
            fontScale = 1.5f
        }
        val context = app.createConfigurationContext(config)
        val target = Resource("doc", "مستند", "document", null, 0.0, """{"doc":{"fontSize":12,"lineHeight":1.5}}""", "[]", 0, null, 0, 0)
        var saved: Pair<Double, Double>? = null
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalContext provides context, LocalResources provides context.resources, LocalConfiguration provides config, LocalLayoutDirection provides LayoutDirection.Rtl,
                LocalDensity provides Density(density, 1.5f)) {
                WorldsTheme { DocumentTypographyDialog(target, false, {}, { size, spacing, done -> saved = size to spacing; done(true) }) }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.document_typography)).assertIsDisplayed()
        compose.onNodeWithContentDescription(context.getString(R.string.document_body_size)).assertIsDisplayed().performSemanticsAction(SemanticsActions.SetProgress) { it(18f) }
        compose.onNodeWithContentDescription(context.getString(R.string.document_line_spacing)).assertIsDisplayed().performSemanticsAction(SemanticsActions.SetProgress) { it(2f) }
        compose.onNodeWithText(context.getString(R.string.save)).assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.cancel)).assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(500)
            instrumentation.uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-typography-ar-${if (light) "light" else "dark"}.png").close()
        }
        compose.onNodeWithText(context.getString(R.string.save)).performClick()
        compose.runOnIdle { check(saved == (18.0 to 2.0)) }
    }
}
