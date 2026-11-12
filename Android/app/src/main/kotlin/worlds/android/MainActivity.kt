package worlds.android

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import worlds.content.ContentStore
import worlds.content.ContentVersion
import worlds.content.ContentEvent
import worlds.content.InlineEditing
import worlds.content.CodeEditing
import worlds.content.ContainerEditing
import worlds.content.TableEditing
import worlds.content.ListEditing
import worlds.content.MarkdownExport
import worlds.content.MarkdownImport
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import worlds.content.Resource
import worlds.content.ResourceDocument
import worlds.content.PageMatch
import worlds.content.ProjectEditing
import worlds.content.newBlockId
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date
import worlds.android.ai.AiChatScreen
import worlds.android.automations.AutomationsScreen
import worlds.android.planning.PlanningScreen
import worlds.android.planning.PlanningSection
import worlds.android.discord.DiscordComposer

class MainActivity : ComponentActivity() {
    internal var drawingShortcutOwner: Any? = null
    internal var pageShortcutOwner: Any? = null
    internal var editorShortcutOwner: Any? = null
    override fun onProvideKeyboardShortcuts(data: MutableList<android.view.KeyboardShortcutGroup>?, menu: android.view.Menu?, deviceId: Int) {
        super.onProvideKeyboardShortcuts(data, menu, deviceId)
        if (drawingShortcutOwner != null) data?.add(drawingKeyboardShortcutGroup(this))
        if (pageShortcutOwner != null) data?.add(pageKeyboardShortcutGroup(this))
        if (editorShortcutOwner != null) data?.add(editorKeyboardShortcutGroup(this))
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { WorldsTheme { val model: HomeModel = viewModel(); val account: AccountModel = viewModel(); Home(model, account) } }
    }
}

internal fun editorKeyboardShortcutGroup(context: Context): android.view.KeyboardShortcutGroup =
    android.view.KeyboardShortcutGroup(context.getString(R.string.edit_text), listOf(
        android.view.KeyboardShortcutInfo(context.getString(R.string.save), android.view.KeyEvent.KEYCODE_S, android.view.KeyEvent.META_CTRL_ON)))

internal fun pageKeyboardShortcutGroup(context: Context): android.view.KeyboardShortcutGroup {
    val ctrl = android.view.KeyEvent.META_CTRL_ON
    return android.view.KeyboardShortcutGroup(context.getString(R.string.page_shortcuts_title), listOf(
        android.view.KeyboardShortcutInfo(context.getString(R.string.find_text), android.view.KeyEvent.KEYCODE_F, ctrl),
        android.view.KeyboardShortcutInfo(context.getString(R.string.find_replace), android.view.KeyEvent.KEYCODE_H, ctrl)))
}

internal fun drawingKeyboardShortcutGroup(context: Context): android.view.KeyboardShortcutGroup {
    val ctrl = android.view.KeyEvent.META_CTRL_ON
    fun item(label: Int, key: Int, modifiers: Int = 0) = android.view.KeyboardShortcutInfo(context.getString(label), key, modifiers)
    return android.view.KeyboardShortcutGroup(context.getString(R.string.drawing_shortcuts_title), listOf(
        item(R.string.drawing_pen, android.view.KeyEvent.KEYCODE_B), item(R.string.drawing_pencil, android.view.KeyEvent.KEYCODE_P), item(R.string.drawing_highlighter, android.view.KeyEvent.KEYCODE_H),
        item(R.string.drawing_eraser, android.view.KeyEvent.KEYCODE_E), item(R.string.drawing_undo, android.view.KeyEvent.KEYCODE_Z, ctrl),
        item(R.string.drawing_redo, android.view.KeyEvent.KEYCODE_Z, ctrl or android.view.KeyEvent.META_SHIFT_ON),
        item(R.string.drawing_redo, android.view.KeyEvent.KEYCODE_Y, ctrl), item(R.string.drawing_fit, android.view.KeyEvent.KEYCODE_0, ctrl),
        item(R.string.drawing_select, android.view.KeyEvent.KEYCODE_M), item(R.string.drawing_clear_selection_shortcut, android.view.KeyEvent.KEYCODE_D, ctrl),
        item(R.string.drawing_remove_strokes, android.view.KeyEvent.KEYCODE_FORWARD_DEL), item(R.string.drawing_remove_strokes, android.view.KeyEvent.KEYCODE_DEL)))
}

data class HomeState(
    val pages: List<Resource> = emptyList(), val selected: ResourceDocument? = null,
    val children: List<Resource> = emptyList(),
    val selectedTemplateTree: Boolean = false, val moveVisible: Boolean = false, val moveLoading: Boolean = false, val moveError: Boolean = false,
    val moveSource: Resource? = null, val moveDestinations: List<MoveDestination> = emptyList(),
    val query: String = "", val loading: Boolean = true, val error: Boolean = false,
    val trash: Boolean = false, val busy: Boolean = false, val actionError: Boolean = false,
    val versions: List<ContentVersion>? = null,
    val editor: EditorTarget? = null, val editorSaveError: Boolean = false,
    val importError: Int? = null, val markdownStatus: Int? = null,
    val imageStatus: Int? = null,
    val fileStatus: Int? = null,
    val projectResources: List<Resource> = emptyList(),
    val projectActivity: List<ProjectActivity> = emptyList(),
    val templatesVisible: Boolean = false, val templatesLoading: Boolean = false, val templatesError: Boolean = false, val templates: List<Resource> = emptyList(),
    /** Badges in the planning navigation: tasks due today or overdue, and captures waiting in Inbox. */
    val dueToday: Int = 0, val inboxCount: Int = 0,
)
data class MoveDestination(val resource: Resource, val path: String)
data class ProjectActivity(val resource: Resource, val event: ContentEvent)
private data class OpenPageSnapshot(val document: ResourceDocument, val children: List<Resource>, val templateTree: Boolean, val projectResources: List<Resource>, val projectActivity: List<ProjectActivity>)

data class EditorTarget(val pageId: String, val blockId: String, val revision: Long, val initial: String, val isNew: Boolean, val afterBlockId: String? = null,
    val listType: String? = null, val listItemPath: List<Int>? = null, val containerType: String? = null, val containerIndex: Int? = null, val tablePath: List<Int>? = null, val documentFormatting: Boolean = false)

private data class MarkdownSnapshot(val document: ResourceDocument, val original: Boolean)
private data class ImageImportSnapshot(val pageId: String, val revision: Long, val afterBlockId: String?, val gallery: Boolean, val slideId: String? = null, val slideBackground: Boolean = false, val slideVideo: Boolean = false)
private data class ImageExportSnapshot(val pageId: String, val attachmentId: String, val gallery: Boolean)
private data class FileImportSnapshot(val parentId: String?, val parentRevision: Long?)
private data class FileExportSnapshot(val resourceId: String, val attachmentId: String)
internal data class ImageExportRequest(val name: String, val mime: String)
internal const val MAX_SHARE_TEXT_CHARS = 100_000
internal fun markdownShareIntent(title: String, text: String): Intent {
    require(text.length <= MAX_SHARE_TEXT_CHARS)
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, text)
    return Intent.createChooser(send, null)
}

class HomeModel(application: Application, internal val databaseName: String) : AndroidViewModel(application), AutoCloseable {
    constructor(application: Application) : this(application, "worlds-content.db")
    private val store = ContentStore(application, databaseName)
    private val mutable = MutableStateFlow(HomeState())
    val state = mutable.asStateFlow()
    private var requestId = 0L
    private var openId = 0L
    private var moveGeneration = 0L
    private var markdownSnapshot: MarkdownSnapshot? = null
    private var imageSnapshot: ImageImportSnapshot? = null
    private var imageExportSnapshot: ImageExportSnapshot? = null
    private var fileImportSnapshot: FileImportSnapshot? = null
    private var fileExportSnapshot: FileExportSnapshot? = null
    init { refresh() }

    fun search(query: String) { mutable.update { it.copy(query = query) }; refresh() }
    fun refresh() {
        val request = ++requestId
        val query = mutable.value.query
        val trash = mutable.value.trash
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                if (trash) store.list(includeDeleted = true).filter { it.deletedAt != null && it.title.contains(query.trim(), ignoreCase = true) } to null
                else {
                    val hidden = store.templateTreeIds()
                    val all = store.list().filterNot { it.id in hidden }
                    (if (query.isBlank()) all else store.search(query).filterNot { it.id in hidden }) to worlds.android.planning.planningBadges(all)
                }
            } }
            if (request != requestId) return@launch
            val pages = result.getOrNull()?.first.orEmpty()
            val badges = result.getOrNull()?.second
            mutable.update { it.copy(pages = pages.filter { page -> trash || (page.kind != "template" && page.kind !in worlds.android.planning.OWN_VIEW_KINDS) }, loading = false, error = result.isFailure,
                dueToday = badges?.first ?: it.dueToday, inboxCount = badges?.second ?: it.inboxCount) }
        }
    }
    fun create(title: String, kind: String = "page") {
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val metadata = when (kind) { "document" -> ProjectEditing.defaultDocumentMetadata; "project" -> ProjectEditing.defaultProjectMetadata; "gallery" -> """{"gallery":{"view":"grid"}}"""; "presentation" -> worlds.content.PresentationEditing.defaultMetadata; else -> "{}" }
                store.create(kind, title.trim(), metadata = metadata)
            } }
            if (result.isFailure) mutable.update { it.copy(error = true) } else { search(""); open(result.getOrThrow().id) }
        }
    }
    internal fun createStream(title: String, url: String, parent: Resource?, done: (Boolean) -> Unit) {
        val state = mutable.value
        if (state.busy || (parent != null && (state.selected?.resource?.id != parent.id || state.selected.resource.revision != parent.revision))) { done(false); return }
        mutable.update { it.copy(busy = true) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.createStream(title, url, parent?.id, parent?.revision) } }
            mutable.update { it.copy(busy = false) }; done(result.isSuccess)
            if (result.isSuccess) { refresh(); if (parent == null || mutable.value.selected?.resource?.id == parent.id) open(result.getOrThrow().id) }
        }
    }
    internal fun updateStream(stream: Resource, url: String, done: (Boolean) -> Unit) = projectAction(stream, done) { store.updateStream(stream.id, stream.revision, url) }
    internal fun beginFileImport(parent: Resource? = null): Boolean {
        val state = mutable.value
        if (state.busy || (parent != null && (state.selected?.resource?.id != parent.id || parent.kind != "project" || parent.deletedAt != null))) return false
        fileImportSnapshot = FileImportSnapshot(parent?.id, parent?.revision)
        mutable.update { it.copy(importError = null) }; return true
    }
    internal fun fileImportPickerFailed() { fileImportSnapshot = null; mutable.update { it.copy(importError = R.string.file_import_error) } }
    internal fun finishFileImport(uri: Uri?) {
        val snapshot = fileImportSnapshot; fileImportSnapshot = null
        if (uri == null) return
        if (snapshot == null || mutable.value.busy || (snapshot.parentId != null && mutable.value.selected?.resource?.id != snapshot.parentId)) { mutable.update { it.copy(importError = R.string.file_import_error) }; return }
        mutable.update { it.copy(busy = true, importError = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val resolver = getApplication<Application>().contentResolver
                val name = runCatching { resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } }.getOrNull().orEmpty().ifBlank { "file" }.take(512)
                val type = resolver.getType(uri).orEmpty().lowercase().takeIf { it.length <= 127 && Regex("[a-z0-9!#\\$&^_.+-]+/[a-z0-9!#\\$&^_.+-]+").matches(it) } ?: "application/octet-stream"
                requireNotNull(resolver.openInputStream(uri)).use { store.importFileResource(name, type, it, snapshot.parentId, snapshot.parentRevision) }
            } }
            mutable.update { it.copy(busy = false, importError = if (result.isFailure) R.string.file_import_error else null) }
            if (result.isSuccess && (snapshot.parentId == null || mutable.value.selected?.resource?.id == snapshot.parentId)) { refresh(); open(result.getOrThrow().id) }
            else if (result.isSuccess) refresh()
        }
    }
    internal fun beginFileExport(): ImageExportRequest? {
        val state = mutable.value; val doc = state.selected ?: return null
        if (state.busy || doc.resource.kind != "file" || doc.resource.deletedAt != null) return null
        val attachment = worlds.content.FileAttachment.read(doc.resource.metadata) ?: return null
        val name = attachment.name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "-").take(120).ifBlank { "file" }
        fileExportSnapshot = FileExportSnapshot(doc.resource.id, attachment.id); mutable.update { it.copy(busy = true, fileStatus = null) }
        return ImageExportRequest(name, attachment.mime)
    }
    internal fun fileExportPickerFailed() { fileExportSnapshot = null; mutable.update { it.copy(busy = false, fileStatus = R.string.file_export_error) } }
    internal fun finishFileExport(uri: Uri?) {
        val snapshot = fileExportSnapshot; fileExportSnapshot = null
        if (uri == null) { mutable.update { it.copy(busy = false) }; return }
        if (snapshot == null) { mutable.update { it.copy(busy = false, fileStatus = R.string.file_export_error) }; return }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val source = requireNotNull(store.privateFile(snapshot.attachmentId))
                requireNotNull(getApplication<Application>().contentResolver.openOutputStream(uri, "w")).use { output -> source.inputStream().use { it.copyTo(output) }; output.flush() }
            } }
            mutable.update { it.copy(busy = false, fileStatus = if (it.selected?.resource?.id != snapshot.resourceId) null else if (result.isSuccess) R.string.file_export_success else R.string.file_export_error) }
        }
    }
    fun createSubpage(parentId: String, revision: Long, title: String) {
        val state = mutable.value
        if (state.busy || state.selected?.resource?.id != parentId) return
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.createSubpage(parentId, revision, title) } }
            mutable.update { it.copy(busy = false, actionError = result.isFailure && it.selected?.resource?.id == parentId) }
            if (result.isSuccess && mutable.value.selected?.resource?.id == parentId) { refresh(); open(result.getOrThrow().id) }
        }
    }
    internal fun createProjectChild(project: Resource, kind: String, title: String, done: (Boolean) -> Unit) {
        val current = mutable.value.selected?.resource
        if (mutable.value.busy || current?.id != project.id || current.revision != project.revision) { done(false); return }
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.createProjectChild(project.id, project.revision, kind, title) } }
            mutable.update { it.copy(busy = false) }
            done(result.isSuccess)
            if (result.isSuccess && mutable.value.selected?.resource?.id == project.id) { refresh(); open(result.getOrThrow().id) }
        }
    }
    private fun projectAction(project: Resource, done: (Boolean) -> Unit, action: () -> Unit) {
        val current = mutable.value.selected?.resource
        if (mutable.value.busy || current?.id != project.id || current.revision != project.revision) { done(false); return }
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                action()
                requireNotNull(readPageSnapshot(project.id))
            } }
            mutable.update { state ->
                val snapshot = result.getOrNull()?.takeIf { state.selected?.resource?.id == project.id }
                state.copy(busy = false, selected = snapshot?.document ?: state.selected, children = snapshot?.children ?: state.children,
                    projectResources = snapshot?.projectResources ?: state.projectResources, projectActivity = snapshot?.projectActivity ?: state.projectActivity)
            }
            if (result.isSuccess) refresh()
            done(result.isSuccess)
        }
    }
    internal fun updateProject(project: Resource, status: String, start: String?, due: String?, description: String, done: (Boolean) -> Unit) =
        projectAction(project, done) { store.updateProjectDetails(project.id, project.revision, status, start, due, description) }
    internal fun changeProjectLink(project: Resource, targetId: String, add: Boolean, done: (Boolean) -> Unit) =
        projectAction(project, done) { store.changeProjectLink(project.id, project.revision, targetId, add) }
    internal fun galleryAction(gallery: Resource, blockId: String, action: String, done: (Boolean) -> Unit) = projectAction(gallery, done) {
        val document = requireNotNull(store.load(gallery.id))
        require(document.resource.kind == "gallery" && document.resource.revision == gallery.revision)
        val blocks = document.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId && JSONObject(it.content).optString("type") == "galleryItem" }
        require(index >= 0)
        val block = blocks.removeAt(index)
        when (action) {
            "remove" -> Unit
            "first" -> blocks.add(blocks.indexOfFirst { JSONObject(it.content).optString("type") == "galleryItem" }.let { if (it < 0) blocks.size else it }, block)
            "last" -> blocks.add(blocks.indexOfLast { JSONObject(it.content).optString("type") == "galleryItem" } + 1, block)
            else -> error("Unknown gallery action")
        }
        store.saveBlocks(gallery.id, gallery.revision, blocks)
    }
    internal fun galleryLayout(gallery: Resource, view: String, done: (Boolean) -> Unit) = projectAction(gallery, done) {
        require(view in setOf("grid", "list"))
        val document = requireNotNull(store.load(gallery.id))
        require(document.resource.kind == "gallery" && document.resource.revision == gallery.revision)
        val root = JSONObject(gallery.metadata)
        require(!root.has("gallery") || root.optJSONObject("gallery") != null)
        val settings = root.optJSONObject("gallery") ?: JSONObject()
        root.put("gallery", settings.put("view", view))
        store.updateDetails(gallery.id, gallery.revision, root.toString(), document.resource.instructions)
    }
    internal fun presentationAction(deck: Resource, blockId: String, action: String, texts: Map<String, String>, notes: String, done: (Boolean) -> Unit) = projectAction(deck, done) {
        val doc = requireNotNull(store.load(deck.id))
        require(doc.resource.kind == "presentation" && doc.resource.revision == deck.revision)
        val blocks = doc.blocks.toMutableList()
        val index = blocks.indexOfFirst { it.id == blockId && JSONObject(it.content).optString("type") == "slide" }
        if (index < 0 && action == "add" && blocks.none { JSONObject(it.content).optString("type") == "slide" }) {
            blocks.add(worlds.content.PresentationEditing.newSlide("title")); store.saveBlocks(deck.id, deck.revision, blocks); return@projectAction
        }
        require(index >= 0)
        when (action) {
            "edit" -> blocks[index] = worlds.content.PresentationEditing.edit(blocks[index], texts, notes)
            "layout" -> blocks[index] = worlds.content.PresentationEditing.changeLayout(blocks[index], notes)
            "background" -> blocks[index] = worlds.content.PresentationEditing.changeBackground(blocks[index], notes)
            "remove-background-image" -> blocks[index] = worlds.content.PresentationEditing.removeBackgroundImage(blocks[index])
            "style" -> blocks[index] = worlds.content.PresentationEditing.changeTextStyle(blocks[index], notes, texts)
            "move-element" -> blocks[index] = worlds.content.PresentationEditing.moveElement(blocks[index], notes, texts.getValue("x").toInt(), texts.getValue("y").toInt())
            "add-text", "add-rect", "add-ellipse", "add-line" -> blocks[index] = worlds.content.PresentationEditing.addElement(blocks[index], action.removePrefix("add-"))
            "add" -> blocks.add(index + 1, worlds.content.PresentationEditing.newSlide("title-body"))
            "duplicate" -> blocks.add(index + 1, worlds.content.PresentationEditing.duplicate(blocks[index]))
            "remove" -> { require(blocks.count { JSONObject(it.content).optString("type") == "slide" } > 1); blocks.removeAt(index) }
            "up", "down" -> {
                val indices = blocks.indices.filter { JSONObject(blocks[it].content).optString("type") == "slide" }
                val pos = indices.indexOf(index); val target = if (action == "up") pos - 1 else pos + 1
                require(target in indices.indices); val other = indices[target]; val saved = blocks[index]; blocks[index] = blocks[other]; blocks[other] = saved
            }
            else -> error("Unknown presentation action")
        }
        store.saveBlocks(deck.id, deck.revision, blocks)
    }
    internal fun presentationElement(deck: Resource, slideId: String, elementId: String, bounds: List<Int>?, remove: Boolean, done: (Boolean) -> Unit) = projectAction(deck, done) {
        val doc = requireNotNull(store.load(deck.id)); require(doc.resource.kind == "presentation" && doc.resource.revision == deck.revision)
        val blocks = doc.blocks.toMutableList(); val index = blocks.indexOfFirst { it.id == slideId }; require(index >= 0)
        blocks[index] = worlds.content.PresentationEditing.changeElement(blocks[index], elementId, bounds, remove)
        store.saveBlocks(deck.id, deck.revision, blocks)
    }
    fun openMove() {
        val source = mutable.value.selected?.resource ?: return
        if (mutable.value.busy || mutable.value.selectedTemplateTree || source.kind !in setOf("page", "document") || source.deletedAt != null) return
        val generation = ++moveGeneration
        mutable.update { it.copy(moveVisible = true, moveLoading = true, moveError = false, moveSource = source, moveDestinations = emptyList()) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val items = store.personalMoveDestinations(source.id, source.revision)
                val byId = items.associateBy { it.id }
                items.map { item ->
                    val path = mutableListOf<String>(); var current: Resource? = item; val seen = mutableSetOf<String>()
                    while (current != null && seen.add(current.id) && path.size < 64) {
                        path.add(current.title.ifBlank { getApplication<Application>().getString(R.string.untitled) })
                        current = current.parentId?.let(byId::get)
                    }
                    MoveDestination(item, path.asReversed().joinToString(" / "))
                }
            } }
            if (generation == moveGeneration && mutable.value.selected?.resource?.id == source.id) mutable.update { it.copy(moveLoading = false, moveError = result.isFailure, moveDestinations = result.getOrDefault(emptyList())) }
        }
    }
    fun closeMove() { if (!mutable.value.busy) { moveGeneration++; mutable.update { it.copy(moveVisible = false, moveLoading = false, moveSource = null, moveDestinations = emptyList()) } } }
    fun movePage(destination: Resource?) {
        val state = mutable.value; val source = state.moveSource ?: return
        if (!state.moveVisible || state.moveLoading || state.busy || state.selected?.resource?.id != source.id || destination?.id == source.parentId || (destination == null && source.parentId == null)) return
        if (destination != null && state.moveDestinations.none { it.resource.id == destination.id && it.resource.revision == destination.revision }) return
        mutable.update { it.copy(busy = true, moveError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                store.move(source.id, source.revision, destination?.id, destination?.revision, personalOnly = true)
                store.load(source.id)?.let { it to store.children(source.id) }
            } }
            mutable.update { state -> state.copy(busy = false, moveVisible = result.isFailure, moveError = result.isFailure,
                selected = if (result.isSuccess && state.selected?.resource?.id == source.id) result.getOrNull()?.first else state.selected,
                children = if (result.isSuccess && state.selected?.resource?.id == source.id) result.getOrNull()?.second ?: emptyList() else state.children) }
            if (result.isSuccess) refresh()
        }
    }
    fun importDrawing(uri: Uri) {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, importError = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val resolver = getApplication<Application>().contentResolver
                val name = runCatching {
                    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    }
                }.getOrNull().orEmpty().removeSuffix(".worldsdraw").trim().take(120)
                val document = DrawingPackage.decode(requireNotNull(resolver.openInputStream(uri)))
                store.createImportedDrawing(name, document)
            } }
            mutable.update { it.copy(busy = false, importError = if (result.isSuccess) null else if (result.exceptionOrNull() is DrawingPackage.HistoryLimit) R.string.drawing_project_limit else R.string.drawing_import_error) }
            if (result.isSuccess) { search(""); open(result.getOrThrow().id) }
        }
    }
    fun importMarkdown(uri: Uri) {
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, importError = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val resolver = getApplication<Application>().contentResolver
                val candidate = runCatching { resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                    if (it.moveToFirst()) it.getString(0) else null
                } }.getOrNull().orEmpty().trim().take(240)
                val name = (if (candidate.lastOrNull()?.isHighSurrogate() == true) candidate.dropLast(1) else candidate).ifBlank { "import.md" }
                val original = requireNotNull(resolver.openInputStream(uri)).use { input ->
                    val output = ByteArrayOutputStream(); val buffer = ByteArray(8192); var total = 0
                    while (true) {
                        val count = input.read(buffer); if (count < 0) break
                        if (count == 0) {
                            val one = input.read(); if (one < 0) break
                            total++; if (total > MarkdownImport.MAX_BYTES) throw MarkdownImport.TooComplex()
                            output.write(one)
                        } else {
                            total += count; if (total > MarkdownImport.MAX_BYTES) throw MarkdownImport.TooComplex()
                            output.write(buffer, 0, count)
                        }
                    }
                    output.toByteArray()
                }
                val decoder = Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                val source = decoder.decode(ByteBuffer.wrap(original)).toString()
                val blocks = MarkdownImport.parse(source)
                val title = if (name.endsWith(".md", true)) name.dropLast(3) else name
                store.createImportedMarkdown(title, name, original, blocks)
            } }
            mutable.update { it.copy(busy = false, importError = if (result.isSuccess) null else if (result.exceptionOrNull() is MarkdownImport.TooComplex) R.string.markdown_import_limit else R.string.markdown_import_error) }
            if (result.isSuccess) { search(""); open(result.getOrThrow().id) }
        }
    }
    fun markdownImportPickerFailed() { mutable.update { it.copy(importError = R.string.markdown_import_error) } }
    fun beginImageImport(afterBlockId: String? = null): Boolean {
        val state = mutable.value; val doc = state.selected ?: return false
        if (state.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template", "gallery") || (afterBlockId != null && (doc.resource.kind == "gallery" || doc.blocks.none { it.id == afterBlockId }))) return false
        imageSnapshot = ImageImportSnapshot(doc.resource.id, doc.resource.revision, afterBlockId, doc.resource.kind == "gallery")
        mutable.update { it.copy(imageStatus = null) }
        return true
    }
    fun beginSlideImageImport(slideId: String, background: Boolean = false): Boolean {
        val state = mutable.value; val doc = state.selected ?: return false
        if (state.busy || doc.resource.kind != "presentation" || doc.resource.deletedAt != null || doc.blocks.none { it.id == slideId && runCatching { JSONObject(it.content).optString("type") == "slide" }.getOrDefault(false) }) return false
        imageSnapshot = ImageImportSnapshot(doc.resource.id, doc.resource.revision, null, false, slideId, background)
        mutable.update { it.copy(imageStatus = null) }; return true
    }
    fun beginSlideVideoImport(slideId: String): Boolean {
        val state = mutable.value; val doc = state.selected ?: return false
        if (state.busy || doc.resource.kind != "presentation" || doc.resource.deletedAt != null || doc.blocks.none { it.id == slideId && runCatching { JSONObject(it.content).optString("type") == "slide" }.getOrDefault(false) }) return false
        imageSnapshot = ImageImportSnapshot(doc.resource.id, doc.resource.revision, null, false, slideId, slideVideo = true)
        mutable.update { it.copy(imageStatus = null) }; return true
    }
    fun imagePickerFailed() { val snapshot = imageSnapshot; imageSnapshot = null; mutable.update { it.copy(imageStatus = if (snapshot?.gallery == true) R.string.gallery_import_error else if (snapshot?.slideVideo == true) R.string.slide_video_import_error else R.string.image_import_error) } }
    internal fun beginImageExport(blockId: String): ImageExportRequest? {
        val state = mutable.value; val doc = state.selected ?: return null
        if (state.busy || doc.resource.deletedAt != null) return null
        val block = doc.blocks.firstOrNull { it.id == blockId } ?: return null
        val node = runCatching { JSONObject(block.content) }.getOrNull() ?: return null
        if (node.optString("type") !in setOf("image", "galleryItem")) return null
        val attrs = node.optJSONObject("attrs") ?: return null
        val id = attrs.optString("attachmentId").takeIf { it.isNotBlank() } ?: return null
        val mime = attrs.optString("mime").takeIf { it.length <= 127 && Regex("(?:image|video|audio)/[A-Za-z0-9!#\\$&^_.+-]+").matches(it) } ?: return null
        val suffix = when (mime) { "image/png" -> ".png"; "image/jpeg" -> ".jpg"; "image/webp" -> ".webp"; "image/gif" -> ".gif"; "image/avif" -> ".avif"; "video/mp4" -> ".mp4"; "video/webm" -> ".webm"; "audio/mpeg" -> ".mp3"; "audio/mp4" -> ".m4a"; "audio/ogg" -> ".ogg"; "audio/wav" -> ".wav"; "audio/flac" -> ".flac"; else -> "" }
        val candidate = attrs.optString("name").replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "-").trim().take(120)
        val safe = if (candidate.lastOrNull()?.isHighSurrogate() == true) candidate.dropLast(1) else candidate
        val name = safe.ifBlank { "media$suffix" }.let { if (it.contains('.')) it else it + suffix }
        imageExportSnapshot = ImageExportSnapshot(doc.resource.id, id, doc.resource.kind == "gallery")
        mutable.update { it.copy(busy = true, imageStatus = null) }
        return ImageExportRequest(name, mime)
    }
    fun imageExportPickerFailed() { val gallery = imageExportSnapshot?.gallery == true; imageExportSnapshot = null; mutable.update { it.copy(busy = false, imageStatus = if (gallery) R.string.gallery_export_error else R.string.image_export_error) } }
    fun finishImageExport(uri: Uri?) {
        val snapshot = imageExportSnapshot; imageExportSnapshot = null
        if (uri == null) { mutable.update { it.copy(busy = false) }; return }
        if (snapshot == null) { mutable.update { it.copy(busy = false, imageStatus = R.string.image_export_interrupted) }; return }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                requireNotNull(getApplication<Application>().contentResolver.openOutputStream(uri, "w")).use { output ->
                    val file = store.galleryMediaFile(snapshot.attachmentId) ?: store.privateFile(snapshot.attachmentId)
                    if (file != null) file.inputStream().use { it.copyTo(output) }
                    else output.write(requireNotNull(store.imageBytes(snapshot.attachmentId)))
                    output.flush()
                }
            } }
            mutable.update { state -> state.copy(busy = false, imageStatus = if (state.selected?.resource?.id != snapshot.pageId) null else if (result.isSuccess) { if (snapshot.gallery) R.string.gallery_export_success else R.string.image_export_success } else { if (snapshot.gallery) R.string.gallery_export_error else R.string.image_export_error }) }
        }
    }
    fun finishImageImport(uri: Uri?) {
        val snapshot = imageSnapshot; imageSnapshot = null
        if (uri == null) return
        if (snapshot == null || mutable.value.selected?.resource?.id != snapshot.pageId || mutable.value.busy) { mutable.update { it.copy(imageStatus = R.string.image_import_error) }; return }
        mutable.update { it.copy(busy = true, imageStatus = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val resolver = getApplication<Application>().contentResolver
                val name = runCatching { resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } }.getOrNull().orEmpty().ifBlank { "image" }.take(512)
                val mime = resolver.getType(uri).orEmpty().lowercase()
                requireNotNull(resolver.openInputStream(uri)).use { input ->
                    if (snapshot.slideVideo) store.insertGalleryMedia(snapshot.pageId, snapshot.revision, name, mime, input, slideId = requireNotNull(snapshot.slideId))
                    else if (snapshot.gallery && (mime.startsWith("video/") || mime.startsWith("audio/"))) store.insertGalleryMedia(snapshot.pageId, snapshot.revision, name, mime, input)
                    else {
                        val out = ByteArrayOutputStream(); val buffer = ByteArray(16_384); var count: Int
                        while (input.read(buffer).also { count = it } != -1) { require(out.size().toLong() + count <= ContentStore.MAX_IMAGE_BYTES); out.write(buffer, 0, count) }
                        if (snapshot.slideId != null) store.insertSlideImage(snapshot.pageId, snapshot.revision, snapshot.slideId, name, out.toByteArray(), snapshot.slideBackground)
                        else store.insertImage(snapshot.pageId, snapshot.revision, name, out.toByteArray(), snapshot.afterBlockId)
                    }
                }
                requireNotNull(store.load(snapshot.pageId))
            } }
            mutable.update { state -> state.copy(busy = false, selected = if (result.isSuccess && state.selected?.resource?.id == snapshot.pageId) result.getOrNull() else state.selected,
                imageStatus = if (state.selected?.resource?.id == snapshot.pageId && result.isFailure) { if (snapshot.gallery) R.string.gallery_import_error else if (snapshot.slideVideo) R.string.slide_video_import_error else R.string.image_import_error } else null) }
            if (result.isSuccess) refresh()
        }
    }
    fun importPickerFailed() { mutable.update { it.copy(importError = R.string.drawing_import_error) } }
    fun clearImportError() { mutable.update { it.copy(importError = null) } }
    fun showTemplates() {
        if (mutable.value.busy || mutable.value.templatesLoading) return
        mutable.update { it.copy(templatesVisible = true, templatesLoading = true, templatesError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.ensureBuiltinTemplates() } }
            mutable.update { it.copy(templatesLoading = false, templates = result.getOrDefault(emptyList()), templatesError = result.isFailure) }
        }
    }
    fun closeTemplates() { if (!mutable.value.busy) mutable.update { it.copy(templatesVisible = false) } }
    fun editTemplate(id: String) {
        val state = mutable.value
        if (state.busy || state.templatesLoading || !state.templatesVisible || state.templates.none { it.id == id }) return
        mutable.update { it.copy(templatesVisible = false) }
        open(id)
    }
    fun createTemplate() {
        val state = mutable.value
        if (state.busy || state.templatesLoading || !state.templatesVisible) return
        mutable.update { it.copy(busy = true, templatesError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.create("template", "", metadata = JSONObject().put("templateCategory", "Custom").toString()) } }
            mutable.update { it.copy(busy = false, templatesVisible = result.isFailure, templatesError = result.isFailure) }
            result.getOrNull()?.let { open(it.id) }
        }
    }
    fun duplicateTemplate(template: Resource) {
        val state = mutable.value
        if (state.busy || state.templatesLoading || !state.templatesVisible || state.templates.none { it.id == template.id && it.revision == template.revision }) return
        mutable.update { it.copy(busy = true, templatesError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.duplicateTemplate(template.id, template.revision) } }
            mutable.update { state -> state.copy(busy = false, templates = result.getOrNull()?.let { state.templates + it } ?: state.templates, templatesError = result.isFailure) }
        }
    }
    fun trashTemplate(template: Resource) {
        val state = mutable.value
        if (state.busy || state.templatesLoading || !state.templatesVisible || state.templates.none { it.id == template.id && it.revision == template.revision }) return
        mutable.update { it.copy(busy = true, templatesError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.trash(template.id, template.revision); store.ensureBuiltinTemplates() } }
            mutable.update { it.copy(busy = false, templates = result.getOrDefault(it.templates), templatesError = result.isFailure) }
        }
    }
    fun saveTemplate() {
        val source = mutable.value.selected ?: return
        if (mutable.value.busy || source.resource.deletedAt != null || source.resource.kind !in setOf("page", "document")) return
        mutable.update { it.copy(busy = true, markdownStatus = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.saveAsTemplate(source.resource.id, source.resource.revision) } }
            mutable.update { state -> state.copy(busy = false, markdownStatus = if (state.selected?.resource?.id != source.resource.id) null else if (result.isSuccess) R.string.template_saved else R.string.template_save_error) }
        }
    }
    fun useTemplate(id: String) {
        if (mutable.value.busy || mutable.value.templatesLoading || !mutable.value.templatesVisible || mutable.value.templates.none { it.id == id }) return
        mutable.update { it.copy(busy = true, templatesError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.instantiateTemplate(id) } }
            mutable.update { it.copy(busy = false, templatesVisible = result.isFailure, templatesError = result.isFailure) }
            if (result.isSuccess) { search(""); open(result.getOrThrow().id) }
        }
    }
    fun beginMarkdownExport(original: Boolean = false): String? {
        val document = mutable.value.selected ?: return null
        if (mutable.value.busy || document.resource.deletedAt != null || document.resource.kind !in setOf("page", "document")) return null
        if (original && document.markdownSourceName == null) return null
        markdownSnapshot = MarkdownSnapshot(document, original)
        mutable.update { it.copy(busy = true, markdownStatus = null) }
        val name = if (original) document.markdownSourceName!!.removeSuffix(".md").removeSuffix(".MD") else document.resource.title
        val candidate = name.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "-").trim().take(80)
        val safe = if (candidate.lastOrNull()?.isHighSurrogate() == true) candidate.dropLast(1) else candidate
        return safe.ifBlank { "page" } + ".md"
    }
    fun markdownPickerFailed() {
        markdownSnapshot = null
        mutable.update { it.copy(busy = false, markdownStatus = R.string.markdown_export_error) }
    }
    fun finishMarkdownExport(uri: Uri?) {
        val snapshot = markdownSnapshot
        markdownSnapshot = null
        if (uri == null) { mutable.update { it.copy(busy = false) }; return }
        if (snapshot == null) { mutable.update { it.copy(busy = false, markdownStatus = R.string.markdown_export_interrupted) }; return }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val bytes = if (snapshot.original) requireNotNull(store.markdownSource(snapshot.document.resource.id)).bytes else MarkdownExport.page(snapshot.document).toByteArray(Charsets.UTF_8)
                val resolver = getApplication<Application>().contentResolver
                requireNotNull(resolver.openOutputStream(uri, "w")).use { it.write(bytes); it.flush() }
            } }
            mutable.update { state -> state.copy(busy = false, markdownStatus = if (state.selected?.resource?.id != snapshot.document.resource.id) null else if (result.isSuccess) R.string.markdown_export_success else R.string.markdown_export_error) }
        }
    }
    fun copyMarkdown() {
        val snapshot = mutable.value.selected ?: return
        if (mutable.value.busy || snapshot.resource.deletedAt != null || snapshot.resource.kind !in setOf("page", "document")) return
        mutable.update { it.copy(busy = true, markdownStatus = null) }
        viewModelScope.launch {
            val result = runCatching {
                val text = withContext(Dispatchers.IO) { MarkdownExport.page(snapshot) }
                val clipboard = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText(snapshot.resource.title, text))
            }
            mutable.update { state -> state.copy(busy = false, markdownStatus = if (state.selected?.resource?.id != snapshot.resource.id) null else if (result.isSuccess) R.string.markdown_copy_success else R.string.markdown_copy_error) }
        }
    }
    fun shareMarkdown(launch: (Intent) -> Unit) {
        val snapshot = mutable.value.selected ?: return
        if (mutable.value.busy || snapshot.resource.deletedAt != null || snapshot.resource.kind !in setOf("page", "document")) return
        mutable.update { it.copy(busy = true, markdownStatus = null) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { MarkdownExport.page(snapshot) } }
            if (mutable.value.selected?.resource?.id != snapshot.resource.id) { mutable.update { it.copy(busy = false) }; return@launch }
            val text = result.getOrNull()
            val error = when {
                text == null -> R.string.markdown_share_error
                text.length > MAX_SHARE_TEXT_CHARS -> R.string.markdown_share_limit
                runCatching { launch(markdownShareIntent(snapshot.resource.title, text)) }.isFailure -> R.string.markdown_share_error
                else -> null
            }
            mutable.update { it.copy(busy = false, markdownStatus = error) }
        }
    }
    private fun readPageSnapshot(id: String): OpenPageSnapshot? {
        val document = store.load(id) ?: return null
        val hidden = store.templateTreeIds(); val children = store.children(id)
        val resources = if (document.resource.kind == "project") store.list().filter { it.id !in hidden && it.kind != "template" } else emptyList()
        val activity = if (document.resource.kind == "project") (listOf(document.resource) + children).take(30)
            .flatMap { resource -> store.history(resource.id, 8).map { ProjectActivity(resource, it) } }
            .sortedWith(compareByDescending<ProjectActivity> { it.event.createdAt }.thenByDescending { it.event.id }).take(12) else emptyList()
        return OpenPageSnapshot(document, children, id in hidden, resources, activity)
    }
    fun open(id: String) {
        val request = ++openId
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { readPageSnapshot(id) } }
            if (request != openId) return@launch
            if (result.isFailure || result.getOrNull() == null) mutable.update { it.copy(error = true) }
            else mutable.update { it.copy(selected = result.getOrNull()!!.document, children = result.getOrNull()!!.children, selectedTemplateTree = result.getOrNull()!!.templateTree, projectResources = result.getOrNull()!!.projectResources, projectActivity = result.getOrNull()!!.projectActivity, actionError = false, versions = null, markdownStatus = null, imageStatus = null, fileStatus = null) }
        }
    }
    private fun closePage() { openId++; moveGeneration++; imageSnapshot = null; mutable.update { it.copy(selected = null, children = emptyList(), projectResources = emptyList(), projectActivity = emptyList(), selectedTemplateTree = false, moveVisible = false, moveLoading = false, moveSource = null, moveDestinations = emptyList(), actionError = false, versions = null, markdownStatus = null, imageStatus = null, fileStatus = null) } }
    fun back() {
        val parent = mutable.value.selected?.resource?.parentId
        if (parent != null && !mutable.value.trash) open(parent) else closePage()
    }
    fun toggleTrash() {
        closePage()
        mutable.update { it.copy(trash = !it.trash, query = "", loading = true) }
        refresh()
    }
    fun rename(title: String) = mutate { page -> store.rename(page.id, page.revision, title.trim()); false }
    internal fun updateImageSettings(target: ImageSettingsTarget, caption: String, display: Int, align: String) = mutate { page ->
        require(page.id == target.pageId && page.revision == target.revision)
        store.updateImagePresentation(page.id, target.blockId, target.revision, caption, display, align); false
    }
    internal fun updateDocumentRunningText(pageId: String, revision: Long, header: String, footer: String, done: (Boolean) -> Unit) {
        val page = mutable.value.selected?.resource
        if (mutable.value.busy || page?.id != pageId || page.revision != revision) { done(false); return }
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                store.updateDocumentRunningText(pageId, revision, header, footer)
                requireNotNull(store.load(pageId))
            } }
            mutable.update { state -> state.copy(busy = false, selected = if (result.isSuccess && state.selected?.resource?.id == pageId) result.getOrNull() else state.selected) }
            if (result.isSuccess) refresh()
            done(result.isSuccess)
        }
    }
    internal fun updateDocumentTypography(pageId: String, revision: Long, size: Double, leading: Double, done: (Boolean) -> Unit) {
        val page = mutable.value.selected?.resource
        if (mutable.value.busy || page?.id != pageId || page.revision != revision) { done(false); return }
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                store.updateDocumentTypography(pageId, revision, size, leading)
                requireNotNull(store.load(pageId))
            } }
            mutable.update { state -> state.copy(busy = false, selected = if (result.isSuccess && state.selected?.resource?.id == pageId) result.getOrNull() else state.selected) }
            if (result.isSuccess) refresh()
            done(result.isSuccess)
        }
    }
    internal fun replacePageText(snapshot: ResourceDocument, query: String, replacement: String, matchCase: Boolean, index: Int?, done: (ResourceDocument?) -> Unit) {
        val page = mutable.value.selected?.resource
        if (mutable.value.busy || page?.id != snapshot.resource.id || page.revision != snapshot.resource.revision) { done(null); return }
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                store.replacePageText(page.id, page.revision, query, replacement, matchCase, index)
                requireNotNull(store.load(page.id))
            } }
            mutable.update { state -> state.copy(busy = false, selected = if (result.isSuccess && state.selected?.resource?.id == page.id) result.getOrNull() else state.selected) }
            if (result.isSuccess) refresh()
            done(result.getOrNull())
        }
    }
    fun trash() = mutate { page -> store.trash(page.id, page.revision); true }
    fun restore() = mutate { page -> store.restore(page.id); true }
    fun restoreVersion(id: String) = mutate { page -> store.restoreVersion(page.id, id, page.revision); false }
    private fun mutate(action: (Resource) -> Boolean) {
        val page = mutable.value.selected?.resource ?: return
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val close = action(page)
                close to if (close) null else store.load(page.id)?.let { it to store.children(page.id) }
            } }
            if (result.isFailure) mutable.update { it.copy(busy = false, actionError = it.selected?.resource?.id == page.id) }
            else {
                val (close, document) = result.getOrThrow()
                mutable.update { state -> state.copy(busy = false, selected = if (state.selected?.resource?.id == page.id) { if (close) null else document?.first } else state.selected, children = if (state.selected?.resource?.id == page.id) { if (close) emptyList() else document?.second ?: emptyList() } else state.children, versions = null) }
                refresh()
            }
        }
    }
    fun showVersions() {
        val page = mutable.value.selected?.resource ?: return
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.versions(page.id) } }
            mutable.update { state -> state.copy(busy = false, versions = if (state.selected?.resource?.id == page.id) result.getOrNull() else null, actionError = result.isFailure && state.selected?.resource?.id == page.id) }
        }
    }
    fun closeVersions() { mutable.update { it.copy(versions = null) } }
    fun saveVersion() {
        val page = mutable.value.selected?.resource ?: return
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, actionError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { store.createVersion(page.id, page.revision); store.versions(page.id) } }
            mutable.update { state -> state.copy(busy = false, versions = if (state.selected?.resource?.id == page.id) result.getOrNull() else null, actionError = result.isFailure && state.selected?.resource?.id == page.id) }
        }
    }
    fun editBlock(blockId: String) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        val block = doc.blocks.firstOrNull { it.id == blockId } ?: return
        if (runCatching { InlineEditing.text(block.content) }.isFailure && runCatching { CodeEditing.read(block.content) }.isFailure) return
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, block.id, doc.resource.revision, block.content, false, documentFormatting = doc.resource.kind == "document"), editorSaveError = false) }
    }
    fun addBlock(heading: Boolean = false, afterBlockId: String? = null) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        if (afterBlockId != null && doc.blocks.none { it.id == afterBlockId }) return
        val id = newBlockId()
        val attrs = JSONObject().put("bid", id)
        if (heading) attrs.put("level", 1)
        val node = JSONObject().put("type", if (heading) "heading" else "paragraph").put("attrs", attrs).toString()
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, id, doc.resource.revision, node, true, afterBlockId, documentFormatting = doc.resource.kind == "document"), editorSaveError = false) }
    }
    fun addCodeBlock(afterBlockId: String? = null) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        if (afterBlockId != null && doc.blocks.none { it.id == afterBlockId }) return
        val id = newBlockId()
        val node = JSONObject().put("type", "codeBlock").put("attrs", JSONObject().put("bid", id).put("language", "")).toString()
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, id, doc.resource.revision, node, true, afterBlockId), editorSaveError = false) }
    }
    fun addMathBlock(afterBlockId: String? = null, latex: String = "\\frac{a}{b}") = mutate { page ->
        val id = newBlockId()
        val node = JSONObject().put("type", "mathBlock").put("attrs", JSONObject().put("bid", id).put("latex", latex)).toString()
        val blocks = requireNotNull(store.load(page.id)).blocks.toMutableList()
        val insertIndex = afterBlockId?.let { after -> blocks.indexOfFirst { it.id == after } } ?: -1
        val newBlock = worlds.content.ContentBlock(id, node)
        if (insertIndex >= 0 && insertIndex < blocks.size) blocks.add(insertIndex + 1, newBlock) else blocks.add(newBlock)
        store.saveBlocks(page.id, page.revision, blocks)
        false
    }
    fun addMermaidBlock(afterBlockId: String? = null, code: String = "graph TD\n  A[Start] --> B[Process]\n  B --> C[End]") = mutate { page ->
        val id = newBlockId()
        val node = JSONObject().put("type", "mermaid").put("attrs", JSONObject().put("bid", id).put("code", code)).toString()
        val blocks = requireNotNull(store.load(page.id)).blocks.toMutableList()
        val insertIndex = afterBlockId?.let { after -> blocks.indexOfFirst { it.id == after } } ?: -1
        val newBlock = worlds.content.ContentBlock(id, node)
        if (insertIndex >= 0 && insertIndex < blocks.size) blocks.add(insertIndex + 1, newBlock) else blocks.add(newBlock)
        store.saveBlocks(page.id, page.revision, blocks)
        false
    }
    /** The assistant changed or put back these pages: refresh the list and reload the open page if it was one of them. */
    fun assistantChanged(pageIds: Set<String>) {
        refresh()
        val shown = mutable.value.selected?.resource?.id
        if (shown != null && shown in pageIds) open(shown)
    }
    fun createWithContent(title: String, content: String) {
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                val page = store.create("page", title.ifBlank { getApplication<Application>().getString(R.string.new_page) })
                val id = newBlockId()
                val node = JSONObject().put("type", "paragraph").put("attrs", JSONObject().put("bid", id))
                    .put("content", org.json.JSONArray().put(JSONObject().put("type", "text").put("text", content))).toString()
                val block = worlds.content.ContentBlock(id, node)
                store.saveBlocks(page.id, page.revision, listOf(block))
                page
            } }
            if (result.isSuccess) {
                refresh()
                open(result.getOrThrow().id)
            }
        }
    }
    fun addContainer(type: String, afterBlockId: String? = null) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        if (type !in setOf("blockquote", "callout", "prompt") || afterBlockId != null && doc.blocks.none { it.id == afterBlockId }) return
        val paragraph = JSONObject().put("type", "paragraph").toString()
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, newBlockId(), doc.resource.revision, paragraph, true, afterBlockId, containerType = type), editorSaveError = false) }
    }
    fun editContainerParagraph(blockId: String, index: Int) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        val block = doc.blocks.firstOrNull { it.id == blockId } ?: return
        val paragraph = runCatching { ContainerEditing.read(block.content).paragraphs.getOrNull(index) }.getOrNull() ?: return
        if (runCatching { InlineEditing.text(paragraph) }.isFailure) return
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, blockId, doc.resource.revision, paragraph, false, containerIndex = index), editorSaveError = false) }
    }
    fun appendContainerParagraph(blockId: String) = mutate { page ->
        store.editList(page.id, blockId, page.revision) { ContainerEditing.append(it) }; false
    }
    fun addTable() = mutate { page -> store.insertTable(page.id, newBlockId(), page.revision); false }
    fun editTableParagraph(blockId: String, row: Int, column: Int, index: Int) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        val block = doc.blocks.firstOrNull { it.id == blockId } ?: return
        val paragraph = runCatching { TableEditing.read(block.content).rows.getOrNull(row)?.getOrNull(column)?.paragraphs?.getOrNull(index) }.getOrNull() ?: return
        if (runCatching { InlineEditing.text(paragraph) }.isFailure) return
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, blockId, doc.resource.revision, paragraph, false, tablePath = listOf(row, column, index)), editorSaveError = false) }
    }
    fun resizeTable(blockId: String, row: Boolean) = mutate { page ->
        store.editList(page.id, blockId, page.revision) { if (row) TableEditing.appendRow(it) else TableEditing.appendColumn(it) }; false
    }
    fun tableAction(blockId: String, revision: Long, action: String, row: Int, column: Int) = mutate { page ->
        if (page.revision != revision) throw worlds.content.ContentConflict()
        store.changeTable(page.id, blockId, revision, action, row, column); false
    }
    fun addList(type: String, afterBlockId: String? = null) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        if (type !in setOf("bulletList", "orderedList", "taskList") || afterBlockId != null && doc.blocks.none { it.id == afterBlockId }) return
        val paragraph = JSONObject().put("type", "paragraph").toString()
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, newBlockId(), doc.resource.revision, paragraph, true, afterBlockId, listType = type), editorSaveError = false) }
    }
    fun editListItem(blockId: String, path: List<Int>) {
        val doc = mutable.value.selected ?: return
        if (mutable.value.busy || doc.resource.deletedAt != null || doc.resource.kind !in setOf("page", "document", "template")) return
        val block = doc.blocks.firstOrNull { it.id == blockId } ?: return
        val item = runCatching { ListEditing.read(block.content).items.firstOrNull { it.path == path } }.getOrNull() ?: return
        val paragraph = item.paragraph ?: return
        if (runCatching { InlineEditing.text(paragraph) }.isFailure) return
        mutable.update { it.copy(editor = EditorTarget(doc.resource.id, blockId, doc.resource.revision, paragraph, false, listItemPath = path.toList()), editorSaveError = false) }
    }
    fun toggleListItem(blockId: String, path: List<Int>, checked: Boolean) = mutate { page ->
        store.editList(page.id, blockId, page.revision) { ListEditing.setChecked(it, path, checked) }; false
    }
    fun appendListItem(blockId: String) = mutate { page ->
        store.editList(page.id, blockId, page.revision) { ListEditing.append(it) }; false
    }
    fun listItemAction(blockId: String, path: List<Int>, action: String) = mutate { page ->
        if (action == "remove") store.removeListItem(page.id, blockId, page.revision, path)
        else store.editList(page.id, blockId, page.revision) {
            when (action) {
                "after" -> ListEditing.insertAfter(it, path)
                "nested" -> ListEditing.addNested(it, path)
                "up" -> ListEditing.move(it, path, -1)
                "down" -> ListEditing.move(it, path, 1)
                else -> error("Unsupported list action")
            }
        }
        false
    }
    fun moveBlock(blockId: String, direction: Int) = mutate { page -> store.moveBlock(page.id, blockId, page.revision, direction); false }
    fun duplicateBlock(pageId: String, blockId: String, revision: Long) = mutate { page ->
        if (page.id != pageId || page.revision != revision) throw worlds.content.ContentConflict()
        store.duplicateBlock(page.id, blockId, revision); false
    }
    fun removeBlock(pageId: String, blockId: String, revision: Long) = mutate { page ->
        if (page.id != pageId || page.revision != revision) throw worlds.content.ContentConflict()
        store.removeBlock(page.id, blockId, revision); false
    }
    fun cancelEditor() { if (!mutable.value.busy) mutable.update { it.copy(editor = null, editorSaveError = false) } }
    fun saveEditor(content: String) {
        val target = mutable.value.editor ?: return
        if (mutable.value.busy) return
        mutable.update { it.copy(busy = true, editorSaveError = false) }
        viewModelScope.launch {
            val result = runCatching { withContext(Dispatchers.IO) {
                when {
                    target.tablePath != null -> store.editList(target.pageId, target.blockId, target.revision) { TableEditing.replaceParagraph(it, target.tablePath[0], target.tablePath[1], target.tablePath[2], content) }
                    target.containerType != null -> store.insertContainer(target.pageId, target.blockId, target.revision, target.containerType, content, target.afterBlockId)
                    target.containerIndex != null -> store.editList(target.pageId, target.blockId, target.revision) { ContainerEditing.replaceParagraph(it, target.containerIndex, content) }
                    target.listType != null -> store.insertList(target.pageId, target.blockId, target.revision, target.listType, content, target.afterBlockId)
                    target.listItemPath != null -> store.editList(target.pageId, target.blockId, target.revision) { ListEditing.replaceParagraph(it, target.listItemPath, content) }
                    JSONObject(target.initial).optString("type") == "codeBlock" -> store.saveCodeBlock(target.pageId, target.blockId, target.revision, content, target.isNew, target.afterBlockId)
                    else -> store.saveInlineBlock(target.pageId, target.blockId, target.revision, content, target.isNew, target.afterBlockId)
                }
                requireNotNull(store.load(target.pageId))
            } }
            mutable.update { state ->
                if (state.editor != target) state.copy(busy = false)
                else if (result.isFailure) state.copy(busy = false, editorSaveError = true)
                else state.copy(busy = false, editor = null, selected = if (state.selected?.resource?.id == target.pageId) result.getOrThrow() else state.selected)
            }
            if (result.isSuccess) refresh()
        }
    }
    override fun close() { store.close() }
    override fun onCleared() { close() }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun WorldsTheme(store: AppearanceStore? = null, content: @Composable () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val defaultStore = remember(context.applicationContext) { AppearanceStore(context.applicationContext) }
    val appearanceStore = store ?: defaultStore
    val appearance by appearanceStore.values.collectAsState(initial = AppearancePreferences())
    val systemDark = isSystemInDarkTheme()
    val dark = when (appearance.theme) { "dark" -> true; "light" -> false; else -> systemDark }
    val accent = appearanceAccents.firstOrNull { it.id == appearance.accent } ?: appearanceAccents.first()
    val primary = if (dark) accent.dark else accent.light
    val scheme = worldsColorScheme(dark, primary)
    val view = androidx.compose.ui.platform.LocalView.current
    androidx.compose.runtime.SideEffect {
        val activity = generateSequence(view.context) { (it as? android.content.ContextWrapper)?.baseContext }
            .filterIsInstance<android.app.Activity>().firstOrNull()
        if (activity != null) {
            val bars = androidx.core.view.WindowCompat.getInsetsController(activity.window, view)
            bars.isAppearanceLightStatusBars = !dark
            bars.isAppearanceLightNavigationBars = !dark
        }
    }
    CompositionLocalProvider(LocalAppearanceStore provides appearanceStore, LocalAppearancePreferences provides appearance) {
        MaterialTheme(colorScheme = scheme, typography = WorldsTypography, shapes = WorldsShapes) {
            CompositionLocalProvider(LocalContentColor provides scheme.onBackground, worlds.android.glass.LocalGlassQuality provides appearance.glassQuality, worlds.android.glass.LocalGlassDark provides dark, androidx.compose.foundation.LocalIndication provides WorldsPressIndication(if (dark) Color(0x1FFFFFFF) else Color(0x14000000)), LocalRippleConfiguration provides RippleConfiguration(rippleAlpha = androidx.compose.material.ripple.RippleAlpha(0.05f, 0.08f, 0.05f, 0.10f)), content = content)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun Home(model: HomeModel, account: AccountModel? = null, shareLauncher: ((Intent) -> Unit)? = null) {
    var showLibraryActions by remember { mutableStateOf(false) }
    var destinationName by rememberSaveable { mutableStateOf(WorldsDestination.Home.name) }
    val state by model.state.collectAsStateWithLifecycle()
    var showAccount by rememberSaveable { mutableStateOf(false) }
    var showAppearance by rememberSaveable { mutableStateOf(false) }
    var showAiChat by rememberSaveable { mutableStateOf(false) }
    var showAutomations by rememberSaveable { mutableStateOf(false) }
    var showDiscordComposer by rememberSaveable { mutableStateOf(false) }
    var showProfile by rememberSaveable { mutableStateOf(false) }
    var planningSection by rememberSaveable { mutableStateOf<String?>(null) }
    if (showAppearance) {
        AppearanceSettings(onBack = { showAppearance = false })
        return
    }
    if (showAccount && account != null) {
        AccountScreen(account, onBack = { showAccount = false })
        return
    }
    if (showAiChat) {
        AiChatScreen(databaseName = model.databaseName, onBack = { showAiChat = false }, onCreatePage = { title, content -> showAiChat = false; model.createWithContent(title, content) }, onOpenPage = { id -> showAiChat = false; model.open(id) }, onWorkspaceChanged = model::assistantChanged)
        return
    }
    if (showAutomations) {
        AutomationsScreen(databaseName = model.databaseName, onBack = { showAutomations = false })
        return
    }
    val openSection = planningSection?.let { name -> PlanningSection.entries.firstOrNull { it.name == name } }
    if (openSection != null) {
        // Lesson notes are pages, so they open in the page editor.
        PlanningScreen(openSection, model.databaseName, LocalAppearancePreferences.current.studyPackEnabled,
            onBack = { planningSection = null; model.refresh() },
            onOpenPage = { id -> planningSection = null; model.refresh(); model.open(id) })
        return
    }
    if (showDiscordComposer) {
        DiscordComposer(initialDocument = state.selected, databaseName = model.databaseName, onBack = { showDiscordComposer = false })
        return
    }
    if (showProfile) {
        ProfileScreen(onBack = { showProfile = false })
        return
    }
    val keyboard = LocalSoftwareKeyboardController.current
    val context = androidx.compose.ui.platform.LocalContext.current
    if (state.moveVisible) AlertDialog(onDismissRequest = model::closeMove,
        title = { WorldsActionLabel(R.drawable.ic_folder, stringResource(R.string.move_page)) },
        text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.move_page_explanation), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (state.moveLoading || state.busy) CircularProgressIndicator(Modifier.padding(16.dp))
                else if (state.moveError) {
                    Text(stringResource(R.string.move_page_error), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = model::openMove) { Text(stringResource(R.string.retry)) }
                } else {
                    TextButton(enabled = state.moveSource?.parentId != null, onClick = { model.movePage(null) }, modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.fillMaxWidth()) { WorldsActionLabel(R.drawable.ic_folder, stringResource(R.string.move_page_root)) }
                    }
                    state.moveDestinations.forEach { target ->
                        TextButton(enabled = target.resource.id != state.moveSource?.parentId, onClick = { model.movePage(target.resource) }, modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                WorldsGlyph(R.drawable.ic_file_text, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(target.path, color = MaterialTheme.colorScheme.onSurface, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }, confirmButton = { TextButton(enabled = !state.busy, onClick = model::closeMove) { Text(stringResource(R.string.cancel)) } })
    val importPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) model.importDrawing(uri) }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> model.finishImageImport(uri) }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> model.finishFileImport(uri) }
    val fileExportPicker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result -> model.finishFileExport(if (result.resultCode == android.app.Activity.RESULT_OK) result.data?.data else null) }
    fun pickFile(parent: Resource? = null) { if (model.beginFileImport(parent)) runCatching { filePicker.launch(arrayOf("*/*")) }.onFailure { model.fileImportPickerFailed() } }
    fun exportFile() { model.beginFileExport()?.let { request ->
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(request.mime).putExtra(Intent.EXTRA_TITLE, request.name)
        runCatching { fileExportPicker.launch(intent) }.onFailure { model.fileExportPickerFailed() }
    } }
    val imageExportPicker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result -> model.finishImageExport(if (result.resultCode == android.app.Activity.RESULT_OK) result.data?.data else null) }
    fun exportImage(blockId: String) {
        model.beginImageExport(blockId)?.let { request ->
            val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(request.mime).putExtra(Intent.EXTRA_TITLE, request.name)
            runCatching { imageExportPicker.launch(intent) }.onFailure { model.imageExportPickerFailed() }
        }
    }
    val imageTypes = remember { listOf("image/png", "image/jpeg", "image/webp", "image/gif") + if (android.os.Build.VERSION.SDK_INT >= 31) listOf("image/avif") else emptyList() }
    fun pickImage(after: String?) {
        if (model.beginImageImport(after)) runCatching { imagePicker.launch(imageTypes.toTypedArray()) }.onFailure { model.imagePickerFailed() }
    }
    fun pickGalleryMedia() {
        if (model.beginImageImport()) runCatching { imagePicker.launch((imageTypes + listOf("video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/flac")).toTypedArray()) }.onFailure { model.imagePickerFailed() }
    }
    fun pickSlideImage(slideId: String) {
        if (model.beginSlideImageImport(slideId)) runCatching { imagePicker.launch(imageTypes.toTypedArray()) }.onFailure { model.imagePickerFailed() }
    }
    fun pickSlideBackground(slideId: String) {
        if (model.beginSlideImageImport(slideId, background = true)) runCatching { imagePicker.launch(imageTypes.toTypedArray()) }.onFailure { model.imagePickerFailed() }
    }
    fun pickSlideVideo(slideId: String) {
        if (model.beginSlideVideoImport(slideId)) runCatching { imagePicker.launch(arrayOf("video/mp4", "video/webm")) }.onFailure { model.imagePickerFailed() }
    }
    val markdownImportPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> if (uri != null) model.importMarkdown(uri) }
    var showMarkdownImport by rememberSaveable { mutableStateOf(false) }
    var templateToTrash by remember { mutableStateOf<Resource?>(null) }
    templateToTrash?.let { template ->
        AlertDialog(onDismissRequest = { templateToTrash = null }, title = { Text(stringResource(R.string.template_trash_title)) },
            text = { Text(stringResource(R.string.template_trash_body, template.title)) },
            confirmButton = { TextButton(onClick = { templateToTrash = null; model.trashTemplate(template) }) { Text(stringResource(R.string.move_to_trash)) } },
            dismissButton = { TextButton(onClick = { templateToTrash = null }) { Text(stringResource(R.string.cancel)) } })
    }
    if (state.templatesVisible) AlertDialog(onDismissRequest = model::closeTemplates,
        title = { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.templates_title)) }, text = {
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                Text(stringResource(R.string.templates_explanation), color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(enabled = !state.templatesLoading && !state.busy, onClick = model::createTemplate) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.template_new)) }
                if (state.templatesLoading || state.busy) CircularProgressIndicator(Modifier.padding(16.dp))
                else if (state.templatesError) {
                    Text(stringResource(R.string.templates_error), color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = model::showTemplates) { Text(stringResource(R.string.retry)) }
                } else if (state.templates.isEmpty()) Text(stringResource(R.string.templates_empty))
                else state.templates.forEach { template ->
                    val metadata = remember(template.metadata) { JSONObject(template.metadata) }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                    TextButton(onClick = { model.useTemplate(template.id) }, modifier = Modifier.weight(1f), contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                            val icon = when (metadata.optString("builtin")) {
                                "todo" -> R.drawable.ic_list_todo
                                "project", "feedback", "roadmap", "bugs" -> R.drawable.ic_table_2
                                "weekly", "release", "meeting" -> R.drawable.ic_file_text
                                "discord" -> R.drawable.ic_message_circle
                                else -> R.drawable.ic_files
                            }
                            WorldsGlyph(icon, Modifier.padding(top = 3.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Column(Modifier.weight(1f)) {
                                Text(template.title.replace("{{date}}", "").trim(), color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleSmall)
                                Text(metadata.optString("description"), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                Text(metadata.optString("templateCategory"), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    var actionsOpen by remember(template.id) { mutableStateOf(false) }
                    val actionsLabel = stringResource(R.string.template_actions, template.title)
                    Box {
                        IconButton(onClick = { actionsOpen = true }, modifier = Modifier.semantics { contentDescription = actionsLabel }) { WorldsGlyph(R.drawable.ic_ellipsis_vertical, tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                        DropdownMenu(expanded = actionsOpen, onDismissRequest = { actionsOpen = false }) {
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_pen_line) }, text = { Text(stringResource(R.string.template_edit)) }, onClick = { actionsOpen = false; model.editTemplate(template.id) })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(R.string.template_duplicate)) }, onClick = { actionsOpen = false; model.duplicateTemplate(template) })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, text = { Text(stringResource(R.string.move_to_trash)) }, onClick = { actionsOpen = false; templateToTrash = template })
                        }
                    }
                    }
                }
            }
        }, confirmButton = { TextButton(enabled = !state.busy, onClick = model::closeTemplates) { Text(stringResource(R.string.close)) } })
    if (showMarkdownImport) AlertDialog(onDismissRequest = { showMarkdownImport = false },
        title = { Text(stringResource(R.string.markdown_import)) }, text = { Text(stringResource(R.string.markdown_import_explanation)) },
        confirmButton = { TextButton(onClick = { showMarkdownImport = false; runCatching { markdownImportPicker.launch(arrayOf("*/*")) }.onFailure { model.markdownImportPickerFailed() } }) { Text(stringResource(R.string.choose_file)) } },
        dismissButton = { TextButton(onClick = { showMarkdownImport = false }) { Text(stringResource(R.string.cancel)) } })
    val markdownPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/markdown")) { uri -> model.finishMarkdownExport(uri) }
    var showMarkdown by rememberSaveable(state.selected?.resource?.id) { mutableStateOf(false) }
    if (showMarkdown && state.selected != null) AlertDialog(onDismissRequest = { showMarkdown = false },
        title = { Text(stringResource(R.string.markdown_export)) }, text = {
            Column {
                Text(stringResource(R.string.markdown_explanation))
                TextButton(enabled = !state.busy, onClick = {
                    showMarkdown = false
                    model.shareMarkdown { intent -> if (shareLauncher != null) shareLauncher(intent) else context.startActivity(intent) }
                }) { WorldsActionLabel(R.drawable.ic_share_2, stringResource(R.string.markdown_share)) }
                if (state.selected?.markdownSourceName != null) TextButton(enabled = !state.busy, onClick = {
                    showMarkdown = false
                    model.beginMarkdownExport(original = true)?.let { name -> runCatching { markdownPicker.launch(name) }.onFailure { model.markdownPickerFailed() } }
                }) { Text(stringResource(R.string.markdown_save_original)) }
            }
        },
        confirmButton = { TextButton(enabled = !state.busy, onClick = {
            showMarkdown = false
            model.beginMarkdownExport()?.let { name -> runCatching { markdownPicker.launch(name) }.onFailure { model.markdownPickerFailed() } }
        }) { Text(stringResource(R.string.markdown_save)) } },
        dismissButton = { TextButton(enabled = !state.busy, onClick = { showMarkdown = false; model.copyMarkdown() }) { Text(stringResource(R.string.markdown_copy)) } })
    state.importError?.let { error ->
        AlertDialog(onDismissRequest = model::clearImportError, title = { Text(stringResource(R.string.import_title)) },
            text = { Text(stringResource(error)) }, confirmButton = { TextButton(onClick = model::clearImportError) { Text(stringResource(R.string.close)) } })
    }
    var showCreate by rememberSaveable { mutableStateOf(false) }
    var createKind by rememberSaveable { mutableStateOf("page") }
    var createParent by rememberSaveable { mutableStateOf<String?>(null) }
    var createParentRevision by rememberSaveable { mutableLongStateOf(0L) }
    var title by rememberSaveable { mutableStateOf("") }
    var showRename by rememberSaveable { mutableStateOf(false) }
    var streamCreateParent by remember { mutableStateOf<Resource?>(null) }
    var showStreamCreate by remember { mutableStateOf(false) }
    var renameTitle by rememberSaveable { mutableStateOf("") }
    BackHandler(enabled = state.selected != null && state.editor == null) { model.back() }
    if (showStreamCreate) StreamEditDialog(null, state.busy, creating = true, onDismiss = { showStreamCreate = false }) { title, url, done ->
        model.createStream(title, url, streamCreateParent) { success -> if (success) showStreamCreate = false; done(success) }
    }
    state.editor?.let { if (JSONObject(it.initial).optString("type") == "codeBlock") CodeEditorDialog(it, state.busy, state.editorSaveError, model::cancelEditor, model::saveEditor) else InlineEditorDialog(it, state.busy, state.editorSaveError, model::cancelEditor, model::saveEditor) }
    if (showCreate) {
        AlertDialog(onDismissRequest = { showCreate = false; title = "" }, title = { Text(stringResource(if (createParent != null) R.string.new_subpage else if (createKind == "drawing") R.string.new_drawing else if (createKind == "document") R.string.new_document else if (createKind == "project") R.string.project_new else if (createKind == "gallery") R.string.gallery_new else if (createKind == "presentation") R.string.presentation_new else R.string.new_page)) },
            text = { OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text(stringResource(if (createKind == "drawing") R.string.drawing_title else if (createKind == "project") R.string.project_title else R.string.page_title)) }, singleLine = true) },
            confirmButton = { TextButton(onClick = { val parent = createParent; if (parent == null) model.create(title, createKind) else model.createSubpage(parent, createParentRevision, title); title = ""; showCreate = false; createParent = null }) { Text(stringResource(R.string.create)) } },
            dismissButton = { TextButton(onClick = { showCreate = false; title = "" }) { Text(stringResource(R.string.cancel)) } })
    }
    if (showRename && state.selected != null) {
        AlertDialog(onDismissRequest = { showRename = false }, title = { Text(stringResource(R.string.rename)) },
            text = { OutlinedTextField(value = renameTitle, onValueChange = { renameTitle = it }, label = { Text(stringResource(R.string.page_title)) }, singleLine = true) },
            confirmButton = { TextButton(onClick = { model.rename(renameTitle); showRename = false }) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { showRename = false }) { Text(stringResource(R.string.cancel)) } })
    }
    state.versions?.let { versions ->
        AlertDialog(onDismissRequest = { if (!state.busy) model.closeVersions() }, title = { Text(stringResource(R.string.versions)) },
            text = {
                Column {
                    if (versions.isEmpty()) Text(stringResource(R.string.no_versions))
                    else LazyColumn(Modifier.heightIn(max = 300.dp)) {
                        items(versions, key = { it.id }) { version ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                                Column(Modifier.weight(1f)) {
                                    val date = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(version.createdAt))
                                    Text(when (version.label) { "Before restore" -> stringResource(R.string.before_restore); "Before block removal" -> stringResource(R.string.before_block_removal); else -> version.label ?: date })
                                    if (version.label != null) Text(date, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                TextButton(enabled = !state.busy, onClick = { model.restoreVersion(version.id) }) { Text(stringResource(R.string.restore)) }
                            }
                        }
                    }
                    TextButton(enabled = !state.busy, onClick = model::saveVersion) { Text(stringResource(R.string.save_version)) }
                }
            },
            confirmButton = { TextButton(enabled = !state.busy, onClick = model::closeVersions) { Text(stringResource(R.string.close)) } })
    }
    val destination = WorldsDestination.valueOf(destinationName)
    fun selectDestination(next: WorldsDestination) {
        if (destination == WorldsDestination.Search && next != WorldsDestination.Search) model.search("")
        destinationName = next.name
    }
    BackHandler(enabled = state.selected == null && destination != WorldsDestination.Home) { selectDestination(WorldsDestination.Home) }
    val shellActions = remember(account) { ShellActions(
        create = { kind -> createParent = null; createKind = kind; title = ""; showCreate = true },
        open = { id -> if (id.isEmpty()) model.back() else model.open(id) },
        search = model::search,
        refresh = model::refresh,
        settings = { showAppearance = true },
        account = if (account != null) { { showAccount = true } } else null,
        automations = { showAutomations = true },
        templates = model::showTemplates,
        planning = { section -> planningSection = section.name },
    ) }
    WorldsShell(state, shellActions, destination, ::selectDestination, showLibraryActions, { showLibraryActions = it },
        moreItems = {
            if (account != null) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_circle_user) }, text = { Text(stringResource(R.string.account_title)) }, onClick = { showLibraryActions = false; showAccount = true })
            if (!state.trash) {
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_folder) }, text = { Text(stringResource(R.string.project_new)) }, onClick = { showLibraryActions = false; createParent = null; createKind = "project"; showCreate = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_image) }, text = { Text(stringResource(R.string.gallery_new)) }, onClick = { showLibraryActions = false; createParent = null; createKind = "gallery"; showCreate = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_maximize) }, text = { Text(stringResource(R.string.presentation_new)) }, onClick = { showLibraryActions = false; createParent = null; createKind = "presentation"; showCreate = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_file_text) }, text = { Text(stringResource(R.string.new_document)) }, onClick = { showLibraryActions = false; createParent = null; createKind = "document"; showCreate = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_table_2) }, text = { Text(stringResource(R.string.new_spreadsheet)) }, onClick = { showLibraryActions = false; createParent = null; createKind = "spreadsheet"; showCreate = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_pen_line) }, text = { Text(stringResource(R.string.new_drawing)) }, onClick = { showLibraryActions = false; createParent = null; createKind = "drawing"; showCreate = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_link) }, text = { Text(stringResource(R.string.stream_add)) }, onClick = { showLibraryActions = false; streamCreateParent = null; showStreamCreate = true })
                HorizontalDivider()
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_message_circle) }, text = { Text(stringResource(R.string.ai_chat)) }, onClick = { showLibraryActions = false; destinationName = WorldsDestination.Ai.name })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_sliders_horizontal) }, text = { Text(stringResource(R.string.automations)) }, onClick = { showLibraryActions = false; showAutomations = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_list_todo) }, text = { Text(stringResource(R.string.plan_tasks)) }, onClick = { showLibraryActions = false; planningSection = PlanningSection.Tasks.name })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_calendar) }, text = { Text(stringResource(R.string.plan_calendar)) }, onClick = { showLibraryActions = false; planningSection = PlanningSection.Calendar.name })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_inbox) }, text = { Text(stringResource(R.string.plan_inbox)) }, onClick = { showLibraryActions = false; planningSection = PlanningSection.Inbox.name })
                if (LocalAppearancePreferences.current.studyPackEnabled) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_graduation_cap) }, text = { Text(stringResource(R.string.plan_study)) }, onClick = { showLibraryActions = false; planningSection = PlanningSection.Study.name })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_share_2) }, text = { Text(stringResource(R.string.discord)) }, onClick = { showLibraryActions = false; showDiscordComposer = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_circle_user) }, text = { Text(stringResource(R.string.profile)) }, onClick = { showLibraryActions = false; showProfile = true })
                HorizontalDivider()
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_upload) }, text = { Text(stringResource(R.string.file_import)) }, onClick = { showLibraryActions = false; pickFile() })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_upload) }, text = { Text(stringResource(R.string.drawing_import)) }, onClick = { showLibraryActions = false; runCatching { importPicker.launch(arrayOf("*/*")) }.onFailure { model.importPickerFailed() } })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_file_text) }, text = { Text(stringResource(R.string.markdown_import)) }, onClick = { showLibraryActions = false; showMarkdownImport = true })
                DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(R.string.templates_title)) }, onClick = { showLibraryActions = false; model.showTemplates() })
                HorizontalDivider()
            }
            DropdownMenuItem(leadingIcon = { WorldsGlyph(if (state.trash) R.drawable.ic_files else R.drawable.ic_trash_2) }, text = { Text(stringResource(if (state.trash) R.string.pages else R.string.trash)) }, onClick = { showLibraryActions = false; model.toggleTrash(); destinationName = WorldsDestination.Library.name })
        },
        ai = { aiModifier -> AiChatScreen(databaseName = model.databaseName, onBack = { selectDestination(WorldsDestination.Home) }, onCreatePage = { title, content -> selectDestination(WorldsDestination.Home); model.createWithContent(title, content) }, modifier = aiModifier, showBack = false, onOpenPage = { id -> selectDestination(WorldsDestination.Home); model.open(id) }, onWorkspaceChanged = model::assistantChanged) },
        detail = { detailModifier ->
                if (state.selected!!.resource.kind == "spreadsheet" && state.selected!!.resource.deletedAt == null) SpreadsheetScreen(state.selected!!.resource, onBack = model::back, modifier = detailModifier, databaseName = model.databaseName)
                else if (state.selected!!.resource.kind == "drawing" && state.selected!!.resource.deletedAt == null) DrawingScreen(state.selected!!.resource, model::back, detailModifier, model.databaseName)
                else if (state.selected!!.resource.kind == "project" && state.selected!!.resource.deletedAt == null) ProjectScreen(state.selected!!.resource, state.children, state.projectResources, state.projectActivity, state.busy,
                    onBack = model::back, onOpen = model::open, onRename = { renameTitle = state.selected!!.resource.title; showRename = true }, onTrash = model::trash,
                    onCreateChild = model::createProjectChild, onUpdate = model::updateProject, onLinkChange = model::changeProjectLink, onImportFile = { pickFile(it) }, onAddStream = { streamCreateParent = it; showStreamCreate = true }, modifier = detailModifier)
                else if (state.selected!!.resource.kind == "gallery" && state.selected!!.resource.deletedAt == null) GalleryScreen(state.selected!!, model.databaseName, state.busy, state.imageStatus,
                    onBack = model::back, onAdd = ::pickGalleryMedia, onExport = ::exportImage, onAction = model::galleryAction, onLayout = model::galleryLayout,
                    onRename = { renameTitle = state.selected!!.resource.title; showRename = true }, onTrash = model::trash, modifier = detailModifier)
                else if (state.selected!!.resource.kind == "presentation" && state.selected!!.resource.deletedAt == null) PresentationScreen(state.selected!!, state.busy, model::back, model::presentationAction, model.databaseName, state.imageStatus, ::pickSlideImage, ::pickSlideBackground, ::pickSlideVideo, model::presentationElement,
                    onRename = { renameTitle = state.selected!!.resource.title; showRename = true }, onTrash = model::trash, modifier = detailModifier)
                else if (state.selected!!.resource.kind == "file" && state.selected!!.resource.deletedAt == null) FileScreen(state.selected!!.resource, model.databaseName, state.busy, state.fileStatus,
                    onBack = model::back, onExport = ::exportFile, onRename = { renameTitle = state.selected!!.resource.title; showRename = true }, onTrash = model::trash, modifier = detailModifier)
                else if (state.selected!!.resource.kind == "stream" && state.selected!!.resource.deletedAt == null) StreamScreen(state.selected!!.resource, state.busy, model::back, model::updateStream,
                    onRename = { renameTitle = state.selected!!.resource.title; showRename = true }, onTrash = model::trash, modifier = detailModifier)
                else PageDetail(state.selected!!, state.children, model::back, state.busy, state.actionError, canMovePage = !state.selectedTemplateTree, databaseName = model.databaseName, imageStatus = state.imageStatus,
                    allowKeyboardShortcuts = state.editor == null && state.versions == null && !state.moveVisible && !state.templatesVisible && !showCreate && !showRename && !showMarkdown && !showMarkdownImport && templateToTrash == null,
                    onRename = { renameTitle = state.selected!!.resource.title; showRename = true },
                    onMovePage = model::openMove,
                    onAddImage = ::pickImage,
                    onExportImage = ::exportImage,
                    onImageSettings = model::updateImageSettings,
                    onDocumentRunningText = model::updateDocumentRunningText,
                    onDocumentTypography = model::updateDocumentTypography,
                    onFindReplace = model::replacePageText,
                    onNewSubpage = { createParent = state.selected!!.resource.id; createParentRevision = state.selected!!.resource.revision; createKind = "page"; title = ""; showCreate = true }, onOpenSubpage = model::open,
                    onTrash = model::trash, onRestore = model::restore, onVersions = model::showVersions, onAdd = model::addBlock, onAddCode = model::addCodeBlock, onAddMath = model::addMathBlock, onAddMermaid = model::addMermaidBlock, onEdit = model::editBlock, onMove = model::moveBlock, onRemove = model::removeBlock, onDuplicate = model::duplicateBlock,
                    onAddTable = model::addTable, onEditTable = model::editTableParagraph, onResizeTable = model::resizeTable, onTableAction = model::tableAction, onAddContainer = model::addContainer, onEditContainer = model::editContainerParagraph, onAppendContainer = model::appendContainerParagraph, onAddList = model::addList, onEditItem = model::editListItem, onToggleItem = model::toggleListItem, onAppendItem = model::appendListItem, onItemAction = model::listItemAction, markdownStatus = state.markdownStatus, onMarkdown = { showMarkdown = true }, onSaveTemplate = model::saveTemplate,
                    onDiscord = { showDiscordComposer = true },
                    modifier = detailModifier)
        },
    )
}

@Composable private fun ListBlockView(list: ListEditing.ListBlock, editable: Boolean, reveal: PageMatch?,
    onEdit: (List<Int>) -> Unit, onToggle: (List<Int>, Boolean) -> Unit, onAppend: () -> Unit,
    onAction: (List<Int>, String) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        list.items.forEach { item -> key(item.path) {
            val paragraph = item.paragraph
            val preview = paragraph?.let { remember(it) { previewBlock(it) } }
            val match = reveal?.takeIf { it.path == item.path + 0 }
            var menu by remember { mutableStateOf(false) }
            var confirmRemoval by remember { mutableStateOf(false) }
            val pathLabel = item.path.filterIndexed { index, _ -> index % 2 == 0 }.joinToString(".") { (it + 1).toString() }
            if (confirmRemoval) AlertDialog(onDismissRequest = { confirmRemoval = false },
                title = { Text(stringResource(R.string.remove_list_item)) },
                text = { Text(stringResource(R.string.remove_list_item_body)) },
                confirmButton = { TextButton(onClick = { confirmRemoval = false; onAction(item.path, "remove") }) { Text(stringResource(R.string.remove)) } },
                dismissButton = { TextButton(onClick = { confirmRemoval = false }) { Text(stringResource(R.string.cancel)) } })
            Row(Modifier.fillMaxWidth().padding(start = (item.depth * 18).coerceAtMost(144).dp), verticalAlignment = Alignment.CenterVertically) {
                if (item.listType == "taskList") {
                    val description = if (item.depth == 0) stringResource(R.string.task_item, item.index + 1) else stringResource(R.string.nested_task_item, pathLabel)
                    Checkbox(checked = item.checked == true, enabled = editable && item.checked != null,
                        onCheckedChange = { onToggle(item.path, it) }, modifier = Modifier.semantics { contentDescription = description })
                } else Text(if (item.listType == "orderedList") "${item.number}." else "•", modifier = Modifier.padding(end = 12.dp))
                val canEditItem = editable && paragraph != null && remember(paragraph) { runCatching { InlineEditing.text(paragraph) }.isSuccess }
                Column(Modifier.weight(1f).heightIn(min = 30.dp).tapToEdit(canEditItem) { onEdit(item.path) }) {
                    if (preview != null && preview.text.isNotEmpty()) Text(highlightedFindText(preview, paragraph, match, MaterialTheme.colorScheme.primary.copy(alpha = 0.30f)), color = MaterialTheme.colorScheme.onBackground, lineHeight = 28.sp, modifier = findRevealModifier(match))
                    else if (preview != null) Text(stringResource(R.string.empty_list_item), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (item.incomplete || preview?.incomplete == true) Text(stringResource(R.string.preview_incomplete), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 23.sp)
                }
                if (editable && paragraph != null) {
                    val description = stringResource(R.string.list_item_actions, pathLabel)
                    Box {
                        TextButton(onClick = { menu = true }, modifier = Modifier.widthIn(min = 48.dp).semantics { contentDescription = description }, contentPadding = PaddingValues(horizontal = 4.dp)) { WorldsGlyph(R.drawable.ic_ellipsis_vertical) }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_list_plus) }, text = { Text(stringResource(R.string.list_insert_after)) }, onClick = { menu = false; onAction(item.path, "after") })
                            DropdownMenuItem(enabled = item.depth < 16, leadingIcon = { WorldsGlyph(R.drawable.ic_list_tree) }, text = { Text(stringResource(R.string.list_add_nested)) }, onClick = { menu = false; onAction(item.path, "nested") })
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            DropdownMenuItem(enabled = item.index > 0, leadingIcon = { WorldsGlyph(R.drawable.ic_arrow_up) }, text = { Text(stringResource(R.string.move_list_item_up)) }, onClick = { menu = false; onAction(item.path, "up") })
                            DropdownMenuItem(enabled = item.index < item.siblingCount - 1, leadingIcon = { WorldsGlyph(R.drawable.ic_arrow_down) }, text = { Text(stringResource(R.string.move_list_item_down)) }, onClick = { menu = false; onAction(item.path, "down") })
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, text = { Text(stringResource(R.string.remove_list_item)) }, onClick = { menu = false; confirmRemoval = true })
                        }
                    }
                }
            }
        } }
        if (editable) TextButton(onClick = onAppend) { Text(stringResource(R.string.add_list_item)) }
    }
}

@Composable private fun ContainerBlockView(container: ContainerEditing.Container, editable: Boolean, reveal: PageMatch?, onEdit: (Int) -> Unit, onAppend: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(12.dp)).padding(16.dp)) {
        val title = when (container.type) { "blockquote" -> stringResource(R.string.quote); "callout" -> stringResource(R.string.callout); else -> stringResource(R.string.prompt) }
        Text(title, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
        if (container.label.isNotBlank() && container.label != "Prompt") Text(container.label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        container.paragraphs.forEachIndexed { index, paragraph ->
            if (paragraph == null) Text(stringResource(R.string.preview_incomplete), color = MaterialTheme.colorScheme.onSurfaceVariant)
            else {
                val preview = remember(paragraph) { previewBlock(paragraph) }
                val match = reveal?.takeIf { it.path == listOf(index) }
                val canEditParagraph = editable && remember(paragraph) { runCatching { InlineEditing.text(paragraph) }.isSuccess }
                Column(Modifier.fillMaxWidth().heightIn(min = 30.dp).tapToEdit(canEditParagraph, stringResource(R.string.edit_container_paragraph, index + 1)) { onEdit(index) }) {
                if (preview.text.isNotEmpty()) Text(highlightedFindText(preview, paragraph, match, MaterialTheme.colorScheme.primary.copy(alpha = 0.30f)), color = MaterialTheme.colorScheme.onSurface, lineHeight = 26.sp, modifier = findRevealModifier(match))
                else Text(stringResource(R.string.empty_paragraph), color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (preview.incomplete) Text(stringResource(R.string.preview_incomplete), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (editable) TextButton(onClick = onAppend) { Text(stringResource(R.string.add_quote_paragraph)) }
    }
}

private data class PendingTableDelete(val revision: Long, val action: String, val row: Int, val column: Int)

@Composable private fun TableBlockView(table: TableEditing.Table, revision: Long, editable: Boolean, reveal: PageMatch?, onEdit: (Int, Int, Int) -> Unit, onResize: (Boolean) -> Unit, onAction: (Long, String, Int, Int) -> Unit) {
    var pending by remember { mutableStateOf<PendingTableDelete?>(null) }
    pending?.let { target ->
        AlertDialog(onDismissRequest = { pending = null },
            title = { Text(stringResource(if (target.action == "remove_row") R.string.delete_table_row else R.string.delete_table_column)) },
            text = { Text(stringResource(R.string.delete_table_confirm)) },
            confirmButton = { TextButton(enabled = editable, onClick = { pending = null; onAction(target.revision, target.action, target.row, target.column) }) { Text(stringResource(R.string.remove)) } },
            dismissButton = { TextButton(onClick = { pending = null }) { Text(stringResource(R.string.cancel)) } })
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        if (!table.canResize) Text(stringResource(R.string.table_limited), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            table.rows.forEachIndexed { rowIndex, row ->
                Row(Modifier.height(IntrinsicSize.Min)) {
                    row.forEachIndexed { columnIndex, cell ->
                        Column(Modifier.width(180.dp).fillMaxHeight().border(0.5.dp, MaterialTheme.colorScheme.outlineVariant)
                            .background(if (cell?.header == true) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface).padding(8.dp)) {
                            if (cell == null || cell.spanned) Text(stringResource(R.string.preview_incomplete), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                            cell?.paragraphs?.forEachIndexed { index, paragraph ->
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    if (paragraph == null) Text(stringResource(R.string.preview_incomplete), modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                    else {
                                        val preview = remember(paragraph) { previewBlock(paragraph) }
                                        val match = reveal?.takeIf { it.path == listOf(rowIndex, columnIndex, index) }
                                        val canEdit = editable && remember(paragraph) { runCatching { InlineEditing.text(paragraph) }.isSuccess }
                                        val description = stringResource(R.string.edit_table_cell, rowIndex + 1, columnIndex + 1, index + 1)
                                        val actionModifier = if (canEdit) Modifier.clickable(onClickLabel = description) { onEdit(rowIndex, columnIndex, index) }.semantics { contentDescription = description } else Modifier
                                        Column(Modifier.weight(1f).defaultMinSize(minHeight = 48.dp).then(actionModifier).then(findRevealModifier(match)), verticalArrangement = Arrangement.Center) {
                                            if (preview.text.isEmpty()) Text(stringResource(R.string.empty_cell), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                            else Text(highlightedFindText(preview, paragraph, match, MaterialTheme.colorScheme.primary.copy(alpha = 0.30f)), color = MaterialTheme.colorScheme.onSurface, fontWeight = if (cell.header) FontWeight.SemiBold else FontWeight.Normal)
                                            if (preview.incomplete) Text(stringResource(R.string.preview_incomplete), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                                        }
                                    }
                                    if (index == 0 && editable && table.canResize) {
                                        TableCellMenu(table, rowIndex, columnIndex, revision, onAction, onEdit = if (paragraph != null && runCatching { InlineEditing.text(paragraph) }.isSuccess) ({ onEdit(rowIndex, columnIndex, index) }) else null) { pending = it }
                                    }
                                }
                            }

                        }
                    }
                }
            }
        }
        if (editable && table.canResize) Row {
            TextButton(enabled = table.canAddRow, onClick = { onResize(true) }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.add_table_row)) }
            TextButton(enabled = table.canAddColumn, onClick = { onResize(false) }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.add_table_column)) }
        }
    }
}

@Composable private fun TableCellMenu(table: TableEditing.Table, row: Int, column: Int, revision: Long,
    onAction: (Long, String, Int, Int) -> Unit, onEdit: (() -> Unit)?, onDelete: (PendingTableDelete) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val description = stringResource(R.string.table_cell_actions, row + 1, column + 1)
    Box {
        TextButton(onClick = { menu = true }, modifier = Modifier.size(48.dp).semantics { contentDescription = description }, contentPadding = PaddingValues(0.dp)) { WorldsGlyph(R.drawable.ic_ellipsis_vertical) }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            if (onEdit != null) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_pen_line) }, text = { Text(stringResource(R.string.edit_text)) }, onClick = { menu = false; onEdit() })
            DropdownMenuItem(enabled = table.canAddRow, leadingIcon = { WorldsGlyph(R.drawable.ic_rows_3) }, text = { Text(stringResource(R.string.insert_table_row_after)) }, onClick = { menu = false; onAction(revision, "insert_row", row, column) })
            DropdownMenuItem(enabled = table.canAddColumn, leadingIcon = { WorldsGlyph(R.drawable.ic_columns_3) }, text = { Text(stringResource(R.string.insert_table_column_after)) }, onClick = { menu = false; onAction(revision, "insert_column", row, column) })
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_rows_3) }, text = { Text(stringResource(R.string.delete_table_row)) }, onClick = { menu = false; onDelete(PendingTableDelete(revision, "remove_row", row, column)) })
            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_columns_3) }, text = { Text(stringResource(R.string.delete_table_column)) }, onClick = { menu = false; onDelete(PendingTableDelete(revision, "remove_column", row, column)) })
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun PageDetail(document: ResourceDocument, children: List<Resource>, onBack: () -> Unit, busy: Boolean, actionError: Boolean, canMovePage: Boolean, databaseName: String, imageStatus: Int?, allowKeyboardShortcuts: Boolean,
    onAddImage: (String?) -> Unit,
    onExportImage: (String) -> Unit,
    onImageSettings: (ImageSettingsTarget, String, Int, String) -> Unit,
    onDocumentRunningText: (String, Long, String, String, (Boolean) -> Unit) -> Unit,
    onDocumentTypography: (String, Long, Double, Double, (Boolean) -> Unit) -> Unit,
    onFindReplace: (ResourceDocument, String, String, Boolean, Int?, (ResourceDocument?) -> Unit) -> Unit,
    onMovePage: () -> Unit,
    onNewSubpage: () -> Unit, onOpenSubpage: (String) -> Unit,
    onRename: () -> Unit, onTrash: () -> Unit, onRestore: () -> Unit, onVersions: () -> Unit, onAdd: (Boolean, String?) -> Unit, onAddCode: (String?) -> Unit, onAddMath: (String?) -> Unit = {}, onAddMermaid: (String?) -> Unit = {}, onEdit: (String) -> Unit, onMove: (String, Int) -> Unit, onRemove: (String, String, Long) -> Unit, onDuplicate: (String, String, Long) -> Unit,
    onAddTable: () -> Unit, onEditTable: (String, Int, Int, Int) -> Unit, onResizeTable: (String, Boolean) -> Unit, onTableAction: (String, Long, String, Int, Int) -> Unit, onAddContainer: (String, String?) -> Unit, onEditContainer: (String, Int) -> Unit, onAppendContainer: (String) -> Unit, onAddList: (String, String?) -> Unit, onEditItem: (String, List<Int>) -> Unit, onToggleItem: (String, List<Int>, Boolean) -> Unit, onAppendItem: (String) -> Unit,
    onItemAction: (String, List<Int>, String) -> Unit, markdownStatus: Int?, onMarkdown: () -> Unit, onSaveTemplate: () -> Unit, onDiscord: () -> Unit = {}, modifier: Modifier = Modifier) {
    val editable = document.resource.deletedAt == null && document.resource.kind in setOf("page", "document", "template")
    var paginatedMode by rememberSaveable(document.resource.id) { mutableStateOf(false) }
    val pageFocus = remember(document.resource.id) { FocusRequester() }
    var pageHasFocus by remember(document.resource.id) { mutableStateOf(false) }
    val blockListState = remember(document.resource.id) { LazyListState() }
    val blockScope = rememberCoroutineScope()
    var revealedMatch by remember(document.resource.id) { mutableStateOf<PageMatch?>(null) }
    val latestDocument by rememberUpdatedState(document)
    LaunchedEffect(document.resource.revision) { revealedMatch = null }
    LaunchedEffect(revealedMatch) { if (revealedMatch != null) { delay(5000); revealedMatch = null } }
    var imageSettings by remember(document.resource.id) { mutableStateOf<ImageSettingsTarget?>(null) }
    var runningTextTarget by remember(document.resource.id) { mutableStateOf<Resource?>(null) }
    runningTextTarget?.let { target -> DocumentRunningTextDialog(target, busy, { runningTextTarget = null }) { header, footer, done ->
        onDocumentRunningText(target.id, target.revision, header, footer, done)
    } }
    var typographyTarget by remember(document.resource.id) { mutableStateOf<Resource?>(null) }
    typographyTarget?.let { target -> DocumentTypographyDialog(target, busy, { typographyTarget = null }) { size, spacing, done ->
        onDocumentTypography(target.id, target.revision, size, spacing, done)
    } }
    var findTarget by remember(document.resource.id) { mutableStateOf<ResourceDocument?>(null) }
    var findWasOpen by remember(document.resource.id) { mutableStateOf(false) }
    LaunchedEffect(findTarget) {
        if (findTarget != null) findWasOpen = true
        else if (findWasOpen) { withFrameNanos { }; pageFocus.requestFocus(); findWasOpen = false }
    }
    val findSession = rememberSaveable(document.resource.id, saver = PageFindSessionSaver) { PageFindSession() }
    findTarget?.let { target -> PageFindDialog(target, findSession, busy, { findTarget = null }, onFindReplace) { snapshot, match ->
        val blockIndex = document.blocks.indexOfFirst { it.id == match.blockId }
        if (snapshot.resource.id != document.resource.id || snapshot.resource.revision != document.resource.revision || blockIndex < 0) false
        else {
            val header = runCatching { JSONObject(document.resource.metadata).optJSONObject("doc")?.optString("header").orEmpty() }.getOrDefault("")
            val extra = if (document.resource.kind == "document" && header.isNotBlank()) 1 else 0
            findTarget = null; revealedMatch = null
            blockScope.launch {
                blockListState.scrollToItem(blockIndex + extra)
                if (latestDocument.resource.id == snapshot.resource.id && latestDocument.resource.revision == snapshot.resource.revision) revealedMatch = match
            }
            true
        }
    } }
    imageSettings?.let { target -> ImageSettingsDialog(target, busy, { imageSettings = null }) { caption, display, align -> imageSettings = null; onImageSettings(target, caption, display, align) } }
    var pendingRemoval by remember(document.resource.id) { mutableStateOf<Pair<String, Long>?>(null) }
    val pageActivity = androidx.activity.compose.LocalActivity.current as? MainActivity
    val pageShortcutsActive = allowKeyboardShortcuts && editable && pageHasFocus && !busy && findTarget == null && imageSettings == null && runningTextTarget == null && typographyTarget == null && pendingRemoval == null
    DisposableEffect(pageActivity, pageShortcutsActive) {
        val owner = Any()
        if (pageShortcutsActive) pageActivity?.pageShortcutOwner = owner
        onDispose { if (pageActivity?.pageShortcutOwner === owner) pageActivity.pageShortcutOwner = null }
    }
    LaunchedEffect(document.resource.id) { pageFocus.requestFocus() }
    pendingRemoval?.let { (blockId, revision) ->
        AlertDialog(onDismissRequest = { pendingRemoval = null }, title = { Text(stringResource(R.string.remove_block_title)) },
            text = { Text(stringResource(R.string.remove_block_body)) },
            confirmButton = { TextButton(enabled = !busy, onClick = { pendingRemoval = null; onRemove(document.resource.id, blockId, revision) }) { Text(stringResource(R.string.remove)) } },
            dismissButton = { TextButton(onClick = { pendingRemoval = null }) { Text(stringResource(R.string.cancel)) } })
    }
    Box(modifier.fillMaxHeight().onPreviewKeyEvent { event ->
        if (pageShortcutsActive && event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0 && event.isCtrlPressed && !event.isShiftPressed && !event.isAltPressed && !event.isMetaPressed && event.key in setOf(Key.F, Key.H)) {
            findTarget = document; true
        } else false
    }.focusRequester(pageFocus).onFocusChanged { pageHasFocus = it.hasFocus }.focusable().testTag("page-keyboard-surface"), contentAlignment = Alignment.TopCenter) {
    Column(Modifier.widthIn(max = 900.dp).fillMaxSize().padding(horizontal = 28.dp, vertical = 24.dp)) {
        WorldsBackButton(onBack)
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            WorldsTile(worldsTile(document.resource.kind), 48.dp)
            Text(document.resource.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.onBackground)
        }
        FlowRow(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (document.resource.deletedAt == null) {
                if (editable) {
                    var insertMenu by remember { mutableStateOf(false) }
                    Box {
                        FilledTonalButton(enabled = !busy, colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface), onClick = { insertMenu = true }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.insert_block)) }
                        DropdownMenu(expanded = insertMenu, onDismissRequest = { insertMenu = false }) {
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_type) }, text = { Text(stringResource(R.string.add_paragraph)) }, onClick = { insertMenu = false; onAdd(false, null) })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_heading_1) }, text = { Text(stringResource(R.string.add_heading)) }, onClick = { insertMenu = false; onAdd(true, null) })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_square_code) }, text = { Text(stringResource(R.string.add_code)) }, onClick = { insertMenu = false; onAddCode(null) })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_image) }, text = { Text(stringResource(R.string.image_insert)) }, onClick = { insertMenu = false; onAddImage(null) })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_table_2) }, text = { Text(stringResource(R.string.add_table)) }, onClick = { insertMenu = false; onAddTable() })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_code_2) }, text = { Text(stringResource(R.string.insert_math)) }, onClick = { insertMenu = false; onAddMath(null) })
                            DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(R.string.insert_mermaid)) }, onClick = { insertMenu = false; onAddMermaid(null) })
                            listOf(Triple("blockquote", R.string.quote, R.drawable.ic_text_quote), Triple("callout", R.string.callout, R.drawable.ic_lightbulb), Triple("prompt", R.string.prompt, R.drawable.ic_square_terminal)).forEach { (type, label, icon) ->
                                DropdownMenuItem(leadingIcon = { WorldsGlyph(icon) }, text = { Text(stringResource(label)) }, onClick = { insertMenu = false; onAddContainer(type, null) })
                            }
                            listOf(Triple("bulletList", R.string.bullet_list, R.drawable.ic_list), Triple("orderedList", R.string.numbered_list, R.drawable.ic_list_ordered), Triple("taskList", R.string.task_list, R.drawable.ic_list_todo)).forEach { (type, label, icon) ->
                                DropdownMenuItem(leadingIcon = { WorldsGlyph(icon) }, text = { Text(stringResource(label)) }, onClick = { insertMenu = false; onAddList(type, null) })
                            }
                        }
                    }
                }
                var pageMenu by remember { mutableStateOf(false) }
                Box {
                    FilledTonalButton(enabled = !busy, colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface), onClick = { pageMenu = true }) { WorldsActionLabel(R.drawable.ic_ellipsis_vertical, stringResource(R.string.page_actions)) }
                    DropdownMenu(expanded = pageMenu, onDismissRequest = { pageMenu = false }) {
                        if (editable) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_search) }, text = { Text(stringResource(R.string.find_replace)) }, onClick = { pageMenu = false; findTarget = document })
                        if (document.resource.kind == "document") DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(if (paginatedMode) R.string.document_continuous_mode else R.string.document_paginated_mode)) }, onClick = { pageMenu = false; paginatedMode = !paginatedMode })
                        if (document.resource.kind == "document") DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_download) }, text = { Text(stringResource(R.string.document_print)) }, onClick = { pageMenu = false; pageActivity?.let { printWorldsDocument(it, document.resource.title, document.blocks) } })
                        if (document.resource.kind == "document") DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_settings_2) }, text = { Text(stringResource(R.string.document_running_text)) }, onClick = { pageMenu = false; runningTextTarget = document.resource })
                        if (document.resource.kind == "document") DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_type) }, text = { Text(stringResource(R.string.document_typography)) }, onClick = { pageMenu = false; typographyTarget = document.resource })
                        DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_share_2) }, text = { Text(stringResource(R.string.discord)) }, onClick = { pageMenu = false; onDiscord() })
                        DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_pen_line) }, text = { Text(stringResource(R.string.rename)) }, onClick = { pageMenu = false; onRename() })
                        DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_history) }, text = { Text(stringResource(R.string.versions)) }, onClick = { pageMenu = false; onVersions() })
                        if (canMovePage && document.resource.kind in setOf("page", "document")) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_folder) }, text = { Text(stringResource(R.string.move_page)) }, onClick = { pageMenu = false; onMovePage() })
                        if (document.resource.kind in setOf("page", "document")) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_download) }, text = { Text(stringResource(R.string.markdown_export)) }, onClick = { pageMenu = false; onMarkdown() })
                        if (document.resource.kind in setOf("page", "document")) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(R.string.template_save)) }, onClick = { pageMenu = false; onSaveTemplate() })
                        DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, text = { Text(stringResource(R.string.move_to_trash)) }, onClick = { pageMenu = false; onTrash() })
                    }
                }
            } else TextButton(enabled = !busy, onClick = onRestore) { Text(stringResource(R.string.restore)) }
        }
        if (actionError) Text(stringResource(R.string.action_error), color = MaterialTheme.colorScheme.error, lineHeight = 24.sp)
        imageStatus?.let { Text(stringResource(it), color = if (it == R.string.image_export_success) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error, lineHeight = 24.sp) }
        markdownStatus?.let { Text(stringResource(it), color = if (it in setOf(R.string.markdown_export_error, R.string.markdown_copy_error, R.string.markdown_export_interrupted, R.string.markdown_share_error, R.string.markdown_share_limit, R.string.template_save_error)) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 24.sp) }
        Spacer(Modifier.height(20.dp))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Spacer(Modifier.height(20.dp))
        val runningText = remember(document.resource.metadata) { runCatching { JSONObject(document.resource.metadata).optJSONObject("doc") }.getOrNull() }
        val header = runningText?.optString("header").orEmpty()
        val footer = runningText?.optString("footer").orEmpty()
        val typography = remember(document.resource.metadata) { documentTypography(document.resource.metadata) }
        if (paginatedMode && document.resource.kind == "document") {
            val pagesOfBlocks = remember(document.blocks) { if (document.blocks.isEmpty()) listOf(emptyList()) else document.blocks.chunked(6) }
            val totalPages = pagesOfBlocks.size
            LazyColumn(Modifier.weight(1f).testTag("page-blocks"), state = blockListState, horizontalAlignment = Alignment.CenterHorizontally) {
                items(pagesOfBlocks.size, key = { "page-card-$it" }) { pageIndex ->
                    val blocksOnPage = pagesOfBlocks[pageIndex]
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surface,
                        shadowElevation = 3.dp,
                        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)),
                        modifier = Modifier.widthIn(max = 680.dp).fillMaxWidth().padding(vertical = 12.dp)
                    ) {
                        Column(Modifier.padding(horizontal = 32.dp, vertical = 28.dp)) {
                            // Repeated running header on each page
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Text(header.ifBlank { document.resource.title.ifBlank { stringResource(R.string.untitled) } }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(DateFormat.getDateInstance(DateFormat.SHORT).format(Date(document.resource.updatedAt)), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            HorizontalDivider(Modifier.padding(vertical = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
                            if (pageIndex == 0) {
                                Text(document.resource.title.ifBlank { stringResource(R.string.untitled) }, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(bottom = 12.dp))
                            }
                            if (blocksOnPage.isEmpty()) {
                                Text(stringResource(R.string.page_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 16.dp))
                            }
                            blocksOnPage.forEach { block ->
                                RenderSingleBlock(block, document, editable, busy, databaseName, typography, revealedMatch, onEdit, onEditTable, onResizeTable, onTableAction, onEditContainer, onAppendContainer, onEditItem, onToggleItem, onAppendItem, onItemAction, onAdd, onAddCode, onAddMath, onAddMermaid, onAddImage, onMove, onDuplicate, { pendingRemoval = it }, { imageSettings = it }, onExportImage)
                                Spacer(Modifier.height(8.dp))
                            }
                            Spacer(Modifier.height(20.dp))
                            HorizontalDivider(Modifier.padding(bottom = 10.dp), color = MaterialTheme.colorScheme.outlineVariant)
                            // Repeated running footer on each page
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                Text(footer.ifBlank { "Worlds" }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(stringResource(R.string.document_page_of, pageIndex + 1, totalPages), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                if (editable) {
                    item(key = "subpages-heading") {
                        Spacer(Modifier.height(24.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(stringResource(R.string.subpages_title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(enabled = !busy, onClick = onNewSubpage) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.new_subpage)) }
                        }
                        if (children.isEmpty()) Text(stringResource(R.string.subpages_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    items(children, key = { "subpage-${it.id}" }) { child ->
                        PageRow(child, false) { if (!busy) onOpenSubpage(child.id) }
                    }
                }
            }
        } else {
            LazyColumn(Modifier.weight(1f).testTag("page-blocks"), state = blockListState) {
                if (document.resource.kind == "document" && header.isNotBlank()) item(key = "document-header") {
                    Text(header, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth().padding(bottom = 16.dp))
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Spacer(Modifier.height(16.dp))
                }
                if (document.blocks.isEmpty()) item { Text(stringResource(R.string.page_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, lineHeight = 26.sp) }
                items(document.blocks, key = { "block-${it.id}" }) { block ->
                    RenderSingleBlock(block, document, editable, busy, databaseName, typography, revealedMatch, onEdit, onEditTable, onResizeTable, onTableAction, onEditContainer, onAppendContainer, onEditItem, onToggleItem, onAppendItem, onItemAction, onAdd, onAddCode, onAddMath, onAddMermaid, onAddImage, onMove, onDuplicate, { pendingRemoval = it }, { imageSettings = it }, onExportImage)
                }
                if (document.resource.kind == "document" && footer.isNotBlank()) item(key = "document-footer") {
                    Spacer(Modifier.height(16.dp)); HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    Text(footer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth().padding(top = 16.dp))
                }
                if (editable) {
                    item(key = "subpages-heading") {
                        Spacer(Modifier.height(24.dp))
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(stringResource(R.string.subpages_title), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            TextButton(enabled = !busy, onClick = onNewSubpage) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.new_subpage)) }
                        }
                        if (children.isEmpty()) Text(stringResource(R.string.subpages_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    }
                    items(children, key = { "subpage-${it.id}" }) { child ->
                        PageRow(child, false) { if (!busy) onOpenSubpage(child.id) }
                    }
                }
            }
        }
        if (!editable) Text(stringResource(R.string.read_only), color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, lineHeight = 23.sp)
    }
    }
}

@Composable
private fun RenderSingleBlock(
    block: worlds.content.ContentBlock,
    document: ResourceDocument,
    editable: Boolean,
    busy: Boolean,
    databaseName: String,
    typography: DocumentTypography,
    revealedMatch: PageMatch?,
    onEdit: (String) -> Unit,
    onEditTable: (String, Int, Int, Int) -> Unit,
    onResizeTable: (String, Boolean) -> Unit,
    onTableAction: (String, Long, String, Int, Int) -> Unit,
    onEditContainer: (String, Int) -> Unit,
    onAppendContainer: (String) -> Unit,
    onEditItem: (String, List<Int>) -> Unit,
    onToggleItem: (String, List<Int>, Boolean) -> Unit,
    onAppendItem: (String) -> Unit,
    onItemAction: (String, List<Int>, String) -> Unit,
    onAdd: (Boolean, String?) -> Unit,
    onAddCode: (String?) -> Unit,
    onAddMath: (String?) -> Unit,
    onAddMermaid: (String?) -> Unit,
    onAddImage: (String?) -> Unit,
    onMove: (String, Int) -> Unit,
    onDuplicate: (String, String, Long) -> Unit,
    onPendingRemoval: (Pair<String, Long>) -> Unit,
    onImageSettings: (ImageSettingsTarget) -> Unit,
    onExportImage: (String) -> Unit
) {
    val blockMatch = revealedMatch?.takeIf { it.blockId == block.id }
    val isRevealed = blockMatch != null
    Column(Modifier.fillMaxWidth().then(if (isRevealed) Modifier.background(MaterialTheme.colorScheme.primary.copy(alpha = 0.12f), RoundedCornerShape(8.dp)).testTag("find-revealed-block") else Modifier)) {
        val list = remember(block.content) { runCatching { ListEditing.read(block.content) }.getOrNull() }
        val container = remember(block.content) { runCatching { ContainerEditing.read(block.content) }.getOrNull() }
        val table = remember(block.content) { runCatching { TableEditing.read(block.content) }.getOrNull() }
        val image = remember(block.content) { runCatching { JSONObject(block.content).optString("type") == "image" }.getOrDefault(false) }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Column(Modifier.weight(1f)) {
        if (image) {
            ImageBlock(block.content, databaseName)
        } else if (isMathBlock(block.content)) {
            MathBlock(latex = mathLatex(block.content))
        } else if (isMermaidBlock(block.content)) {
            MermaidBlock(code = mermaidCode(block.content))
        } else if (table != null) {
            TableBlockView(table, document.resource.revision, editable && !busy, blockMatch, onEdit = { row, col, index -> onEditTable(block.id, row, col, index) }, onResize = { onResizeTable(block.id, it) }, onAction = { revision, action, row, col -> onTableAction(block.id, revision, action, row, col) })
        } else if (container != null) {
            ContainerBlockView(container, editable && !busy, blockMatch, onEdit = { onEditContainer(block.id, it) }, onAppend = { onAppendContainer(block.id) })
        } else if (list != null) {
            ListBlockView(list, editable && !busy, blockMatch,
                onEdit = { index -> onEditItem(block.id, index) },
                onToggle = { index, value -> onToggleItem(block.id, index, value) },
                onAppend = { onAppendItem(block.id) },
                onAction = { path, action -> onItemAction(block.id, path, action) })
        } else {
            val preview = remember(block.content) { previewBlock(block.content) }
            val match = blockMatch?.takeIf { it.path.isEmpty() }
            val baseSize = if (document.resource.kind == "document") typography.size * 4f / 3f else 16f
            val factor = when { preview.headingLevel == 1 -> 1.625f; preview.headingLevel == 2 -> 1.375f; preview.headingLevel == 3 -> 1.1875f; preview.paragraphStyle == "title" -> 2.4f; preview.paragraphStyle == "subtitle" -> 1.35f; preview.paragraphStyle == "caption" -> .82f; else -> 1f }
            val textSize = baseSize * factor
            val canEdit = editable && !busy && remember(block.content) { runCatching { InlineEditing.text(block.content) }.isSuccess || runCatching { CodeEditing.read(block.content) }.isSuccess }
            Column(Modifier.fillMaxWidth().heightIn(min = 30.dp).tapToEdit(canEdit) { onEdit(block.id) }) {
            if (preview.text.isNotEmpty()) Text(highlightedFindText(preview, block.content, match, MaterialTheme.colorScheme.primary.copy(alpha = 0.30f)), color = if (preview.paragraphStyle in setOf("subtitle", "caption")) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onBackground,
                fontSize = textSize.sp,
                fontWeight = if (preview.headingLevel != null || preview.paragraphStyle == "title") FontWeight.SemiBold else FontWeight.Normal,
                lineHeight = if (preview.hasCustomFontSize) androidx.compose.ui.unit.TextUnit.Unspecified else if (document.resource.kind == "document") (textSize * typography.leading).sp else 30.sp, textAlign = preview.alignment, modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp).then(findRevealModifier(match)))
            if (preview.incomplete) Text(stringResource(R.string.preview_incomplete), color = MaterialTheme.colorScheme.onSurfaceVariant,
                fontSize = 13.sp, lineHeight = 23.sp, modifier = Modifier.padding(bottom = 12.dp))
            if (preview.text.isEmpty() && !preview.incomplete) Spacer(Modifier.height(16.dp))
            }
        }
        }
        if (editable) {
            var menu by remember { mutableStateOf(false) }
            val blockActionsLabel = stringResource(R.string.block_actions)
            Box {
                IconButton(enabled = !busy, onClick = { menu = true }, modifier = Modifier.size(34.dp).semantics { contentDescription = blockActionsLabel }) { Icon(painterResource(R.drawable.ic_ellipsis_vertical), contentDescription = null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (image)
                        DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_sliders_horizontal) }, text = { Text(stringResource(R.string.image_settings)) }, onClick = { menu = false; onImageSettings(ImageSettingsTarget(document.resource.id, block.id, document.resource.revision, block.content)) })
                    if (image) DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_download) }, text = { Text(stringResource(R.string.image_export)) }, onClick = { menu = false; onExportImage(block.id) })
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_type) }, text = { Text(stringResource(R.string.insert_paragraph_after)) }, onClick = { menu = false; onAdd(false, block.id) })
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_heading_1) }, text = { Text(stringResource(R.string.insert_heading_after)) }, onClick = { menu = false; onAdd(true, block.id) })
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_square_code) }, text = { Text(stringResource(R.string.insert_code_after)) }, onClick = { menu = false; onAddCode(block.id) })
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_code_2) }, text = { Text(stringResource(R.string.insert_math_after)) }, onClick = { menu = false; onAddMath(block.id) })
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(R.string.insert_diagram_after)) }, onClick = { menu = false; onAddMermaid(block.id) })
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_image) }, text = { Text(stringResource(R.string.image_insert_after)) }, onClick = { menu = false; onAddImage(block.id) })
                    val index = document.blocks.indexOfFirst { it.id == block.id }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    DropdownMenuItem(enabled = index > 0, leadingIcon = { WorldsGlyph(R.drawable.ic_arrow_up) }, text = { Text(stringResource(R.string.move_block_up)) }, onClick = { menu = false; onMove(block.id, -1) })
                    DropdownMenuItem(enabled = index < document.blocks.lastIndex, leadingIcon = { WorldsGlyph(R.drawable.ic_arrow_down) }, text = { Text(stringResource(R.string.move_block_down)) }, onClick = { menu = false; onMove(block.id, 1) })
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_files) }, text = { Text(stringResource(R.string.duplicate_block)) }, onClick = { menu = false; onDuplicate(document.resource.id, block.id, document.resource.revision) })
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    DropdownMenuItem(leadingIcon = { WorldsGlyph(R.drawable.ic_trash_2) }, text = { Text(stringResource(R.string.remove_block)) }, onClick = { menu = false; onPendingRemoval(block.id to document.resource.revision) })
                }
            }
        }
        }
    }
}
