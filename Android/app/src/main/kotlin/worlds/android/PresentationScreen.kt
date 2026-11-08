package worlds.android

import androidx.compose.foundation.background
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import worlds.content.ContentBlock
import worlds.content.Resource
import worlds.content.ResourceDocument

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun PresentationScreen(document: ResourceDocument, busy: Boolean, onBack: () -> Unit,
    action: (Resource, String, String, Map<String, String>, String, (Boolean) -> Unit) -> Unit,
    databaseName: String, imageStatus: Int?, onAddImage: (String) -> Unit, onBackgroundImage: (String) -> Unit, onAddVideo: (String) -> Unit,
    onElement: (Resource, String, String, List<Int>?, Boolean, (Boolean) -> Unit) -> Unit,
    onRename: () -> Unit, onTrash: () -> Unit, modifier: Modifier = Modifier) {
    val deck = document.resource
    val slides = remember(document.blocks) { document.blocks.filter { runCatching { JSONObject(it.content).optString("type") == "slide" }.getOrDefault(false) } }
    var selectedId by rememberSaveable(deck.id) { mutableStateOf<String?>(null) }
    val index = slides.indexOfFirst { it.id == selectedId }.let { if (it < 0) 0 else it }
    val slide = slides.getOrNull(index)
    var editing by remember(deck.id) { mutableStateOf<ContentBlock?>(null) }
    var presenting by rememberSaveable(deck.id) { mutableStateOf(false) }
    var confirmRemove by remember(deck.id) { mutableStateOf(false) }
    var confirmTrash by remember(deck.id) { mutableStateOf(false) }
    var failed by remember(deck.id) { mutableStateOf(false) }
    var managing by remember(deck.id) { mutableStateOf(false) }
    var elementTarget by remember(deck.id) { mutableStateOf<Pair<ContentBlock, JSONObject>?>(null) }
    var styleTarget by remember(deck.id) { mutableStateOf<Pair<ContentBlock, JSONObject>?>(null) }
    var showBackground by remember(deck.id) { mutableStateOf(false) }
    var moveMode by remember(deck.id) { mutableStateOf(false) }
    fun run(which: String) { action(deck, slide?.id.orEmpty(), which, emptyMap(), "") { failed = !it } }
    editing?.let { target -> SlideEditDialog(target, busy, { editing = null }) { texts, notes ->
        action(deck, target.id, "edit", texts, notes) { success -> if (success) editing = null; failed = !success }
    } }
    elementTarget?.let { (target, element) ->
        SlideElementDialog(element, busy, { elementTarget = null }, { styleTarget = target to element; elementTarget = null }) { bounds, remove ->
            onElement(deck, target.id, element.optString("id"), bounds, remove) { success -> if (success) { elementTarget = null; managing = false }; failed = !success }
        }
    }
    styleTarget?.let { (target, element) ->
        SlideTextStyleDialog(element, busy, { styleTarget = null }) { changes ->
            action(deck, target.id, "style", changes, element.optString("id")) { success ->
                if (success) { styleTarget = null; managing = false }; failed = !success
            }
        }
    }
    if (showBackground && slide != null) {
        val background = remember(slide.content) { runCatching { JSONObject(slide.content).getJSONObject("attrs").getJSONObject("background") }.getOrNull() }
        val current = background?.optString("color").orEmpty()
        val hasImage = background?.optString("attachmentId").orEmpty().isNotBlank()
        SlideBackgroundDialog(current, hasImage, busy, { showBackground = false },
            pick = { showBackground = false; onBackgroundImage(slide.id) },
            remove = { action(deck, slide.id, "remove-background-image", emptyMap(), "") { success -> if (success) showBackground = false; failed = !success } }) { color ->
            action(deck, slide.id, "background", emptyMap(), color) { success -> if (success) showBackground = false; failed = !success }
        }
    }
    if (managing && slide != null && elementTarget == null && styleTarget == null) {
        val elements = runCatching { JSONObject(slide.content).getJSONObject("attrs").getJSONArray("elements") }.getOrNull()
        AlertDialog(onDismissRequest = { managing = false }, title = { Text(stringResource(R.string.slide_elements)) }, text = {
            Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                (0 until (elements?.length() ?: 0)).forEach { i ->
                    val el = elements?.optJSONObject(i); val type = el?.optString("type")
                    if (el != null && type in setOf("text", "shape", "image", "video") && el.optString("id").isNotBlank()) {
                        val label = when (type) { "text" -> R.string.slide_add_text; "image" -> R.string.slide_add_image; "video" -> R.string.slide_add_video; else -> when (el.optString("shape")) { "ellipse" -> R.string.slide_add_ellipse; "line" -> R.string.slide_add_line; else -> R.string.slide_add_rect } }
                        TextButton(onClick = { elementTarget = slide to el }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.slide_element_number, i + 1, stringResource(label))) }
                    }
                }
            }
        }, confirmButton = { TextButton(onClick = { managing = false }) { Text(stringResource(R.string.close)) } })
    }
    if (confirmRemove && slide != null) AlertDialog(onDismissRequest = { confirmRemove = false }, title = { Text(stringResource(R.string.slide_remove)) }, text = { Text(stringResource(R.string.slide_remove_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { confirmRemove = false; run("remove") }) { Text(stringResource(R.string.slide_remove)) } }, dismissButton = { TextButton(onClick = { confirmRemove = false }) { Text(stringResource(R.string.cancel)) } })
    if (confirmTrash) AlertDialog(onDismissRequest = { confirmTrash = false }, title = { Text(stringResource(R.string.move_to_trash)) }, text = { Text(stringResource(R.string.presentation_trash_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { confirmTrash = false; onTrash() }) { Text(stringResource(R.string.move_to_trash)) } }, dismissButton = { TextButton(onClick = { confirmTrash = false }) { Text(stringResource(R.string.cancel)) } })
    if (presenting && slide != null) FullscreenPresentation(slide, databaseName, index, slides.size,
        onPrevious = { if (index > 0) selectedId = slides[index - 1].id },
        onNext = { if (index < slides.lastIndex) selectedId = slides[index + 1].id },
        onFirst = { selectedId = slides.first().id }, onLast = { selectedId = slides.last().id },
        onExit = { presenting = false })
    if (!presenting || slide == null) CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurface) {
        Box(modifier.fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            Column(Modifier.widthIn(max = 1000.dp).fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                run {
                    TextButton(onClick = onBack) { WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.back)) }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        WorldsGlyph(R.drawable.ic_maximize, tint = MaterialTheme.colorScheme.primary)
                        Text(deck.title.ifBlank { stringResource(R.string.untitled) }, style = MaterialTheme.typography.headlineMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        FilledTonalButton(enabled = !busy, onClick = { run("add") }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.slide_add)) }
                        TextButton(enabled = !busy && slide != null, onClick = { editing = slide }) { WorldsActionLabel(R.drawable.ic_pen_line, stringResource(R.string.slide_edit)) }
                        TextButton(enabled = !busy && slide != null, onClick = { moveMode = !moveMode }) { WorldsActionLabel(R.drawable.ic_maximize, stringResource(if (moveMode) R.string.slide_move_done else R.string.slide_move_mode)) }
                        TextButton(enabled = !busy && slide != null, onClick = { showBackground = true }) { WorldsActionLabel(R.drawable.ic_image, stringResource(R.string.slide_background)) }
                        var layoutMenu by remember { mutableStateOf(false) }
                        Box {
                            TextButton(enabled = !busy && slide != null, onClick = { layoutMenu = true }) { WorldsActionLabel(R.drawable.ic_sliders_horizontal, stringResource(R.string.slide_layout)) }
                            DropdownMenu(expanded = layoutMenu, onDismissRequest = { layoutMenu = false }) {
                                listOf("title" to R.string.slide_layout_title, "title-body" to R.string.slide_layout_title_body,
                                    "section" to R.string.slide_layout_section, "two-columns" to R.string.slide_layout_columns,
                                    "image" to R.string.slide_layout_image, "blank" to R.string.slide_layout_blank).forEach { (layout, label) ->
                                    DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = {
                                        layoutMenu = false
                                        action(deck, slide!!.id, "layout", emptyMap(), layout) { failed = !it }
                                    })
                                }
                            }
                        }
                        TextButton(enabled = slide != null, onClick = { presenting = true }) { WorldsActionLabel(R.drawable.ic_maximize, stringResource(R.string.slide_present)) }
                        var menu by remember { mutableStateOf(false) }
                        Box { TextButton(enabled = !busy, onClick = { menu = true }) { WorldsActionLabel(R.drawable.ic_ellipsis_vertical, stringResource(R.string.page_actions)) }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.rename)) }, onClick = { menu = false; onRename() })
                                DropdownMenuItem(text = { Text(stringResource(R.string.move_to_trash)) }, onClick = { menu = false; confirmTrash = true })
                            }
                        }
                    }
                    if (failed) Text(stringResource(R.string.presentation_error), color = MaterialTheme.colorScheme.error)
                    imageStatus?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                if (slide == null) Text(stringResource(R.string.presentation_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else {
                    val attrs = runCatching { JSONObject(slide.content).getJSONObject("attrs") }.getOrNull()
                    val elements = attrs?.optJSONArray("elements")
                    val unsupported = attrs == null || elements == null || (0 until (elements?.length() ?: 0)).any { i ->
                        val el = elements?.optJSONObject(i); val type = el?.optString("type")
                        type !in setOf("text", "shape", "image", "video") || (type == "shape" && el?.optString("shape") !in setOf("rect", "ellipse", "line"))
                    }
                    SlidePreview(slide, databaseName, moveMode && !busy, onMove = { elementId, x, y ->
                        action(deck, slide.id, "move-element", mapOf("x" to x.toString(), "y" to y.toString()), elementId) { failed = !it }
                    }, onResize = { elementId, bounds ->
                        onElement(deck, slide.id, elementId, bounds, false) { failed = !it }
                    })
                    if (moveMode) Text(stringResource(R.string.slide_move_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    if (unsupported) Text(stringResource(R.string.slide_unsupported), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        TextButton(enabled = index > 0, onClick = { selectedId = slides[index - 1].id }) { Text(stringResource(R.string.slide_previous)) }
                        Text(stringResource(R.string.slide_count, index + 1, slides.size), style = MaterialTheme.typography.labelLarge)
                        TextButton(enabled = index < slides.lastIndex, onClick = { selectedId = slides[index + 1].id }) { Text(stringResource(R.string.slide_next)) }
                    }
                    run {
                        var addMenu by remember { mutableStateOf(false) }
                        Box {
                            TextButton(enabled = !busy, onClick = { addMenu = true }) { WorldsActionLabel(R.drawable.ic_plus, stringResource(R.string.slide_add_element)) }
                            DropdownMenu(expanded = addMenu, onDismissRequest = { addMenu = false }) {
                                listOf("text" to R.string.slide_add_text, "rect" to R.string.slide_add_rect, "ellipse" to R.string.slide_add_ellipse, "line" to R.string.slide_add_line).forEach { (kind, label) ->
                                    DropdownMenuItem(text = { Text(stringResource(label)) }, onClick = { addMenu = false; run("add-$kind") })
                                }
                                DropdownMenuItem(text = { Text(stringResource(R.string.slide_add_image)) }, leadingIcon = { WorldsGlyph(R.drawable.ic_image) }, onClick = { addMenu = false; onAddImage(slide.id) })
                                DropdownMenuItem(text = { Text(stringResource(R.string.slide_add_video)) }, leadingIcon = { WorldsGlyph(android.R.drawable.ic_media_play) }, onClick = { addMenu = false; onAddVideo(slide.id) })
                            }
                        }
                        TextButton(enabled = !busy, onClick = { managing = true }) { WorldsActionLabel(R.drawable.ic_sliders_horizontal, stringResource(R.string.slide_elements)) }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(enabled = !busy && index > 0, onClick = { run("up") }) { WorldsActionLabel(R.drawable.ic_arrow_up, stringResource(R.string.slide_up)) }
                            TextButton(enabled = !busy && index < slides.lastIndex, onClick = { run("down") }) { WorldsActionLabel(R.drawable.ic_arrow_down, stringResource(R.string.slide_down)) }
                            TextButton(enabled = !busy, onClick = { run("duplicate") }) { WorldsActionLabel(R.drawable.ic_files, stringResource(R.string.slide_duplicate)) }
                            TextButton(enabled = !busy && slides.size > 1, onClick = { confirmRemove = true }) { WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.slide_remove)) }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun FullscreenPresentation(slide: ContentBlock, databaseName: String, index: Int, count: Int,
    onPrevious: () -> Unit, onNext: () -> Unit, onFirst: () -> Unit, onLast: () -> Unit, onExit: () -> Unit) {
    Dialog(onDismissRequest = onExit, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        val window = (view.parent as? DialogWindowProvider)?.window
        DisposableEffect(window) {
            if (window != null) {
                window.setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
                window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                val controller = androidx.core.view.WindowCompat.getInsetsController(window, view)
                controller.systemBarsBehavior = androidx.core.view.WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                controller.hide(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            }
            onDispose { window?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        }
        val focus = remember { FocusRequester() }
        LaunchedEffect(Unit) { focus.requestFocus() }
        BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black).focusRequester(focus).onPreviewKeyEvent { event ->
            if (event.type != KeyEventType.KeyDown) false else when (event.key) {
                Key.DirectionRight, Key.DirectionDown, Key.PageDown, Key.Spacebar -> { onNext(); true }
                Key.DirectionLeft, Key.DirectionUp, Key.PageUp -> { onPrevious(); true }
                Key.MoveHome -> { onFirst(); true }
                Key.MoveEnd -> { onLast(); true }
                Key.Escape -> { onExit(); true }
                else -> false
            }
        }.focusable(), contentAlignment = Alignment.Center) {
            Box(Modifier.widthIn(max = maxHeight * (16f / 9f)).fillMaxWidth()) { SlidePreview(slide, databaseName) }
            Surface(Modifier.align(Alignment.TopEnd).padding(12.dp), color = Color(0xcc171719), shape = RoundedCornerShape(12.dp)) {
                TextButton(onClick = onExit, colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) {
                    WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.slide_exit))
                }
            }
            Surface(Modifier.align(Alignment.BottomCenter).padding(12.dp), color = Color(0xcc171719), shape = RoundedCornerShape(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(enabled = index > 0, onClick = onPrevious, colors = ButtonDefaults.textButtonColors(contentColor = Color.White, disabledContentColor = Color.Gray)) {
                        WorldsActionLabel(R.drawable.ic_chevron_left, stringResource(R.string.slide_previous))
                    }
                    Text(stringResource(R.string.slide_count, index + 1, count), color = Color.White, style = MaterialTheme.typography.labelLarge)
                    TextButton(enabled = index < count - 1, onClick = onNext, colors = ButtonDefaults.textButtonColors(contentColor = Color.White, disabledContentColor = Color.Gray)) {
                        WorldsActionLabel(R.drawable.ic_chevron_right, stringResource(R.string.slide_next))
                    }
                }
            }
        }
    }
}

private val slideBackgroundColors = listOf("#16161a", "#0f172a", "#1b1f1d", "#2a1a1f", "#f7f5f0", "#ffffff", "#1d3557", "#3a2e5a", "#7c2d12", "#14532d")
private val slideTextColors = listOf("#f4f2ee", "#16161a", "#d2a46e", "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f", "#8b8d98")

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun SlideColorChoices(colors: List<String>, selected: String, enabled: Boolean, select: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        colors.forEach { color ->
            FilterChip(selected = color.equals(selected, true), enabled = enabled, onClick = { select(color) },
                leadingIcon = { Box(Modifier.size(18.dp).background(Color(android.graphics.Color.parseColor(color)), CircleShape)) },
                label = { Text(color, style = MaterialTheme.typography.labelMedium) })
        }
    }
}

@Composable private fun SlideBackgroundDialog(current: String, hasImage: Boolean, busy: Boolean, dismiss: () -> Unit, pick: () -> Unit, remove: () -> Unit, save: (String) -> Unit) {
    var chosen by remember(current) { mutableStateOf(current) }
    AlertDialog(onDismissRequest = { if (!busy) dismiss() }, title = { WorldsActionLabel(R.drawable.ic_image, stringResource(R.string.slide_background)) },
        text = { Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
            Text(stringResource(R.string.slide_background_hint), style = MaterialTheme.typography.bodyMedium)
            SlideColorChoices(slideBackgroundColors, chosen, !busy) { chosen = it }
            TextButton(enabled = !busy, onClick = pick) { WorldsActionLabel(R.drawable.ic_image, stringResource(R.string.slide_background_picture)) }
            if (hasImage) TextButton(enabled = !busy, onClick = remove) { WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.slide_background_remove_picture)) }
        } }, confirmButton = { TextButton(enabled = !busy && chosen in slideBackgroundColors, onClick = { save(chosen) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(enabled = !busy, onClick = dismiss) { Text(stringResource(R.string.cancel)) } })
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun SlideTextStyleDialog(element: JSONObject, busy: Boolean, dismiss: () -> Unit, save: (Map<String, String>) -> Unit) {
    val initialFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { initialFocus.requestFocus() }
    val original = remember(element.optString("id")) { element.optJSONObject("style") ?: JSONObject() }
    var size by remember { mutableStateOf(original.optInt("fontSize", 32).toString()) }
    var bold by remember { mutableStateOf(original.optInt("fontWeight", 500) >= 700) }
    var italic by remember { mutableStateOf(original.optBoolean("italic")) }
    var align by remember { mutableStateOf(original.optString("align", "left")) }
    var color by remember { mutableStateOf(original.optString("color", "#f4f2ee")) }
    val originalSize = original.optInt("fontSize", 32); val originalBold = original.optInt("fontWeight", 500) >= 700
    val sizeValue = size.toIntOrNull()
    AlertDialog(modifier = Modifier.imePadding(), onDismissRequest = { if (!busy) dismiss() }, title = { Box(Modifier.focusRequester(initialFocus).focusable()) { WorldsActionLabel(R.drawable.ic_type, stringResource(R.string.slide_text_style)) } },
        text = {
            val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
            val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
            fun finishTyping() { focusManager.clearFocus(); keyboard?.hide() }
            val scroll = rememberScrollState()
            LaunchedEffect(scroll, focusManager, keyboard) {
                scroll.interactionSource.interactions.collect { if (it is DragInteraction.Start) finishTyping() }
            }
            Column(Modifier.heightIn(max = 420.dp).verticalScroll(scroll).testTag("slide_style_scroll"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = size, onValueChange = { if (it.length <= 3) size = it }, label = { Text(stringResource(R.string.slide_font_size)) },
                enabled = !busy, singleLine = true, isError = sizeValue !in 4..300,
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number, imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { finishTyping() }))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = bold, enabled = !busy, onClick = { finishTyping(); bold = !bold }, label = { Text(stringResource(R.string.bold), fontWeight = FontWeight.Bold) })
                FilterChip(selected = italic, enabled = !busy, onClick = { finishTyping(); italic = !italic }, label = { Text(stringResource(R.string.italic), fontStyle = FontStyle.Italic) })
            }
            Text(stringResource(R.string.slide_alignment), style = MaterialTheme.typography.labelLarge)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(Triple("left", R.string.image_align_left, R.drawable.ic_align_left), Triple("center", R.string.image_align_center, R.drawable.ic_align_center), Triple("right", R.string.image_align_right, R.drawable.ic_align_right)).forEach { (value, label, icon) ->
                    FilterChip(selected = align == value, enabled = !busy, onClick = { finishTyping(); align = value }, leadingIcon = { WorldsGlyph(icon) }, label = { Text(stringResource(label)) })
                }
            }
            Text(stringResource(R.string.slide_text_color), style = MaterialTheme.typography.labelLarge)
            SlideColorChoices(slideTextColors, color, !busy) { finishTyping(); color = it }
        } }, confirmButton = { TextButton(enabled = !busy && sizeValue in 4..300, onClick = {
            val changes = mutableMapOf<String, String>()
            if (sizeValue != originalSize) changes["fontSize"] = size
            if (bold != originalBold) changes["fontWeight"] = if (bold) "700" else "500"
            if (italic != original.optBoolean("italic")) changes["italic"] = italic.toString()
            if (align != original.optString("align", "left")) changes["align"] = align
            if (color != original.optString("color", "#f4f2ee")) changes["color"] = color
            save(changes)
        }) { Text(stringResource(R.string.save)) } }, dismissButton = { TextButton(enabled = !busy, onClick = dismiss) { Text(stringResource(R.string.cancel)) } })
}

@Composable private fun SlideElementDialog(element: JSONObject, busy: Boolean, dismiss: () -> Unit, format: () -> Unit, save: (List<Int>?, Boolean) -> Unit) {
    val keys = listOf("x", "y", "w", "h")
    val fields = remember(element.optString("id")) { mutableStateMapOf<String, String>().apply { keys.forEach { put(it, element.optInt(it).toString()) } } }
    val parsed = keys.map { fields[it]?.toIntOrNull() }
    val valid = parsed.all { it != null } && parsed[0]!! in -1280..2560 && parsed[1]!! in -720..1440 && parsed[2]!! in 16..2560 && parsed[3]!! in 4..1440
    var confirm by remember { mutableStateOf(false) }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text(stringResource(R.string.slide_element_remove)) }, text = { Text(stringResource(R.string.slide_element_remove_confirm)) },
        confirmButton = { TextButton(enabled = !busy, onClick = { confirm = false; save(null, true) }) { Text(stringResource(R.string.slide_element_remove)) } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } })
    AlertDialog(onDismissRequest = { if (!busy) dismiss() }, title = { Text(stringResource(R.string.slide_element_position)) }, text = {
        Column(Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
            val labels = listOf(R.string.slide_x, R.string.slide_y, R.string.slide_width, R.string.slide_height)
            keys.forEachIndexed { i, key -> OutlinedTextField(value = fields[key].orEmpty(), onValueChange = { if (it.length <= 6) fields[key] = it }, enabled = !busy, singleLine = true,
                label = { Text(stringResource(labels[i])) }, modifier = Modifier.fillMaxWidth(), keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.NumberSigned)) }
            if (element.optString("type") == "text") TextButton(enabled = !busy, onClick = format) { WorldsActionLabel(R.drawable.ic_type, stringResource(R.string.slide_text_style)) }
            TextButton(enabled = !busy, onClick = { confirm = true }) { WorldsActionLabel(R.drawable.ic_trash_2, stringResource(R.string.slide_element_remove)) }
        }
    }, confirmButton = { TextButton(enabled = !busy && valid, onClick = { save(parsed.map { it!! }, false) }) { Text(stringResource(R.string.save)) } }, dismissButton = { TextButton(enabled = !busy, onClick = dismiss) { Text(stringResource(R.string.cancel)) } })
}

private data class SlideDragging(val target: SlideMoveTarget, val handle: String? = null, val dx: Double = 0.0, val dy: Double = 0.0) {
    fun preview(): SlideMoveTarget = if (handle == null) target.copy(x = target.x + dx, y = target.y + dy) else slideResize(target, handle, dx, dy)
}

@Composable private fun SlidePreview(slide: ContentBlock, databaseName: String, moveEnabled: Boolean = false, onMove: (String, Int, Int) -> Unit = { _, _, _ -> }, onResize: (String, List<Int>) -> Unit = { _, _ -> }) {
    val attrs = remember(slide.content) { runCatching { JSONObject(slide.content).getJSONObject("attrs") }.getOrNull() }
    val bg = remember(slide.content) { runCatching { Color(android.graphics.Color.parseColor(attrs?.optJSONObject("background")?.optString("color") ?: "#16161a")) }.getOrDefault(Color(0xff16161a)) }
    val elements = attrs?.optJSONArray("elements")
    var dragging by remember(slide.id, moveEnabled) { mutableStateOf<SlideDragging?>(null) }
    var selectedId by remember(slide.id) { mutableStateOf<String?>(null) }
    var pointerDown by remember(slide.id) { mutableStateOf<androidx.compose.ui.geometry.Offset?>(null) }
    val latestOnMove by rememberUpdatedState(onMove)
    val latestOnResize by rememberUpdatedState(onResize)
    val targets = remember(slide.content) {
        (0 until (elements?.length() ?: 0)).mapNotNull { i ->
            val el = elements?.optJSONObject(i) ?: return@mapNotNull null
            if (el.optString("type") !in setOf("text", "shape", "image", "video")) return@mapNotNull null
            SlideMoveTarget(el.optString("id"), el.optDouble("x", 0.0), el.optDouble("y", 0.0), el.optDouble("w", 0.0), el.optDouble("h", 0.0), el.optDouble("rot", 0.0))
        }
    }
    BoxWithConstraints(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(bg).clipToBounds()) {
        val scale = maxWidth / 1280f
        val density = LocalDensity.current
        val pixelsPerUnit = with(density) { maxWidth.toPx() } / 1280f
        val backgroundId = attrs?.optJSONObject("background")?.optString("attachmentId").orEmpty()
        if (backgroundId.isNotBlank()) SlideImage(backgroundId, databaseName, Modifier.fillMaxSize(), true)
        for (i in 0 until (elements?.length() ?: 0)) {
            val el = elements?.optJSONObject(i) ?: continue
            val drag = dragging?.takeIf { it.target.id == el.optString("id") }
            val preview = drag?.preview()
            val x = (preview?.x ?: el.optDouble("x", 0.0)).coerceIn(-1280.0, 2560.0).toFloat(); val y = (preview?.y ?: el.optDouble("y", 0.0)).coerceIn(-720.0, 1440.0).toFloat()
            val w = (preview?.width ?: el.optDouble("w", 0.0)).coerceIn(0.0, 2560.0).toFloat(); val h = (preview?.height ?: el.optDouble("h", 0.0)).coerceIn(0.0, 1440.0).toFloat()
            val rotation = el.optDouble("rot", 0.0).takeIf { it.isFinite() }?.coerceIn(-3600.0, 3600.0)?.toFloat() ?: 0f
            val opacity = el.optDouble("opacity", 1.0).takeIf { it.isFinite() }?.coerceIn(0.0, 1.0)?.toFloat() ?: 1f
            val place = Modifier.absoluteOffset(x = scale * x, y = scale * y).size(width = scale * w, height = scale * h).graphicsLayer { rotationZ = rotation; alpha = opacity }.then(if (drag != null) Modifier.border(2.dp, Color(0xffd2a46e)) else Modifier).clipToBounds()
            when (el.optString("type")) {
                "text" -> {
                    val style = el.optJSONObject("style"); val text = el.optString("text"); val color = slideColor(style?.optString("color") ?: "#f4f2ee")
                    val size = style?.optDouble("fontSize", 32.0)?.coerceIn(4.0, 300.0)?.toFloat() ?: 32f
                    val align = when (style?.optString("align")) { "center" -> TextAlign.Center; "right" -> TextAlign.Right; else -> TextAlign.Left }
                    Text(text, modifier = place, color = color, fontSize = with(density) { (scale * size).toSp() }, lineHeight = with(density) { (scale * size * 1.2f).toSp() }, fontWeight = FontWeight((style?.optInt("fontWeight", 500) ?: 500).coerceIn(1, 1000)), fontStyle = if (style?.optBoolean("italic") == true) FontStyle.Italic else FontStyle.Normal, textAlign = align)
                }
                "shape" -> {
                    val shape = el.optString("shape")
                    val color = runCatching { Color(android.graphics.Color.parseColor(el.optString(if (shape == "line") "stroke" else "fill", "#d2a46e"))) }.getOrDefault(Color(0xffd2a46e))
                    val clip = when (shape) { "ellipse" -> CircleShape; "rect" -> RoundedCornerShape(scale * el.optDouble("radius", 0.0).coerceIn(0.0, 300.0).toFloat()); else -> RoundedCornerShape(0.dp) }
                    Box(place.background(color, clip))
                }
                "image" -> SlideImage(el.optString("attachmentId"), databaseName, place, el.optString("fit") == "cover")
                "video" -> SlideVideo(el.optString("attachmentId"), databaseName, place, el.optString("fit") == "cover")
            }
        }
        if (moveEnabled && pixelsPerUnit > 0f) Canvas(Modifier.matchParentSize().testTag("slide_move_canvas").pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    val event = awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial)
                    event.changes.firstOrNull { it.pressed && !it.previousPressed }?.let { pointerDown = it.position }
                }
            }
        }.pointerInput(slide.content, pixelsPerUnit) {
            detectTapGestures { position -> selectedId = slideMoveHit(targets, position.x / pixelsPerUnit.toDouble(), position.y / pixelsPerUnit.toDouble())?.id }
        }.pointerInput(slide.content, pixelsPerUnit) {
            detectDragGestures(onDragStart = { position ->
                val start = pointerDown ?: position
                val x = start.x / pixelsPerUnit.toDouble(); val y = start.y / pixelsPerUnit.toDouble()
                val selected = targets.singleOrNull { it.id == selectedId }
                val radius = 24.dp.toPx() / pixelsPerUnit
                val handle = selected?.let { slideHandles(it).minByOrNull { h -> kotlin.math.hypot(h.x - x, h.y - y) } }
                    ?.takeIf { kotlin.math.hypot(it.x - x, it.y - y) <= radius }
                val target = if (handle != null) selected else slideMoveHit(targets, x, y)
                selectedId = target?.id
                dragging = target?.let { SlideDragging(it, handle?.name) }
            }, onDragCancel = { dragging = null }, onDragEnd = {
                val current = dragging; dragging = null
                if (current != null) {
                    val result = current.preview()
                    val x = kotlin.math.round(result.x).toInt().coerceIn(-1280, 2560)
                    val y = kotlin.math.round(result.y).toInt().coerceIn(-720, 1440)
                    if (current.handle == null) {
                        if (x != kotlin.math.round(current.target.x).toInt() || y != kotlin.math.round(current.target.y).toInt()) latestOnMove(current.target.id, x, y)
                    } else {
                        val width = kotlin.math.round(result.width).toInt().coerceIn(16, 2560)
                        val height = kotlin.math.round(result.height).toInt().coerceIn(4, 1440)
                        if (x != kotlin.math.round(current.target.x).toInt() || y != kotlin.math.round(current.target.y).toInt() || width != kotlin.math.round(current.target.width).toInt() || height != kotlin.math.round(current.target.height).toInt()) latestOnResize(current.target.id, listOf(x, y, width, height))
                    }
                }
            }, onDrag = { change, amount ->
                val current = dragging
                if (current != null) { dragging = current.copy(dx = current.dx + amount.x / pixelsPerUnit, dy = current.dy + amount.y / pixelsPerUnit); change.consume() }
            })
        }) {
            val selected = dragging?.preview() ?: targets.singleOrNull { it.id == selectedId }
            if (selected != null) {
                val handles = slideHandles(selected); val corners = listOf(0, 2, 4, 6, 0)
                corners.zipWithNext().forEach { (a, b) ->
                    drawLine(Color(0xffd2a46e), androidx.compose.ui.geometry.Offset((handles[a].x * pixelsPerUnit).toFloat(), (handles[a].y * pixelsPerUnit).toFloat()), androidx.compose.ui.geometry.Offset((handles[b].x * pixelsPerUnit).toFloat(), (handles[b].y * pixelsPerUnit).toFloat()), strokeWidth = 2.dp.toPx())
                }
                handles.forEach { handle ->
                    val radius = 5.dp.toPx(); val point = androidx.compose.ui.geometry.Offset((handle.x * pixelsPerUnit).toFloat() - radius, (handle.y * pixelsPerUnit).toFloat() - radius)
                    val handleSize = androidx.compose.ui.geometry.Size(radius * 2, radius * 2)
                    drawRect(Color.White, point, handleSize)
                    drawRect(Color(0xff765127), point, handleSize, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.dp.toPx()))
                }
            }
        }
    }
}

private fun slideColor(value: String): Color {
    val rgba = Regex("rgba\\(\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(0(?:\\.\\d+)?|1(?:\\.0+)?)\\s*\\)").matchEntire(value)
    return runCatching {
        if (rgba == null) Color(android.graphics.Color.parseColor(value)) else {
            val (r, g, b, a) = rgba.destructured
            require(listOf(r, g, b).all { it.toInt() in 0..255 })
            Color(r.toInt(), g.toInt(), b.toInt(), (a.toFloat() * 255).toInt())
        }
    }.getOrDefault(Color(0xfff4f2ee))
}

@Composable private fun SlideImage(id: String, databaseName: String, modifier: Modifier, cover: Boolean) {
    val context = LocalContext.current.applicationContext
    val image by produceState<android.graphics.Bitmap?>(null, id, databaseName) {
        value = withContext(Dispatchers.IO) { runCatching { worlds.content.ContentStore(context, databaseName).use { it.imageBytes(id) }?.let { decodePageImage(it) } }.getOrNull() }
    }
    if (image != null) Image(image!!.asImageBitmap(), contentDescription = stringResource(R.string.image_description), modifier = modifier, contentScale = if (cover) ContentScale.Crop else ContentScale.Fit)
    else Box(modifier.background(Color(0xff49494c)), contentAlignment = Alignment.Center) { Text(stringResource(R.string.image_unavailable), color = Color.White, style = MaterialTheme.typography.labelSmall) }
}

@Composable private fun SlideEditDialog(slide: ContentBlock, busy: Boolean, dismiss: () -> Unit, save: (Map<String, String>, String) -> Unit) {
    val attrs = remember(slide.content) { runCatching { JSONObject(slide.content).getJSONObject("attrs") }.getOrNull() }
    val entries = remember(slide.content) {
        val items = attrs?.optJSONArray("elements")
        (0 until (items?.length() ?: 0)).mapNotNull { items?.optJSONObject(it) }.filter { it.optString("type") == "text" && it.optString("id").isNotBlank() }
    }
    val values = remember(slide.id) { mutableStateMapOf<String, String>().apply { entries.forEach { put(it.optString("id"), it.optString("text")) } } }
    var notes by rememberSaveable(slide.id) { mutableStateOf(attrs?.optString("notes").orEmpty()) }
    AlertDialog(onDismissRequest = { if (!busy) dismiss() }, title = { Text(stringResource(R.string.slide_edit)) }, text = {
        Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            entries.forEachIndexed { index, entry -> val id = entry.optString("id"); OutlinedTextField(value = values[id].orEmpty(), onValueChange = { if (it.length <= 20_000) values[id] = it }, enabled = !busy,
                label = { Text(stringResource(R.string.slide_text_number, index + 1)) }, modifier = Modifier.fillMaxWidth(), maxLines = 6) }
            OutlinedTextField(value = notes, onValueChange = { if (it.length <= 20_000) notes = it }, enabled = !busy, label = { Text(stringResource(R.string.slide_notes)) }, modifier = Modifier.fillMaxWidth(), maxLines = 5)
        }
    }, confirmButton = { TextButton(enabled = !busy, onClick = { save(values.toMap(), notes) }) { Text(stringResource(R.string.save)) } }, dismissButton = { TextButton(enabled = !busy, onClick = dismiss) { Text(stringResource(R.string.cancel)) } })
}
