package worlds.android

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit
import org.json.JSONObject
import worlds.content.CodeEditing
import worlds.content.LinkAddress

internal data class BlockPreview(val text: AnnotatedString, val headingLevel: Int?, val incomplete: Boolean, val alignment: androidx.compose.ui.text.style.TextAlign? = null, val paragraphStyle: String? = null, val hasCustomFontSize: Boolean = false)

private fun cssColor(value: String): Color? {
    val hex = Regex("^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$").matchEntire(value)
    if (hex != null) {
        val source = hex.groupValues[1]
        val digits = if (source.length == 3) source.map { "$it$it" }.joinToString("") else source
        val r = digits.substring(0, 2).toInt(16); val g = digits.substring(2, 4).toInt(16); val b = digits.substring(4, 6).toInt(16)
        val a = if (digits.length == 8) digits.substring(6, 8).toInt(16) / 255f else 1f
        return Color(r / 255f, g / 255f, b / 255f, a)
    }
    val rgba = Regex("^rgba?\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})(?:\\s*,\\s*(0(?:\\.\\d+)?|1(?:\\.0+)?))?\\s*\\)$", RegexOption.IGNORE_CASE).matchEntire(value) ?: return null
    val rgb = (1..3).map { rgba.groupValues[it].toInt() }
    if (rgb.any { it > 255 }) return null
    val alpha = rgba.groupValues[4].takeIf { it.isNotEmpty() }?.toFloatOrNull() ?: 1f
    return Color(rgb[0] / 255f, rgb[1] / 255f, rgb[2] / 255f, alpha)
}

/** Read-only preview. The source JSON is never modified. */
internal fun previewBlock(raw: String, interactiveLinks: Boolean = true): BlockPreview {
    val node = JSONObject(raw)
    val type = node.optString("type")
    if (type == "codeBlock") {
        val code = runCatching { CodeEditing.read(raw) }.getOrNull() ?: return BlockPreview(AnnotatedString(""), null, true)
        return BlockPreview(AnnotatedString.Builder(code.text).apply { if (code.text.isNotEmpty()) addStyle(SpanStyle(fontFamily = FontFamily.Monospace), 0, code.text.length) }.toAnnotatedString(), null, false)
    }
    if (type != "paragraph" && type != "heading") return BlockPreview(AnnotatedString(""), null, true)
    val heading = if (type == "heading") node.optJSONObject("attrs")?.optInt("level", 1)?.coerceIn(1, 6) ?: 1 else null
    val output = AnnotatedString.Builder()
    var incomplete = false
    var hasCustomFontSize = false
    val content = node.optJSONArray("content")
    if (node.has("content") && !node.isNull("content") && content == null) incomplete = true
    if (content != null) for (index in 0 until content.length()) {
        val child = content.optJSONObject(index)
        if (child == null) { incomplete = true; continue }
        when (child.optString("type")) {
            "hardBreak" -> output.append('\n')
            "text" -> {
                if (child.opt("text") !is String) { incomplete = true; continue }
                val start = output.length
                output.append(child.optString("text", ""))
                val marks = child.optJSONArray("marks")
                if (child.has("marks") && marks == null) incomplete = true
                var bold = false; var italic = false; var code = false
                var underline = false; var strike = false
                var link: String? = null
                var foreground: Color? = null; var background: Color? = null
                var fontSize = TextUnit.Unspecified
                if (marks != null) for (i in 0 until marks.length()) {
                    val mark = marks.optJSONObject(i)
                    when (mark?.optString("type")) {
                        "bold" -> bold = true
                        "italic" -> italic = true
                        "underline" -> underline = true
                        "link" -> {
                            underline = true
                            val href = mark.optJSONObject("attrs")?.optString("href").orEmpty()
                            if (LinkAddress.isSupported(href)) link = href else incomplete = true
                        }
                        "strike" -> strike = true
                        "code" -> code = true
                        "highlight" -> {
                            val value = mark.optJSONObject("attrs")?.optString("color")?.takeIf { it.isNotBlank() && it != "null" }
                            background = if (value == null) Color(0x3DC8A27C) else cssColor(value).also { if (it == null) incomplete = true }
                        }
                        "textStyle" -> {
                            val attrs = mark.optJSONObject("attrs")
                            if (attrs == null && mark.has("attrs") && !mark.isNull("attrs")) incomplete = true
                            attrs?.let { a ->
                                for (key in listOf("color", "backgroundColor")) if (a.has(key) && !a.isNull(key)) {
                                    val parsed = (a.opt(key) as? String)?.let(::cssColor)
                                    if (parsed == null) incomplete = true else if (key == "color") foreground = parsed else background = parsed
                                }
                                if (a.has("fontSize") && !a.isNull("fontSize")) {
                                    val match = (a.opt("fontSize") as? String)?.let { Regex("^(\\d+(?:\\.\\d+)?)(pt|px)$").matchEntire(it) }
                                    val amount = match?.groupValues?.get(1)?.toFloatOrNull()
                                    if (amount == null || amount !in 1f..200f) incomplete = true else {
                                        fontSize = (amount * if (match.groupValues[2] == "pt") 4f / 3f else 1f).sp
                                        hasCustomFontSize = true
                                    }
                                }
                                if (a.keys().asSequence().any { it !in setOf("color", "backgroundColor", "fontSize") }) incomplete = true
                            }
                        }
                        else -> incomplete = true
                    }
                }
                val decorations = buildList { if (underline) add(TextDecoration.Underline); if (strike) add(TextDecoration.LineThrough) }
                if (start < output.length) output.addStyle(SpanStyle(
                    fontWeight = if (bold) FontWeight.Bold else null,
                    fontStyle = if (italic) FontStyle.Italic else null,
                    fontSize = fontSize,
                    fontFamily = if (code) FontFamily.Monospace else null,
                    color = foreground ?: Color.Unspecified,
                    background = background ?: Color.Unspecified,
                    textDecoration = if (decorations.isEmpty()) null else TextDecoration.combine(decorations),
                ), start, output.length)
                if (interactiveLinks && link != null && start < output.length) output.addLink(LinkAnnotation.Url(link), start, output.length)
            }
            else -> incomplete = true
        }
    }
    val alignmentValue = node.optJSONObject("attrs")?.optString("textAlign")
    val alignment = when (alignmentValue) {
        "left" -> androidx.compose.ui.text.style.TextAlign.Left
        "center" -> androidx.compose.ui.text.style.TextAlign.Center
        "right" -> androidx.compose.ui.text.style.TextAlign.Right
        "justify" -> androidx.compose.ui.text.style.TextAlign.Justify
        null, "", "null" -> null
        else -> { incomplete = true; null }
    }
    val paragraphStyle = if (type == "paragraph") node.optJSONObject("attrs")?.optString("pstyle")?.takeIf { it.isNotEmpty() && it != "null" } else null
    if (paragraphStyle != null && paragraphStyle !in setOf("normal", "title", "subtitle", "caption")) incomplete = true
    return BlockPreview(output.toAnnotatedString(), heading, incomplete, alignment, paragraphStyle, hasCustomFontSize)
}
