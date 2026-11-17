package worlds.android

/**
 * Reads a Mermaid flowchart as concepts and links, the same way the desktop does
 * (src/editor/conceptMap.ts), so a concept map opens as the same world here.
 *
 * Where each concept sits is kept in the diagram as Mermaid comments:
 *     %% view world
 *     %% at C0 120 -40
 */
internal enum class MapView { WORLD, DIAGRAM }

internal data class MapNode(val id: String, var label: String, var shape: String)
internal data class MapEdge(val from: String, val to: String, val label: String, val style: String)
internal data class MapPoint(val x: Float, val y: Float)

internal data class ConceptGraph(
    val direction: String,
    val nodes: List<MapNode>,
    val edges: List<MapEdge>,
    val positions: Map<String, MapPoint>,
    val view: MapView?,
    val simple: Boolean,
) {
    /** A concept map is a flowchart whose links mostly carry a linking phrase. */
    val looksLikeConceptMap: Boolean get() = edges.isNotEmpty() && edges.count { it.label.isNotBlank() } * 2 >= edges.size
    val shownView: MapView get() = view ?: if (looksLikeConceptMap) MapView.WORLD else MapView.DIAGRAM
}

internal object ConceptMap {
    private data class Shape(val name: String, val open: String, val close: String)
    private val shapes = listOf(
        Shape("stadium", "([", "])"), Shape("subroutine", "[[", "]]"), Shape("cylinder", "[(", ")]"),
        Shape("circle", "((", "))"), Shape("hexagon", "{{", "}}"), Shape("asym", ">", "]"),
        Shape("round", "(", ")"), Shape("rect", "[", "]"), Shape("rhombus", "{", "}"),
    )
    private val header = Regex("""^\s*(flowchart|graph)(?:\s+(TB|TD|BT|RL|LR))?\s*;?\s*$""", RegexOption.IGNORE_CASE)
    private val id = Regex("""^\s*([\p{L}\p{N}_][\p{L}\p{N}_]*)""")
    private val op = Regex("""^\s*(<?)(-\.+-|--+|==+)(>|x|o)?\s*(?:\|([^|]*)\|)?""")
    private val textOp = Regex("""^\s*(--|==|-\.)\s+([^|]+?)\s+(-->|---|==>|===|-\.->|-\.-)""")
    private val viewLine = Regex("""^%%\s*view\s+(world|diagram)\s*$""", RegexOption.IGNORE_CASE)
    private val atLine = Regex("""^%%\s*at\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*$""", RegexOption.IGNORE_CASE)
    private val keywords = Regex("^(subgraph|end|classDef|class|style|linkStyle|click|direction)$", RegexOption.IGNORE_CASE)

    private fun unquote(text: String): String {
        val t = text.trim()
        val q = if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t.substring(1, t.length - 1) else t
        return q.replace("#quot;", "\"").replace("#lt;", "<").replace("#gt;", ">").replace("#35;", "#")
    }

    private data class NodeRead(val node: MapNode, val labelled: Boolean, val rest: String)

    private fun readNode(src: String): NodeRead? {
        val m = id.find(src) ?: return null
        var rest = src.substring(m.value.length)
        val nodeId = m.groupValues[1]
        for (s in shapes) {
            if (!rest.startsWith(s.open)) continue
            var body = rest.substring(s.open.length)
            val label: String
            if (body.trimStart().startsWith("\"")) {
                val start = body.indexOf('"')
                val end = body.indexOf('"', start + 1)
                if (end < 0) return null
                label = body.substring(start + 1, end)
                body = body.substring(end + 1)
                val close = body.indexOf(s.close)
                if (close < 0 || body.substring(0, close).isNotBlank()) return null
                rest = body.substring(close + s.close.length)
            } else {
                val close = body.indexOf(s.close)
                if (close < 0) return null
                label = body.substring(0, close)
                rest = body.substring(close + s.close.length)
            }
            rest = rest.replace(Regex("^:::[\\w-]+"), "")
            return NodeRead(MapNode(nodeId, unquote(label), s.name), true, rest)
        }
        rest = rest.replace(Regex("^:::[\\w-]+"), "")
        return NodeRead(MapNode(nodeId, nodeId, "rect"), false, rest)
    }

    private data class OpRead(val style: String, val label: String, val rest: String)

    private fun readOp(src: String): OpRead? {
        textOp.find(src)?.let { t ->
            val style = when { t.groupValues[1] == "==" -> "thick"; t.groupValues[1] == "-." -> "dotted"; t.groupValues[3].endsWith(">") -> "arrow"; else -> "line" }
            return OpRead(style, unquote(t.groupValues[2]), src.substring(t.value.length))
        }
        val m = op.find(src) ?: return null
        val body = m.groupValues[2]
        val style = when { body.startsWith("=") -> "thick"; body.contains(".") -> "dotted"; m.groupValues[3].isNotEmpty() -> "arrow"; else -> "line" }
        return OpRead(style, unquote(m.groupValues[4]), src.substring(m.value.length))
    }

    /** A line split at the semicolons that end statements, not those inside a "label" or an entity like #quot; */
    private fun statements(line: String): List<String> {
        val out = mutableListOf<String>()
        var quoted = false
        var start = 0
        for (k in line.indices) {
            val ch = line[k]
            if (ch == '"') quoted = !quoted
            else if (ch == ';' && !quoted && !Regex("#[a-zA-Z0-9]+$").containsMatchIn(line.substring(start, k))) {
                out.add(line.substring(start, k)); start = k + 1
            }
        }
        out.add(line.substring(start))
        return out
    }

    fun parse(code: String): ConceptGraph? {
        val lines = code.replace("\r", "").split("\n")
        var i = 0
        while (i < lines.size && (lines[i].isBlank() || lines[i].trim().startsWith("%%"))) i++
        val head = header.find(lines.getOrElse(i) { "" }) ?: return null
        val nodes = mutableListOf<MapNode>()
        val byId = mutableMapOf<String, MapNode>()
        val edges = mutableListOf<MapEdge>()
        val positions = mutableMapOf<String, MapPoint>()
        var view: MapView? = null
        var simple = true
        fun note(n: MapNode, labelled: Boolean) {
            val known = byId[n.id]
            if (known == null) { byId[n.id] = n; nodes.add(n) }
            else if (labelled) { known.label = n.label; known.shape = n.shape }
        }
        fun comment(line: String) {
            val t = line.trim()
            viewLine.find(t)?.let { view = if (it.groupValues[1].equals("world", true)) MapView.WORLD else MapView.DIAGRAM }
            atLine.find(t)?.let { positions[it.groupValues[1]] = MapPoint(it.groupValues[2].toFloat(), it.groupValues[3].toFloat()) }
        }
        lines.take(i).forEach(::comment)
        for (raw in lines.drop(i + 1)) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("%%")) { comment(line); continue }
            for (statement in statements(line)) {
                if (statement.isBlank()) continue
                val first = readNode(statement)
                if (first == null) { simple = false; break }
                note(first.node, first.labelled)
                var rest = first.rest
                var from = first.node.id
                while (rest.isNotBlank()) {
                    val o = readOp(rest) ?: break
                    val next = readNode(o.rest)
                    if (next == null) { rest = o.rest; simple = false; break }
                    note(next.node, next.labelled)
                    edges.add(MapEdge(from, next.node.id, o.label, o.style))
                    from = next.node.id
                    rest = next.rest
                }
                if (rest.isNotBlank()) simple = false
            }
        }
        if (nodes.any { keywords.matches(it.id) }) simple = false
        positions.keys.retainAll(byId.keys)
        return ConceptGraph((head.groupValues[2].ifEmpty { "TD" }).uppercase(), nodes, edges, positions, view, simple)
    }

    /** Only the layout comments change; every other line stays exactly as written. */
    fun withLayout(code: String, view: MapView?, positions: Map<String, MapPoint>, order: List<String>): String {
        val kept = code.replace("\r", "").split("\n").filterNot { Regex("""^\s*%%\s*(view|at)\s""", RegexOption.IGNORE_CASE).containsMatchIn(it) }.toMutableList()
        while (kept.isNotEmpty() && kept.last().isBlank()) kept.removeAt(kept.lastIndex)
        val extra = mutableListOf<String>()
        view?.let { extra.add("%% view ${if (it == MapView.WORLD) "world" else "diagram"}") }
        for (nodeId in order) positions[nodeId]?.let { extra.add("%% at $nodeId ${Math.round(it.x)} ${Math.round(it.y)}") }
        return kept.joinToString("\n") + if (extra.isEmpty()) "" else "\n" + extra.joinToString("\n")
    }
}
