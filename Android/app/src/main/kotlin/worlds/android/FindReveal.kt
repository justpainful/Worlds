package worlds.android

import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import org.json.JSONObject
import worlds.content.PageMatch

@Composable internal fun findRevealModifier(match: PageMatch?): Modifier {
    if (match == null) return Modifier
    val requester = remember(match) { BringIntoViewRequester() }
    LaunchedEffect(requester) { withFrameNanos { }; requester.bringIntoView() }
    return Modifier.bringIntoViewRequester(requester).testTag("find-revealed-match")
}

internal fun highlightedFindText(preview: BlockPreview, raw: String, match: PageMatch?, color: Color): AnnotatedString {
    if (match == null) return preview.text
    return runCatching {
        val children = JSONObject(raw).getJSONArray("content")
        require(match.runIndex in 0 until children.length())
        var offset = 0
        for (index in 0 until match.runIndex) {
            val child = children.optJSONObject(index) ?: continue
            when (child.optString("type")) {
                "text" -> if (child.opt("text") is String) offset += child.getString("text").length
                "hardBreak" -> offset++
            }
        }
        val run = children.getJSONObject(match.runIndex).getString("text")
        require(match.start >= 0 && match.end <= run.length && match.start < match.end)
        require(run.substring(match.start, match.end) == match.context.substring(match.contextStart, match.contextEnd))
        val start = offset + match.start; val end = offset + match.end
        require(end <= preview.text.length)
        buildAnnotatedString { append(preview.text); addStyle(SpanStyle(background = color), start, end) }
    }.getOrDefault(preview.text)
}
