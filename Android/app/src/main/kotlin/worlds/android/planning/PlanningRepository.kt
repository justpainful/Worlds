package worlds.android.planning

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.content.ContentStore
import worlds.content.Resource

/** Reads and writes run one at a time, so every write sees the one before it. */
private val planningIo = Dispatchers.IO.limitedParallelism(1)

/**
 * Planning items through the same ContentStore as every other resource. The
 * fields are written to `metadata.<kind>` in the desktop's shape, merging so
 * no other key is touched. Changes show at once and are saved in order.
 */
internal class PlanningRepository(context: Context, databaseName: String) {
    private val store = ContentStore(context.applicationContext, databaseName)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    var rows by mutableStateOf<List<PlanRow>>(emptyList())
        private set
    var loading by mutableStateOf(true)
        private set
    var loadFailed by mutableStateOf(false)
        private set
    var writeFailed by mutableStateOf(false)
        private set

    fun load() {
        scope.launch {
            val result = withContext(planningIo) {
                runCatching {
                    val templates = store.templateTreeIds()
                    store.list().filter { it.id !in templates && it.kind != "template" }.map { PlanRow.of(it) }
                }
            }
            result.onSuccess { rows = it; loadFailed = false }.onFailure { loadFailed = true }
            loading = false
        }
    }

    fun dismissError() { writeFailed = false }

    private fun put(row: PlanRow) {
        rows = if (rows.any { it.id == row.id }) rows.map { if (it.id == row.id) row else it } else rows + row
    }

    private fun write(work: ContentStore.() -> Resource?, done: (PlanRow?) -> Unit = {}) {
        scope.launch {
            val result = withContext(planningIo) { runCatching { store.work() } }
            result.onSuccess { resource ->
                val row = resource?.let { PlanRow.of(it) }
                if (row != null) put(row)
                done(row)
            }.onFailure {
                writeFailed = true
                load()
            }
        }
    }

    private fun ContentStore.fresh(id: String): Resource = requireNotNull(this.load(id)?.resource) { "Resource not found" }

    /** Create an item. `fields` become `metadata.<kind>` exactly as given. */
    fun create(kind: String, title: String, parentId: String?, fields: Map<String, Any?>, done: (PlanRow) -> Unit = {}) {
        write({ this.create(kind, title.trim(), parentId, newKindMetadata(kind, fields)) }) { row -> if (row != null) done(row) }
    }

    /** Merge a patch into an item's fields. The list updates right away. */
    fun update(id: String, kind: String, patch: Map<String, Any?>) {
        rows.firstOrNull { it.id == id }?.let { current ->
            val key = dataKeyOf(kind)
            put(current.copy(data = JSONObject(mergeKindData(JSONObject().put(key, current.data).toString(), kind, patch)).getJSONObject(key)))
        }
        write({ val r = fresh(id); updateDetails(id, r.revision, mergeKindData(r.metadata, kind, patch), r.instructions) })
    }

    /** Replace an item's fields with a change computed from the saved ones. */
    fun change(id: String, kind: String, change: (JSONObject) -> JSONObject) {
        rows.firstOrNull { it.id == id }?.let { current -> put(current.copy(data = change(JSONObject(current.data.toString())))) }
        write({ val r = fresh(id); updateDetails(id, r.revision, replaceKindData(r.metadata, kind, change), r.instructions) })
    }

    fun rename(id: String, title: String) {
        val clean = title.trim()
        rows.firstOrNull { it.id == id }?.let { if (it.title == clean) return; put(it.copy(title = clean)) }
        write({ val r = fresh(id); this.rename(id, r.revision, clean) })
    }

    /** File an item under another one, or at the top level with null. Used to link a task to a goal. */
    fun move(id: String, parentId: String?) {
        rows.firstOrNull { it.id == id }?.let { if (it.parentId == parentId) return; put(it.copy(parentId = parentId)) }
        write({ val r = fresh(id); this.move(id, r.revision, parentId) })
    }

    /**
     * Turn an inbox capture into something else: the new item is made first,
     * then the capture goes to Trash, so a failed write never loses the words.
     */
    fun convert(captureId: String, conversion: Conversion, parentId: String? = null, done: (PlanRow) -> Unit = {}) {
        rows = rows.filter { it.id != captureId }
        write({
            val made = this.create(conversion.kind, conversion.title.trim(), parentId, conversion.metadata)
            this.trash(captureId)
            made
        }) { row -> if (row != null) done(row) }
    }

    /** Moves the item, and anything filed under it, to Trash. */
    fun trash(id: String) {
        val gone = mutableSetOf(id)
        var grew = true
        while (grew) {
            val more = rows.filter { it.parentId in gone && it.id !in gone }.map { it.id }
            grew = gone.addAll(more)
        }
        rows = rows.filter { it.id !in gone }
        write({ this.trash(id); null })
    }

    fun close() {
        scope.launch { withContext(planningIo) { store.close() } }
    }
}
