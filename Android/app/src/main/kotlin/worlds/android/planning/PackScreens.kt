package worlds.android.planning

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import worlds.android.R
import worlds.android.Switch
import worlds.android.WorldsActionLabel

/*
 * Packs on Android (docs/PACKS.md, Design 4): a list of packs to turn on, then
 * each pack's views from its definition. A table is a list of rows, a board a
 * section per stage (one column at a time suits a phone), and an item opens
 * in an editor built from its fields. Teacher attendance and the other custom
 * desktop screens come later.
 */

@Composable internal fun PacksScreen(repo: PlanningRepository, onBack: () -> Unit) {
    val context = LocalContext.current
    val catalog = remember { runCatching { PackCatalog.load(context) }.getOrNull() }
    var enabled by remember { mutableStateOf(PackPrefs.enabled(context)) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    val arabic = currentLocale().language == "ar"
    val pack = open?.let { catalog?.pack(it) }
    if (pack != null) {
        PackScreen(pack, catalog!!, repo, arabic, onBack = { open = null })
        return
    }
    PlanScaffold(R.drawable.pi_layers, stringResource(R.string.packs_title), stringResource(R.string.packs_subtitle), onBack) {
        planStatus(repo)
        if (catalog == null) {
            item(key = "packs-missing") { PlanHint(stringResource(R.string.plan_load_error)) }
            return@PlanScaffold
        }
        for (family in catalog.families) {
            val packs = catalog.packs.filter { it.family == family.id && it.id != "study" && it.sidebarViews.isNotEmpty() }
            if (packs.isEmpty()) continue
            item(key = "family-${family.id}") { PlanGroupTitle(family.label.text(arabic)) }
            item(key = "group-${family.id}") {
                PlanGroup(packs) { p, divider ->
                    val on = p.id in enabled
                    PlanRowItem(p.label.text(arabic), done = false, divider = divider,
                        onClick = { if (on) open = p.id else { PackPrefs.setEnabled(context, p.id, true); enabled = PackPrefs.enabled(context); open = p.id } },
                        leading = { PlanMark(packTile(p.icon), null) },
                        meta = listOf(p.blurb.text(arabic) to null),
                        trailing = { Switch(checked = on, onCheckedChange = { v -> PackPrefs.setEnabled(context, p.id, v); enabled = PackPrefs.enabled(context) }) })
                }
            }
        }
    }
}

@Composable private fun PackScreen(pack: PackDef, catalog: PackCatalog, repo: PlanningRepository, arabic: Boolean, onBack: () -> Unit) {
    var viewId by rememberSaveable(pack.id) { mutableStateOf(pack.sidebarViews.firstOrNull()?.id) }
    var editing by remember { mutableStateOf<PlanRow?>(null) }
    // A new item starts from its definition: stages at their first step, checkboxes off, then opens.
    val add = { k: PackKind ->
        val start = linkedMapOf<String, Any?>()
        k.fields.forEach { f -> if (f.type == "checkbox") start[f.id] = false else if (f.type == "stage") f.options.firstOrNull()?.let { start[f.id] = it.id } }
        repo.create(k.kind, "", null, start) { made -> editing = made }
    }
    val view = pack.sidebarViews.firstOrNull { it.id == viewId } ?: pack.sidebarViews.firstOrNull()
    val kind = view?.let { pack.kind(it.kind) }
    val titleOf = { id: String -> repo.rows.firstOrNull { it.id == id }?.title.orEmpty() }
    val items = kind?.let { k -> repo.rows.filter { it.kind == k.kind } }.orEmpty()

    PlanScaffold(packTile(pack.icon), pack.label.text(arabic), view?.label?.text(arabic), onBack, trailing = {
        if (kind != null) TextButton(onClick = { add(kind) }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.packs_add)) }
    }) {
        planStatus(repo)
        if (pack.sidebarViews.size > 1) item(key = "views") {
            PlanPills(pack.sidebarViews.map { it.id to it.label.text(arabic) }, view?.id ?: "") { viewId = it }
        }
        if (view == null || kind == null) return@PlanScaffold
        if (items.isEmpty()) {
            item(key = "empty") {
                PlanEmpty(packTile(kind.icon), stringResource(R.string.packs_empty_title), kind.plural.text(arabic)) {
                    TextButton(onClick = { add(kind) }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.packs_add)) }
                }
            }
            return@PlanScaffold
        }
        val shown = (view.columns?.mapNotNull { c -> kind.fields.firstOrNull { it.id == c } } ?: kind.listFields).take(3)
        val group = view.groupBy?.let { g -> kind.fields.firstOrNull { it.id == g } }
        if (view.type == "board" && group != null) {
            // A board on a phone: one section per lane, in the stage's order.
            val lanes = group.options.map { it.id to it.label.text(arabic) } + if (group.type == "choice") listOf("" to stringResource(R.string.packs_none)) else emptyList()
            for ((lane, label) in lanes) {
                val inLane = items.filter { (it.data.opt(group.id) as? String ?: if (group.type == "stage") group.options.firstOrNull()?.id else "") == lane }
                if (inLane.isEmpty()) continue
                item(key = "lane-$lane") { PlanGroupTitle(label, inLane.size) }
                item(key = "lane-items-$lane") { PackRows(inLane, kind, shown.filter { it.id != group.id }, arabic, titleOf) { editing = it } }
            }
        } else {
            item(key = "rows") { PackRows(items.sortedBy { it.title.lowercase() }, kind, shown, arabic, titleOf) { editing = it } }
        }
    }

    editing?.let { row -> catalog.kindOf(row.kind)?.let { (p, k) -> PackItemEditor(row, p, k, repo, arabic, onClose = { editing = null }) } }
}

@Composable private fun PackRows(rows: List<PlanRow>, kind: PackKind, shown: List<PackField>, arabic: Boolean, titleOf: (String) -> String, onOpen: (PlanRow) -> Unit) {
    PlanGroup(rows) { row, divider ->
        val done = kind.doneField?.let { row.data.optBoolean(it) } ?: false
        val meta = shown.mapNotNull { f -> packValue(f, row.data, arabic, titleOf).ifBlank { null }?.let { "${f.label.text(arabic)}: $it" to null } }
        PlanRowItem(row.title, done = done, divider = divider, onClick = { onOpen(row) }, leading = { PlanMark(packTile(kind.icon), null) }, meta = meta)
    }
}

/** An item's fields, edited as its definition says: text, numbers, dates, choices, ticks and links. */
@Composable private fun PackItemEditor(row: PlanRow, pack: PackDef, kind: PackKind, repo: PlanningRepository, arabic: Boolean, onClose: () -> Unit) {
    var title by rememberSaveable(row.id) { mutableStateOf(row.title) }
    val values = remember(row.id) { mutableStateMapOf<String, Any?>().apply { kind.fields.forEach { f -> put(f.id, if (row.data.isNull(f.id)) null else row.data.opt(f.id)) } } }
    val texts = remember(row.id) { mutableStateMapOf<String, String>().apply { kind.fields.forEach { f -> put(f.id, editText(f, values[f.id])) } } }
    val now = PlanDates.today()
    val numbersOk = kind.fields.filter { it.type == "number" || it.type == "money" }.all { numberValid(texts[it.id].orEmpty()) }
    EditorDialog(kind.label.text(arabic), onDismiss = onClose, saveEnabled = numbersOk,
        onSave = {
            val patch = linkedMapOf<String, Any?>()
            for (f in kind.fields) {
                val next: Any? = when (f.type) {
                    "number", "money" -> numberOf(texts[f.id].orEmpty())
                    "text", "longText", "url", "email", "phone", "time" -> texts[f.id].orEmpty().ifBlank { null }
                    else -> values[f.id]
                }
                if (next != (if (row.data.isNull(f.id)) null else row.data.opt(f.id))) patch[f.id] = next
            }
            repo.rename(row.id, title)
            if (patch.isNotEmpty()) repo.update(row.id, row.kind, patch)
            onClose()
        },
        onDelete = { repo.trash(row.id); onClose() }) {
        PlanTextField(title, { title = it }, stringResource(R.string.plan_field_title))
        for (f in kind.fields) {
            val label = f.label.text(arabic)
            when (f.type) {
                "checkbox" -> SwitchRow(label, values[f.id] == true) { values[f.id] = it }
                "date" -> DateField(label, values[f.id] as? String, now, allowNone = true, onChange = { values[f.id] = it })
                "choice", "stage" -> ChoiceRow(label, f.options.map { it.id to it.label.text(arabic) }, values[f.id] as? String, allowNone = f.type == "choice") { values[f.id] = it }
                "link" -> {
                    val target = f.to?.let { pack.kind(it) }
                    val options = target?.let { t -> repo.rows.filter { it.kind == t.kind }.map { it.id to it.title.ifBlank { "…" } } }.orEmpty()
                    ChoiceRow(label, options, values[f.id] as? String, allowNone = true) { values[f.id] = it }
                }
                "number", "money" -> PlanTextField(texts[f.id].orEmpty(), { texts[f.id] = it }, if (f.type == "money") "$label (${f.currency ?: "SAR"})" else label, isError = !numberValid(texts[f.id].orEmpty()), number = true)
                "longText" -> PlanTextField(texts[f.id].orEmpty(), { texts[f.id] = it }, label, multiline = true)
                else -> PlanTextField(texts[f.id].orEmpty(), { texts[f.id] = it }, label)
            }
        }
    }
}

@Composable private fun ChoiceRow(label: String, options: List<Pair<String, String>>, value: String?, allowNone: Boolean, onChange: (String?) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FieldLabel(label, options.firstOrNull { it.first == value }?.second)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (allowNone) Choice(stringResource(R.string.packs_none), value == null) { onChange(null) }
            options.forEach { (id, text) -> Choice(text, value == id) { onChange(id) } }
        }
    }
}

private fun editText(field: PackField, v: Any?): String = when {
    v == null || v == JSONObject.NULL -> ""
    field.type == "number" || field.type == "money" -> (v as? Number)?.let { numberText(it.toDouble()) }.orEmpty()
    else -> v.toString()
}
