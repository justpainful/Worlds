package worlds.content

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class Resource(
    val id: String, val title: String, val kind: String, val parentId: String?,
    val sortKey: Double, val metadata: String, val instructions: String,
    val revision: Long, val deletedAt: Long?, val createdAt: Long, val updatedAt: Long,
)
data class ContentBlock(val id: String, val content: String)
data class ResourceDocument(val resource: Resource, val blocks: List<ContentBlock>, val markdownSourceName: String? = null)
data class MarkdownSource(val name: String, val bytes: ByteArray)
data class ContentVersion(val id: String, val pageId: String, val createdAt: Long, val label: String?, val blockCount: Int)
data class ContentEvent(val id: Long, val pageId: String, val kind: String, val createdAt: Long, val details: String)
class ContentConflict : IllegalStateException("Resource changed since it was loaded")

/** Local personal resources only. This store is not a shared Yjs replica. */
class ContentStore(context: Context, name: String = "worlds-content.db") :
    SQLiteOpenHelper(context.applicationContext, name, null, 6) {
    private val appContext = context.applicationContext
    override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true) }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE resources (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, parent_id TEXT REFERENCES resources(id), sort_key REAL NOT NULL, metadata TEXT NOT NULL, instructions TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, trash_group TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")
        db.execSQL("CREATE INDEX resources_parent ON resources(parent_id,sort_key,created_at)")
        db.execSQL("CREATE TABLE blocks (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, sort_key INTEGER NOT NULL, content TEXT NOT NULL, text TEXT NOT NULL)")
        db.execSQL("CREATE INDEX blocks_page ON blocks(page_id,sort_key)")
        createVersions(db)
        createHistory(db)
        createPendingDrawings(db)
        createMarkdownSources(db)
        createMediaBlobs(db)
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        require(oldVersion in 1..5 && newVersion == 6) { "No migration from $oldVersion to $newVersion" }
        if (oldVersion < 2) createVersions(db)
        if (oldVersion < 3) createHistory(db)
        if (oldVersion < 4) createPendingDrawings(db)
        if (oldVersion < 5) createMarkdownSources(db)
        createMediaBlobs(db)
    }

    private fun createMediaBlobs(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE media_blobs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL)")
    }

    /** Resolve only private attachment IDs, never caller-supplied paths. */
    fun privateFile(attachmentId: String): java.io.File? {
        if (!Regex("[0-9a-f]{32}").matches(attachmentId)) return null
        return java.io.File(appContext.filesDir, "worlds-files/$attachmentId").takeIf { it.isFile }
    }

    private fun SQLiteDatabase.fileForGallery(fileId: String, fileRevision: Long): FileAttachment {
        val file = requireResource(fileId)
        if (file.revision != fileRevision) throw ContentConflict()
        require(file.kind == "file" && file.deletedAt == null && !insideTemplateTree(fileId))
        val attachment = requireNotNull(FileAttachment.read(file.metadata))
        require(attachment.mime.startsWith("image/") || attachment.mime.startsWith("video/"))
        require(privateFile(attachment.id)?.length() == attachment.size)
        return attachment
    }

    private fun SQLiteDatabase.appendFileToGallery(gallery: Resource, attachment: FileAttachment): Resource {
        val count = rawQuery("SELECT COUNT(*) FROM blocks WHERE page_id=?", arrayOf(gallery.id)).use { it.moveToFirst(); it.getInt(0) }
        if (count > 0) captureVersion(gallery, null)
        val position = rawQuery("SELECT COALESCE(MAX(sort_key)+1,0) FROM blocks WHERE page_id=?", arrayOf(gallery.id)).use { it.moveToFirst(); it.getInt(0) }
        val block = newBlockId()
        val attrs = JSONObject().put("bid", block).put("attachmentId", attachment.id).put("name", attachment.name).put("mime", attachment.mime).put("size", attachment.size).put("kind", if (attachment.mime.startsWith("image/")) "image" else "video").put("caption", "")
        val node = JSONObject().put("type", "galleryItem").put("attrs", attrs)
        insertOrThrow("blocks", null, ContentValues().apply { put("id", block); put("page_id", gallery.id); put("sort_key", position); put("content", node.toString()); put("text", attachment.name) })
        bump(gallery.id, gallery.revision); record(gallery.id, "blocks_saved", JSONObject().put("blockCount", count + 1)); return requireResource(gallery.id)
    }

    fun addFileToGallery(fileId: String, fileRevision: Long, galleryId: String, galleryRevision: Long): Resource = writableDatabase.transaction {
        val file = fileForGallery(fileId, fileRevision); val gallery = requireResource(galleryId)
        if (gallery.revision != galleryRevision) throw ContentConflict()
        require(gallery.kind == "gallery" && gallery.deletedAt == null && !insideTemplateTree(galleryId))
        appendFileToGallery(gallery, file)
    }

    fun createGalleryFromFile(fileId: String, fileRevision: Long, title: String): Resource = writableDatabase.transaction {
        require(title.length <= 512)
        val file = fileForGallery(fileId, fileRevision); val now = System.currentTimeMillis(); val id = newResourceId(now)
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", title.trim()); put("kind", "gallery"); put("sort_key", nextSort(null))
            put("metadata", """{"gallery":{"view":"grid"}}"""); put("instructions", "[]"); put("created_at", now); put("updated_at", now)
        })
        record(id, "created", JSONObject().put("kind", "gallery")); appendFileToGallery(requireResource(id), file)
    }

    /** Copy a picked file first; publish the resource only after the complete copy is durable. */
    fun importFileResource(name: String, mime: String, input: java.io.InputStream, parentId: String? = null, parentRevision: Long? = null): Resource {
        require(name.length <= 512)
        require(Regex("[A-Za-z0-9!#\\$&^_.+-]+/[A-Za-z0-9!#\\$&^_.+-]+").matches(mime) && mime.length <= 127)
        val directory = java.io.File(appContext.filesDir, "worlds-files")
        check(directory.isDirectory || directory.mkdirs())
        val attachment = UUID.randomUUID().toString().replace("-", "")
        val temporary = java.io.File(directory, "$attachment.tmp")
        val finalFile = java.io.File(directory, attachment)
        var committed = false
        try {
            var size = 0L
            java.io.FileOutputStream(temporary).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer); if (count < 0) break; if (count == 0) continue
                    size += count; require(size <= MAX_GALLERY_MEDIA_BYTES) { "File is too large" }
                    output.write(buffer, 0, count)
                }
                output.fd.sync()
            }
            check(temporary.renameTo(finalFile))
            val result = writableDatabase.transaction {
                if (parentId != null) {
                    val parent = requireResource(parentId)
                    require(parent.kind == "project" && parent.deletedAt == null && !insideTemplateTree(parentId))
                    if (parentRevision == null || parent.revision != parentRevision) throw ContentConflict()
                }
                val now = System.currentTimeMillis(); val resourceId = newResourceId(now)
                val kind = when { mime.startsWith("image/") -> "image"; mime.startsWith("video/") -> "video"; mime.startsWith("audio/") -> "audio"; else -> "file" }
                val metadata = JSONObject().put("file", JSONObject().put("attachmentId", attachment).put("name", name).put("mime", mime).put("size", size).put("kind", kind)).toString()
                insertOrThrow("resources", null, ContentValues().apply {
                    put("id", resourceId); put("title", name); put("kind", "file"); put("parent_id", parentId); put("sort_key", nextSort(parentId))
                    put("metadata", metadata); put("instructions", "[]"); put("created_at", now); put("updated_at", now)
                })
                record(resourceId, "created", JSONObject().put("kind", "file")); requireResource(resourceId)
            }
            committed = true; return result
        } finally {
            temporary.delete()
            if (!committed) finalFile.delete()
        }
    }

    /** File-backed gallery media keeps large recordings out of SQLite cursor windows. */
    fun galleryMediaFile(attachmentId: String): java.io.File? {
        if (!Regex("[0-9a-f]{32}").matches(attachmentId)) return null
        return java.io.File(appContext.filesDir, "worlds-gallery-media/$attachmentId").takeIf { it.isFile }
    }

    fun insertGalleryMedia(pageId: String, expectedRevision: Long, name: String, mime: String, input: java.io.InputStream, slideId: String? = null): Resource {
        val supported = setOf("video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/flac")
        require(mime in supported) { "Unsupported media type" }
        require(slideId == null || mime.startsWith("video/"))
        val directory = java.io.File(appContext.filesDir, "worlds-gallery-media")
        check(directory.isDirectory || directory.mkdirs())
        val id = UUID.randomUUID().toString().replace("-", "")
        val temporary = java.io.File(directory, "$id.tmp")
        val finalFile = java.io.File(directory, id)
        var committed = false
        try {
            var size = 0L
            java.io.FileOutputStream(temporary).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    if (count == 0) continue
                    size += count
                    require(size <= MAX_GALLERY_MEDIA_BYTES) { "Media is too large" }
                    output.write(buffer, 0, count)
                }
                require(size > 0); output.fd.sync()
            }
            val extractor = android.media.MediaExtractor()
            var videoWidth = 0; var videoHeight = 0
            val kind = try {
                extractor.setDataSource(temporary.absolutePath)
                val tracks = (0 until extractor.trackCount).mapNotNull { extractor.getTrackFormat(it).getString(android.media.MediaFormat.KEY_MIME) }
                val video = tracks.any { it.startsWith("video/") }
                val audio = tracks.any { it.startsWith("audio/") }
                if (video) {
                    val format = (0 until extractor.trackCount).map { extractor.getTrackFormat(it) }.first { it.getString(android.media.MediaFormat.KEY_MIME)?.startsWith("video/") == true }
                    videoWidth = if (format.containsKey(android.media.MediaFormat.KEY_WIDTH)) format.getInteger(android.media.MediaFormat.KEY_WIDTH) else 0
                    videoHeight = if (format.containsKey(android.media.MediaFormat.KEY_HEIGHT)) format.getInteger(android.media.MediaFormat.KEY_HEIGHT) else 0
                    if (format.containsKey(android.media.MediaFormat.KEY_ROTATION) && format.getInteger(android.media.MediaFormat.KEY_ROTATION) % 180 != 0) { val temp = videoWidth; videoWidth = videoHeight; videoHeight = temp }
                }
                require(if (mime.startsWith("video/")) video else audio && !video) { "Media does not match its type" }
                if (video) "video" else "audio"
            } finally { extractor.release() }
            check(temporary.renameTo(finalFile)) { "Could not store media" }
            val result = writableDatabase.transaction {
                val gallery = requireResource(pageId)
                if (gallery.revision != expectedRevision) throw ContentConflict()
                require(gallery.deletedAt == null && gallery.kind == if (slideId == null) "gallery" else "presentation")
                if (slideId != null) {
                    val raw = rawQuery("SELECT content FROM blocks WHERE page_id=? AND id=?", arrayOf(pageId, slideId)).use { require(it.moveToFirst()); it.getString(0) }
                    val node = JSONObject(raw); require(node.optString("type") == "slide")
                    val elements = requireNotNull(node.optJSONObject("attrs")?.optJSONArray("elements")); require(elements.length() < 1000)
                    val ratio = if (videoWidth > 0 && videoHeight > 0) (videoWidth.toDouble() / videoHeight).coerceIn(0.1, 10.0) else 16.0 / 9.0
                    val width = minOf(720.0, 560.0 * ratio); val height = width / ratio
                    val element = JSONObject().put("id", UUID.randomUUID().toString().replace("-", "").take(26)).put("type", "video")
                        .put("x", kotlin.math.round((1280 - width) / 2).toInt()).put("y", kotlin.math.round((720 - height) / 2).toInt())
                        .put("w", kotlin.math.round(width).toInt()).put("h", kotlin.math.round(height).toInt()).put("attachmentId", id).put("fit", "contain")
                    elements.put(element); captureVersion(gallery, null)
                    update("blocks", ContentValues().apply { put("content", node.toString()) }, "page_id=? AND id=?", arrayOf(pageId, slideId))
                    bump(pageId, expectedRevision); record(pageId, "blocks_saved", JSONObject().put("videoName", name.take(512)))
                    return@transaction requireResource(pageId)
                }
                val count = rawQuery("SELECT COUNT(*) FROM blocks WHERE page_id=?", arrayOf(pageId)).use { it.moveToFirst(); it.getInt(0) }
                if (count > 0) captureVersion(gallery, null)
                val position = rawQuery("SELECT COALESCE(MAX(sort_key)+1,0) FROM blocks WHERE page_id=?", arrayOf(pageId)).use { it.moveToFirst(); it.getInt(0) }
                val block = newBlockId()
                val attrs = JSONObject().put("bid", block).put("attachmentId", id).put("name", name.take(512)).put("mime", mime).put("size", size).put("kind", kind).put("caption", "")
                val node = JSONObject().put("type", "galleryItem").put("attrs", attrs)
                insertOrThrow("blocks", null, ContentValues().apply { put("id", block); put("page_id", pageId); put("sort_key", position); put("content", node.toString()); put("text", name.take(512)) })
                bump(pageId, expectedRevision); record(pageId, "blocks_saved", JSONObject().put("blockCount", count + 1)); requireResource(pageId)
            }
            committed = true
            return result
        } finally {
            temporary.delete()
            if (!committed) finalFile.delete()
        }
    }

    /** Image bytes and the desktop-compatible media node commit together. */
    fun insertImage(pageId: String, expectedRevision: Long, name: String, bytes: ByteArray, afterBlockId: String? = null): Resource {
        require(bytes.isNotEmpty() && bytes.size <= MAX_IMAGE_BYTES)
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val mime = bounds.outMimeType
        require(mime in setOf("image/png", "image/jpeg", "image/webp", "image/gif") && bounds.outWidth in 1..12_000 && bounds.outHeight in 1..12_000 && bounds.outWidth.toLong() * bounds.outHeight <= 64_000_000L) { "Unsupported image" }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        val decoded = requireNotNull(android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })) { "Image cannot be decoded" }
        decoded.recycle()
        return writableDatabase.transaction {
            val page = requireResource(pageId)
            if (page.revision != expectedRevision) throw ContentConflict()
            require(page.deletedAt == null && page.kind in setOf("page", "document", "template", "gallery"))
            val anchor = if (afterBlockId == null) null else rawQuery("SELECT sort_key FROM blocks WHERE page_id=? AND id=?", arrayOf(pageId, afterBlockId)).use {
                require(it.moveToFirst()) { "Block not found" }; it.getInt(0)
            }
            val count = rawQuery("SELECT COUNT(*) FROM blocks WHERE page_id=?", arrayOf(pageId)).use { it.moveToFirst(); it.getInt(0) }
            if (count > 0) captureVersion(page, null)
            val position = if (anchor == null) rawQuery("SELECT COALESCE(MAX(sort_key)+1,0) FROM blocks WHERE page_id=?", arrayOf(pageId)).use { it.moveToFirst(); it.getInt(0) } else anchor + 1
            if (anchor != null) execSQL("UPDATE blocks SET sort_key=sort_key+1 WHERE page_id=? AND sort_key>=?", arrayOf<Any>(pageId, position))
            val attachment = newResourceId(System.currentTimeMillis()); val block = newBlockId()
            insertOrThrow("media_blobs", null, ContentValues().apply { put("id", attachment); put("mime", mime); put("bytes", bytes) })
            val attrs = JSONObject().put("bid", block).put("attachmentId", attachment).put("name", name.take(512)).put("mime", mime)
                .put("size", bytes.size).put("caption", "")
            if (page.kind == "gallery") attrs.put("kind", "image")
            else attrs.put("width", bounds.outWidth).put("height", bounds.outHeight).put("display", 100).put("align", "center")
            val node = JSONObject().put("type", if (page.kind == "gallery") "galleryItem" else "image").put("attrs", attrs)
            insertOrThrow("blocks", null, ContentValues().apply { put("id", block); put("page_id", pageId); put("sort_key", position); put("content", node.toString()); put("text", name.take(512)) })
            bump(pageId, expectedRevision); record(pageId, "blocks_saved", JSONObject().put("blockCount", count + 1)); requireResource(pageId)
        }
    }

    /** Append a desktop image element and its private bytes in one transaction. */
    fun insertSlideImage(pageId: String, expectedRevision: Long, slideId: String, name: String, bytes: ByteArray, background: Boolean = false): Resource {
        require(bytes.isNotEmpty() && bytes.size <= MAX_IMAGE_BYTES)
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val mime = bounds.outMimeType
        require(mime in setOf("image/png", "image/jpeg", "image/webp", "image/gif") && bounds.outWidth in 1..12_000 && bounds.outHeight in 1..12_000 && bounds.outWidth.toLong() * bounds.outHeight <= 64_000_000L)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        requireNotNull(android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })).recycle()
        return writableDatabase.transaction {
            val deck = requireResource(pageId)
            if (deck.revision != expectedRevision) throw ContentConflict()
            require(deck.kind == "presentation" && deck.deletedAt == null)
            val raw = rawQuery("SELECT content FROM blocks WHERE page_id=? AND id=?", arrayOf(pageId, slideId)).use { require(it.moveToFirst()); it.getString(0) }
            val node = JSONObject(raw); require(node.optString("type") == "slide")
            val attrs = requireNotNull(node.optJSONObject("attrs"))
            val attachment = newResourceId(System.currentTimeMillis())
            if (background) {
                require(!attrs.has("background") || attrs.optJSONObject("background") != null)
                val slideBackground = attrs.optJSONObject("background") ?: JSONObject().put("color", "#16161a")
                slideBackground.put("attachmentId", attachment); attrs.put("background", slideBackground)
            } else {
                val elements = requireNotNull(attrs.optJSONArray("elements")); require(elements.length() < 1000)
                val elementId = UUID.randomUUID().toString().replace("-", "").take(26)
                elements.put(JSONObject().put("id", elementId).put("type", "image").put("x", 290).put("y", 110).put("w", 700).put("h", 500).put("attachmentId", attachment).put("fit", "contain"))
            }
            captureVersion(deck, null)
            insertOrThrow("media_blobs", null, ContentValues().apply { put("id", attachment); put("mime", mime); put("bytes", bytes) })
            update("blocks", ContentValues().apply { put("content", node.toString()) }, "page_id=? AND id=?", arrayOf(pageId, slideId))
            bump(pageId, expectedRevision); record(pageId, "blocks_saved", JSONObject().put("imageName", name.take(512))); requireResource(pageId)
        }
    }

    fun imageBytes(attachmentId: String): ByteArray? {
        val db = readableDatabase
        val size = db.rawQuery("SELECT length(bytes) FROM media_blobs WHERE id=?", arrayOf(attachmentId)).use { if (!it.moveToFirst()) return null else it.getInt(0) }
        require(size in 1..MAX_IMAGE_BYTES)
        val result = java.io.ByteArrayOutputStream(size); var offset = 1
        while (offset <= size) {
            val chunk = db.rawQuery("SELECT substr(bytes,?,?) FROM media_blobs WHERE id=?", arrayOf(offset.toString(), "200000", attachmentId)).use { check(it.moveToFirst()); it.getBlob(0) }
            check(chunk.isNotEmpty()); result.write(chunk); offset += chunk.size
        }
        return result.toByteArray()
    }

    /** Update only image presentation attributes, retaining its original attachment and unknown data. */
    fun updateImagePresentation(pageId: String, blockId: String, expectedRevision: Long, caption: String, display: Int, align: String): Resource {
        require(caption.length <= 2000 && (display == 0 || display in 20..100) && align in setOf("left", "center", "right"))
        val doc = requireNotNull(load(pageId)) { "Resource not found" }
        if (doc.resource.revision != expectedRevision) throw ContentConflict()
        require(doc.resource.deletedAt == null && doc.resource.kind in setOf("page", "document", "template"))
        val blocks = doc.blocks.toMutableList(); val index = blocks.indexOfFirst { it.id == blockId }
        require(index >= 0) { "Block not found" }
        val node = JSONObject(blocks[index].content); require(node.optString("type") == "image")
        val attrs = requireNotNull(node.optJSONObject("attrs"))
        attrs.put("caption", caption).put("display", display).put("align", align)
        blocks[index] = ContentBlock(blockId, node.toString())
        return saveBlocks(pageId, expectedRevision, blocks)
    }

    /** Replace supported text runs atomically without rewriting untouched blocks. */
    fun replacePageText(id: String, expectedRevision: Long, query: String, replacement: String, matchCase: Boolean, index: Int?): Resource = writableDatabase.transaction {
        val page = requireResource(id)
        if (page.revision != expectedRevision) throw ContentConflict()
        require(page.deletedAt == null && page.kind in setOf("page", "document", "template"))
        val blocks = mutableListOf<ContentBlock>()
        rawQuery("SELECT id,content FROM blocks WHERE page_id=? ORDER BY sort_key", arrayOf(id)).use { cursor ->
            while (cursor.moveToNext()) blocks.add(ContentBlock(cursor.getString(0), cursor.getString(1)))
        }
        val result = PageFind.scan(blocks, query, matchCase)
        require(!result.truncated && result.matches.isNotEmpty())
        val selected = if (index == null) result.matches else listOf(result.matches[index])
        val updated = PageFind.replace(blocks, selected, replacement)
        if (updated == blocks) return@transaction page
        captureVersion(page, null)
        for (i in blocks.indices) if (updated[i].content != blocks[i].content) {
            val block = updated[i]
            check(update("blocks", ContentValues().apply { put("content", block.content); put("text", plainText(JSONObject(block.content))) }, "page_id=? AND id=?", arrayOf(id, block.id)) == 1)
        }
        bump(id, expectedRevision); record(id, "blocks_saved", JSONObject().put("blockCount", blocks.size)); requireResource(id)
    }

    private fun createMarkdownSources(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE markdown_sources (resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE, filename TEXT NOT NULL, original BLOB NOT NULL)")
    }

    /** Create the page, parsed blocks and original file bytes in one transaction. */
    fun createImportedMarkdown(title: String, filename: String, original: ByteArray, blocks: List<String>): Resource = writableDatabase.transaction {
        require(original.size <= MarkdownImport.MAX_BYTES && filename.length <= 512 && blocks.size <= 100_000)
        val values = blocks.map { raw ->
            require(raw.toByteArray(Charsets.UTF_8).size <= 1_000_000)
            val node = JSONObject(raw); val blockId = newBlockId()
            val attrs = node.optJSONObject("attrs") ?: JSONObject().also { node.put("attrs", it) }
            attrs.put("bid", blockId)
            Triple(blockId, node.toString(), plainText(node))
        }
        val now = System.currentTimeMillis(); val id = newResourceId(now)
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", title); put("kind", "page"); put("sort_key", nextSort(null)); put("metadata", "{}"); put("instructions", "[]")
            put("revision", if (values.isEmpty()) 0 else 1); put("created_at", now); put("updated_at", now)
        })
        values.forEachIndexed { index, (blockId, json, text) ->
            insertOrThrow("blocks", null, ContentValues().apply { put("id", blockId); put("page_id", id); put("sort_key", index); put("content", json); put("text", text) })
        }
        insertOrThrow("markdown_sources", null, ContentValues().apply { put("resource_id", id); put("filename", filename); put("original", original) })
        record(id, "created", JSONObject().put("kind", "page"))
        requireResource(id)
    }

    fun markdownSource(id: String): MarkdownSource? = readableDatabase.transaction {
        val info = rawQuery("SELECT filename,length(original) FROM markdown_sources WHERE resource_id=?", arrayOf(id)).use {
            if (it.moveToFirst()) it.getString(0) to it.getInt(1) else return@transaction null
        }
        val output = java.io.ByteArrayOutputStream(info.second); var offset = 1
        while (offset <= info.second) {
            val part = rawQuery("SELECT substr(original,?,?) FROM markdown_sources WHERE resource_id=?", arrayOf(offset.toString(), "100000", id)).use {
                check(it.moveToFirst()) { "Markdown source changed" }; it.getBlob(0)
            }
            check(part.isNotEmpty()) { "Markdown source is incomplete" }
            output.write(part); offset += part.size
        }
        MarkdownSource(info.first, output.toByteArray())
    }

    private fun createPendingDrawings(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE pending_drawings (resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE, document TEXT NOT NULL)")
    }

    /** Commit the imported resource and its validated document together. */
    fun createImportedDrawing(title: String, document: String): Resource = writableDatabase.transaction {
        require(document.isNotBlank())
        val now = System.currentTimeMillis()
        val id = newResourceId(now)
        val metadata = JSONObject().put("androidImportedDrawing", true).toString()
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", title); put("kind", "drawing"); put("sort_key", nextSort(null))
            put("metadata", metadata); put("instructions", "[]"); put("created_at", now); put("updated_at", now)
        })
        insertOrThrow("pending_drawings", null, ContentValues().apply { put("resource_id", id); put("document", document) })
        record(id, "created", JSONObject().put("kind", "drawing"))
        requireResource(id)
    }

    fun pendingDrawing(id: String): String? {
        val db = readableDatabase
        val length = db.rawQuery("SELECT length(document) FROM pending_drawings WHERE resource_id=?", arrayOf(id)).use {
            if (it.moveToFirst()) it.getInt(0) else return null
        }
        val result = StringBuilder(length)
        var offset = 1
        while (offset <= length) {
            val part = db.rawQuery("SELECT substr(document,?,?) FROM pending_drawings WHERE resource_id=?", arrayOf(offset.toString(), "100000", id)).use {
                check(it.moveToFirst()) { "Pending drawing changed" }; it.getString(0)
            }
            check(part.isNotEmpty()) { "Pending drawing is incomplete" }
            result.append(part)
            // SQLite counts Unicode code points, whereas Java counts UTF-16 units.
            offset += part.codePointCount(0, part.length)
        }
        return result.toString()
    }
    fun clearPendingDrawing(id: String) { writableDatabase.delete("pending_drawings", "resource_id=?", arrayOf(id)) }

    private fun createVersions(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE versions (id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, label TEXT, snapshot TEXT NOT NULL, block_count INTEGER NOT NULL)")
        db.execSQL("CREATE INDEX versions_page ON versions(page_id,created_at DESC)")
    }
    private fun createHistory(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE, kind TEXT NOT NULL, created_at INTEGER NOT NULL, details TEXT NOT NULL)")
        db.execSQL("CREATE INDEX history_page ON history(page_id,id DESC)")
    }

    fun create(kind: String, title: String, parentId: String? = null, metadata: String = "{}", instructions: String = "[]"): Resource = writableDatabase.transaction {
        require(kind in KINDS)
        JSONObject(metadata); JSONArray(instructions)
        if (parentId != null) require(requireResource(parentId).deletedAt == null) { "Parent is in trash" }
        val sort = nextSort(parentId)
        val now = System.currentTimeMillis()
        val id = newResourceId(now)
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", title); put("kind", kind); put("parent_id", parentId); put("sort_key", sort)
            put("metadata", metadata); put("instructions", instructions); put("created_at", now); put("updated_at", now)
        })
        if (kind == "presentation") {
            val slide = PresentationEditing.newSlide("title")
            insertOrThrow("blocks", null, ContentValues().apply { put("id", slide.id); put("page_id", id); put("sort_key", 0); put("content", slide.content); put("text", "") })
        }
        record(id, "created", JSONObject().put("kind", kind))
        requireResource(id)
    }

    fun createStream(title: String, url: String, parentId: String? = null, parentRevision: Long? = null): Resource = writableDatabase.transaction {
        require(title.length <= 512)
        val parsed = StreamEditing.parseUrl(url)
        if (parentId != null) {
            val parent = requireResource(parentId)
            if (parentRevision == null || parent.revision != parentRevision) throw ContentConflict()
            require(parent.kind == "project" && parent.deletedAt == null && !insideTemplateTree(parentId))
        }
        val name = title.trim().ifBlank { java.net.URI(parsed.url).path.orEmpty().substringAfterLast('/').ifBlank { "Stream" }.take(512) }
        val now = System.currentTimeMillis(); val id = newResourceId(now)
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", name); put("kind", "stream"); put("parent_id", parentId); put("sort_key", nextSort(parentId))
            put("metadata", StreamEditing.update("{}", parsed.url)); put("instructions", "[]"); put("created_at", now); put("updated_at", now)
        })
        record(id, "created", JSONObject().put("kind", "stream")); requireResource(id)
    }

    fun updateStream(id: String, revision: Long, url: String): Resource = writableDatabase.transaction {
        val stream = requireResource(id)
        if (stream.revision != revision) throw ContentConflict()
        require(stream.kind == "stream" && stream.deletedAt == null && !insideTemplateTree(id))
        val metadata = StreamEditing.update(stream.metadata, url)
        update("resources", ContentValues().apply { put("metadata", metadata) }, "id=?", arrayOf(id))
        bump(id, revision); record(id, "details_changed", JSONObject()); requireResource(id)
    }

    /** Create a child only if its visible parent has not changed since the dialog opened. */
    fun createSubpage(parentId: String, expectedRevision: Long, title: String): Resource = writableDatabase.transaction {
        val parent = requireResource(parentId)
        if (parent.revision != expectedRevision) throw ContentConflict()
        require(parent.deletedAt == null && parent.kind in setOf("page", "document", "template"))
        val now = System.currentTimeMillis(); val id = newResourceId(now)
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", title.trim()); put("kind", "page"); put("parent_id", parentId); put("sort_key", nextSort(parentId))
            put("metadata", "{}"); put("instructions", "[]"); put("created_at", now); put("updated_at", now)
        })
        record(id, "created", JSONObject().put("kind", "page"))
        requireResource(id)
    }

    fun createProjectChild(projectId: String, expectedRevision: Long, kind: String, title: String): Resource = writableDatabase.transaction {
        require(kind in ProjectEditing.childKinds && kind !in setOf("file", "stream") && title.length <= 512)
        val project = requireResource(projectId)
        if (project.revision != expectedRevision) throw ContentConflict()
        require(project.kind == "project" && project.deletedAt == null && !insideTemplateTree(projectId))
        val now = System.currentTimeMillis(); val id = newResourceId(now)
        val metadata = when (kind) { "document" -> ProjectEditing.defaultDocumentMetadata; "project" -> ProjectEditing.defaultProjectMetadata; "gallery" -> """{"gallery":{"view":"grid"}}"""; "presentation" -> PresentationEditing.defaultMetadata; else -> "{}" }
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", title.trim()); put("kind", kind); put("parent_id", projectId); put("sort_key", nextSort(projectId))
            put("metadata", metadata); put("instructions", "[]"); put("created_at", now); put("updated_at", now)
        })
        if (kind == "presentation") {
            val slide = PresentationEditing.newSlide("title")
            insertOrThrow("blocks", null, ContentValues().apply { put("id", slide.id); put("page_id", id); put("sort_key", 0); put("content", slide.content); put("text", "") })
        }
        record(id, "created", JSONObject().put("kind", kind)); requireResource(id)
    }

    fun updateProjectDetails(id: String, expectedRevision: Long, status: String, start: String?, due: String?, description: String): Resource = writableDatabase.transaction {
        val project = requireResource(id)
        if (project.revision != expectedRevision) throw ContentConflict()
        require(project.kind == "project" && project.deletedAt == null && !insideTemplateTree(id))
        val previous = ProjectEditing.read(project.metadata)
        val metadata = ProjectEditing.updateDetails(project.metadata, status, start, due, description)
        if (previous.status == status && previous.start == start && previous.due == due && previous.description == description) return@transaction project
        update("resources", ContentValues().apply { put("metadata", metadata) }, "id=?", arrayOf(id))
        bump(id, expectedRevision); record(id, "details_changed", JSONObject()); requireResource(id)
    }

    fun changeProjectLink(id: String, expectedRevision: Long, targetId: String, add: Boolean): Resource = writableDatabase.transaction {
        val project = requireResource(id)
        if (project.revision != expectedRevision) throw ContentConflict()
        require(project.kind == "project" && project.deletedAt == null && !insideTemplateTree(id))
        val info = ProjectEditing.read(project.metadata)
        val links = if (add) {
            val target = requireResource(targetId)
            require(target.id != id && target.deletedAt == null && target.parentId != id && target.kind != "template" && !insideTemplateTree(target.id))
            require(target.id !in info.links)
            info.links + target.id
        } else {
            require(targetId in info.links)
            info.links.filterNot { it == targetId }
        }
        update("resources", ContentValues().apply { put("metadata", ProjectEditing.updateLinks(project.metadata, links)) }, "id=?", arrayOf(id))
        bump(id, expectedRevision); record(id, "details_changed", JSONObject()); requireResource(id)
    }

    fun children(parentId: String): List<Resource> {
        val result = mutableListOf<Resource>()
        readableDatabase.rawQuery("SELECT $COLS FROM resources WHERE parent_id=? AND deleted_at IS NULL ORDER BY sort_key,created_at,id", arrayOf(parentId)).use {
            while (it.moveToNext()) result.add(it.resource())
        }
        return result
    }

    /** Seed the desktop catalog once. Deleted templates are not recreated on later visits. */
    fun ensureBuiltinTemplates(): List<Resource> = writableDatabase.transaction {
        execSQL("CREATE TABLE IF NOT EXISTS android_template_seed (version INTEGER PRIMARY KEY)")
        val seeded = rawQuery("SELECT 1 FROM android_template_seed WHERE version=1", null).use { it.moveToFirst() }
        if (!seeded) {
            for (template in BuiltinTemplates.all) {
                val now = System.currentTimeMillis(); val id = newResourceId(now)
                val metadata = JSONObject().put("builtin", template.key).put("description", template.description).put("templateCategory", template.category).put("icon", template.icon)
                insertOrThrow("resources", null, ContentValues().apply {
                    put("id", id); put("title", template.title); put("kind", "template"); put("sort_key", nextSort(null)); put("metadata", metadata.toString()); put("instructions", "[]"); put("created_at", now); put("updated_at", now)
                })
                insertTemplateBlocks(id, MarkdownImport.parse(template.markdown), null)
            }
            execSQL("INSERT INTO android_template_seed(version) VALUES(1)")
        }
        val result = mutableListOf<Resource>()
        rawQuery("SELECT $COLS FROM resources WHERE kind='template' AND parent_id IS NULL AND deleted_at IS NULL ORDER BY sort_key,created_at,id", null).use { while (it.moveToNext()) result.add(it.resource()) }
        result.sortedWith(compareBy<Resource>({ if (JSONObject(it.metadata).optString("templateCategory") == "Custom") 0 else 1 }, { JSONObject(it.metadata).optString("templateCategory").lowercase() }, { it.sortKey }, { it.id }))
    }

    /** Create a page from the template's current structured content in one transaction. */
    fun instantiateTemplate(templateId: String, today: String = java.time.LocalDate.now().toString()): Resource = writableDatabase.transaction {
        require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(today))
        val template = requireResource(templateId)
        require(template.kind == "template" && template.deletedAt == null && template.parentId == null)
        require(JSONObject(template.metadata).optString("templateResourceKind", "page") == "page") { "This template resource kind is not supported yet" }
        copyTemplateTree(template, null, "page", today, templateId, intArrayOf(0), 0)
    }

    /** Copy a personal page and its supported descendants without changing the source. */
    fun saveAsTemplate(pageId: String, expectedRevision: Long): Resource = writableDatabase.transaction {
        val page = requireResource(pageId)
        if (page.revision != expectedRevision) throw ContentConflict()
        require(page.deletedAt == null && page.kind in setOf("page", "document"))
        copyTemplateTree(page, null, "template", null, null, intArrayOf(0), 0)
    }

    fun duplicateTemplate(id: String, expectedRevision: Long): Resource = writableDatabase.transaction {
        val source = requireResource(id)
        if (source.revision != expectedRevision) throw ContentConflict()
        require(source.kind == "template" && source.parentId == null && source.deletedAt == null)
        require(JSONObject(source.metadata).optString("templateResourceKind", "page") == "page") { "Unsupported template resource kind" }
        val copied = copyTemplateTree(source, null, "template", null, null, intArrayOf(0), 0)
        val metadata = JSONObject(source.metadata)
        listOf("sync", "drawingExportPolicyCache", "drawingExportPolicyRequest", "drawingLibrary", "experiment").forEach(metadata::remove)
        update("resources", ContentValues().apply { put("title", source.title + " (copy)"); put("metadata", metadata.toString()) }, "id=?", arrayOf(copied.id))
        requireResource(copied.id)
    }

    private fun SQLiteDatabase.copyTemplateTree(source: Resource, parent: String?, rootKind: String?, today: String?, fromTemplate: String?, count: IntArray, depth: Int): Resource {
        require(depth <= 64 && ++count[0] <= 500) { "Template tree exceeds limits" }
        require(source.deletedAt == null && (rootKind != null || source.kind in setOf("page", "document"))) { "Unsupported template descendant" }
        val blocks = mutableListOf<String>()
        rawQuery("SELECT content FROM blocks WHERE page_id=? ORDER BY sort_key", arrayOf(source.id)).use { while (it.moveToNext()) blocks.add(it.getString(0)) }
        val metadata = JSONObject(source.metadata)
        listOf("sync", "drawingExportPolicyCache", "drawingExportPolicyRequest", "drawingLibrary", "experiment").forEach(metadata::remove)
        if (rootKind == "template") { metadata.put("templateCategory", "Custom"); metadata.remove("builtin") }
        if (fromTemplate != null) { metadata.put("fromTemplate", fromTemplate); metadata.remove("templateCategory") }
        val kind = rootKind ?: source.kind
        val now = System.currentTimeMillis(); val id = newResourceId(now)
        insertOrThrow("resources", null, ContentValues().apply {
            put("id", id); put("title", if (today == null) source.title else source.title.replace("{{date}}", today)); put("kind", kind); put("parent_id", parent); put("sort_key", nextSort(parent)); put("metadata", metadata.toString()); put("instructions", source.instructions)
            put("revision", if (blocks.isEmpty()) 0 else 1); put("created_at", now); put("updated_at", now)
        })
        insertTemplateBlocks(id, blocks, today)
        record(id, "created", JSONObject().put("kind", kind))
        val children = mutableListOf<Resource>()
        rawQuery("SELECT $COLS FROM resources WHERE parent_id=? AND deleted_at IS NULL ORDER BY sort_key,created_at,id", arrayOf(source.id)).use { while (it.moveToNext()) children.add(it.resource()) }
        children.forEach { copyTemplateTree(it, id, null, null, null, count, depth + 1) }
        return requireResource(id)
    }

    private fun SQLiteDatabase.insertTemplateBlocks(pageId: String, blocks: List<String>, today: String?) {
        blocks.forEachIndexed { index, raw ->
            val node = JSONObject(if (today == null) raw else raw.replace("{{date}}", today))
            val blockId = newBlockId()
            val attrs = node.optJSONObject("attrs") ?: JSONObject().also { node.put("attrs", it) }
            attrs.put("bid", blockId)
            insertOrThrow("blocks", null, ContentValues().apply {
                put("id", blockId); put("page_id", pageId); put("sort_key", index); put("content", node.toString()); put("text", plainText(node))
            })
        }
    }

    fun load(id: String): ResourceDocument? = readableDatabase.transaction {
        val page = findResource(id) ?: return@transaction null
        val blocks = mutableListOf<ContentBlock>()
        rawQuery("SELECT id,content FROM blocks WHERE page_id=? ORDER BY sort_key", arrayOf(id)).use {
            while (it.moveToNext()) blocks.add(ContentBlock(it.getString(0), it.getString(1)))
        }
        val sourceName = rawQuery("SELECT filename FROM markdown_sources WHERE resource_id=?", arrayOf(id)).use { if (it.moveToFirst()) it.getString(0) else null }
        ResourceDocument(page, blocks, sourceName)
    }

    fun list(includeDeleted: Boolean = false): List<Resource> {
        val result = mutableListOf<Resource>()
        val filter = if (includeDeleted) "" else " WHERE deleted_at IS NULL"
        readableDatabase.rawQuery("SELECT $COLS FROM resources$filter ORDER BY sort_key,created_at,id", null).use {
            while (it.moveToNext()) result.add(it.resource())
        }
        return result
    }

    /** Template descendants belong in the template tree, not in the personal page library. */
    fun templateTreeIds(): Set<String> {
        val ids = mutableSetOf<String>()
        readableDatabase.rawQuery("WITH RECURSIVE t(id) AS (SELECT id FROM resources WHERE kind='template' UNION SELECT r.id FROM resources r JOIN t ON r.parent_id=t.id) SELECT id FROM t", null).use {
            while (it.moveToNext()) ids.add(it.getString(0))
        }
        return ids
    }

    /** Save full ordered ProseMirror nodes. A stale revision cannot overwrite another edit. */
    fun saveBlocks(id: String, expectedRevision: Long, blocks: List<ContentBlock>): Resource = writableDatabase.transaction {
        require(blocks.map { it.id }.all { it.isNotBlank() } && blocks.map { it.id }.toSet().size == blocks.size)
        val nodes = blocks.map { block ->
            val node = JSONObject(block.content)
            require(!node.has("attrs") || node.isNull("attrs") || node.optJSONObject("attrs") != null) { "Block attributes must be an object" }
            val attrs = node.optJSONObject("attrs") ?: JSONObject().also { node.put("attrs", it) }
            attrs.put("bid", block.id)
            Triple(block.id, node.toString(), plainText(node))
        }
        val current = requireResource(id)
        check(current.deletedAt == null) { "Resource is in trash" }
        if (current.revision != expectedRevision) throw ContentConflict()
        val existing = mutableListOf<Pair<String, String>>()
        rawQuery("SELECT id,content FROM blocks WHERE page_id=? ORDER BY sort_key", arrayOf(id)).use {
            while (it.moveToNext()) existing.add(it.getString(0) to it.getString(1))
        }
        if (existing == nodes.map { it.first to it.second }) return@transaction current
        for ((blockId) in nodes) {
            val owner = rawQuery("SELECT page_id FROM blocks WHERE id=?", arrayOf(blockId)).use { if (it.moveToFirst()) it.getString(0) else null }
            require(owner == null || owner == id) { "Block belongs to another resource" }
        }
        val latest = rawQuery("SELECT MAX(created_at) FROM versions WHERE page_id=?", arrayOf(id)).use { it.moveToFirst(); if (it.isNull(0)) null else it.getLong(0) }
        val previousCount = rawQuery("SELECT COUNT(*) FROM blocks WHERE page_id=?", arrayOf(id)).use { it.moveToFirst(); it.getInt(0) }
        if (previousCount > 0 && (latest == null || System.currentTimeMillis() - latest >= EDIT_SNAPSHOT_INTERVAL_MS)) captureVersion(current, null)
        delete("blocks", "page_id=?", arrayOf(id))
        nodes.forEachIndexed { index, (blockId, json, text) ->
            insertOrThrow("blocks", null, ContentValues().apply { put("id", blockId); put("page_id", id); put("sort_key", index); put("content", json); put("text", text) })
        }
        bump(id, expectedRevision)
        record(id, "blocks_saved", JSONObject().put("blockCount", nodes.size))
        requireResource(id)
    }

    /** Capture a local recovery version and remove one block in the same transaction. */
    fun removeBlock(id: String, blockId: String, expectedRevision: Long): Resource = writableDatabase.transaction {
        val page = requireResource(id)
        check(page.deletedAt == null) { "Resource is in trash" }
        if (page.revision != expectedRevision) throw ContentConflict()
        val exists = rawQuery("SELECT 1 FROM blocks WHERE page_id=? AND id=?", arrayOf(id, blockId)).use { it.moveToFirst() }
        require(exists) { "Block not found" }
        captureVersion(page, "Before block removal")
        check(delete("blocks", "page_id=? AND id=?", arrayOf(id, blockId)) == 1)
        bump(id, expectedRevision)
        record(id, "block_removed", JSONObject().put("blockId", blockId))
        requireResource(id)
    }

    /** Apply a supported inline edit without rewriting or dropping other blocks. */
    fun replaceInline(id: String, blockId: String, expectedRevision: Long, start: Int, end: Int, text: String): Resource =
        editInline(id, blockId, expectedRevision) { InlineEditing.replace(it, start, end, text) }

    fun setInlineMark(id: String, blockId: String, expectedRevision: Long, start: Int, end: Int, mark: String, enabled: Boolean): Resource =
        editInline(id, blockId, expectedRevision) { InlineEditing.setMark(it, start, end, mark, enabled) }

    /** Save one supported block while retaining every other block and checking the loaded revision. */
    fun saveInlineBlock(id: String, blockId: String, expectedRevision: Long, content: String, isNew: Boolean, afterBlockId: String? = null): Resource {
        InlineEditing.text(content)
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId }
        if (isNew) {
            require(index < 0) { "Block already exists" }
            val insertion = if (afterBlockId == null) blocks.size else blocks.indexOfFirst { it.id == afterBlockId }.also { require(it >= 0) { "Anchor not found" } } + 1
            blocks.add(insertion, ContentBlock(blockId, content))
        }
        else { require(index >= 0) { "Block not found" }; blocks[index] = ContentBlock(blockId, content) }
        return saveBlocks(id, expectedRevision, blocks)
    }

    /** Save code without interpreting or replacing neighboring blocks. */
    fun saveCodeBlock(id: String, blockId: String, expectedRevision: Long, content: String, isNew: Boolean, afterBlockId: String? = null): Resource {
        CodeEditing.read(content)
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId }
        if (isNew) {
            require(index < 0)
            val insertion = if (afterBlockId == null) blocks.size else blocks.indexOfFirst { it.id == afterBlockId }.also { require(it >= 0) } + 1
            blocks.add(insertion, ContentBlock(blockId, content))
        } else {
            require(index >= 0)
            CodeEditing.read(blocks[index].content)
            blocks[index] = ContentBlock(blockId, content)
        }
        return saveBlocks(id, expectedRevision, blocks)
    }

    fun insertTable(id: String, blockId: String, expectedRevision: Long): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        require(document.blocks.none { it.id == blockId })
        return saveBlocks(id, expectedRevision, document.blocks + ContentBlock(blockId, TableEditing.create(blockId)))
    }

    fun insertContainer(id: String, blockId: String, expectedRevision: Long, type: String, paragraph: String, afterBlockId: String? = null): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        require(blocks.none { it.id == blockId })
        val index = if (afterBlockId == null) blocks.size else blocks.indexOfFirst { it.id == afterBlockId }.also { require(it >= 0) } + 1
        blocks.add(index, ContentBlock(blockId, ContainerEditing.create(type, blockId, paragraph)))
        return saveBlocks(id, expectedRevision, blocks)
    }

    /** Update one list while retaining all other blocks and checking the loaded revision. */
    fun editList(id: String, blockId: String, expectedRevision: Long, change: (String) -> String): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId }
        require(index >= 0) { "Block not found" }
        blocks[index] = blocks[index].copy(content = change(blocks[index].content))
        return saveBlocks(id, expectedRevision, blocks)
    }

    /** Structural table changes use a revision check and may remove the last table cell. */
    fun changeTable(id: String, blockId: String, expectedRevision: Long, action: String, row: Int, column: Int): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId }; require(index >= 0)
        val raw = blocks[index].content
        val changed = when (action) {
            "insert_row" -> TableEditing.insertRowAfter(raw, row)
            "insert_column" -> TableEditing.insertColumnAfter(raw, column)
            "remove_row" -> TableEditing.removeRow(raw, row)
            "remove_column" -> TableEditing.removeColumn(raw, column)
            else -> throw IllegalArgumentException("Invalid table action")
        }
        if (changed == null) blocks.removeAt(index) else blocks[index] = blocks[index].copy(content = changed)
        return saveBlocks(id, expectedRevision, blocks)
    }

    fun removeListItem(id: String, blockId: String, expectedRevision: Long, path: List<Int>): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId }; require(index >= 0)
        val changed = ListEditing.remove(blocks[index].content, path)
        if (changed == null) blocks.removeAt(index) else blocks[index] = blocks[index].copy(content = changed)
        return saveBlocks(id, expectedRevision, blocks)
    }

    fun insertList(id: String, blockId: String, expectedRevision: Long, type: String, paragraph: String, afterBlockId: String? = null): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        require(blocks.none { it.id == blockId })
        val index = if (afterBlockId == null) blocks.size else blocks.indexOfFirst { it.id == afterBlockId }.also { require(it >= 0) } + 1
        blocks.add(index, ContentBlock(blockId, ListEditing.create(type, blockId, paragraph)))
        return saveBlocks(id, expectedRevision, blocks)
    }

    /** Duplicate the source node immediately after it, with a new top-level block ID. */
    fun duplicateBlock(id: String, blockId: String, expectedRevision: Long): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId }
        require(index >= 0) { "Block not found" }
        val node = JSONObject(blocks[index].content)
        val attrs = node.optJSONObject("attrs") ?: JSONObject().also { node.put("attrs", it) }
        val newId = newBlockId()
        attrs.put("bid", newId)
        blocks.add(index + 1, ContentBlock(newId, node.toString()))
        return saveBlocks(id, expectedRevision, blocks)
    }

    /** Move one block by one position without interpreting its content. */
    fun moveBlock(id: String, blockId: String, expectedRevision: Long, direction: Int): Resource {
        require(direction == -1 || direction == 1)
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId }
        require(index >= 0) { "Block not found" }
        val destination = index + direction
        require(destination in blocks.indices) { "Block is already at the boundary" }
        val block = blocks.removeAt(index)
        blocks.add(destination, block)
        return saveBlocks(id, expectedRevision, blocks)
    }

    private fun editInline(id: String, blockId: String, expectedRevision: Long, change: (String) -> String): Resource {
        val document = requireNotNull(load(id)) { "Resource not found" }
        if (document.resource.revision != expectedRevision) throw ContentConflict()
        val index = document.blocks.indexOfFirst { it.id == blockId }
        require(index >= 0) { "Block not found" }
        val changed = document.blocks.toMutableList()
        changed[index] = changed[index].copy(content = change(changed[index].content))
        return saveBlocks(id, expectedRevision, changed)
    }

    fun rename(id: String, expectedRevision: Long, title: String): Resource = writableDatabase.transaction {
        val page = requireResource(id)
        check(page.deletedAt == null)
        if (page.revision != expectedRevision) throw ContentConflict()
        if (page.title == title) return@transaction page
        update("resources", ContentValues().apply { put("title", title) }, "id=?", arrayOf(id))
        bump(id, expectedRevision)
        record(id, "renamed", JSONObject().put("before", page.title).put("after", title))
        requireResource(id)
    }

    fun updateDetails(id: String, expectedRevision: Long, metadata: String, instructions: String): Resource = writableDatabase.transaction {
        JSONObject(metadata); JSONArray(instructions)
        val page = requireResource(id)
        check(page.deletedAt == null)
        if (page.revision != expectedRevision) throw ContentConflict()
        update("resources", ContentValues().apply { put("metadata", metadata); put("instructions", instructions) }, "id=?", arrayOf(id))
        bump(id, expectedRevision)
        record(id, "details_changed", JSONObject())
        requireResource(id)
    }

    /** Edit document running text without replacing unrelated metadata or instructions. */
    fun updateDocumentRunningText(id: String, expectedRevision: Long, header: String, footer: String): Resource = writableDatabase.transaction {
        require(header.length <= 2000 && footer.length <= 2000)
        val page = requireResource(id)
        if (page.revision != expectedRevision) throw ContentConflict()
        require(page.deletedAt == null && page.kind == "document")
        val metadata = JSONObject(page.metadata)
        require(!metadata.has("doc") || metadata.isNull("doc") || metadata.optJSONObject("doc") != null)
        val doc = metadata.optJSONObject("doc") ?: JSONObject().also { metadata.put("doc", it) }
        if (doc.optString("header", "") == header && doc.optString("footer", "") == footer) return@transaction page
        doc.put("header", header).put("footer", footer)
        update("resources", ContentValues().apply { put("metadata", metadata.toString()) }, "id=?", arrayOf(id))
        bump(id, expectedRevision)
        record(id, "details_changed", JSONObject())
        requireResource(id)
    }

    fun updateDocumentTypography(id: String, expectedRevision: Long, size: Double, lineHeight: Double): Resource = writableDatabase.transaction {
        require(size.isFinite() && size in 6.0..48.0 && lineHeight.isFinite() && lineHeight in 1.0..3.0)
        val page = requireResource(id)
        if (page.revision != expectedRevision) throw ContentConflict()
        require(page.deletedAt == null && page.kind == "document")
        val metadata = JSONObject(page.metadata)
        require(!metadata.has("doc") || metadata.isNull("doc") || metadata.optJSONObject("doc") != null)
        val doc = metadata.optJSONObject("doc") ?: JSONObject().also { metadata.put("doc", it) }
        if (doc.optDouble("fontSize", 12.0) == size && doc.optDouble("lineHeight", 1.5) == lineHeight) return@transaction page
        doc.put("fontSize", size).put("lineHeight", lineHeight)
        update("resources", ContentValues().apply { put("metadata", metadata.toString()) }, "id=?", arrayOf(id))
        bump(id, expectedRevision); record(id, "details_changed", JSONObject()); requireResource(id)
    }

    /** Explicitly capture a recoverable local version. */
    fun createVersion(id: String, expectedRevision: Long, label: String? = null): ContentVersion = writableDatabase.transaction {
        val page = requireResource(id)
        check(page.deletedAt == null) { "Resource is in trash" }
        if (page.revision != expectedRevision) throw ContentConflict()
        captureVersion(page, label)
    }

    fun versions(id: String): List<ContentVersion> {
        val result = mutableListOf<ContentVersion>()
        readableDatabase.rawQuery("SELECT id,page_id,created_at,label,block_count FROM versions WHERE page_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200", arrayOf(id)).use {
            while (it.moveToNext()) result.add(ContentVersion(it.getString(0), it.getString(1), it.getLong(2), if (it.isNull(3)) null else it.getString(3), it.getInt(4)))
        }
        return result
    }

    fun history(id: String, limit: Int = 100): List<ContentEvent> {
        require(limit in 1..500)
        val result = mutableListOf<ContentEvent>()
        readableDatabase.rawQuery("SELECT id,page_id,kind,created_at,details FROM history WHERE page_id=? ORDER BY id DESC LIMIT ?", arrayOf(id, limit.toString())).use {
            while (it.moveToNext()) result.add(ContentEvent(it.getLong(0), it.getString(1), it.getString(2), it.getLong(3), it.getString(4)))
        }
        return result
    }

    /** Capture current content and restore a local version in the same transaction. */
    fun restoreVersion(id: String, versionId: String, expectedRevision: Long): Resource = writableDatabase.transaction {
        val current = requireResource(id)
        check(current.deletedAt == null) { "Resource is in trash" }
        if (current.revision != expectedRevision) throw ContentConflict()
        val snapshot = rawQuery("SELECT snapshot FROM versions WHERE id=? AND page_id=?", arrayOf(versionId, id)).use {
            require(it.moveToFirst()) { "Version not found for this resource" }; JSONObject(it.getString(0))
        }
        val title = snapshot.getString("title")
        val metadata = snapshot.getJSONObject("metadata").toString()
        val instructions = snapshot.getJSONArray("instructions").toString()
        val blocks = snapshot.getJSONArray("blocks")
        val nodes = (0 until blocks.length()).map { index ->
            val node = blocks.getJSONObject(index)
            val attrs = requireNotNull(node.optJSONObject("attrs")) { "Version block has no attributes" }
            val blockId = attrs.getString("bid")
            require(blockId.isNotBlank())
            val owner = rawQuery("SELECT page_id FROM blocks WHERE id=?", arrayOf(blockId)).use { if (it.moveToFirst()) it.getString(0) else null }
            require(owner == null || owner == id) { "Version block belongs to another resource" }
            Triple(blockId, node.toString(), plainText(node))
        }
        require(nodes.map { it.first }.toSet().size == nodes.size) { "Version has duplicate block IDs" }
        captureVersion(current, "Before restore")
        delete("blocks", "page_id=?", arrayOf(id))
        nodes.forEachIndexed { index, (blockId, json, text) ->
            insertOrThrow("blocks", null, ContentValues().apply { put("id", blockId); put("page_id", id); put("sort_key", index); put("content", json); put("text", text) })
        }
        update("resources", ContentValues().apply { put("title", title); put("metadata", metadata); put("instructions", instructions) }, "id=?", arrayOf(id))
        bump(id, expectedRevision)
        record(id, "version_restored", JSONObject().put("versionId", versionId))
        requireResource(id)
    }

    fun personalMoveDestinations(id: String, expectedRevision: Long): List<Resource> = readableDatabase.transaction {
        val source = requireResource(id)
        if (source.revision != expectedRevision) throw ContentConflict()
        require(source.deletedAt == null && source.kind in setOf("page", "document") && !insideTemplateTree(id))
        val result = mutableListOf<Resource>()
        rawQuery("""WITH RECURSIVE hidden(id) AS (
            SELECT id FROM resources WHERE kind='template' UNION SELECT r.id FROM resources r JOIN hidden h ON r.parent_id=h.id
        ), excluded(id) AS (
            SELECT id FROM resources WHERE id=? UNION SELECT r.id FROM resources r JOIN excluded e ON r.parent_id=e.id
        ) SELECT $COLS FROM resources WHERE deleted_at IS NULL AND kind IN ('page','document','project')
            AND id NOT IN (SELECT id FROM hidden) AND id NOT IN (SELECT id FROM excluded) ORDER BY sort_key,created_at,id""", arrayOf(id)).use {
            while (it.moveToNext()) result.add(it.resource())
        }
        result
    }

    fun move(id: String, expectedRevision: Long, parentId: String?, expectedParentRevision: Long? = null, personalOnly: Boolean = false): Resource = writableDatabase.transaction {
        val page = requireResource(id)
        check(page.deletedAt == null)
        if (page.revision != expectedRevision) throw ContentConflict()
        if (personalOnly) require(page.kind in setOf("page", "document") && !insideTemplateTree(id))
        if (parentId != null) {
            val parent = requireResource(parentId)
            check(parent.deletedAt == null)
            if (expectedParentRevision != null && parent.revision != expectedParentRevision) throw ContentConflict()
            if (personalOnly) require(parent.kind in setOf("page", "document", "project") && !insideTemplateTree(parentId))
            require(parentId !in subtree(id)) { "Cannot move a resource into itself or its descendants" }
        }
        if (personalOnly && page.parentId == parentId) return@transaction page
        val sort = nextSort(parentId)
        update("resources", ContentValues().apply { put("parent_id", parentId); put("sort_key", sort) }, "id=?", arrayOf(id))
        bump(id, expectedRevision)
        record(id, "moved", JSONObject().put("before", page.parentId ?: JSONObject.NULL).put("after", parentId ?: JSONObject.NULL))
        requireResource(id)
    }

    fun trash(id: String, expectedRevision: Long? = null) = writableDatabase.transaction {
        val root = requireResource(id)
        if (expectedRevision != null && root.revision != expectedRevision) throw ContentConflict()
        val group = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        for (item in subtree(id)) update("resources", ContentValues().apply { put("deleted_at", now); put("trash_group", group); put("revision", requireResource(item).revision + 1) }, "id=? AND deleted_at IS NULL", arrayOf(item))
        if (root.deletedAt == null) record(id, "trashed", JSONObject())
        Unit
    }

    fun restore(id: String) = writableDatabase.transaction {
        requireResource(id)
        val group = rawQuery("SELECT trash_group FROM resources WHERE id=?", arrayOf(id)).use { it.moveToFirst(); if (it.isNull(0)) null else it.getString(0) }
        if (group != null) {
            for (item in subtree(id)) execSQL("UPDATE resources SET deleted_at=NULL,trash_group=NULL,revision=revision+1 WHERE id=? AND trash_group=?", arrayOf(item, group))
            execSQL("UPDATE resources SET parent_id=NULL WHERE id=? AND parent_id IN (SELECT id FROM resources WHERE deleted_at IS NOT NULL)", arrayOf(id))
            record(id, "restored", JSONObject())
        }
        Unit
    }

    /** Literal substring search over titles and derived text, preserving Arabic text. */
    fun search(query: String, limit: Int = 50): List<Resource> {
        val q = query.trim()
        require(limit in 1..500)
        if (q.isEmpty()) return emptyList()
        val result = mutableListOf<Resource>()
        readableDatabase.rawQuery("SELECT $COLS FROM resources r WHERE r.deleted_at IS NULL AND r.kind!='template' AND (instr(lower(r.title),lower(?))>0 OR EXISTS (SELECT 1 FROM blocks b WHERE b.page_id=r.id AND instr(lower(b.text),lower(?))>0)) ORDER BY r.updated_at DESC,r.id LIMIT ?", arrayOf(q, q, limit.toString())).use {
            while (it.moveToNext()) result.add(it.resource())
        }
        return result
    }

    private fun SQLiteDatabase.subtree(id: String): List<String> {
        val ids = mutableListOf<String>()
        rawQuery("WITH RECURSIVE tree(id) AS (SELECT id FROM resources WHERE id=? UNION ALL SELECT r.id FROM resources r JOIN tree t ON r.parent_id=t.id) SELECT id FROM tree", arrayOf(id)).use { while (it.moveToNext()) ids.add(it.getString(0)) }
        return ids
    }
    private fun SQLiteDatabase.insideTemplateTree(id: String): Boolean = rawQuery(
        "WITH RECURSIVE ancestors(id,parent_id,kind) AS (SELECT id,parent_id,kind FROM resources WHERE id=? UNION SELECT r.id,r.parent_id,r.kind FROM resources r JOIN ancestors a ON r.id=a.parent_id) SELECT 1 FROM ancestors WHERE kind='template' LIMIT 1",
        arrayOf(id)).use { it.moveToFirst() }
    private fun SQLiteDatabase.captureVersion(page: Resource, label: String?): ContentVersion {
        val blocks = JSONArray()
        rawQuery("SELECT content FROM blocks WHERE page_id=? ORDER BY sort_key", arrayOf(page.id)).use {
            while (it.moveToNext()) blocks.put(JSONObject(it.getString(0)))
        }
        val snapshot = JSONObject().put("title", page.title).put("metadata", JSONObject(page.metadata))
            .put("instructions", JSONArray(page.instructions)).put("blocks", blocks).toString()
        require(snapshot.toByteArray(Charsets.UTF_8).size <= MAX_SNAPSHOT_BYTES) { "Version exceeds size limit" }
        val now = System.currentTimeMillis()
        val id = newResourceId(now)
        insertOrThrow("versions", null, ContentValues().apply { put("id", id); put("page_id", page.id); put("created_at", now); put("label", label); put("snapshot", snapshot); put("block_count", blocks.length()) })
        return ContentVersion(id, page.id, now, label, blocks.length())
    }
    private fun SQLiteDatabase.record(pageId: String, kind: String, details: JSONObject) {
        insertOrThrow("history", null, ContentValues().apply { put("page_id", pageId); put("kind", kind); put("created_at", System.currentTimeMillis()); put("details", details.toString()) })
    }
    private fun SQLiteDatabase.nextSort(parentId: String?): Double {
        val clause = if (parentId == null) "parent_id IS NULL" else "parent_id=?"
        val args = if (parentId == null) null else arrayOf(parentId)
        return rawQuery("SELECT COALESCE(MAX(sort_key)+1,0) FROM resources WHERE $clause", args).use { it.moveToFirst(); it.getDouble(0) }
    }
    private fun SQLiteDatabase.bump(id: String, revision: Long) {
        val values = ContentValues().apply { put("revision", revision + 1); put("updated_at", System.currentTimeMillis()) }
        if (update("resources", values, "id=? AND revision=?", arrayOf(id, revision.toString())) != 1) throw ContentConflict()
    }
    private fun SQLiteDatabase.findResource(id: String): Resource? = rawQuery("SELECT $COLS FROM resources WHERE id=?", arrayOf(id)).use { if (it.moveToFirst()) it.resource() else null }
    private fun SQLiteDatabase.requireResource(id: String) = requireNotNull(findResource(id)) { "Resource not found" }
    private fun android.database.Cursor.resource() = Resource(getString(0), getString(1), getString(2), if (isNull(3)) null else getString(3), getDouble(4), getString(5), getString(6), getLong(7), if (isNull(8)) null else getLong(8), getLong(9), getLong(10))
    private inline fun <T> SQLiteDatabase.transaction(block: SQLiteDatabase.() -> T): T { beginTransaction(); try { val result = block(); setTransactionSuccessful(); return result } finally { endTransaction() } }

    companion object {
        private const val COLS = "id,title,kind,parent_id,sort_key,metadata,instructions,revision,deleted_at,created_at,updated_at"
        private const val EDIT_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000L
        private const val MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
        const val MAX_IMAGE_BYTES = 16 * 1024 * 1024
        const val MAX_GALLERY_MEDIA_BYTES = 512L * 1024 * 1024
        private val KINDS = setOf("page", "document", "presentation", "project", "gallery", "file", "stream", "drawing", "template")
    }
}
