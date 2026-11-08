package worlds.android

/** UTF-16 offsets for bounded editor segments without splitting a surrogate pair. */
internal fun sharedTextPageOffsets(text: String, pageSize: Int = 4_000): List<Int> {
    require(pageSize >= 2)
    val offsets = mutableListOf(0)
    var start = 0
    while (start < text.length) {
        var end = (start + pageSize).coerceAtMost(text.length)
        if (end < text.length && text[end - 1].isHighSurrogate() && text[end].isLowSurrogate()) end--
        offsets.add(end)
        start = end
    }
    if (offsets.size == 1) offsets.add(0)
    return offsets
}

/** Keep a caret on its current page at a shared boundary when possible. */
internal fun sharedTextPageForCaret(offsets: List<Int>, caret: Int, currentPage: Int): Int {
    require(offsets.size >= 2 && caret in 0..offsets.last())
    return (0 until offsets.lastIndex).firstOrNull { page ->
        caret < offsets[page + 1] || (caret == offsets[page + 1] && page == currentPage)
    } ?: offsets.lastIndex - 1
}
