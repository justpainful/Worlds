package worlds.android

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
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

internal fun isMathBlock(raw: String): Boolean = runCatching {
    val type = JSONObject(raw).optString("type")
    type in setOf("mathBlock", "mathInline", "katexBlock")
}.getOrDefault(false)

internal fun isMermaidBlock(raw: String): Boolean = runCatching {
    JSONObject(raw).optString("type") == "mermaid"
}.getOrDefault(false)

internal fun mathLatex(raw: String): String = runCatching {
    JSONObject(raw).optJSONObject("attrs")?.optString("latex").orEmpty()
}.getOrDefault("")

internal fun mermaidCode(raw: String): String = runCatching {
    JSONObject(raw).optJSONObject("attrs")?.optString("code").orEmpty()
}.getOrDefault("")

/**
 * Visual renderer for KaTeX / LaTeX mathematical equations.
 * Displays formatted formula preview with symbol substitutions and equation styling.
 */
@Composable
internal fun MathBlock(latex: String, display: Boolean = true, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }

    val formattedFormula = remember(latex) {
        latex
            .replace("\\frac", "")
            .replace("\\sqrt", "√")
            .replace("\\int", "∫")
            .replace("\\sum", "∑")
            .replace("\\prod", "∏")
            .replace("\\alpha", "α")
            .replace("\\beta", "β")
            .replace("\\gamma", "γ")
            .replace("\\delta", "δ")
            .replace("\\theta", "θ")
            .replace("\\lambda", "λ")
            .replace("\\mu", "μ")
            .replace("\\pi", "π")
            .replace("\\sigma", "σ")
            .replace("\\omega", "ω")
            .replace("\\infty", "∞")
            .replace("\\approx", "≈")
            .replace("\\neq", "≠")
            .replace("\\leq", "≤")
            .replace("\\geq", "≥")
            .replace("\\pm", "±")
            .replace("\\times", "×")
            .replace("\\div", "÷")
            .replace("\\cdot", "·")
            .replace("\\partial", "∂")
            .replace("{", "(")
            .replace("}", ")")
            .replace("\\,", " ")
            .replace("\\quad", "   ")
            .trim()
    }

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f), RoundedCornerShape(12.dp)),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    WorldsGlyph(R.drawable.ic_code_2, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                    Text(
                        "LaTeX Equation",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                TextButton(onClick = {
                    clipboard.setText(AnnotatedString(latex))
                    copied = true
                }) {
                    Text(if (copied) "Copied" else "Copy LaTeX", style = MaterialTheme.typography.labelSmall)
                }
            }

            Spacer(Modifier.height(8.dp))

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(8.dp))
                    .padding(vertical = 16.dp, horizontal = 20.dp),
                contentAlignment = if (display) Alignment.Center else Alignment.CenterStart
            ) {
                Text(
                    text = formattedFormula.ifBlank { "f(x) = y" },
                    style = MaterialTheme.typography.headlineSmall.copy(
                        fontFamily = FontFamily.Serif,
                        fontStyle = FontStyle.Italic
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                    textAlign = if (display) TextAlign.Center else TextAlign.Start
                )
            }
        }
    }
}

/**
 * Visual renderer for Mermaid diagrams.
 * Displays flowchart / graph structure with nodes, connector arrows, and code toggle.
 */
@Composable
internal fun MermaidBlock(code: String, modifier: Modifier = Modifier) {
    val clipboard = LocalClipboardManager.current
    var showSource by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }

    val parsedDiagram = remember(code) {
        val lines = code.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("%%") }
        val diagramType = lines.firstOrNull()?.split(" ")?.firstOrNull() ?: "graph"
        val nodes = mutableListOf<String>()
        val connections = mutableListOf<Pair<String, String>>()

        val nodeRegex = Regex("([A-Za-z0-9_]+)(?:\\[(.*?)\\])?\\s*(?:-->|---|->)\\s*([A-Za-z0-9_]+)(?:\\[(.*?)\\])?")
        lines.forEach { line ->
            val match = nodeRegex.find(line)
            if (match != null) {
                val fromId = match.groupValues[1]
                val fromLabel = match.groupValues[2].ifBlank { fromId }
                val toId = match.groupValues[3]
                val toLabel = match.groupValues[4].ifBlank { toId }
                if (fromLabel !in nodes) nodes.add(fromLabel)
                if (toLabel !in nodes) nodes.add(toLabel)
                connections.add(fromLabel to toLabel)
            }
        }
        Triple(diagramType, nodes.take(12), connections.take(12))
    }

    val (diagramType, nodes, _) = parsedDiagram

    Surface(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f), RoundedCornerShape(12.dp)),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)
    ) {
        Column(Modifier.padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    WorldsGlyph(R.drawable.ic_files, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
                    Text(
                        "Diagram (${diagramType.uppercase()})",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Row {
                    TextButton(onClick = { showSource = !showSource }) {
                        Text(if (showSource) "Diagram" else "Source", style = MaterialTheme.typography.labelSmall)
                    }
                    TextButton(onClick = {
                        clipboard.setText(AnnotatedString(code))
                        copied = true
                    }) {
                        Text(if (copied) "Copied" else "Copy", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            if (showSource) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(8.dp))
                        .padding(12.dp)
                ) {
                    Text(
                        text = code,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                }
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(8.dp))
                        .padding(16.dp),
                    contentAlignment = Alignment.Center
                ) {
                    if (nodes.isEmpty()) {
                        Text(
                            text = code.lines().take(6).joinToString("\n"),
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                    } else {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            nodes.forEachIndexed { i, nodeName ->
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = MaterialTheme.colorScheme.primary.copy(alpha = 0.15f),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.primary.copy(alpha = 0.4f)),
                                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                                ) {
                                    Text(
                                        text = nodeName,
                                        style = MaterialTheme.typography.bodyMedium,
                                        fontWeight = FontWeight.Medium,
                                        color = MaterialTheme.colorScheme.onSurface,
                                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                                    )
                                }
                                if (i < nodes.lastIndex) {
                                    WorldsGlyph(
                                        R.drawable.ic_arrow_down,
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

