package worlds.android

import android.content.Context
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.content.ContentStore
import worlds.content.Resource
import worlds.content.SpreadsheetCell
import worlds.content.SpreadsheetEditing
import worlds.content.SpreadsheetEvaluator

/** Loads and saves run one at a time, so a reopen always sees the last save. */
private val spreadsheetIo = Dispatchers.IO.limitedParallelism(1)
private const val SAVE_DELAY_MS = 220L

private class SpreadsheetModel(context: Context, databaseName: String, private val resourceId: String) {
    private val store = ContentStore(context.applicationContext, databaseName)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var saveJob: Job? = null
    private var dirty = false
    var workbook by mutableStateOf<JSONObject?>(null)
        private set
    var version by mutableIntStateOf(0)
        private set
    var loadFailed by mutableStateOf(false)
        private set
    var saveFailed by mutableStateOf(false)
        private set

    fun load() {
        loadFailed = false
        scope.launch {
            val loaded = withContext(spreadsheetIo) { runCatching { SpreadsheetEditing.workbook(store.load(resourceId)!!.resource.metadata) } }
            loaded.onSuccess { workbook = it; version++ }.onFailure { loadFailed = true }
        }
    }

    fun edit(change: (JSONObject) -> Unit) {
        val current = workbook ?: return
        change(current)
        version++
        dirty = true
        saveJob?.cancel()
        saveJob = scope.launch { delay(SAVE_DELAY_MS); flush() }
    }

    fun flush() {
        saveJob?.cancel()
        if (!dirty) return
        val snapshot = workbook?.toString() ?: return
        dirty = false
        scope.launch {
            val saved = withContext(spreadsheetIo) { runCatching { store.saveWorkbook(resourceId, snapshot) } }
            saved.onSuccess { saveFailed = false }.onFailure { dirty = true; saveFailed = true }
        }
    }

    fun close() {
        flush()
        scope.launch { withContext(spreadsheetIo) { store.close() } }
    }
}

private val rowHeaderWidth = 44.dp
private val cellWidth = 116.dp
private val cellHeight = 34.dp

@Composable
internal fun SpreadsheetScreen(resource: Resource, onBack: () -> Unit, modifier: Modifier = Modifier, databaseName: String = "worlds-content.db") {
    val context = LocalContext.current
    val model = remember(resource.id, databaseName) { SpreadsheetModel(context, databaseName, resource.id) }
    var activeCell by rememberSaveable(resource.id) { mutableStateOf("A1") }
    var draft by rememberSaveable(resource.id) { mutableStateOf("") }
    var draftLoaded by rememberSaveable(resource.id) { mutableStateOf(false) }

    val workbook = model.workbook
    fun commitDraft() {
        val current = model.workbook ?: return
        if (!draftLoaded) return
        val sheet = SpreadsheetEditing.activeSheet(current)
        if (draft != SpreadsheetEditing.rawValue(sheet, activeCell)) model.edit { SpreadsheetEditing.setCell(sheet, activeCell, draft) }
    }
    fun selectCell(key: String) {
        commitDraft()
        activeCell = key
        model.workbook?.let { draft = SpreadsheetEditing.rawValue(SpreadsheetEditing.activeSheet(it), key) }
    }
    fun leave() { commitDraft(); model.flush(); onBack() }

    val latestCommit by rememberUpdatedState(::commitDraft)
    DisposableEffect(model) {
        model.load()
        onDispose { latestCommit(); model.close() }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { commitDraft(); model.flush() }
    LaunchedEffect(workbook) {
        if (workbook != null && !draftLoaded) { draft = SpreadsheetEditing.rawValue(SpreadsheetEditing.activeSheet(workbook), activeCell); draftLoaded = true }
    }
    BackHandler { leave() }

    val version = model.version
    val evaluated = remember(workbook, version) { workbook?.let { SpreadsheetEvaluator(it).evaluate() }.orEmpty() }

    Column(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            WorldsBackButton(::leave)
            WorldsTile(R.drawable.pi_spreadsheet, 34.dp)
            Text(resource.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onBackground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (model.saveFailed) Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.spreadsheet_save_error), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            TextButton(onClick = model::flush) { Text(stringResource(R.string.retry)) }
        }
        when {
            model.loadFailed -> Column {
                Text(stringResource(R.string.spreadsheet_load_error), color = MaterialTheme.colorScheme.error)
                TextButton(onClick = model::load) { Text(stringResource(R.string.retry)) }
            }
            workbook == null -> CircularProgressIndicator()
            else -> {
                val sheet = SpreadsheetEditing.activeSheet(workbook)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                        Text(activeCell, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp).testTag("spreadsheet-active-cell"), style = MaterialTheme.typography.labelLarge)
                    }
                    OutlinedTextField(value = draft, onValueChange = { draft = it }, modifier = Modifier.weight(1f).testTag("spreadsheet-formula"), singleLine = true, shape = RoundedCornerShape(12.dp),
                        placeholder = { Text(stringResource(R.string.spreadsheet_formula_hint), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { commitDraft() }))
                    Button(onClick = { commitDraft() }, modifier = Modifier.testTag("spreadsheet-apply")) { Text(stringResource(R.string.spreadsheet_apply)) }
                }
                // Columns read left to right on every device, so A1 is in the same place everywhere.
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    SpreadsheetGrid(sheet, evaluated[sheet.getString("id")].orEmpty(), version, activeCell, Modifier.weight(1f), ::selectCell)
                }
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    SpreadsheetEditing.sheets(workbook).forEach { item ->
                        val active = item.getString("id") == sheet.getString("id")
                        Text(item.getString("name"), modifier = Modifier.clip(CircleShape).background(if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface).clickable {
                            commitDraft()
                            model.edit { it.put("activeSheetId", item.getString("id")) }
                            draft = SpreadsheetEditing.rawValue(item, activeCell)
                        }.padding(horizontal = 14.dp, vertical = 9.dp), style = MaterialTheme.typography.labelLarge, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                    }
                    val addLabel = stringResource(R.string.spreadsheet_add_sheet)
                    IconButton(onClick = { commitDraft(); model.edit { SpreadsheetEditing.addSheet(it) }; draft = "" }, modifier = Modifier.semantics { contentDescription = addLabel }) { WorldsGlyph(R.drawable.ic_plus) }
                }
            }
        }
    }
}

@Composable private fun SpreadsheetGrid(sheet: JSONObject, values: Map<String, SpreadsheetCell>, version: Int, activeCell: String, modifier: Modifier, onSelect: (String) -> Unit) {
    val columns = sheet.getInt("cols")
    val rows = sheet.getInt("rows")
    val scroll = rememberScrollState()
    val hairline = MaterialTheme.colorScheme.outlineVariant
    val shape = RoundedCornerShape(12.dp)
    Column(modifier.clip(shape).border(0.5.dp, MaterialTheme.colorScheme.outline, shape).background(MaterialTheme.colorScheme.surface)) {
        Row {
            HeaderCell("", rowHeaderWidth)
            Row(Modifier.horizontalScroll(scroll)) { repeat(columns) { HeaderCell(SpreadsheetEditing.colToName(it), cellWidth) } }
        }
        LazyColumn(Modifier.fillMaxSize().testTag("spreadsheet-grid")) {
            items((0 until rows).toList(), key = { it }) { row ->
                Row {
                    HeaderCell("${row + 1}", rowHeaderWidth)
                    SpreadsheetRow(sheet, values, version, row, columns, activeCell, scroll, hairline, onSelect)
                }
            }
        }
    }
}

@Composable private fun SpreadsheetRow(sheet: JSONObject, values: Map<String, SpreadsheetCell>, @Suppress("UNUSED_PARAMETER") version: Int, row: Int, columns: Int, activeCell: String, scroll: ScrollState, hairline: Color, onSelect: (String) -> Unit) {
    val cells = sheet.getJSONObject("cells")
    Row(Modifier.horizontalScroll(scroll)) {
        repeat(columns) { col ->
            val key = SpreadsheetEditing.cellKey(row, col)
            val value = values[key]
            val style = cells.optJSONObject(key)?.optJSONObject("s")
            val active = key == activeCell
            val background = style?.optString("bg")?.let(::parseCssColor)
            val align = when (style?.optString("align")) { "center" -> TextAlign.Center; "right" -> TextAlign.Right; "left" -> TextAlign.Left; else -> if (value?.isNumber == true) TextAlign.Right else TextAlign.Start }
            Box(Modifier.size(cellWidth, cellHeight)
                .background(if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.14f) else background ?: Color.Transparent)
                .border(if (active) 1.5.dp else 0.5.dp, if (active) MaterialTheme.colorScheme.primary else hairline)
                .clickable { onSelect(key) }.testTag("cell-$key").padding(horizontal = 7.dp), contentAlignment = Alignment.CenterStart) {
                if (value != null && value.display.isNotEmpty()) Text(value.display, modifier = Modifier.fillMaxWidth(), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = align, style = MaterialTheme.typography.bodySmall,
                    fontWeight = if (style?.optBoolean("bold") == true) FontWeight.SemiBold else null, fontStyle = if (style?.optBoolean("italic") == true) FontStyle.Italic else null,
                    textDecoration = when { style?.optBoolean("underline") == true -> TextDecoration.Underline; style?.optBoolean("strike") == true -> TextDecoration.LineThrough; else -> null },
                    color = if (value.error != null) MaterialTheme.colorScheme.error else style?.optString("color")?.let(::parseCssColor) ?: MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

@Composable private fun HeaderCell(label: String, width: androidx.compose.ui.unit.Dp) {
    Box(Modifier.size(width, cellHeight).background(MaterialTheme.colorScheme.surfaceContainerHigh).border(0.5.dp, MaterialTheme.colorScheme.outlineVariant), contentAlignment = Alignment.Center) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun parseCssColor(value: String): Color? = if (value.isBlank()) null else runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrNull()
