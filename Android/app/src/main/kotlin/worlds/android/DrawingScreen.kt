package worlds.android

import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.shape.RoundedCornerShape
import worlds.android.glass.LocalGlassBackdrop
import worlds.android.glass.glassBackdropSource
import worlds.android.glass.rememberGlassBackdrop
import worlds.android.glass.worldsGlass
import worlds.android.glass.worldsGlassLens
import android.app.Application
import android.content.Context
import android.net.Uri
import android.os.Build
import android.graphics.Canvas
import android.view.MotionEvent
import android.view.InputDevice
import android.view.View
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.*
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import worlds.content.Resource
import worlds.content.ContentStore
import worlds.stylus.*
import kotlin.math.*

internal data class PendingStroke(val samples: List<StrokeSample>, val brush: StrokeBrush, val erase: Boolean, val color: String)
private enum class DrawingExport { IMAGE, PROJECT }
private data class ExportSnapshot(val document: String, val format: DrawingExport)

internal data class DrawingLayerInfo(val id: String, val name: String, val visible: Boolean, val opacity: Double, val blend: String)
internal data class CanvasRefImage(val id: String = java.util.UUID.randomUUID().toString(), val uri: Uri, val x: Float = 40f, val y: Float = 40f, val scale: Float = 1.0f, val opacity: Float = 0.75f, val visible: Boolean = true)
internal data class CanvasAnnotation(val id: String = java.util.UUID.randomUUID().toString(), val sceneX: Double, val sceneY: Double, val text: String, val author: String = "Author", val timestamp: Long = System.currentTimeMillis())

private class DrawingModel(app: Application, private val resource: Resource, databaseName: String) : AndroidViewModel(app) {
    private val drawingId = resource.id
    private val content = ContentStore(app, databaseName)
    private val store = DrawingStore(app)
    var document by mutableStateOf<String?>(null); private set
    var busy by mutableStateOf(false); private set
    var failed by mutableStateOf(false); private set
    var pending by mutableStateOf<PendingStroke?>(null); private set
    var exportStatus by mutableStateOf<Int?>(null); private set
    var gesture by mutableStateOf(false); private set
    var selectedStrokes by mutableStateOf<Set<String>>(emptySet()); private set
    fun selectStroke(id: String?) { selectedStrokes = id?.let(::setOf) ?: emptySet() }
    fun selectStrokes(ids: Set<String>) { selectedStrokes = ids.toSet() }
    var viewport by mutableStateOf(DrawingViewport()); private set
    private var exportSnapshot: ExportSnapshot? = null

    var activeLayerId by mutableStateOf<String?>(null); private set
    fun selectActiveLayer(id: String?) { activeLayerId = id }

    var referenceImages by mutableStateOf<List<CanvasRefImage>>(emptyList()); private set
    fun addReferenceImage(uri: Uri) { referenceImages = referenceImages + CanvasRefImage(uri = uri) }
    fun updateReferenceImage(image: CanvasRefImage) { referenceImages = referenceImages.map { if (it.id == image.id) image else it } }
    fun removeReferenceImage(id: String) { referenceImages = referenceImages.filterNot { it.id == id } }

    var annotations by mutableStateOf<List<CanvasAnnotation>>(emptyList()); private set
    fun addAnnotation(x: Double, y: Double, text: String) { annotations = annotations + CanvasAnnotation(sceneX = x, sceneY = y, text = text) }
    fun removeAnnotation(id: String) { annotations = annotations.filterNot { it.id == id } }

    fun addLayer(name: String) {
        val doc = document ?: return
        if (busy || pending != null || gesture) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.addLayer(drawingId, JSONObject(doc).getInt("revision"), name).toString() } }
            if (result.isSuccess) {
                document = result.getOrThrow()
                val layers = JSONObject(document!!).getJSONObject("scene").getJSONObject("layers")
                val keys = layers.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    if (layers.getJSONObject(k).optString("name") == name) { activeLayerId = k; break }
                }
            } else failed = true
            busy = false
        }
    }

    fun removeLayer(layerId: String) {
        val doc = document ?: return
        if (busy || pending != null || gesture) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.removeLayer(drawingId, JSONObject(doc).getInt("revision"), layerId).toString() } }
            if (result.isSuccess) { document = result.getOrThrow(); if (activeLayerId == layerId) activeLayerId = null } else failed = true
            busy = false
        }
    }

    fun updateLayer(layerId: String, visible: Boolean? = null, opacity: Double? = null, blend: String? = null, name: String? = null) {
        val doc = document ?: return
        if (busy || pending != null || gesture) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.updateLayer(drawingId, JSONObject(doc).getInt("revision"), layerId, visible, opacity, blend, name).toString() } }
            if (result.isSuccess) document = result.getOrThrow() else failed = true
            busy = false
        }
    }

    fun reorderLayers(order: List<String>) {
        val doc = document ?: return
        if (busy || pending != null || gesture) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.reorderLayers(drawingId, JSONObject(doc).getInt("revision"), order).toString() } }
            if (result.isSuccess) document = result.getOrThrow() else failed = true
            busy = false
        }
    }

    fun scaleStrokes(ids: Set<String>, scaleX: Double, scaleY: Double, originX: Double, originY: Double) {
        val doc = document ?: return
        if (busy || pending != null) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.scaleStrokes(drawingId, JSONObject(doc).getInt("revision"), ids, scaleX, scaleY, originX, originY).toString() } }
            if (result.isSuccess) document = result.getOrThrow() else failed = true
            busy = false
        }
    }

    fun rotateStrokes(ids: Set<String>, angleDeg: Double, originX: Double, originY: Double) {
        val doc = document ?: return
        if (busy || pending != null) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.rotateStrokes(drawingId, JSONObject(doc).getInt("revision"), ids, angleDeg, originX, originY).toString() } }
            if (result.isSuccess) document = result.getOrThrow() else failed = true
            busy = false
        }
    }

    fun updateGesture(active: Boolean) { gesture = active }
    fun updateViewport(value: DrawingViewport) { viewport = value }
    fun zoom(factor: Double) { if (!gesture && !busy && pending == null) viewport = viewport.zoomCentered(factor) }
    fun fit() { if (!gesture && !busy && pending == null) viewport = DrawingViewport() }
    init { load() }
    fun load() {
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.loadOrCreate(drawingId, content, JSONObject(resource.metadata).optBoolean("androidImportedDrawing", false)).toString().also { DrawingInk.parse(it) } } }
            document = result.getOrNull(); failed = result.isFailure; busy = false
        }
    }
    fun commit(stroke: PendingStroke) { if (busy || pending != null) return; pending = stroke; retry() }
    fun retry() {
        val stroke = pending ?: return
        val doc = document ?: return
        if (busy) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.addStroke(drawingId, JSONObject(doc).getInt("revision"), stroke.samples, stroke.brush, stroke.erase, stroke.color, activeLayerId).toString() } }
            if (result.isSuccess) { document = result.getOrThrow(); pending = null } else failed = true
            busy = false
        }
    }
    fun discard() { if (!busy) { pending = null; failed = false } }
    fun prepareExport(format: DrawingExport): Boolean {
        val doc = document ?: return false
        if (busy || pending != null || gesture) return false
        if (format == DrawingExport.PROJECT && JSONObject(doc).getJSONArray("operations").length() > 500) { exportStatus = R.string.drawing_project_limit; return false }
        exportSnapshot = ExportSnapshot(doc, format); exportStatus = null; busy = true
        return true
    }
    fun exportTo(uri: Uri?) {
        val snapshot = exportSnapshot
        exportSnapshot = null
        if (uri == null || snapshot == null) { if (uri != null) exportStatus = R.string.drawing_export_interrupted; busy = false; return }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val data = when (snapshot.format) { DrawingExport.IMAGE -> DrawingInk.png(snapshot.document); DrawingExport.PROJECT -> DrawingPackage.encode(snapshot.document) }
                requireNotNull(getApplication<Application>().contentResolver.openOutputStream(uri, "w")) { "File could not be opened" }.use { it.write(data); it.flush() }
            } }
            exportStatus = when {
                result.exceptionOrNull() is DrawingPackage.HistoryLimit -> R.string.drawing_project_limit
                result.isSuccess && snapshot.format == DrawingExport.PROJECT -> R.string.drawing_project_success
                result.isSuccess -> R.string.drawing_export_success
                snapshot.format == DrawingExport.PROJECT -> R.string.drawing_project_error
                else -> R.string.drawing_export_error
            }
            busy = false
        }
    }
    fun pickerFailed(format: DrawingExport) { exportSnapshot = null; exportStatus = if (format == DrawingExport.PROJECT) R.string.drawing_project_error else R.string.drawing_export_error; busy = false }
    fun moveStrokes(ids: Set<String>, dx: Double, dy: Double) {
        val doc = document ?: return
        if (busy || pending != null) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.moveStrokes(drawingId, JSONObject(doc).getInt("revision"), ids, dx, dy).toString() } }
            if (result.isSuccess) document = result.getOrThrow() else failed = true
            busy = false
        }
    }
    fun removeSelectedStroke() {
        val doc = document ?: return; val ids = selectedStrokes.toSet(); if (ids.isEmpty()) return
        if (busy || pending != null || gesture) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.removeStrokes(drawingId, JSONObject(doc).getInt("revision"), ids).toString() } }
            if (result.isSuccess) { document = result.getOrThrow(); selectedStrokes = emptySet() } else failed = true
            busy = false
        }
    }
    fun duplicateSelectedStrokes() {
        val doc = document ?: return; val ids = selectedStrokes.toSet(); if (ids.isEmpty()) return
        if (busy || pending != null || gesture) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.duplicateStrokes(drawingId, JSONObject(doc).getInt("revision"), ids) } }
            if (result.isSuccess) { val (updated, copies) = result.getOrThrow(); document = updated.toString(); selectedStrokes = copies } else failed = true
            busy = false
        }
    }
    fun toggle(redo: Boolean) {
        val doc = document ?: return
        if (busy || pending != null || gesture) return
        busy = true; failed = false
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.toggle(drawingId, JSONObject(doc).getInt("revision"), redo).toString() } }
            if (result.isSuccess) { document = result.getOrThrow(); selectedStrokes = emptySet() } else failed = true
            busy = false
        }
    }
    override fun onCleared() { store.close(); content.close() }
}

private fun historyAvailable(json: String): Pair<Boolean, Boolean> {
    val ops = JSONObject(json).getJSONArray("operations"); val enabled = mutableMapOf<String, Boolean>()
    for (i in 0 until ops.length()) {
        val op = ops.getJSONObject(i)
        if (op.getString("actor") != "android-local") continue
        if (op.getString("type") == "edit") enabled[op.getString("id")] = true else enabled[op.getString("target")] = op.getBoolean("enabled")
    }
    var redo = false
    for (i in ops.length() - 1 downTo 0) {
        val op = ops.getJSONObject(i)
        if (op.getString("actor") != "android-local") continue
        if (op.getString("type") == "edit") break
        if (!op.getBoolean("enabled") && enabled[op.getString("target")] == false) { redo = true; break }
    }
    return enabled.values.any { it } to redo
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun DrawingScreen(resource: Resource, onBack: () -> Unit, modifier: Modifier = Modifier, databaseName: String = "worlds-content.db") {
    val app = androidx.compose.ui.platform.LocalContext.current.applicationContext as Application
    val factory = remember(resource.id) { object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST") override fun <T : ViewModel> create(modelClass: Class<T>): T = DrawingModel(app, resource, databaseName) as T
    } }
    val model: DrawingModel = viewModel(key = "drawing-${resource.id}", factory = factory)
    var tool by rememberSaveable(resource.id) { mutableStateOf("pen") }
    var multiSelect by rememberSaveable(resource.id) { mutableStateOf(false) }
    LaunchedEffect(tool) { if (tool != "select") { multiSelect = false; model.selectStroke(null) } }
    val erase = tool == "eraser"
    var inkColor by rememberSaveable(resource.id) { mutableStateOf("#202023") }
    var highlightColor by rememberSaveable(resource.id) { mutableStateOf("#e6c235") }
    var penWidth by rememberSaveable(resource.id) { mutableFloatStateOf(8f) }
    var pencilWidth by rememberSaveable(resource.id) { mutableFloatStateOf(4f) }
    var highlightWidth by rememberSaveable(resource.id) { mutableFloatStateOf(28f) }
    var eraserWidth by rememberSaveable(resource.id) { mutableFloatStateOf(24f) }
    var barrelEraser by rememberSaveable(resource.id) { mutableStateOf(false) }
    var showSettings by rememberSaveable(resource.id) { mutableStateOf(false) }
    var showLayers by rememberSaveable(resource.id) { mutableStateOf(false) }
    var showRefImages by rememberSaveable(resource.id) { mutableStateOf(false) }
    var activeAnnotationDialog by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    var viewingAnnotation by remember { mutableStateOf<CanvasAnnotation?>(null) }
    val refImagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> uri?.let { model.addReferenceImage(it) } }
    val exportPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/png")) { uri -> model.exportTo(uri) }
    val projectPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/x-worlds-drawing")) { uri -> model.exportTo(uri) }
    var showExport by remember { mutableStateOf(false) }
    val drawingFocus = remember(resource.id) { FocusRequester() }
    var drawingHasFocus by remember(resource.id) { mutableStateOf(false) }
    val activity = androidx.activity.compose.LocalActivity.current as? MainActivity
    DisposableEffect(activity, drawingHasFocus, showSettings, showExport, showLayers, showRefImages) {
        val owner = Any()
        if (drawingHasFocus && !showSettings && !showExport && !showLayers && !showRefImages) activity?.drawingShortcutOwner = owner
        onDispose { if (activity?.drawingShortcutOwner === owner) activity.drawingShortcutOwner = null }
    }
    LaunchedEffect(resource.id) { drawingFocus.requestFocus() }
    if (showLayers) {
        val layers = remember(model.document) {
            val doc = model.document
            if (doc != null) runCatching {
                val scene = JSONObject(doc).getJSONObject("scene")
                val layersObj = scene.getJSONObject("layers")
                val order = scene.getJSONArray("layerOrder")
                (0 until order.length()).map { i ->
                    val lid = order.getString(i)
                    val l = layersObj.getJSONObject(lid)
                    DrawingLayerInfo(lid, l.optString("name", "Layer ${i + 1}"), l.optBoolean("visible", true), l.optDouble("opacity", 1.0), l.optString("blend", "source-over"))
                }
            }.getOrDefault(emptyList()) else emptyList()
        }
        var newLayerName by remember { mutableStateOf("") }
        var showAddLayerField by remember { mutableStateOf(false) }
        AlertDialog(onDismissRequest = { showLayers = false },
            title = { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.drawing_layers)) },
            text = {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    layers.forEachIndexed { index, layer ->
                        val isActive = (model.activeLayerId == layer.id) || (model.activeLayerId == null && index == 0)
                        Card(colors = CardDefaults.cardColors(containerColor = if (isActive) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.35f)), modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(10.dp)) {
                                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    RadioButton(selected = isActive, onClick = { model.selectActiveLayer(layer.id) })
                                    Text(layer.name, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                    IconButton(onClick = { model.updateLayer(layer.id, visible = !layer.visible) }) {
                                        WorldsGlyph(if (layer.visible) R.drawable.ic_check else R.drawable.ic_check, tint = if (layer.visible) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f))
                                    }
                                    if (layers.size > 1) {
                                        IconButton(onClick = { model.removeLayer(layer.id) }) {
                                            WorldsGlyph(R.drawable.ic_trash_2, tint = MaterialTheme.colorScheme.error)
                                        }
                                    }
                                }
                                Text(stringResource(R.string.drawing_layer_opacity, (layer.opacity * 100).roundToInt()), style = MaterialTheme.typography.bodySmall)
                                Slider(value = layer.opacity.toFloat(), onValueChange = { model.updateLayer(layer.id, opacity = it.toDouble()) }, valueRange = 0f..1f, steps = 10)
                                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                    if (index > 0) {
                                        TextButton(onClick = {
                                            val reordered = layers.map { it.id }.toMutableList()
                                            java.util.Collections.swap(reordered, index, index - 1)
                                            model.reorderLayers(reordered)
                                        }) { WorldsActionLabel(R.drawable.ic_arrow_up, "Up") }
                                    }
                                    if (index < layers.lastIndex) {
                                        TextButton(onClick = {
                                            val reordered = layers.map { it.id }.toMutableList()
                                            java.util.Collections.swap(reordered, index, index + 1)
                                            model.reorderLayers(reordered)
                                        }) { WorldsActionLabel(R.drawable.ic_arrow_down, "Down") }
                                    }
                                }
                            }
                        }
                    }
                    if (showAddLayerField) {
                        OutlinedTextField(value = newLayerName, onValueChange = { newLayerName = it.take(40) }, label = { Text(stringResource(R.string.drawing_layer_name)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(enabled = newLayerName.isNotBlank(), onClick = { model.addLayer(newLayerName.trim()); newLayerName = ""; showAddLayerField = false }) { Text(stringResource(R.string.create)) }
                            TextButton(onClick = { showAddLayerField = false }) { Text(stringResource(R.string.cancel)) }
                        }
                    } else {
                        Button(onClick = { showAddLayerField = true }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.drawing_add_layer)) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showLayers = false }) { Text(stringResource(R.string.close)) } }
        )
    }
    if (showRefImages) {
        AlertDialog(onDismissRequest = { showRefImages = false },
            title = { WorldsActionLabel(R.drawable.ic_image, stringResource(R.string.drawing_ref_image)) },
            text = {
                Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { refImagePicker.launch("image/*") }) {
                        WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.drawing_add_ref_image))
                    }
                    if (model.referenceImages.isEmpty()) {
                        Text(stringResource(R.string.drawing_local_note), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    model.referenceImages.forEach { ref ->
                        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)), modifier = Modifier.fillMaxWidth()) {
                            Column(Modifier.padding(10.dp)) {
                                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    Text("Ref Image", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                    Switch(checked = ref.visible, onCheckedChange = { model.updateReferenceImage(ref.copy(visible = it)) })
                                    IconButton(onClick = { model.removeReferenceImage(ref.id) }) {
                                        WorldsGlyph(R.drawable.ic_trash_2, tint = MaterialTheme.colorScheme.error)
                                    }
                                }
                                Text("Opacity: ${(ref.opacity * 100).roundToInt()}%", style = MaterialTheme.typography.bodySmall)
                                Slider(value = ref.opacity, onValueChange = { model.updateReferenceImage(ref.copy(opacity = it)) }, valueRange = 0.1f..1.0f)
                                Text("Scale: ${((ref.scale * 100).roundToInt()) / 100f}x", style = MaterialTheme.typography.bodySmall)
                                Slider(value = ref.scale, onValueChange = { model.updateReferenceImage(ref.copy(scale = it)) }, valueRange = 0.2f..3.0f)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showRefImages = false }) { Text(stringResource(R.string.close)) } }
        )
    }
    activeAnnotationDialog?.let { (x, y) ->
        var noteText by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { activeAnnotationDialog = null },
            title = { WorldsActionLabel(R.drawable.ic_message_circle, stringResource(R.string.drawing_add_comment)) },
            text = {
                OutlinedTextField(value = noteText, onValueChange = { noteText = it.take(500) }, placeholder = { Text(stringResource(R.string.drawing_comment_placeholder)) }, maxLines = 4, modifier = Modifier.fillMaxWidth())
            },
            confirmButton = {
                Button(enabled = noteText.isNotBlank(), onClick = {
                    model.addAnnotation(x, y, noteText.trim())
                    activeAnnotationDialog = null
                }) { Text(stringResource(R.string.save)) }
            },
            dismissButton = { TextButton(onClick = { activeAnnotationDialog = null }) { Text(stringResource(R.string.cancel)) } }
        )
    }
    viewingAnnotation?.let { ann ->
        AlertDialog(onDismissRequest = { viewingAnnotation = null },
            title = { WorldsActionLabel(R.drawable.ic_message_circle, stringResource(R.string.drawing_comment)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(ann.author, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                    Text(ann.text, style = MaterialTheme.typography.bodyLarge)
                }
            },
            confirmButton = { TextButton(onClick = { viewingAnnotation = null }) { Text(stringResource(R.string.close)) } },
            dismissButton = { TextButton(onClick = { model.removeAnnotation(ann.id); viewingAnnotation = null }) { Text(stringResource(R.string.remove), color = MaterialTheme.colorScheme.error) } }
        )
    }
    LaunchedEffect(resource.id) { drawingFocus.requestFocus() }
    if (showSettings) {
        val colors = listOf("#202023" to R.string.drawing_black, "#245b93" to R.string.drawing_blue, "#b33335" to R.string.drawing_red, "#2c764c" to R.string.drawing_green, "#e6c235" to R.string.drawing_yellow)
        val selectedColor = if (tool == "highlighter") highlightColor else inkColor
        AlertDialog(onDismissRequest = { showSettings = false }, title = { WorldsActionLabel(R.drawable.ic_sliders_horizontal, stringResource(R.string.drawing_settings)) }, text = {
            Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.drawing_color))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    colors.forEach { (value, label) ->
                        FilterChip(selected = selectedColor == value, onClick = { if (tool == "highlighter") highlightColor = value else inkColor = value }, colors = FilterChipDefaults.filterChipColors(selectedContainerColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.22f), selectedLabelColor = MaterialTheme.colorScheme.onSurface), label = {
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                Box(Modifier.size(14.dp).background(androidx.compose.ui.graphics.Color(android.graphics.Color.parseColor(value)), CircleShape))
                                Spacer(Modifier.width(6.dp)); Text(stringResource(label))
                            }
                        })
                    }
                }
                val penLabel = stringResource(R.string.drawing_pen_width_label)
                val eraserLabel = stringResource(R.string.drawing_eraser_width_label)
                val pencilLabel = stringResource(R.string.drawing_pencil_width_label)
                val highlighterLabel = stringResource(R.string.drawing_highlighter_width_label)
                val sliderColors = SliderDefaults.colors(thumbColor = MaterialTheme.colorScheme.primary, activeTrackColor = MaterialTheme.colorScheme.primary,
                    inactiveTrackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.22f), activeTickColor = MaterialTheme.colorScheme.onPrimary,
                    inactiveTickColor = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.55f))
                Text(stringResource(R.string.drawing_pen_width, penWidth.toInt()))
                Slider(value = penWidth, onValueChange = { penWidth = it }, valueRange = 4f..64f, steps = 14, colors = sliderColors, modifier = Modifier.semantics { contentDescription = penLabel })
                Text(stringResource(R.string.drawing_pencil_width, pencilWidth.toInt()))
                Slider(value = pencilWidth, onValueChange = { pencilWidth = it }, valueRange = 1f..32f, steps = 30, colors = sliderColors, modifier = Modifier.semantics { contentDescription = pencilLabel })
                Text(stringResource(R.string.drawing_highlighter_width, highlightWidth.toInt()))
                Slider(value = highlightWidth, onValueChange = { highlightWidth = it }, valueRange = 4f..64f, steps = 14, colors = sliderColors, modifier = Modifier.semantics { contentDescription = highlighterLabel })
                Text(stringResource(R.string.drawing_eraser_width, eraserWidth.toInt()))
                Slider(value = eraserWidth, onValueChange = { eraserWidth = it }, valueRange = 4f..64f, steps = 14, colors = sliderColors, modifier = Modifier.semantics { contentDescription = eraserLabel })
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    WorldsGlyph(R.drawable.ic_eraser)
                    Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
                        Text(stringResource(R.string.drawing_barrel_eraser))
                        Text(stringResource(R.string.drawing_barrel_eraser_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    val label = stringResource(R.string.drawing_barrel_eraser)
                    Switch(checked = barrelEraser, onCheckedChange = { barrelEraser = it }, modifier = Modifier.semantics { contentDescription = label })
                }
                Spacer(Modifier.height(16.dp))
                Text(stringResource(R.string.drawing_shortcuts_title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurface)
                Text(stringResource(R.string.drawing_shortcuts_detail), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }, confirmButton = { TextButton(onClick = { showSettings = false }) { Text(stringResource(R.string.close)) } })
    }
    BackHandler { if (!model.busy && model.pending == null && !model.gesture) onBack() }
    Column(modifier.fillMaxHeight().onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown || event.nativeKeyEvent.repeatCount != 0 || event.isAltPressed || event.isMetaPressed || showSettings || showExport || model.document == null || model.busy || model.pending != null || model.gesture) false
        else if (event.isCtrlPressed) {
            val (canUndo, canRedo) = historyAvailable(model.document!!)
            when {
                event.key == Key.Z && !event.isShiftPressed && canUndo -> { model.toggle(false); true }
                ((event.key == Key.Z && event.isShiftPressed) || (event.key == Key.Y && !event.isShiftPressed)) && canRedo -> { model.toggle(true); true }
                event.key == Key.Zero && !event.isShiftPressed -> { model.fit(); true }
                event.key == Key.D && !event.isShiftPressed && tool == "select" && model.selectedStrokes.isNotEmpty() -> { model.selectStroke(null); true }
                else -> false
            }
        } else if (!event.isShiftPressed) when (event.key) {
            Key.B -> { tool = "pen"; true }
            Key.P -> { tool = "pencil"; true }
            Key.H -> { tool = "highlighter"; true }
            Key.E -> { tool = "eraser"; true }
            Key.M -> { tool = "select"; true }
            Key.Delete, Key.Backspace -> if (tool == "select" && model.selectedStrokes.isNotEmpty()) { model.removeSelectedStroke(); true } else false
            else -> false
        } else false
    }.focusRequester(drawingFocus).onFocusChanged { drawingHasFocus = it.hasFocus }.focusable()) {
        val backdrop = rememberGlassBackdrop()
        val current = model.document
        val canvasDescription = stringResource(R.string.drawing_canvas)
        val surround = MaterialTheme.colorScheme.surfaceContainerLow.toArgb()
        val accentArgb = MaterialTheme.colorScheme.primary.toArgb()
        val chromeEnabled = !model.gesture && !model.busy
        val panelsEnabled = chromeEnabled && model.pending == null
        CompositionLocalProvider(LocalGlassBackdrop provides backdrop) {
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().glassBackdropSource(backdrop).background(MaterialTheme.colorScheme.surfaceContainerLow), contentAlignment = androidx.compose.ui.Alignment.Center) {
                    if (current != null) AndroidView(factory = { context -> InkView(context) },
                        update = { view -> view.document = current; view.selectionMode = tool == "select"; view.multiSelect = multiSelect; view.selectedGroup = model.selectedStrokes; view.selectionGroupChanged = model::selectStrokes; view.moveStrokes = model::moveStrokes; view.scaleStrokes = model::scaleStrokes; view.rotateStrokes = model::rotateStrokes; view.referenceImages = model.referenceImages; view.annotations = model.annotations; view.commentMode = tool == "comment"; view.onAnnotationClick = { viewingAnnotation = it }; view.onCanvasTappedForAnnotation = { x, y -> activeAnnotationDialog = x to y }; view.erase = erase; view.barrelEraser = barrelEraser; view.highlighter = tool == "highlighter"; view.pencil = tool == "pencil"; view.inkColor = if (tool == "highlighter") highlightColor else inkColor; view.penWidth = penWidth.toDouble(); view.pencilWidth = pencilWidth.toDouble(); view.highlightWidth = highlightWidth.toDouble(); view.eraserWidth = eraserWidth.toDouble(); view.canDraw = !model.busy && model.pending == null; view.pending = model.pending; view.complete = model::commit; view.gestureChanged = model::updateGesture; view.viewport = model.viewport; view.viewportChanged = model::updateViewport; view.surroundColor = surround; view.accentColor = accentArgb; view.invalidate() },
                        modifier = Modifier.fillMaxSize().semantics { contentDescription = canvasDescription })
                    else if (model.busy) CircularProgressIndicator()
                }
                Column(Modifier.align(androidx.compose.ui.Alignment.TopCenter).fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        WorldsGlassBackButton(onBack, enabled = !model.busy && model.pending == null && !model.gesture)
                        Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                            Text(resource.title, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onBackground)
                            Text(stringResource(R.string.drawing_local_note), maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Row(Modifier.height(50.dp).worldsGlass(RoundedCornerShape(25.dp)).padding(horizontal = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            DockButton(R.drawable.ic_files, stringResource(R.string.drawing_layers), panelsEnabled) { showLayers = true }
                            DockButton(R.drawable.ic_image, stringResource(R.string.drawing_ref_image), panelsEnabled) { showRefImages = true }
                            DockButton(R.drawable.ic_sliders_horizontal, stringResource(R.string.drawing_settings), panelsEnabled) { showSettings = true }
                            Box {
                                DockButton(R.drawable.ic_download, stringResource(R.string.drawing_export), model.document != null && !model.busy && model.pending == null && !model.gesture) { showExport = true }
                DropdownMenu(expanded = showExport, onDismissRequest = { showExport = false }) {
                    listOf(DrawingExport.IMAGE to R.string.drawing_export_png, DrawingExport.PROJECT to R.string.drawing_export_project).forEach { (format, label) ->
                        DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = {
                            showExport = false
                            if (model.prepareExport(format)) {
                                val filename = resource.title.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_").trim().take(80).ifBlank { "Worlds" }
                                runCatching { if (format == DrawingExport.IMAGE) exportPicker.launch("$filename.png") else projectPicker.launch("$filename.worldsdraw") }.onFailure { model.pickerFailed(format) }
                            }
                        })
                    }
                }
                            }
                        }
                    }
                    model.exportStatus?.let { Text(stringResource(it), color = if (it in setOf(R.string.drawing_export_error, R.string.drawing_export_interrupted, R.string.drawing_project_error, R.string.drawing_project_limit)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onBackground) }
                    if (model.failed) {
                        Text(stringResource(if (model.document == null) R.string.drawing_loading_error else if (model.pending != null) R.string.drawing_error else R.string.drawing_operation_error), color = MaterialTheme.colorScheme.error)
                        if (model.pending != null) {
                            TextButton(onClick = model::retry) { Text(stringResource(R.string.retry)) }
                            TextButton(onClick = model::discard) { Text(stringResource(R.string.discard)) }
                        } else if (model.document == null) TextButton(onClick = model::load) { Text(stringResource(R.string.retry)) }
                    }
                }
                val (canUndo, canRedo) = model.document?.let(::historyAvailable) ?: (false to false)
                val navigationEnabled = !model.busy && model.pending == null && !model.gesture
                FlowRow(Modifier.align(androidx.compose.ui.Alignment.BottomCenter).fillMaxWidth().padding(horizontal = 12.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, androidx.compose.ui.Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (tool == "select") Row(Modifier.height(50.dp).worldsGlass(RoundedCornerShape(25.dp)).padding(horizontal = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        DockButton(R.drawable.ic_list_plus, stringResource(R.string.drawing_multi_select), chromeEnabled, chosen = multiSelect) { multiSelect = !multiSelect; if (!multiSelect) model.selectStroke(null) }
                        if (model.selectedStrokes.isNotEmpty()) {
                            DockButton(R.drawable.ic_files, stringResource(R.string.drawing_duplicate_selection), chromeEnabled) { model.duplicateSelectedStrokes() }
                            DockButton(R.drawable.ic_x, stringResource(R.string.drawing_clear_selection, model.selectedStrokes.size), chromeEnabled) { model.selectStroke(null) }
                            DockButton(R.drawable.ic_trash_2, stringResource(if (model.selectedStrokes.size == 1) R.string.drawing_remove_stroke else R.string.drawing_remove_strokes), navigationEnabled) { model.removeSelectedStroke() }
                        }
                    }
                    Row(Modifier.height(50.dp).worldsGlass(RoundedCornerShape(25.dp)).padding(horizontal = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        DockButton(R.drawable.ic_undo_2, stringResource(R.string.drawing_undo), canUndo && navigationEnabled) { model.toggle(false) }
                        DockButton(R.drawable.ic_redo_2, stringResource(R.string.drawing_redo), canRedo && navigationEnabled) { model.toggle(true) }
                        DockButton(R.drawable.ic_zoom_out, stringResource(R.string.drawing_zoom_out), navigationEnabled && model.viewport.zoom > 0.5) { model.zoom(0.8) }
                        Text(stringResource(R.string.drawing_zoom_value, (model.viewport.zoom * 100).roundToInt()), modifier = Modifier.widthIn(min = 44.dp), maxLines = 1, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        DockButton(R.drawable.ic_zoom_in, stringResource(R.string.drawing_zoom_in), navigationEnabled && model.viewport.zoom < 16.0) { model.zoom(1.25) }
                        DockButton(R.drawable.ic_maximize, stringResource(R.string.drawing_fit), navigationEnabled) { model.fit() }
                    }
                    Row(Modifier.height(56.dp).worldsGlass(RoundedCornerShape(28.dp)).padding(horizontal = 6.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        listOf(Triple("pen", R.drawable.ic_pen_line, R.string.drawing_pen), Triple("pencil", R.drawable.ic_pencil, R.string.drawing_pencil), Triple("highlighter", R.drawable.ic_highlighter, R.string.drawing_highlighter), Triple("eraser", R.drawable.ic_eraser, R.string.drawing_eraser), Triple("select", R.drawable.ic_maximize, R.string.drawing_select), Triple("comment", R.drawable.ic_message_circle, R.string.drawing_comment)).forEach { (value, icon, labelId) ->
                            DockButton(icon, stringResource(labelId), chromeEnabled, chosen = tool == value) { tool = value; model.selectStroke(null) }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun DockButton(icon: Int, label: String, enabled: Boolean = true, chosen: Boolean = false, onClick: () -> Unit) {
    Box(Modifier.size(42.dp).then(if (chosen) Modifier.worldsGlassLens(CircleShape) else Modifier).clip(CircleShape).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = label; selected = chosen }, contentAlignment = androidx.compose.ui.Alignment.Center) {
        Icon(painterResource(icon), contentDescription = null, modifier = Modifier.size(21.dp), tint = when { !enabled -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.34f); chosen -> MaterialTheme.colorScheme.primary; else -> MaterialTheme.colorScheme.onSurface })
    }
}

internal class InkView(context: Context) : View(context) {
    var document = ""
        set(value) { if (value != field) { saved = DrawingInk.parse(value); field = value; stablePicture = null; stablePictureAttempted = false } }
    private var saved: List<InkStroke> = emptyList()
    private var stablePicture: android.graphics.Picture? = null
    private var stablePictureAttempted = false
    var selectionMode = false
        set(value) { if (field != value) { selectedIds = emptySet(); selectionPointer = null; field = value; invalidate() } }
    var multiSelect = false
    var moveStroke: (String, Double, Double) -> Unit = { _, _, _ -> }
    var moveStrokes: ((Set<String>, Double, Double) -> Unit)? = null
    var scaleStrokes: ((Set<String>, Double, Double, Double, Double) -> Unit)? = null
    var rotateStrokes: ((Set<String>, Double, Double, Double) -> Unit)? = null
    var referenceImages: List<CanvasRefImage> = emptyList()
        set(value) { field = value; invalidate() }
    var annotations: List<CanvasAnnotation> = emptyList()
        set(value) { field = value; invalidate() }
    var onAnnotationClick: ((CanvasAnnotation) -> Unit)? = null
    var onCanvasTappedForAnnotation: ((Double, Double) -> Unit)? = null
    var commentMode = false
    private val imageBitmaps = mutableMapOf<Uri, android.graphics.Bitmap?>()
    private var activeHandle: Int? = null
    private var transformOriginX = 0.0
    private var transformOriginY = 0.0
    private var transformStartX = 0.0
    private var transformStartY = 0.0
    private var transformCurrentX = 0.0
    private var transformCurrentY = 0.0
    var selectionChanged: (String?) -> Unit = {}
    var selectionGroupChanged: (Set<String>) -> Unit = {}
    var selected: String?
        get() = selectedIds.firstOrNull()
        set(value) { selectedGroup = value?.let(::setOf) ?: emptySet() }
    var selectedGroup: Set<String>
        get() = selectedIds
        set(value) { if (selectedIds != value) { selectedIds = value.toSet(); invalidate() } }
    private var selectedIds: Set<String> = emptySet()
    private var toggleOnTap: String? = null
    private var selectionPointer: Int? = null
    private var selectionPen = false
    private var selectionScreenX = 0.0; private var selectionScreenY = 0.0
    private var selectionStartX = 0.0; private var selectionStartY = 0.0
    private var selectionDx = 0.0; private var selectionDy = 0.0
    var erase = false
    var barrelEraser = false
    var highlighter = false
    var pencil = false
    var surroundColor = android.graphics.Color.rgb(224, 224, 224)
    var accentColor = android.graphics.Color.rgb(10, 132, 255)
    var inkColor = "#202023"
    var penWidth = 8.0
    var pencilWidth = 4.0
    var highlightWidth = 28.0
    var eraserWidth = 24.0
    var canDraw = true
    var pending: PendingStroke? = null
    var complete: (PendingStroke) -> Unit = {}
    var gestureChanged: (Boolean) -> Unit = {}
    var viewport = DrawingViewport()
    var viewportChanged: (DrawingViewport) -> Unit = {}
    private val active = mutableMapOf<Int, MutableList<StrokeSample>>()
    private val activeErase = mutableMapOf<Int, Boolean>()
    private val activeColor = mutableMapOf<Int, String>()
    private val activeBrush = mutableMapOf<Int, StrokeBrush>()
    private var currentPointer: Int? = null
    private var fingerId: Int? = null
    private val penIds = mutableSetOf<Int>()
    private var suppressFinger = false
    private var navigation: Navigation? = null
    private var deferredPenEnd: Int? = null
    private var hoverPosition: Pair<Float, Float>? = null
    private var hoverEraser = false
    internal val isStylusHovering: Boolean get() = hoverPosition != null
    private val hoverPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        style = android.graphics.Paint.Style.STROKE; strokeWidth = 2f; color = android.graphics.Color.DKGRAY
    }
    private data class Navigation(val first: Int, val second: Int, var x: Double, var y: Double, var span: Double, val original: DrawingViewport,
        val penPointer: Int?, val penCheckpoint: Int?)
    private fun brushFor(erasing: Boolean, first: StrokeSample): StrokeBrush = when {
        erasing -> StrokeBrush(size = eraserWidth)
        highlighter -> StrokeBrush(kind = "highlighter", size = highlightWidth, opacity = 0.35, pressureSize = false)
        pencil -> pencilBrush(pencilWidth, first)
        else -> StrokeBrush(size = penWidth)
    }
    private fun toScene(sample: StylusSample, frame: DrawingViewport.Transform): StrokeSample {
            val (scale, left, top) = frame
            val pressure = sample.pressure?.toDouble()?.takeIf { it.isFinite() }?.coerceIn(0.01, 1.0) ?: 1.0
            val tilt = sample.tiltRadians?.toDouble()?.takeIf { it.isFinite() }?.coerceIn(0.0, 1.56) ?: 0.0
            val orientation = sample.orientationRadians?.toDouble()?.takeIf { it.isFinite() } ?: 0.0
            return StrokeSample((sample.x - left) / scale, (sample.y - top) / scale, pressure,
                Math.toDegrees(atan(tan(tilt) * sin(orientation))), Math.toDegrees(atan(-tan(tilt) * cos(orientation))), sample.timeMillis.toDouble())
    }
    private fun erases(sample: StylusSample): Boolean = erase || sample.eraser ||
        (barrelEraser && sample.pointerId in penIds && sample.buttons and MotionEvent.BUTTON_STYLUS_PRIMARY != 0)
    private val recorder = StrokeRecorder(
        brushFor = { sample -> brushFor(erases(sample), toScene(sample, transform())) },
        toScene = { sample -> toScene(sample, transform()) }, emit = { event ->
            when (event) {
                is StrokeRecordingEvent.Started -> { val erasing = event.eraser; active[event.pointerId] = mutableListOf(event.first); activeErase[event.pointerId] = erasing; activeColor[event.pointerId] = inkColor; activeBrush[event.pointerId] = brushFor(erasing, event.first); gestureChanged(true) }
                is StrokeRecordingEvent.Sampled -> active[event.pointerId]?.add(event.sample)
                is StrokeRecordingEvent.Completed -> { active.remove(event.pointerId); val wasErasing = activeErase.remove(event.pointerId) ?: event.eraser; val color = activeColor.remove(event.pointerId) ?: "#202023"; activeBrush.remove(event.pointerId); currentPointer = null; canDraw = false; complete(PendingStroke(event.samples, event.brush, wasErasing, color)); gestureChanged(navigation != null) }
                is StrokeRecordingEvent.Canceled -> { active.remove(event.pointerId); activeErase.remove(event.pointerId); activeColor.remove(event.pointerId); activeBrush.remove(event.pointerId); currentPointer = null; gestureChanged(navigation != null) }
                is StrokeRecordingEvent.LimitReached -> Unit
            }
            invalidate()
        }, eraseFor = ::erases)
    private val engine = WorldsStylusEngine { event ->
        when (event) {
            is StylusEvent.Hover -> { hoverPosition = event.sample.x to event.sample.y; hoverEraser = event.sample.eraser || (barrelEraser && event.sample.buttons and MotionEvent.BUTTON_STYLUS_PRIMARY != 0); invalidate() }
            is StylusEvent.HoverExit -> { hoverPosition = null; invalidate() }
            is StylusEvent.Start -> { hoverPosition = null; invalidate() }
            else -> Unit
        }
        val id = when (event) {
            is StylusEvent.Start -> event.sample.pointerId
            is StylusEvent.Move -> event.sample.pointerId
            is StylusEvent.End -> event.sample.pointerId
            is StylusEvent.Cancel -> event.pointerId
            is StylusEvent.Hover -> event.sample.pointerId
            is StylusEvent.HoverExit -> event.pointerId
        }
        if (event is StylusEvent.Start && currentPointer == null) currentPointer = id
        if (currentPointer == id) {
            if (event is StylusEvent.End && navigation != null) {
                recorder.onEvent(StylusEvent.Move(event.sample))
                deferredPenEnd = id
            } else recorder.onEvent(event)
        }
    }
    private val stylus = AndroidStylusInput(engine)
    override fun onDetachedFromWindow() { stablePicture = null; stablePictureAttempted = false; selectionPointer = null; selectionDx = 0.0; selectionDy = 0.0; hoverPosition = null; engine.cancelAll(); deferredPenEnd?.let { recorder.onEvent(StylusEvent.Cancel(it)) }; deferredPenEnd = null; finishNavigation(true); gestureChanged(false); super.onDetachedFromWindow() }
    override fun onHoverEvent(event: MotionEvent): Boolean {
        val pen = (0 until event.pointerCount).any { event.getToolType(it) in setOf(MotionEvent.TOOL_TYPE_STYLUS, MotionEvent.TOOL_TYPE_ERASER) }
        if (!pen) return super.onHoverEvent(event)
        stylus.onMotionEvent(event)
        return true
    }
    private fun transform(): DrawingViewport.Transform = viewport.transform(width, height)
    override fun onGenericMotionEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_SCROLL && event.isFromSource(InputDevice.SOURCE_CLASS_POINTER) && canDraw && currentPointer == null && navigation == null) {
            val scroll = event.getAxisValue(MotionEvent.AXIS_VSCROLL).toDouble()
            if (scroll.isFinite() && scroll != 0.0) {
                viewport = viewport.zoomAround(width, height, event.x.toDouble(), event.y.toDouble(), event.x.toDouble(), event.y.toDouble(), exp(scroll.coerceIn(-10.0, 10.0) * 0.15))
                viewportChanged(viewport); invalidate(); return true
            }
        }
        return super.onGenericMotionEvent(event)
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val (scale, left, top) = transform()
        canvas.save()
        canvas.clipRect(0, 0, width, height)
        canvas.drawColor(surroundColor)
        canvas.save(); canvas.translate(left.toFloat(), top.toFloat()); canvas.scale(scale.toFloat(), scale.toFloat())
        canvas.clipRect(0f, 0f, 1280f, 720f)
        referenceImages.filter { it.visible }.forEach { img ->
            val bmp = imageBitmaps.getOrPut(img.uri) {
                runCatching { context.contentResolver.openInputStream(img.uri)?.use { android.graphics.BitmapFactory.decodeStream(it) } }.getOrNull()
            }
            if (bmp != null) {
                val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { alpha = (img.opacity.coerceIn(0f, 1f) * 255).roundToInt() }
                canvas.save(); canvas.translate(img.x, img.y); canvas.scale(img.scale, img.scale); canvas.drawBitmap(bmp, 0f, 0f, p); canvas.restore()
            }
        }
        val overlays = mutableListOf<InkStroke>()
        pending?.let { overlays.add(InkStroke(it.samples, it.brush, it.erase, android.graphics.Color.parseColor(it.color))) }
        active.forEach { (id, points) -> overlays.add(InkStroke(points, activeBrush.getValue(id), activeErase[id] == true, android.graphics.Color.parseColor(activeColor.getValue(id)))) }
        val draggingSelection = selectionMode && selectionPointer != null && activeHandle == null
        val shown = if (draggingSelection) saved.map { stroke ->
            if (stroke.id in selectedIds) stroke.copy(samples = stroke.samples.map { it.copy(x = it.x + selectionDx, y = it.y + selectionDy) }) else stroke
        } else saved
        if (draggingSelection) DrawingInk.draw(canvas, shown + overlays)
        else {
            if (!stablePictureAttempted) { stablePicture = DrawingInk.record(saved); stablePictureAttempted = true }
            val picture = stablePicture
            if (picture != null) DrawingInk.drawCached(canvas, picture, overlays) else DrawingInk.draw(canvas, saved + overlays)
        }
        if (selectionMode && selectedIds.isNotEmpty()) {
            val selectedList = shown.filter { it.id in selectedIds }
            val allPts = selectedList.flatMap { it.samples }
            if (allPts.isNotEmpty()) {
                val minX = allPts.minOf { it.x }; val minY = allPts.minOf { it.y }
                val maxX = allPts.maxOf { it.x }; val maxY = allPts.maxOf { it.y }
                val pad = 10.0 / scale
                val boxL = (minX - pad).toFloat(); val boxT = (minY - pad).toFloat()
                val boxR = (maxX + pad).toFloat(); val boxB = (maxY + pad).toFloat()
                val cx = (boxL + boxR) / 2f; val cy = (boxT + boxB) / 2f
                val boxPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                    color = accentColor; style = android.graphics.Paint.Style.STROKE
                    strokeWidth = (2.0 / scale).toFloat(); pathEffect = android.graphics.DashPathEffect(floatArrayOf((6.0 / scale).toFloat(), (4.0 / scale).toFloat()), 0f)
                }
                canvas.drawRect(boxL, boxT, boxR, boxB, boxPaint)
                val fillP = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE; style = android.graphics.Paint.Style.FILL }
                val strokeP = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = accentColor; style = android.graphics.Paint.Style.STROKE; strokeWidth = (2.0 / scale).toFloat() }
                val hs = (6.0 / scale).toFloat()
                listOf(boxL to boxT, cx to boxT, boxR to boxT, boxR to cy, boxR to boxB, cx to boxB, boxL to boxB, boxL to cy).forEach { (hx, hy) ->
                    canvas.drawRect(hx - hs, hy - hs, hx + hs, hy + hs, fillP)
                    canvas.drawRect(hx - hs, hy - hs, hx + hs, hy + hs, strokeP)
                }
                val rotStem = (24.0 / scale).toFloat(); val rotY = boxT - rotStem
                canvas.drawLine(cx, boxT, cx, rotY, strokeP)
                canvas.drawCircle(cx, rotY, hs, fillP); canvas.drawCircle(cx, rotY, hs, strokeP)
            }
        }
        annotations.forEach { ann ->
            val pinP = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = accentColor; style = android.graphics.Paint.Style.FILL }
            val borderP = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE; style = android.graphics.Paint.Style.STROKE; strokeWidth = (2.0 / scale).toFloat() }
            val r = (12.0 / scale).toFloat()
            canvas.drawCircle(ann.sceneX.toFloat(), ann.sceneY.toFloat(), r, pinP)
            canvas.drawCircle(ann.sceneX.toFloat(), ann.sceneY.toFloat(), r, borderP)
            pinP.color = android.graphics.Color.WHITE
            canvas.drawCircle(ann.sceneX.toFloat(), ann.sceneY.toFloat(), (4.0 / scale).toFloat(), pinP)
        }
        canvas.restore(); canvas.restore()
        if (!selectionMode) hoverPosition?.let { (x, y) ->
            val radius = ((if (erase || hoverEraser) eraserWidth else if (highlighter) highlightWidth else if (pencil) pencilWidth else penWidth) * scale / 2.0).coerceIn(5.0, 48.0)
            hoverPaint.color = android.graphics.Color.WHITE; hoverPaint.strokeWidth = 4f
            canvas.drawCircle(x, y, radius.toFloat(), hoverPaint)
            hoverPaint.color = android.graphics.Color.DKGRAY; hoverPaint.strokeWidth = 2f
            canvas.drawCircle(x, y, radius.toFloat(), hoverPaint)
        }
    }
    private fun hitStroke(x: Double, y: Double, tolerance: Double): InkStroke? = saved.asReversed().firstOrNull { stroke ->
        if (stroke.erase) false else {
            val points = stroke.samples
            fun distance(a: StrokeSample, b: StrokeSample): Double {
                val dx = b.x - a.x; val dy = b.y - a.y; val length = dx * dx + dy * dy
                val t = if (length == 0.0) 0.0 else (((x - a.x) * dx + (y - a.y) * dy) / length).coerceIn(0.0, 1.0)
                return hypot(x - (a.x + t * dx), y - (a.y + t * dy))
            }
            val limit = tolerance + stroke.brush.size / 2
            if (points.size == 1) hypot(x - points[0].x, y - points[0].y) <= limit
            else points.zipWithNext().any { (a, b) -> distance(a, b) <= limit }
        }
    }
    private fun updateSelection(screenX: Double, screenY: Double) {
        selectionScreenX = screenX; selectionScreenY = screenY
        val frame = transform()
        selectionDx = frame.sceneX(screenX) - selectionStartX
        selectionDy = frame.sceneY(screenY) - selectionStartY
        invalidate()
    }
    private fun beginSelection(id: String?) {
        val wasSelected = id != null && id in selectedIds
        selectedIds = if (!multiSelect) id?.let(::setOf) ?: emptySet() else if (id != null) selectedIds + id else selectedIds
        toggleOnTap = if (multiSelect && wasSelected) id else null
        selectionChanged(selectedIds.firstOrNull()); selectionGroupChanged(selectedIds)
    }
    private fun selectionTouch(event: MotionEvent): Boolean {
        val index = event.actionIndex
        val action = event.actionMasked
        if (action == MotionEvent.ACTION_DOWN && canDraw) {
            val frame = transform(); val x = frame.sceneX(event.x.toDouble()); val y = frame.sceneY(event.y.toDouble())
            val hitAnn = annotations.firstOrNull { hypot(it.sceneX - x, it.sceneY - y) <= 24.0 / frame.scale }
            if (hitAnn != null) { onAnnotationClick?.invoke(hitAnn); return true }
            if (selectedIds.isNotEmpty()) {
                val selectedList = saved.filter { it.id in selectedIds }
                val allPts = selectedList.flatMap { it.samples }
                if (allPts.isNotEmpty()) {
                    val pad = 10.0 / frame.scale
                    val boxL = allPts.minOf { it.x } - pad; val boxT = allPts.minOf { it.y } - pad
                    val boxR = allPts.maxOf { it.x } + pad; val boxB = allPts.maxOf { it.y } + pad
                    val cx = (boxL + boxR) / 2.0; val cy = (boxT + boxB) / 2.0
                    val rotY = boxT - 24.0 / frame.scale
                    val hitRadius = 20.0 / frame.scale
                    if (hypot(cx - x, rotY - y) <= hitRadius) {
                        activeHandle = 8; transformOriginX = cx; transformOriginY = cy
                        transformStartX = x; transformStartY = y; transformCurrentX = x; transformCurrentY = y
                        selectionPointer = event.getPointerId(0); gestureChanged(true); invalidate(); return true
                    }
                    val handleCoords = listOf(boxL to boxT, cx to boxT, boxR to boxT, boxR to cy, boxR to boxB, cx to boxB, boxL to boxB, boxL to cy)
                    val opposites = listOf(boxR to boxB, cx to boxB, boxL to boxB, boxL to cy, boxL to boxT, cx to boxT, boxR to boxT, boxR to cy)
                    var handleHit = -1
                    handleCoords.forEachIndexed { i, (hx, hy) -> if (hypot(hx - x, hy - y) <= hitRadius && handleHit == -1) handleHit = i }
                    if (handleHit >= 0) {
                        activeHandle = handleHit
                        val (ox, oy) = opposites[handleHit]
                        transformOriginX = ox; transformOriginY = oy
                        transformStartX = x; transformStartY = y; transformCurrentX = x; transformCurrentY = y
                        selectionPointer = event.getPointerId(0); gestureChanged(true); invalidate(); return true
                    }
                }
            }
            val hit = if (x in 0.0..1280.0 && y in 0.0..720.0) hitStroke(x, y, 12.0 / frame.scale)?.id else null
            beginSelection(hit)
            selectionPointer = if (hit != null) event.getPointerId(0) else null
            selectionPen = event.getToolType(0) in setOf(MotionEvent.TOOL_TYPE_STYLUS, MotionEvent.TOOL_TYPE_ERASER)
            selectionStartX = x; selectionStartY = y; selectionDx = 0.0; selectionDy = 0.0
            selectionScreenX = event.x.toDouble(); selectionScreenY = event.y.toDouble()
            gestureChanged(selectionPointer != null); invalidate()
            return true
        }
        if (action == MotionEvent.ACTION_POINTER_DOWN && navigation == null && canDraw &&
            event.getToolType(index) in setOf(MotionEvent.TOOL_TYPE_STYLUS, MotionEvent.TOOL_TYPE_ERASER) && !selectionPen) {
            val frame = transform(); val x = frame.sceneX(event.getX(index).toDouble()); val y = frame.sceneY(event.getY(index).toDouble())
            val hit = if (x in 0.0..1280.0 && y in 0.0..720.0) hitStroke(x, y, 12.0 / frame.scale)?.id else null
            beginSelection(hit); selectionPointer = if (hit != null) event.getPointerId(index) else null
            selectionPen = true; selectionStartX = x; selectionStartY = y; selectionDx = 0.0; selectionDy = 0.0
            selectionScreenX = event.getX(index).toDouble(); selectionScreenY = event.getY(index).toDouble()
            gestureChanged(selectionPointer != null); invalidate()
        }
        if (action == MotionEvent.ACTION_POINTER_DOWN && navigation == null && canDraw) {
            val fingers = (0 until event.pointerCount).filter { event.getToolType(it) == MotionEvent.TOOL_TYPE_FINGER }
            if (fingers.size >= 2) {
                if (!selectionPen) { selectionPointer = null; selectionDx = 0.0; selectionDy = 0.0; toggleOnTap = null }
                val a = fingers[0]; val b = fingers[1]
                val x = (event.getX(a) + event.getX(b)) / 2.0; val y = (event.getY(a) + event.getY(b)) / 2.0
                val span = hypot((event.getX(a) - event.getX(b)).toDouble(), (event.getY(a) - event.getY(b)).toDouble())
                navigation = Navigation(event.getPointerId(a), event.getPointerId(b), x, y, span, viewport, null, null)
                gestureChanged(true); invalidate()
            }
        }
        val nav = navigation
        if (nav != null && action == MotionEvent.ACTION_MOVE) {
            val a = event.findPointerIndex(nav.first); val b = event.findPointerIndex(nav.second)
            if (a >= 0 && b >= 0) {
                val x = (event.getX(a) + event.getX(b)) / 2.0; val y = (event.getY(a) + event.getY(b)) / 2.0
                val span = hypot((event.getX(a) - event.getX(b)).toDouble(), (event.getY(a) - event.getY(b)).toDouble())
                val ratio = if (nav.span > 1.0 && span > 1.0) span / nav.span else 1.0
                viewport = viewport.zoomAround(width, height, nav.x, nav.y, x, y, ratio)
                nav.x = x; nav.y = y; nav.span = span; viewportChanged(viewport); invalidate()
            }
        }
        if (action == MotionEvent.ACTION_MOVE && activeHandle != null) {
            selectionPointer?.let { pointer ->
                val i = event.findPointerIndex(pointer)
                if (i >= 0) {
                    val frame = transform()
                    transformCurrentX = frame.sceneX(event.getX(i).toDouble())
                    transformCurrentY = frame.sceneY(event.getY(i).toDouble())
                    invalidate()
                }
            }
            return true
        }
        if (action == MotionEvent.ACTION_MOVE) selectionPointer?.let { pointer ->
            val i = event.findPointerIndex(pointer)
            if (i >= 0) updateSelection(event.getX(i).toDouble(), event.getY(i).toDouble())
        }
        if (action == MotionEvent.ACTION_POINTER_UP || action == MotionEvent.ACTION_UP) {
            val released = event.getPointerId(index)
            if (released == selectionPointer && activeHandle != null) {
                val h = activeHandle!!; activeHandle = null; selectionPointer = null
                val frame = transform()
                val endX = frame.sceneX(event.getX(index).toDouble())
                val endY = frame.sceneY(event.getY(index).toDouble())
                if (h == 8) {
                    val startAngle = Math.toDegrees(atan2(transformStartY - transformOriginY, transformStartX - transformOriginX))
                    val endAngle = Math.toDegrees(atan2(endY - transformOriginY, endX - transformOriginX))
                    val angleDeg = endAngle - startAngle
                    if (abs(angleDeg) >= 1.0) rotateStrokes?.invoke(selectedIds, angleDeg, transformOriginX, transformOriginY)
                } else {
                    val startDistX = abs(transformStartX - transformOriginX).coerceAtLeast(1.0)
                    val startDistY = abs(transformStartY - transformOriginY).coerceAtLeast(1.0)
                    val endDistX = abs(endX - transformOriginX).coerceAtLeast(1.0)
                    val endDistY = abs(endY - transformOriginY).coerceAtLeast(1.0)
                    val sx = (endDistX / startDistX).coerceIn(0.1, 10.0)
                    val sy = (endDistY / startDistY).coerceIn(0.1, 10.0)
                    if (abs(sx - 1.0) >= 0.03 || abs(sy - 1.0) >= 0.03) scaleStrokes?.invoke(selectedIds, sx, sy, transformOriginX, transformOriginY)
                }
                gestureChanged(navigation != null); invalidate(); return true
            }
            if (released == selectionPointer) {
                updateSelection(event.getX(index).toDouble(), event.getY(index).toDouble())
                val ids = selectedIds; val frame = transform()
                selectionPointer = null
                val moved = hypot(selectionDx, selectionDy) * frame.scale >= 3.0
                if (!isCanceled(event) && ids.isNotEmpty() && moved) {
                    val groupCallback = moveStrokes
                    if (groupCallback != null) groupCallback(ids.toSet(), selectionDx, selectionDy) else ids.firstOrNull()?.let { moveStroke(it, selectionDx, selectionDy) }
                } else if (!isCanceled(event) && !moved && toggleOnTap != null) {
                    selectedIds = selectedIds - requireNotNull(toggleOnTap)
                    selectionChanged(selectedIds.firstOrNull()); selectionGroupChanged(selectedIds)
                }
                toggleOnTap = null
                selectionDx = 0.0; selectionDy = 0.0; invalidate()
            }
            if (nav != null && (released == nav.first || released == nav.second || action == MotionEvent.ACTION_UP)) {
                finishNavigation(isCanceled(event))
                if (selectionPointer != null) updateSelection(selectionScreenX, selectionScreenY)
            }
            gestureChanged(selectionPointer != null || navigation != null)
        }
        if (action == MotionEvent.ACTION_CANCEL) {
            activeHandle = null
            selectionPointer = null; selectionDx = 0.0; selectionDy = 0.0; toggleOnTap = null
            finishNavigation(true); gestureChanged(false); invalidate()
        }
        return true
    }
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (commentMode) {
            if (event.actionMasked == MotionEvent.ACTION_UP) {
                val frame = transform()
                val x = frame.sceneX(event.x.toDouble()); val y = frame.sceneY(event.y.toDouble())
                if (x in 0.0..1280.0 && y in 0.0..720.0) onCanvasTappedForAnnotation?.invoke(x, y)
            }
            return true
        }
        if (selectionMode) return selectionTouch(event)
        if (!canDraw && active.isEmpty() && navigation == null) return true
        val index = event.actionIndex; val tool = event.getToolType(index); val pen = tool == MotionEvent.TOOL_TYPE_STYLUS || tool == MotionEvent.TOOL_TYPE_ERASER
        if (event.actionMasked == MotionEvent.ACTION_DOWN) suppressFinger = false
        if (pen && (event.actionMasked == MotionEvent.ACTION_DOWN || event.actionMasked == MotionEvent.ACTION_POINTER_DOWN)) {
            finishNavigation(true)
            if (!canDraw && active.isEmpty()) { suppressFinger = true; return true }
            cancelFinger(event)
            suppressFinger = true
            penIds.add(event.getPointerId(index))
        }
        if (event.actionMasked == MotionEvent.ACTION_POINTER_DOWN && !pen && (!suppressFinger || penIds.isNotEmpty()) && navigation == null) {
            val fingers = (0 until event.pointerCount).filter { event.getToolType(it) == MotionEvent.TOOL_TYPE_FINGER }
            if (fingers.size >= 2) {
                cancelFinger(event)
                val a = fingers[0]; val b = fingers[1]
                val x = (event.getX(a) + event.getX(b)) / 2.0; val y = (event.getY(a) + event.getY(b)) / 2.0
                val span = hypot((event.getX(a) - event.getX(b)).toDouble(), (event.getY(a) - event.getY(b)).toDouble())
                val activePen = currentPointer?.takeIf { it in penIds }
                navigation = Navigation(event.getPointerId(a), event.getPointerId(b), x, y, span, viewport, activePen, activePen?.let { recorder.checkpoint(it) })
                suppressFinger = true; gestureChanged(true)
            }
        }
        navigation?.let { nav ->
            when (event.actionMasked) {
                MotionEvent.ACTION_MOVE -> {
                    val a = event.findPointerIndex(nav.first); val b = event.findPointerIndex(nav.second)
                    if (a >= 0 && b >= 0) {
                        val x = (event.getX(a) + event.getX(b)) / 2.0; val y = (event.getY(a) + event.getY(b)) / 2.0
                        val span = hypot((event.getX(a) - event.getX(b)).toDouble(), (event.getY(a) - event.getY(b)).toDouble())
                        val ratio = if (nav.span > 1.0 && span > 1.0) span / nav.span else 1.0
                        viewport = viewport.zoomAround(width, height, nav.x, nav.y, x, y, ratio)
                        nav.x = x; nav.y = y; nav.span = span
                        viewportChanged(viewport); invalidate()
                    }
                }
                MotionEvent.ACTION_POINTER_UP -> if (event.getPointerId(index) == nav.first || event.getPointerId(index) == nav.second) finishNavigation(isCanceled(event))
                MotionEvent.ACTION_UP -> { finishNavigation(isCanceled(event)); suppressFinger = false }
                MotionEvent.ACTION_CANCEL -> { finishNavigation(true); suppressFinger = false; engine.cancelAll(); penIds.clear() }
            }
            stylus.onMotionEvent(event)
            if (pen && (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_POINTER_UP)) penIds.remove(event.getPointerId(index))
            return true
        }
        stylus.onMotionEvent(event)
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> if (!pen && penIds.isEmpty() && fingerId == null && !suppressFinger) { fingerId = event.getPointerId(index); engine.start(fingerSample(event, index)) }
            MotionEvent.ACTION_MOVE -> fingerId?.let { id -> val i = event.findPointerIndex(id); if (i >= 0) engine.move(fingerSample(event, i)) }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val id = event.getPointerId(index)
                if (id == fingerId) { engine.end(fingerSample(event, index), isCanceled(event)); fingerId = null }
                if (pen) penIds.remove(id)
                if (event.actionMasked == MotionEvent.ACTION_UP) suppressFinger = false
            }
            MotionEvent.ACTION_CANCEL -> { fingerId = null; penIds.clear(); suppressFinger = false }
        }
        return true
    }
    private fun cancelFinger(event: MotionEvent) {
        fingerId?.let { id -> engine.end(fingerSample(event, event.findPointerIndex(id)).copy(pointerId = id), true) }
        fingerId = null
    }
    private fun isCanceled(event: MotionEvent) = Build.VERSION.SDK_INT >= 33 && event.flags and MotionEvent.FLAG_CANCELED != 0
    private fun finishNavigation(canceled: Boolean) {
        val nav = navigation ?: return
        navigation = null
        if (canceled) {
            viewport = nav.original
            val pointer = nav.penPointer; val checkpoint = nav.penCheckpoint
            if (pointer != null && checkpoint != null) {
                val restoredFrame = nav.original.transform(width, height)
                recorder.reprojectFrom(pointer, checkpoint) { sample -> toScene(sample, restoredFrame) }?.let { restored -> active[pointer] = restored.toMutableList() }
            }
            viewportChanged(viewport); invalidate()
        }
        val finished = deferredPenEnd
        deferredPenEnd = null
        if (finished != null) recorder.finish(finished)
        gestureChanged(currentPointer != null)
    }
    private fun fingerSample(event: MotionEvent, index: Int): StylusSample {
        val i = index.coerceAtLeast(0)
        return StylusSample(event.getPointerId(i), event.eventTime, event.getX(i), event.getY(i), null, null, null, null, false, event.buttonState)
    }
}
