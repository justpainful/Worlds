package worlds.android

import org.junit.Assert.*
import org.junit.Test

class SharedTextPagesTest {
    @Test fun pagesPreserveUnicodeAndAllContent() {
        val text = "a".repeat(3_999) + "😀" + "مرحبا".repeat(900) + "終"
        val offsets = sharedTextPageOffsets(text)
        assertEquals(0, offsets.first())
        assertEquals(text.length, offsets.last())
        assertTrue(offsets.zipWithNext().all { (start, end) -> end > start && end - start <= 4_000 })
        assertTrue(offsets.drop(1).dropLast(1).none { text[it - 1].isHighSurrogate() && text[it].isLowSurrogate() })
        assertEquals(text, offsets.zipWithNext().joinToString("") { (start, end) -> text.substring(start, end) })
    }

    @Test fun emptyAndExactLengthProduceOnePage() {
        assertEquals(listOf(0, 0), sharedTextPageOffsets(""))
        assertEquals(listOf(0, 4_000), sharedTextPageOffsets("x".repeat(4_000)))
        assertEquals(listOf(0, 4_000, 4_001), sharedTextPageOffsets("x".repeat(4_001)))
    }

    @Test fun caretAtBoundaryStaysOnItsCurrentPage() {
        val offsets = listOf(0, 4_000, 8_000, 10_000)
        assertEquals(0, sharedTextPageForCaret(offsets, 4_000, 0))
        assertEquals(1, sharedTextPageForCaret(offsets, 4_000, 1))
        assertEquals(1, sharedTextPageForCaret(offsets, 4_001, 0))
        assertEquals(2, sharedTextPageForCaret(offsets, 10_000, 0))
    }
}
