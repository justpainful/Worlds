package worlds.android

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextInputSelection
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference
import worlds.content.CodeEditing
import worlds.content.InlineEditing

@RunWith(AndroidJUnit4::class)
class EditorKeyboardTest {
    @get:Rule val compose = createComposeRule()
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun key(code: Int, meta: Int) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val now = android.os.SystemClock.uptimeMillis()
        instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_DOWN, code, 0, meta))
        instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_UP, code, 0, meta))
        compose.waitForIdle()
    }

    @Test fun inlineEditorSavesWithCtrlSAndDoesNotSaveFromDiscardConfirmation() {
        val original = """{"type":"paragraph","content":[{"type":"text","text":"Original","marks":[{"type":"bold"}]}]}"""
        val saved = AtomicReference<String>()
        compose.setContent { WorldsTheme { InlineEditorDialog(EditorTarget("page", "block", 0, original, false), false, false, {}, saved::set) } }
        compose.onNodeWithText(app.getString(R.string.text_content)).performClick().performTextInput(" added")
        val ctrl = android.view.KeyEvent.META_CTRL_ON
        key(android.view.KeyEvent.KEYCODE_S, ctrl or android.view.KeyEvent.META_SHIFT_ON)
        assertEquals(null, saved.get())
        compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
        compose.onNodeWithText(app.getString(R.string.discard_title)).assertIsDisplayed()
        key(android.view.KeyEvent.KEYCODE_S, ctrl)
        assertEquals(null, saved.get())
        compose.onNodeWithText(app.getString(R.string.keep_editing)).performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performClick()
        key(android.view.KeyEvent.KEYCODE_S, ctrl)
        assertTrue(InlineEditing.text(saved.get()).contains(" added"))
        assertTrue(saved.get().contains("bold"))
    }

    @Test fun codeEditorSavesContentAndLanguageWithCtrlS() {
        val original = """{"type":"codeBlock","attrs":{"language":"kotlin"},"content":[{"type":"text","text":"val a = 1"}]}"""
        val saved = AtomicReference<String>()
        compose.setContent { WorldsTheme { CodeEditorDialog(EditorTarget("page", "code", 0, original, false), false, false, {}, saved::set) } }
        compose.onNodeWithText(app.getString(R.string.code_content)).performClick().performTextInput(" + 2")
        key(android.view.KeyEvent.KEYCODE_S, android.view.KeyEvent.META_CTRL_ON)
        assertTrue(CodeEditing.read(saved.get()).text.contains(" + 2"))
        assertEquals("kotlin", CodeEditing.read(saved.get()).language)
    }

    @Test fun formattingIsShownWhileEditingAndSelectionStaysCorrect() {
        val original = """{"type":"paragraph","content":[{"type":"text","text":"Bold 😀 ","marks":[{"type":"bold"}]},{"type":"text","text":"مرحبا","marks":[{"type":"italic"}]}]}"""
        val visual = inlineVisualTransformation(original)
        val transformed = visual.filter(AnnotatedString("Bold 😀 مرحبا"))
        assertEquals("Bold 😀 مرحبا", transformed.text.text)
        assertTrue(transformed.text.spanStyles.any { it.item.fontWeight == FontWeight.Bold && it.start == 0 && it.end == 8 })
        assertTrue(transformed.text.spanStyles.any { it.item.fontStyle == FontStyle.Italic && it.start == 8 && it.end == 13 })
        assertEquals(7, transformed.offsetMapping.originalToTransformed(7))
        assertEquals(7, transformed.offsetMapping.transformedToOriginal(7))
        assertTrue(visual.filter(AnnotatedString("changed")).text.spanStyles.isEmpty())
        val saved = AtomicReference<String>()
        compose.setContent { WorldsTheme { InlineEditorDialog(EditorTarget("page", "format", 0, original, false), false, false, {}, saved::set) } }
        compose.onNodeWithText(app.getString(R.string.text_content)).performClick()
        if (InstrumentationRegistry.getArguments().getString("captureUi") == "1") {
            compose.waitForIdle(); Thread.sleep(1000)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-inline-formatted-editor.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.text_content)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.save)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInputSelection(TextRange(8, 13))
        compose.onNodeWithText(app.getString(R.string.underline)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performScrollTo().performClick()
        key(android.view.KeyEvent.KEYCODE_S, android.view.KeyEvent.META_CTRL_ON)
        assertEquals("Bold 😀 مرحبا", InlineEditing.text(saved.get()))
        assertTrue(InlineEditing.hasMark(saved.get(), 8, 13, "underline"))
        assertTrue(InlineEditing.hasMark(saved.get(), 8, 13, "italic"))
        assertTrue(InlineEditing.hasMark(saved.get(), 0, 8, "bold"))
    }

    @Test fun keyboardHelperListsSaveShortcut() {
        val item = editorKeyboardShortcutGroup(app).items.single()
        assertEquals(android.view.KeyEvent.KEYCODE_S, item.keycode)
        assertEquals(android.view.KeyEvent.META_CTRL_ON, item.modifiers)
    }
}
