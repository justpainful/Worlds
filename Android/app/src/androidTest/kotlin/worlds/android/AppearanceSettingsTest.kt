package worlds.android

import android.app.Application
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import java.util.UUID

class AppearanceSettingsTest {
    @get:Rule val compose = createComposeRule()
    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application

    @Test fun libraryIconButtonsContrastWithBothBackgrounds() {
        val file = app.filesDir.resolve("library-contrast-${UUID.randomUUID()}.preferences_pb")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val store = AppearanceStore(PreferenceDataStoreFactory.create(scope = scope, produceFile = { file }))
        val database = "library-contrast-${UUID.randomUUID()}.db"
        val model = HomeModel(app, database)
        var background = Color.Unspecified
        try {
            runBlocking { store.setTheme("dark") }
            compose.setContent { WorldsTheme(store) { background = MaterialTheme.colorScheme.background; Home(model) } }
            compose.waitUntil(20_000) { !model.state.value.loading && background == Color.Black }
            fun assertIconVisible(label: Int, dark: Boolean) {
                val image = compose.onNodeWithContentDescription(app.getString(label)).captureToImage().asAndroidBitmap()
                var contrastingPixels = 0
                for (y in 0 until image.height) for (x in 0 until image.width) {
                    val pixel = image.getPixel(x, y)
                    val brightness = (android.graphics.Color.red(pixel) + android.graphics.Color.green(pixel) + android.graphics.Color.blue(pixel)) / 3
                    if (if (dark) brightness > 160 else brightness < 100) contrastingPixels++
                }
                check(contrastingPixels > 4) { "Icon $label is not visible on the ${if (dark) "dark" else "light"} background" }
            }
            assertIconVisible(R.string.appearance_title, true)
            assertIconVisible(R.string.library_more_actions, true)
            runBlocking { store.setTheme("light") }
            compose.waitUntil(20_000) { background != Color.Black }
            assertIconVisible(R.string.appearance_title, false)
            assertIconVisible(R.string.library_more_actions, false)
        } finally { model.close(); app.deleteDatabase(database); scope.cancel(); file.delete() }
    }

    @Test fun preferencesPersistAcrossStoreRecreation() = runBlocking {
        val file = app.filesDir.resolve("appearance-persistence-${UUID.randomUUID()}.preferences_pb")
        val firstScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val first = AppearanceStore(PreferenceDataStoreFactory.create(scope = firstScope, produceFile = { file }))
        try {
            first.setTheme("dark"); first.setAccent("rose"); first.setDirection("rtl"); first.setSuggestions(false)
            check(first.values.first() == AppearancePreferences("dark", "rose", "rtl", false))
            check(runCatching { first.setTheme("unknown") }.isFailure)
            check(runCatching { first.setDirection("unknown") }.isFailure)
            firstScope.coroutineContext[Job]!!.cancelAndJoin()
            val secondScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            try {
                val second = AppearanceStore(PreferenceDataStoreFactory.create(scope = secondScope, produceFile = { file }))
                check(second.values.first() == AppearancePreferences("dark", "rose", "rtl", false))
            } finally { secondScope.coroutineContext[Job]!!.cancelAndJoin() }
        } finally { firstScope.cancel(); file.delete() }
    }

    @Test fun editorSettingsChangeParagraphDirectionWithoutChangingText() {
        val file = app.filesDir.resolve("editor-settings-${UUID.randomUUID()}.preferences_pb")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val store = AppearanceStore(PreferenceDataStoreFactory.create(scope = scope, produceFile = { file }))
        val database = "editor-settings-${UUID.randomUUID()}.db"
        val model = HomeModel(app, database)
        val page = worlds.content.ContentStore(app, database).use { it.create("page", "Bilingual") }
        try {
            compose.setContent { WorldsTheme(store) { Home(model) } }
            compose.waitUntil(20_000) { !model.state.value.loading }
            compose.onNodeWithContentDescription(app.getString(R.string.appearance_title)).performClick()
            compose.onNodeWithText(app.getString(R.string.editor_direction_rtl)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.editor_suggestions)).performScrollTo().performClick()
            compose.waitUntil(20_000) { runBlocking { store.values.first().direction == "rtl" && !store.values.first().suggestions } }
            compose.onNodeWithText(app.getString(R.string.editor_direction_rtl)).performScrollTo().assertIsSelected()
            compose.onNodeWithText(app.getString(R.string.editor_suggestions)).performScrollTo().assertIsOff()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(300)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-editor-settings.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            }
            compose.onNodeWithText(app.getString(R.string.back)).performScrollTo().performClick()
            model.open(page.id); compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
            compose.onNodeWithText(app.getString(R.string.insert_block)).performClick()
            compose.onNodeWithText(app.getString(R.string.add_paragraph)).performScrollTo().performClick()
            val input = compose.onNodeWithText(app.getString(R.string.text_content))
            input.performTextInput("English 123 مرحبا")
            val layout = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            input.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { action -> check(action(layout)) }
            check(layout.isNotEmpty() && layout.first().getParagraphDirection(0) == androidx.compose.ui.text.style.ResolvedTextDirection.Rtl)
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.any { it.content.contains("English 123 مرحبا") } }
        } finally { model.close(); app.deleteDatabase(database); scope.cancel(); file.delete() }
    }

    @Test fun automaticDirectionFollowsEachParagraph() {
        val text = "Hello world\nمرحبا بالعالم"
        val initial = org.json.JSONObject().put("type", "paragraph").put("content", org.json.JSONArray().put(org.json.JSONObject().put("type", "text").put("text", text))).toString()
        val target = EditorTarget("page", "block", 0, initial, false)
        compose.setContent { WorldsTheme { CompositionLocalProvider(LocalAppearancePreferences provides AppearancePreferences(direction = "auto")) {
            InlineEditorDialog(target, false, false, {}, {})
        } } }
        val layouts = mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        compose.onNodeWithText(app.getString(R.string.text_content)).performSemanticsAction(SemanticsActions.GetTextLayoutResult) { action -> check(action(layouts)) }
        check(layouts.first().getParagraphDirection(0) == androidx.compose.ui.text.style.ResolvedTextDirection.Ltr)
        check(layouts.first().getParagraphDirection(text.indexOf('م')) == androidx.compose.ui.text.style.ResolvedTextDirection.Rtl)
    }

    @Test fun appearanceScreenSupportsArabicRtl() {
        val file = app.filesDir.resolve("appearance-ar-${UUID.randomUUID()}.preferences_pb")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val store = AppearanceStore(PreferenceDataStoreFactory.create(scope = scope, produceFile = { file }))
        val config = android.content.res.Configuration(app.resources.configuration).apply { setLocale(java.util.Locale("ar")) }
        val localized = app.createConfigurationContext(config)
        try {
            compose.setContent {
                CompositionLocalProvider(LocalContext provides localized, LocalLayoutDirection provides LayoutDirection.Rtl) {
                    WorldsTheme(store) { AppearanceSettings(onBack = {}) }
                }
            }
            compose.onNodeWithText(localized.getString(R.string.appearance_title)).assertIsDisplayed()
            compose.onNodeWithText(localized.getString(R.string.appearance_system)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(300)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-appearance-ar.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
                compose.onNodeWithText(localized.getString(R.string.editor_suggestions)).performScrollTo()
                compose.waitForIdle(); Thread.sleep(300)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-editor-settings-ar.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            }
        } finally { scope.cancel(); file.delete() }
    }

    @Test fun settingsChangeThemeAndAccentAndPersist() {
        val file = app.filesDir.resolve("appearance-test-${UUID.randomUUID()}.preferences_pb")
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val data = PreferenceDataStoreFactory.create(scope = scope, produceFile = { file })
        val store = AppearanceStore(data)
        val database = "appearance-test-${UUID.randomUUID()}.db"
        val model = HomeModel(app, database)
        var primary = Color.Unspecified
        try {
            compose.setContent { WorldsTheme(store) { primary = MaterialTheme.colorScheme.primary; Home(model) } }
            compose.waitUntil(20_000) { !model.state.value.loading }
            compose.onNodeWithContentDescription(app.getString(R.string.appearance_title)).performClick()
            compose.onNodeWithText(app.getString(R.string.appearance_dark)).performClick()
            compose.waitUntil(20_000) { runBlocking { store.values.first().theme == "dark" } }
            compose.onNodeWithText(app.getString(R.string.appearance_sky)).performScrollTo().performClick()
            compose.waitUntil(20_000) { runBlocking { store.values.first().accent == "sky" } }
            compose.waitUntil(20_000) { primary == appearanceAccents.first { it.id == "sky" }.dark }
            compose.onNodeWithText(app.getString(R.string.appearance_sky)).assertIsSelected()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(300)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-appearance.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            }
            compose.onNodeWithText(app.getString(R.string.appearance_light)).performScrollTo().performClick()
            compose.waitUntil(20_000) { primary == appearanceAccents.first { it.id == "sky" }.light }
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(300)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-appearance-light.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            }
            check(runBlocking { store.values.first() } == AppearancePreferences("light", "sky"))
            compose.onNodeWithText(app.getString(R.string.back)).performClick()
            compose.onNodeWithContentDescription(app.getString(R.string.appearance_title)).performClick()
            compose.onNodeWithText(app.getString(R.string.appearance_light)).assertIsSelected()
            compose.onNodeWithText(app.getString(R.string.appearance_sky)).performScrollTo().assertIsSelected()
        } finally {
            model.close(); app.deleteDatabase(database); scope.cancel(); file.delete()
        }
    }
}
