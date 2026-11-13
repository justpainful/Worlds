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
import worlds.android.DropdownMenu
import worlds.android.WorldsActionLabel
import worlds.android.WorldsCard

/*
 * Packs on Android (docs/PACKS.md, Design 4): a list of packs to turn on, then
 * each pack's views from its definition. A table is a list of rows, a board a
 * section per stage (one column at a time suits a phone), and an item opens
 * in an editor built from its fields. Teacher attendance and the other custom
 * desktop screens come later.
 */

@Composable internal fun PacksScreen(repo: PlanningRepository, onBack: () -> Unit, onAsk: (String) -> Unit = {}) {
    val context = LocalContext.current
    val catalog = remember { runCatching { PackCatalog.load(context) }.getOrNull() }
    var enabled by remember { mutableStateOf(PackPrefs.enabled(context)) }
    var open by rememberSaveable { mutableStateOf<String?>(null) }
    val arabic = currentLocale().language == "ar"
    val pack = open?.let { catalog?.pack(it) }
    if (pack != null) {
        PackScreen(pack, catalog!!, repo, arabic, onBack = { open = null }, onAsk = onAsk)
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

@Composable private fun PackScreen(pack: PackDef, catalog: PackCatalog, repo: PlanningRepository, arabic: Boolean, onBack: () -> Unit, onAsk: (String) -> Unit) {
    // The pack's own screens (Teacher attendance) come first, then its views.
    val tabs = pack.screens.map { it.id to it.label.text(arabic) } + pack.sidebarViews.map { it.id to it.label.text(arabic) }
    var viewId by rememberSaveable(pack.id) { mutableStateOf(tabs.firstOrNull()?.first) }
    val screen = pack.screens.firstOrNull { it.id == viewId }
    var asking by remember { mutableStateOf(false) }
    val today = PlanDates.today()
    var editing by remember { mutableStateOf<PlanRow?>(null) }
    // A new item starts from its definition: stages at their first step, checkboxes off, then opens.
    val add = { k: PackKind ->
        val start = linkedMapOf<String, Any?>()
        k.fields.forEach { f -> if (f.type == "checkbox") start[f.id] = false else if (f.type == "stage") f.options.firstOrNull()?.let { start[f.id] = it.id } }
        repo.create(k.kind, "", null, start) { made -> editing = made }
    }
    val view = if (screen != null) null else pack.sidebarViews.firstOrNull { it.id == viewId } ?: pack.sidebarViews.firstOrNull()
    val kind = view?.let { pack.kind(it.kind) }
    val titleOf = { id: String -> repo.rows.firstOrNull { it.id == id }?.title.orEmpty() }
    val items = kind?.let { k -> repo.rows.filter { it.kind == k.kind } }.orEmpty()
    val noneLabel = stringResource(R.string.packs_none)

    PlanScaffold(packTile(pack.icon), pack.label.text(arabic), (screen?.label ?: view?.label)?.text(arabic), onBack, trailing = {
        Row {
            if (pack.prompts.isNotEmpty()) Box {
                TextButton(onClick = { asking = true }) { WorldsActionLabel(R.drawable.ic_sparkles, stringResource(R.string.packs_ask_claude)) }
                DropdownMenu(expanded = asking, onDismissRequest = { asking = false }) {
                    pack.prompts.forEach { p -> DropdownMenuItem(text = { Text(p.label.text(arabic)) }, onClick = { asking = false; onAsk(p.prompt.text(arabic)) }) }
                }
            }
            if (kind != null) TextButton(onClick = { add(kind) }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.packs_add)) }
        }
    }) {
        planStatus(repo)
        // The pack's figures and what needs attention, worked out as on desktop.
        if (pack.stats.isNotEmpty() || pack.alerts.isNotEmpty()) item(key = "figures") { PackFigures(pack, repo.rows, arabic, today) }
        if (tabs.size > 1) item(key = "views") {
            PlanPills(tabs, viewId ?: "") { viewId = it }
        }
        if (screen?.component == "teacher.attendance") {
            item(key = "attendance") { TeacherAttendance(pack, repo, arabic) }
            return@PlanScaffold
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
            val lanes = group.options.map { it.id to it.label.text(arabic) } + if (group.type == "choice") listOf("" to noneLabel) else emptyList()
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
    PackFieldsDialog(row.id, row.data, pack, kind, arabic,
        linkOptions = { t -> repo.rows.filter { it.kind == t.kind }.map { it.id to it.title.ifBlank { "…" } } },
        onSave = { patch -> repo.rename(row.id, title); if (patch.isNotEmpty()) repo.update(row.id, row.kind, patch) },
        onDelete = { repo.trash(row.id) }, onClose = onClose) {
        PlanTextField(title, { title = it }, stringResource(R.string.plan_field_title))
    }
}

/**
 * A pack item's fields in a dialog built from its definition, for an item on
 * this phone or one shared from the desktop. `onSave` gets only the fields
 * that changed, with null for a field that was cleared.
 */
@Composable internal fun PackFieldsDialog(id: String, data: JSONObject, pack: PackDef, kind: PackKind, arabic: Boolean, linkOptions: (PackKind) -> List<Pair<String, String>>, onSave: (Map<String, Any?>) -> Unit, onDelete: (() -> Unit)? = null, onClose: () -> Unit, header: @Composable ColumnScope.() -> Unit = {}) {
    val values = remember(id) { mutableStateMapOf<String, Any?>().apply { kind.fields.forEach { f -> put(f.id, if (data.isNull(f.id)) null else data.opt(f.id)) } } }
    val texts = remember(id) { mutableStateMapOf<String, String>().apply { kind.fields.forEach { f -> put(f.id, editText(f, values[f.id])) } } }
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
                if (next != (if (data.isNull(f.id)) null else data.opt(f.id))) patch[f.id] = next
            }
            onSave(patch)
            onClose()
        },
        onDelete = onDelete?.let { remove -> { remove(); onClose() } }) {
        header()
        for (f in kind.fields) {
            val label = f.label.text(arabic)
            when (f.type) {
                "checkbox" -> SwitchRow(label, values[f.id] == true) { values[f.id] = it }
                "date" -> DateField(label, values[f.id] as? String, now, allowNone = true, onChange = { values[f.id] = it })
                "choice", "stage" -> ChoiceRow(label, f.options.map { it.id to it.label.text(arabic) }, values[f.id] as? String, allowNone = f.type == "choice") { values[f.id] = it }
                "link" -> {
                    val options = f.to?.let { pack.kind(it) }?.let(linkOptions).orEmpty()
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

/** A pack's figures as small cards, then each alert that has items. */
@Composable private fun PackFigures(pack: PackDef, rows: List<PlanRow>, arabic: Boolean, today: String) {
    fun ofKind(kindId: String) = pack.kind(kindId)?.let { k -> rows.filter { it.kind == k.kind } }.orEmpty()
    Column(Modifier.fillMaxWidth().padding(bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (pack.stats.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            pack.stats.forEach { st ->
                val v = PackRules.stat(ofKind(st.kind), st, today)
                val field = st.field?.let { f -> pack.kind(st.kind)?.fields?.firstOrNull { it.id == f } }
                val text = when {
                    v == null -> "0"
                    field?.type == "money" -> "${numberText(v)} ${field.currency ?: "SAR"}"
                    else -> numberText(v)
                }
                WorldsCard(Modifier.widthIn(min = 120.dp)) {
                    Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Text(text, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurface, maxLines = 1)
                        Text(st.label.text(arabic), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
                    }
                }
            }
        }
        pack.alerts.forEach { a ->
            val n = PackRules.filter(ofKind(a.kind), a.where, today).size
            if (n > 0) Text("${a.label.text(arabic)} ($n)", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        }
    }
}

/** The Teacher pack's daily attendance: one tap per student, as on desktop. */
@Composable private fun TeacherAttendance(pack: PackDef, repo: PlanningRepository, arabic: Boolean) {
    val classKind = pack.kind("class") ?: return
    val studentKind = pack.kind("student") ?: return
    val attendance = pack.kind("attendance") ?: return
    val statuses = attendance.fields.firstOrNull { it.id == "status" }?.options.orEmpty()
    val classes = repo.rows.filter { it.kind == classKind.kind }.sortedBy { it.title.lowercase() }
    var classId by rememberSaveable { mutableStateOf<String?>(null) }
    var day by rememberSaveable { mutableStateOf(PlanDates.today()) }
    val current = classId ?: classes.firstOrNull()?.id
    if (classes.isEmpty()) {
        PlanEmpty(packTile(classKind.icon), stringResource(R.string.packs_empty_title), classKind.plural.text(arabic))
        return
    }
    val students = repo.rows.filter { it.kind == studentKind.kind && it.data.optString("class") == current }
        .sortedWith(compareBy<PlanRow>({ it.data.optDouble("number", 999.0) }, { it.title.lowercase() }))
    val marks = repo.rows.filter { it.kind == attendance.kind && it.data.optString("date") == day }.associateBy { it.data.optString("student") }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            classes.forEach { c -> Choice(c.title.ifBlank { stringResource(R.string.untitled) }, c.id == current) { classId = c.id } }
        }
        DateField(stringResource(R.string.plan_field_date), day, PlanDates.today(), allowNone = false, onChange = { if (it != null) day = it })
        if (students.isEmpty()) PlanHint(studentKind.plural.text(arabic))
        else PlanGroup(students) { student, divider ->
            val mark = marks[student.id]
            val status = mark?.data?.optString("status").orEmpty()
            Column {
                Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(student.title, style = MaterialTheme.typography.bodyLarge, color = if (status == "absent") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        statuses.forEach { o ->
                            Choice(o.label.text(arabic), status == o.id) {
                                if (mark != null) repo.update(mark.id, attendance.kind, mapOf("status" to o.id))
                                else repo.create(attendance.kind, "${student.title}, $day", null, mapOf("student" to student.id, "date" to day, "status" to o.id, "parentTold" to false))
                            }
                        }
                    }
                }
                if (divider) HorizontalDivider(Modifier.padding(start = 14.dp), color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
