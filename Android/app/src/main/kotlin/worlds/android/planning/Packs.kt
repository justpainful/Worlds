package worlds.android.planning

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import worlds.android.R

/*
 * Packs on Android (docs/PACKS.md, Design 4): the same definitions as the
 * desktop, read from assets/packs.json, which the desktop exports with every
 * label in English and Arabic (src/packs/export.test.ts keeps it current).
 * Items are resources of kind "pack.kind" with their fields under
 * metadata.item, so a Teacher class made here opens on desktop and back.
 */

/** A label in both interface languages. */
internal data class Both(val en: String, val ar: String) {
    fun text(arabic: Boolean): String = if (arabic && ar.isNotBlank()) ar else en
}

internal data class PackOption(val id: String, val label: Both, val color: String?)

internal data class PackField(
    val id: String, val label: Both, val type: String, val options: List<PackOption>,
    val to: String?, val currency: String?, val detailOnly: Boolean,
)

internal data class PackKind(
    val id: String, val kind: String, val label: Both, val plural: Both, val icon: String,
    val dateField: String?, val stageField: String?, val doneField: String?, val fields: List<PackField>,
) {
    /** Fields a list shows (the rest are on the item). */
    val listFields: List<PackField> get() = fields.filter { !it.detailOnly }
}

internal data class PackView(val id: String, val label: Both, val type: String, val kind: String, val groupBy: String?, val columns: List<String>?)

internal data class PackDef(
    val id: String, val family: String, val label: Both, val blurb: Both, val icon: String,
    val kinds: List<PackKind>, val views: List<PackView>, val sidebar: List<String>,
) {
    fun kind(id: String): PackKind? = kinds.firstOrNull { it.id == id }
    val sidebarViews: List<PackView> get() = sidebar.mapNotNull { id -> views.firstOrNull { it.id == id } }
}

internal data class PackFamily(val id: String, val label: Both)

internal data class PackCatalog(val families: List<PackFamily>, val packs: List<PackDef>) {
    fun pack(id: String): PackDef? = packs.firstOrNull { it.id == id }

    /** The pack and kind behind a stored kind, if a pack defines it. */
    fun kindOf(stored: String): Pair<PackDef, PackKind>? {
        for (p in packs) for (k in p.kinds) if (k.kind == stored) return p to k
        return null
    }

    companion object {
        fun parse(text: String): PackCatalog {
            val root = JSONObject(text)
            fun both(o: JSONObject?) = Both(o?.optString("en").orEmpty(), o?.optString("ar").orEmpty())
            fun JSONObject.str(key: String): String? = if (isNull(key)) null else optString(key).ifBlank { null }
            fun <T> JSONArray?.map(f: (JSONObject) -> T): List<T> = if (this == null) emptyList() else (0 until length()).map { f(getJSONObject(it)) }
            val families = root.optJSONArray("families").map { PackFamily(it.getString("id"), both(it.optJSONObject("label"))) }
            val packs = root.optJSONArray("packs").map { p ->
                PackDef(
                    id = p.getString("id"), family = p.optString("family"), label = both(p.optJSONObject("label")), blurb = both(p.optJSONObject("blurb")), icon = p.optString("icon"),
                    kinds = p.optJSONArray("kinds").map { k ->
                        PackKind(
                            id = k.getString("id"), kind = k.getString("kind"), label = both(k.optJSONObject("label")), plural = both(k.optJSONObject("plural")), icon = k.optString("icon"),
                            dateField = k.str("dateField"), stageField = k.str("stageField"), doneField = k.str("doneField"),
                            fields = k.optJSONArray("fields").map { f ->
                                PackField(
                                    id = f.getString("id"), label = both(f.optJSONObject("label")), type = f.optString("type"),
                                    options = f.optJSONArray("options").map { o -> PackOption(o.getString("id"), both(o.optJSONObject("label")), o.str("color")) },
                                    to = f.str("to"), currency = f.str("currency"), detailOnly = f.optBoolean("detailOnly"),
                                )
                            },
                        )
                    },
                    views = p.optJSONArray("views").map { v ->
                        val cols = v.optJSONArray("columns")
                        PackView(v.getString("id"), both(v.optJSONObject("label")), v.optString("type"), v.optString("kind"), v.str("groupBy"),
                            cols?.let { a -> (0 until a.length()).map { a.getString(it) } })
                    },
                    sidebar = p.optJSONArray("sidebar")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty(),
                )
            }
            return PackCatalog(families, packs)
        }

        @Volatile private var cached: PackCatalog? = null

        fun load(context: Context): PackCatalog = cached ?: synchronized(this) {
            cached ?: parse(context.assets.open("packs.json").bufferedReader().use { it.readText() }).also { cached = it }
        }
    }
}

/** Which packs are on, kept on this device like the Study switch. */
internal object PackPrefs {
    private const val FILE = "worlds.packs"
    private const val KEY = "enabled"

    fun enabled(context: Context): Set<String> = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getStringSet(KEY, emptySet()).orEmpty()

    fun setEnabled(context: Context, id: String, on: Boolean) {
        val next = enabled(context).toMutableSet().apply { if (on) add(id) else remove(id) }
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putStringSet(KEY, next).apply()
    }
}

/** The product icon of a pack or kind, when this app ships it; layers otherwise. */
internal fun packTile(name: String): Int = when (name) {
    "briefcase" -> R.drawable.pi_briefcase
    "calendar" -> R.drawable.pi_calendar
    "checklist", "clipboard" -> R.drawable.pi_checklist
    "document", "contract", "invoice", "notes" -> R.drawable.pi_document
    "film", "video", "camera" -> R.drawable.pi_film
    "graduation" -> R.drawable.pi_graduation
    "home", "key", "palm-tree" -> R.drawable.pi_home
    "image", "design", "creative" -> R.drawable.pi_image
    "inbox", "mail" -> R.drawable.pi_inbox
    "library", "book", "bookmark", "writing" -> R.drawable.pi_library
    "notebook" -> R.drawable.pi_notebook
    "paintbrush" -> R.drawable.pi_paintbrush
    "presentation" -> R.drawable.pi_presentation
    "profile", "team", "meeting" -> R.drawable.pi_profile
    "settings", "engineering" -> R.drawable.pi_settings
    "sparkles" -> R.drawable.pi_sparkles
    "spreadsheet", "chart-bar" -> R.drawable.pi_spreadsheet
    "target", "trophy" -> R.drawable.pi_target
    else -> R.drawable.pi_layers
}

/** What a field shows in a list: text, a choice's label, a number, a tick. */
internal fun packValue(field: PackField, data: JSONObject, arabic: Boolean, titleOf: (String) -> String): String {
    if (!data.has(field.id) || data.isNull(field.id)) return ""
    val v = data.opt(field.id)
    return when (field.type) {
        "choice", "stage" -> field.options.firstOrNull { it.id == v }?.label?.text(arabic).orEmpty()
        "checkbox" -> if (v == true) "✓" else ""
        "link" -> (v as? String)?.let(titleOf).orEmpty()
        "money" -> (v as? Number)?.let { "${numberText(it.toDouble())} ${field.currency ?: "SAR"}" }.orEmpty()
        "number" -> (v as? Number)?.let { numberText(it.toDouble()) }.orEmpty()
        else -> v?.toString().orEmpty()
    }
}
