package worlds.android

import android.graphics.BitmapFactory
import android.util.Base64
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.zip.GZIPInputStream
import org.json.JSONTokener
import java.util.zip.GZIPOutputStream

/** Version 2 Worlds drawing package for the supported local stroke journal. */
internal object DrawingPackage {
    private const val MAX_HISTORY = 500
    private const val MAX_BYTES = 64 * 1024 * 1024
    private val header = "WORLDSDRAW1\n".toByteArray(Charsets.UTF_8)
    class HistoryLimit : IllegalArgumentException("Portable history limit exceeded")

    fun encode(document: String): ByteArray {
        if (document.toByteArray(Charsets.UTF_8).size > MAX_BYTES) throw HistoryLimit()
        val doc = JSONObject(document)
        verify(doc)
        val scene = doc.getJSONObject("scene")
        val payload = JSONObject().put("format", "worldsdraw").put("version", 2).put("scene", scene)
            .put("assets", JSONArray()).put("versions", JSONObject()).put("history", doc)
        val raw = payload.toString().toByteArray(Charsets.UTF_8)
        if (raw.size > MAX_BYTES) throw HistoryLimit()
        return ByteArrayOutputStream().use { output ->
            output.write(header)
            GZIPOutputStream(output).use { it.write(raw) }
            output.toByteArray()
        }
    }

    private fun verify(doc: JSONObject) {
        require(keys(doc) == setOf("revision", "seed", "scene", "operations")) { "Unsupported drawing document" }
        val operations = doc.getJSONArray("operations")
        if (operations.length() > MAX_HISTORY) throw HistoryLimit()
        require(doc.getDouble("revision") == operations.length().toDouble()) { "Invalid drawing revision" }
        val seed = doc.getJSONObject("seed")
        verifySeed(seed)
        val seedNodes = seed.getJSONObject("nodes")
        val seedOrder = seed.getJSONArray("nodeOrder")
        require(seedOrder.length() == seedNodes.length())
        val seedIds = mutableSetOf<String>()
        for (index in 0 until seedOrder.length()) {
            val id = seedOrder.getString(index)
            require(safeId(id) && seedIds.add(id))
            val node = seedNodes.getJSONObject(id)
            require(node.getString("id") == id)
            verifyNode(node)
        }
        DrawingInk.parse(JSONObject().put("scene", seed).toString())
        val current = JSONObject(seed.toString())
        val edits = mutableListOf<JSONObject>()
        val enabled = mutableMapOf<String, Boolean>()
        val owners = mutableMapOf<String, String>()
        val ids = mutableSetOf<String>()
        val nodeIds = seedIds.toMutableSet()
        for (index in 0 until operations.length()) {
            val op = operations.getJSONObject(index)
            val id = op.getString("id")
            val actor = op.getString("actor")
            require(safeId(id) && ids.add(id) && safeId(actor) && op.getDouble("base") == index.toDouble())
            require(op.getDouble("at").isFinite() && op.getString("label").isNotBlank())
            when (op.getString("type")) {
                "edit" -> {
                    require(keys(op) == setOf("id", "actor", "base", "at", "label", "type", "changes"))
                    val changes = op.getJSONArray("changes")
                    require(changes.length() in 1..1001)
                    if (changes.getJSONObject(0).optString("type") == "patch") {
                        val patched = mutableSetOf<String>()
                        for (i in 0 until changes.length()) {
                            val patch = changes.getJSONObject(i)
                            require(keys(patch) == setOf("type", "collection", "id", "fields") && patch.getString("type") == "patch" && patch.getString("collection") == "nodes")
                            val nodeId = patch.getString("id"); val fields = patch.getJSONObject("fields")
                            require(patched.add(nodeId) && current.getJSONObject("nodes").has(nodeId) && keys(fields) == setOf("x", "y"))
                            require(fields.getDouble("x").isFinite() && fields.getDouble("y").isFinite())
                            current.getJSONObject("nodes").getJSONObject(nodeId).put("x", fields.getDouble("x")).put("y", fields.getDouble("y"))
                        }
                    } else if (changes.getJSONObject(0).optString("type") == "remove") {
                        require(changes.length() >= 2)
                        val removed = mutableSetOf<String>()
                        for (i in 0 until changes.length() - 1) {
                            val change = changes.getJSONObject(i); val nodeId = change.getString("id")
                            require(keys(change) == setOf("type", "collection", "id") && change.getString("type") == "remove" && change.getString("collection") == "nodes")
                            require(removed.add(nodeId) && current.getJSONObject("nodes").has(nodeId))
                        }
                        val order = changes.getJSONObject(changes.length() - 1)
                        require(keys(order) == setOf("type", "list", "ids") && order.getString("type") == "order" && order.getString("list") == "nodeOrder")
                        val previous = current.getJSONArray("nodeOrder"); val expected = JSONArray()
                        for (i in 0 until previous.length()) if (previous.getString(i) !in removed) expected.put(previous.getString(i))
                        require(expected.length() + removed.size == previous.length() && equalJson(expected, order.getJSONArray("ids")))
                        removed.forEach { current.getJSONObject("nodes").remove(it) }; current.put("nodeOrder", expected)
                    } else {
                        require(changes.length() in 2..1001)
                        val order = changes.getJSONObject(changes.length() - 1)
                        val expected = JSONArray(current.getJSONArray("nodeOrder").toString())
                        for (i in 0 until changes.length() - 1) {
                            val put = changes.getJSONObject(i); val nodeId = put.getString("id"); val node = put.getJSONObject("value")
                            require(keys(put) == setOf("type", "collection", "id", "value") && put.getString("type") == "put" && put.getString("collection") == "nodes")
                            require(safeId(nodeId) && nodeIds.add(nodeId) && node.getString("id") == nodeId)
                            verifyNode(node)
                            val one = JSONObject(seed.toString()); one.put("nodes", JSONObject().put(nodeId, node)); one.put("nodeOrder", JSONArray().put(nodeId))
                            DrawingInk.parse(JSONObject().put("scene", one).toString())
                            current.getJSONObject("nodes").put(nodeId, JSONObject(node.toString())); expected.put(nodeId)
                        }
                        require(keys(order) == setOf("type", "list", "ids") && order.getString("type") == "order" && order.getString("list") == "nodeOrder")
                        require(equalJson(expected, order.getJSONArray("ids"))) { "Invalid drawing order" }
                        current.put("nodeOrder", expected)
                    }
                    edits.add(op); owners[id] = actor; enabled[id] = true
                }
                "toggle" -> {
                    require(keys(op) == setOf("id", "actor", "base", "at", "label", "type", "target", "enabled"))
                    val target = op.getString("target")
                    require(owners[target] == actor && enabled.containsKey(target)) { "Invalid drawing history author" }
                    enabled[target] = op.getBoolean("enabled")
                    val rebuilt = replay(seed, edits, enabled)
                    current.put("nodes", rebuilt.getJSONObject("nodes")); current.put("nodeOrder", rebuilt.getJSONArray("nodeOrder"))
                }
                else -> error("Unsupported drawing history")
            }
        }
        val scene = doc.getJSONObject("scene")
        require(equalJson(current, scene)) { "History does not match drawing" }
        DrawingInk.parse(doc.toString())
    }

    /** Read only packages whose complete scene and history this editor can preserve. */
    fun decode(input: InputStream): String {
        val compressed = input.use { boundedRead(it) }
        require(compressed.size > header.size && compressed.copyOfRange(0, header.size).contentEquals(header)) { "Invalid drawing package" }
        val raw = GZIPInputStream(compressed.inputStream(header.size, compressed.size - header.size)).use { boundedRead(it) }
        val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val json = decoder.decode(ByteBuffer.wrap(raw)).toString()
        val parser = JSONTokener(json)
        val payload = parser.nextValue() as? JSONObject ?: error("Invalid drawing package")
        require(parser.nextClean() == '\u0000') { "Invalid drawing package" }
        val payloadKeys = keys(payload)
        require(payloadKeys.containsAll(setOf("format", "version", "scene", "assets")) &&
            payloadKeys.all { it in setOf("format", "version", "scene", "assets", "versions", "history", "preview") }) { "Unsupported drawing package" }
        val version = payload.getDouble("version")
        require(payload.getString("format") == "worldsdraw" && version in setOf(1.0, 2.0)) { "Unsupported drawing package" }
        require(payload.getJSONArray("assets").length() == 0 && (!payload.has("versions") || payload.getJSONObject("versions").length() == 0)) { "Unsupported drawing package" }
        if (payload.has("preview")) verifyPreview(payload.getJSONObject("preview"))
        val scene = payload.getJSONObject("scene")
        val doc = if (payload.has("history")) {
            require(version == 2.0)
            payload.getJSONObject("history").also { require(equalJson(scene, it.getJSONObject("scene"))) { "Scene does not match history" } }
        } else {
            require(version == 1.0)
            JSONObject().put("revision", 0).put("seed", scene).put("scene", JSONObject(scene.toString())).put("operations", JSONArray())
        }
        verify(doc)
        return doc.toString()
    }

    private fun verifyPreview(preview: JSONObject) {
        require(keys(preview) == setOf("mime", "width", "height", "sha256", "data"))
        require(preview.getString("mime") == "image/png")
        val width = preview.getInt("width"); val height = preview.getInt("height")
        require(width in 1..320 && height in 1..180)
        val encoded = preview.getString("data"); require(encoded.length <= 4 * 1024 * 1024)
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        require(bytes.size >= 24 && bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10)))
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
        require(digest == preview.getString("sha256"))
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        require(options.outMimeType == "image/png" && options.outWidth == width && options.outHeight == height)
    }

    /** Replay append-only strokes using the desktop's order reconciliation. */
    internal fun replay(seed: JSONObject, edits: List<JSONObject>, enabled: Map<String, Boolean>): JSONObject {
        val scene = JSONObject(seed.toString())
        val nodes = scene.getJSONObject("nodes")
        for (op in edits) {
            if (enabled[op.getString("id")] != true) continue
            val changes = op.getJSONArray("changes")
            val put = changes.getJSONObject(0)
            if (put.getString("type") == "patch") {
                for (i in 0 until changes.length()) {
                    val change = changes.getJSONObject(i); val node = nodes.getJSONObject(change.getString("id")); val fields = change.getJSONObject("fields")
                    node.put("x", fields.getDouble("x")).put("y", fields.getDouble("y"))
                }
                continue
            }
            if (put.getString("type") == "remove") { for (i in 0 until changes.length() - 1) nodes.remove(changes.getJSONObject(i).getString("id")) }
            else for (i in 0 until changes.length() - 1) {
                val change = changes.getJSONObject(i); val newId = change.getString("id")
                require(!nodes.has(newId)); nodes.put(newId, JSONObject(change.getJSONObject("value").toString()))
            }
            val desired = changes.getJSONObject(changes.length() - 1).getJSONArray("ids")
            val selected = mutableListOf<String>()
            for (i in 0 until desired.length()) {
                val candidate = desired.getString(i)
                if (nodes.has(candidate) && candidate !in selected) selected.add(candidate)
            }
            selected.addAll(keys(nodes).filter { it !in selected }.sorted())
            scene.put("nodeOrder", JSONArray(selected))
        }
        return scene
    }

    private fun boundedRead(input: InputStream): ByteArray = ByteArrayOutputStream().use { output ->
        val buffer = ByteArray(8192)
        var total = 0
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            total += count
            if (total > MAX_BYTES) throw HistoryLimit()
            output.write(buffer, 0, count)
        }
        output.toByteArray()
    }
    private fun safeId(value: String) = value.isNotBlank() && value.length <= 160 && value !in setOf("__proto__", "prototype", "constructor")
    private fun keys(obj: JSONObject) = obj.keys().asSequence().toSet()
    private fun verifySeed(seed: JSONObject) {
        require(keys(seed) == setOf("schema", "defaultFrameId", "frames", "frameOrder", "layers", "layerOrder", "nodes", "nodeOrder", "assets", "masks", "steps", "stepOrder"))
        val frameId = seed.getString("defaultFrameId"); require(safeId(frameId))
        val frameOrder = seed.getJSONArray("frameOrder"); require(frameOrder.length() == 1 && frameOrder.getString(0) == frameId)
        val frames = seed.getJSONObject("frames"); require(keys(frames) == setOf(frameId))
        val frame = frames.getJSONObject(frameId)
        val expectedFrame = JSONObject().put("id", frameId).put("name", "Frame 1").put("x", 0).put("y", 0).put("w", 1280).put("h", 720).put("background", "#ffffff").put("clip", true).put("status", "draft").put("exportScale", 1)
        require(equalJson(frame, expectedFrame))
        val layerOrder = seed.getJSONArray("layerOrder"); require(layerOrder.length() == 1)
        val layerId = layerOrder.getString(0); require(safeId(layerId))
        val layers = seed.getJSONObject("layers"); require(keys(layers) == setOf(layerId))
        val expectedLayer = JSONObject().put("id", layerId).put("name", "Layer 1").put("visible", true).put("locked", false).put("positionLocked", false).put("alphaLocked", false).put("opacity", 1).put("blend", "source-over").put("parentId", JSONObject.NULL)
        require(equalJson(layers.getJSONObject(layerId), expectedLayer))
        require(seed.getJSONObject("assets").length() == 0 && seed.getJSONObject("masks").length() == 0 && seed.getJSONObject("steps").length() == 0 && seed.getJSONArray("stepOrder").length() == 0)
    }
    private fun verifyNode(node: JSONObject) {
        val required = setOf("id", "kind", "name", "layerId", "frameId", "groupId", "visible", "locked", "rotation", "opacity", "flipX", "flipY", "paint", "textStyle", "effects", "x", "y", "w", "h", "brush", "samples", "erase", "seed")
        require(keys(node).containsAll(required) && keys(node).all { it in required || it == "alphaLock" })
        require(node.getString("name").length <= 512 && node.isNull("groupId") && !node.getBoolean("locked") && !node.optBoolean("alphaLock"))
        require(node.getDouble("w").isFinite() && node.getDouble("h").isFinite() && node.getDouble("w") > 0 && node.getDouble("h") > 0)
        require(node.get("erase") is Boolean && node.getDouble("seed").isFinite())
        val paint = JSONObject().put("fill", "transparent").put("stroke", "#202023").put("strokeWidth", 3).put("dash", JSONArray()).put("cap", "round").put("radius", 16)
        val text = JSONObject().put("font", "IBM Plex Sans Arabic").put("size", 28).put("weight", 400).put("italic", false).put("align", "start").put("direction", "auto").put("leading", 1.7).put("background", "transparent").put("color", "#202023").put("border", "transparent").put("resizeMode", "wrap")
        require(equalJson(node.getJSONObject("paint"), paint) && equalJson(node.getJSONObject("textStyle"), text))
        val brush = node.getJSONObject("brush")
        val brushKeys = setOf("kind", "size", "opacity", "flow", "hardness", "spacing", "angle", "roundness", "smoothing", "stabilizer", "taperStart", "taperEnd", "pressureSize", "pressureOpacity", "pressureFlow", "pressureCurve", "color")
        require(keys(brush).containsAll(brushKeys) && keys(brush).all { it in brushKeys || it == "straightLine" })
        if (brush.has("straightLine")) require(brush.get("straightLine") is Boolean)
        require(brush.getDouble("angle") in -360.0..360.0 && brush.getDouble("smoothing") in 0.0..0.95 && brush.getDouble("stabilizer") in 0.0..100.0)
        val points = node.getJSONArray("samples")
        for (i in 0 until points.length()) {
            val point = points.getJSONObject(i)
            require(keys(point) == setOf("x", "y", "pressure", "tiltX", "tiltY", "time"))
            val x = point.getDouble("x"); val y = point.getDouble("y")
            require(x in -2048.0..(node.getDouble("w") + 2048.0) && y in -2048.0..(node.getDouble("h") + 2048.0))
        }
    }
    internal fun equalJson(a: Any?, b: Any?): Boolean = when {
        a === JSONObject.NULL || a == null -> b == null || b === JSONObject.NULL
        a is JSONObject && b is JSONObject -> keys(a) == keys(b) && keys(a).all { equalJson(a.get(it), b.get(it)) }
        a is JSONArray && b is JSONArray -> a.length() == b.length() && (0 until a.length()).all { equalJson(a.get(it), b.get(it)) }
        a is Number && b is Number -> a.toDouble() == b.toDouble()
        else -> a == b
    }
}
