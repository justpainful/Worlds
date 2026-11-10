package worlds.android

import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import org.junit.Assert.*
import org.junit.Test

class BlockPreviewTest {
    @Test fun searchHighlightUsesVisibleOffsetsAndPreservesExistingStyle() {
        val raw = """{"type":"paragraph","content":[{"type":"text","text":"قبل 😀 "},{"type":"mathInline","attrs":{"latex":"x^2"}},{"type":"text","text":"هدف هنا","marks":[{"type":"bold"}]}]}"""
        val match = worlds.content.PageFind.scan(listOf(worlds.content.ContentBlock("p", raw)), "هدف", false).matches.single()
        val preview = previewBlock(raw)
        val output = highlightedFindText(preview, raw, match, androidx.compose.ui.graphics.Color.Yellow)
        val range = output.spanStyles.single { it.item.background == androidx.compose.ui.graphics.Color.Yellow }
        assertEquals("هدف", output.text.substring(range.start, range.end))
        assertTrue(output.spanStyles.any { it.item.fontWeight == FontWeight.Bold && it.start <= range.start && it.end >= range.end })
        val changed = raw.replace("هدف هنا", "نص آخر")
        assertEquals(previewBlock(changed).text, highlightedFindText(previewBlock(changed), changed, match, androidx.compose.ui.graphics.Color.Yellow))
    }
    @Test fun rendersDesktopPointSizesAndRejectsUnknownCss() {
        val raw = """{"type":"paragraph","content":[{"type":"text","text":"Size","marks":[{"type":"textStyle","attrs":{"fontSize":"24pt","color":"#ff0000"}}]}]}"""
        val preview = previewBlock(raw)
        assertFalse(preview.incomplete); assertTrue(preview.hasCustomFontSize)
        assertEquals(32f, preview.text.spanStyles.single().item.fontSize.value, 0.001f)
        assertTrue(previewBlock(raw.replace("24pt", "large")).incomplete)
    }
    @Test fun rendersDesktopTextStyleAndHighlightColors() {
        val raw = """{"type":"paragraph","content":[{"type":"text","text":"Hello","marks":[{"type":"code"},{"type":"textStyle","attrs":{"color":"#64a8ff","backgroundColor":"rgba(255, 111, 111, 0.24)"}}]}]}"""
        val preview = previewBlock(raw)
        assertFalse(preview.incomplete)
        val style = preview.text.spanStyles.single().item
        assertEquals(androidx.compose.ui.graphics.Color(0xFF64A8FF), style.color)
        assertEquals(androidx.compose.ui.text.font.FontFamily.Monospace, style.fontFamily)
        assertEquals(0.24f, style.background.alpha, 0.01f)
        val highlight = previewBlock("""{"type":"paragraph","content":[{"type":"text","text":"Highlighted","marks":[{"type":"highlight"}]}]}""")
        assertFalse(highlight.incomplete); assertTrue(highlight.text.spanStyles.single().item.background.alpha > 0f)
        assertTrue(previewBlock(raw.replace("#64a8ff", "var(--unsupported)")).incomplete)
    }
    @Test fun supportedLinksAreActionableAndUnsupportedLinksStayInactive() {
        val valid = """{"type":"paragraph","content":[{"type":"text","text":"Worlds","marks":[{"type":"bold"},{"type":"link","attrs":{"href":"https://example.com/path"}}]}]}"""
        val result = previewBlock(valid)
        assertFalse(result.incomplete)
        assertEquals("https://example.com/path", (result.text.getLinkAnnotations(0, result.text.length).single().item as androidx.compose.ui.text.LinkAnnotation.Url).url)
        assertTrue(previewBlock(valid, false).text.getLinkAnnotations(0, 6).isEmpty())
        val invalid = valid.replace("https://example.com/path", "javascript:alert(1)")
        assertTrue(previewBlock(invalid).incomplete)
        assertTrue(previewBlock(invalid).text.getLinkAnnotations(0, 6).isEmpty())
    }
    @Test fun preservesCombinedStylesAndReportsUnknownMarks() {
        val paragraph = """{"type":"paragraph","content":[{"type":"text","text":"Worlds","marks":[{"type":"bold"},{"type":"italic"},{"type":"underline"},{"type":"strike"},{"type":"custom"}]}]}"""
        val preview = previewBlock(paragraph)
        assertEquals("Worlds", preview.text.text)
        assertTrue(preview.incomplete)
        val style = preview.text.spanStyles.single().item
        assertEquals(FontWeight.Bold, style.fontWeight)
        assertEquals(FontStyle.Italic, style.fontStyle)
        assertTrue(style.textDecoration!!.contains(TextDecoration.Underline))
        assertTrue(style.textDecoration!!.contains(TextDecoration.LineThrough))
        assertTrue(previewBlock("""{"type":"mermaid","attrs":{"code":"graph"}}""").incomplete)
    }
}
