package worlds.android

import android.app.Application
import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import worlds.stylus.StrokeBrush
import worlds.stylus.StrokeSample
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInputSelection
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextRange
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import worlds.content.ContentStore
import worlds.content.ContentBlock
import java.util.UUID

class HomeTest {
    @get:Rule val compose = createComposeRule()
    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as Application
    private val database = "worlds-ui-test-${UUID.randomUUID()}.db"
    private lateinit var model: HomeModel

    @Before fun setup() {
        // Finish schema creation before the model and fixture helpers run concurrently.
        ContentStore(app, database).use { it.writableDatabase }
        model = HomeModel(app, database)
    }
    @After fun cleanup() { model.close(); app.deleteDatabase(database) }
    private fun libraryAction(label: Int) {
        compose.onNodeWithContentDescription(app.getString(R.string.library_more_actions)).performClick()
        compose.onNodeWithText(app.getString(label)).performScrollTo().performClick()
    }
    private fun pageAction(label: Int) {
        compose.onNodeWithText(app.getString(R.string.page_actions)).performClick()
        compose.onNodeWithText(app.getString(label)).performScrollTo().performClick()
    }
    private fun insertBlock(label: Int) {
        compose.onNodeWithText(app.getString(R.string.insert_block)).performClick()
        compose.onNodeWithText(app.getString(label)).performScrollTo().performClick()
    }
    private fun drawingControl(label: Int) {
        val name = app.getString(label)
        if (compose.onAllNodes(androidx.compose.ui.test.hasContentDescription(name)).fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithContentDescription(name).performClick()
        else compose.onNodeWithText(name).performClick()
    }

    @Test fun narrowEmptyLibraryKeepsItsMessageVisible() {
        compose.setContent { WorldsTheme { Box(Modifier.size(274.dp, 488.dp)) { Home(model) } } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        compose.onNodeWithText(app.getString(R.string.local_label)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.new_page)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.empty_title)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.empty_body)).assertIsDisplayed()
    }

    @Test fun avifPageImageIsDisplayedAndExportsOriginalBytes() {
        org.junit.Assume.assumeTrue(android.os.Build.VERSION.SDK_INT >= 31)
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("sample.avif").use { it.readBytes() }
        val input = app.cacheDir.resolve("sample-${UUID.randomUUID()}.avif")
        val output = app.cacheDir.resolve("export-${UUID.randomUUID()}.avif")
        input.writeBytes(bytes)
        val page = ContentStore(app, database).use { it.create("page", "AVIF page") }
        try {
            compose.setContent { WorldsTheme { Home(model) } }
            model.open(page.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
            compose.runOnIdle { check(model.beginImageImport()); model.finishImageImport(Uri.fromFile(input)) }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.size == 1 }
            val block = model.state.value.selected!!.blocks.single()
            val attrs = org.json.JSONObject(block.content).getJSONObject("attrs")
            check(attrs.getString("mime") == "image/avif")
            compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(attrs.getString("name")).assertIsDisplayed(); true }.getOrDefault(false) }
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(300)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-avif-page.png")).use { it.readBytes() }
            }
            compose.runOnIdle {
                val request = checkNotNull(model.beginImageExport(block.id))
                check(request.mime == "image/avif" && request.name.endsWith(".avif"))
                model.finishImageExport(Uri.fromFile(output))
            }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.imageStatus == R.string.image_export_success }
            check(output.readBytes().contentEquals(bytes))
        } finally { input.delete(); output.delete() }
    }

    @Test fun avifCanBeSelectedFromTheSystemPicker() {
        org.junit.Assume.assumeTrue(android.os.Build.VERSION.SDK_INT >= 31)
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("sample.avif").use { it.readBytes() }
        val filename = "worlds-avif-${UUID.randomUUID()}.avif"
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "image/avif")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
        }
        val fixture = checkNotNull(app.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        checkNotNull(app.contentResolver.openOutputStream(fixture)).use { it.write(bytes) }
        val page = ContentStore(app, database).use { it.create("page", "AVIF picker") }
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
            insertBlock(R.string.image_insert)
            val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
            fun find(node: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? {
                if (node == null) return null
                if (node.contentDescription?.toString()?.startsWith(filename) == true) return node
                for (i in 0 until node.childCount) find(node.getChild(i))?.let { return it }
                return null
            }
            val deadline = System.currentTimeMillis() + 20_000; var clicked = false
            while (System.currentTimeMillis() < deadline && !clicked) {
                find(automation.rootInActiveWindow)?.let { target ->
                    val bounds = android.graphics.Rect(); target.getBoundsInScreen(bounds)
                    if (!bounds.isEmpty) {
                        val x = bounds.left + bounds.width() / 4; val y = bounds.top + bounds.height() / 4
                        automation.executeShellCommand("input tap $x $y").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
                        clicked = true
                    }
                }
                if (!clicked) Thread.sleep(200)
            }
            check(clicked) { "AVIF file was not found in the system picker" }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.size == 1 }
            val attrs = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs")
            check(attrs.getString("mime") == "image/avif")
            ContentStore(app, database).use { check(it.imageBytes(attrs.getString("attachmentId"))!!.contentEquals(bytes)) }
        } finally { app.contentResolver.delete(fixture, null, null) }
    }

    @Test fun templatePickerCreatesAnEditableIndependentPage() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        libraryAction(R.string.templates_title)
        compose.waitUntil(20_000) { model.state.value.templatesVisible && !model.state.value.templatesLoading }
        check(model.state.value.templates.size == 9)
        compose.onNodeWithText("Weekly Update").performScrollTo().assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            Thread.sleep(500)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("templates.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-templates.png").close()
        }
        compose.onNodeWithText("Weekly Update").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.title?.startsWith("Weekly Update ") == true && !model.state.value.busy }
        val created = model.state.value.selected!!
        check(created.resource.kind == "page" && created.blocks.isNotEmpty())
        compose.onNodeWithText("Shipped").assertIsDisplayed()
        compose.onAllNodesWithText(app.getString(R.string.edit_text))[0].performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Completed")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.first().content.contains("Completed") }
        ContentStore(app, database).use { store ->
            check(store.load(created.resource.id)!!.blocks.size == created.blocks.size)
            check(store.ensureBuiltinTemplates().size == 9)
            val original = store.load(model.state.value.templates.single { it.title.startsWith("Weekly Update") }.id)!!
            check(original.blocks.first().content.contains("Shipped"))
        }
    }

    @Test fun pageCanBeSavedAndUsedAsCustomTemplate() {
        val source = ContentStore(app, database).use { store ->
            val page = store.create("page", "My checklist")
            store.saveBlocks(page.id, 0, listOf(ContentBlock("original", """{"type":"paragraph","content":[{"type":"text","text":"My reusable content"}]}""")))
            page
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(source.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == source.id }
        pageAction(R.string.template_save)
        compose.waitUntil(20_000) { model.state.value.markdownStatus == R.string.template_saved }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected == null }
        libraryAction(R.string.templates_title)
        compose.waitUntil(20_000) { model.state.value.templatesVisible && !model.state.value.templatesLoading }
        compose.onNode(hasText("My checklist") and hasText("Custom")).performScrollTo().performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id != null && model.state.value.selected?.resource?.id != source.id }
        val result = model.state.value.selected!!
        check(result.resource.title == "My checklist" && worlds.content.InlineEditing.text(result.blocks.single().content) == "My reusable content")
        check(result.blocks.single().id != "original")
    }

    @Test fun templateCanBeEditedTrashedAndRestoredWithoutChangingCreatedPages() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        fun picker() {
            libraryAction(R.string.templates_title)
            compose.waitUntil(20_000) { model.state.value.templatesVisible && !model.state.value.templatesLoading }
        }
        picker()
        val template = model.state.value.templates.single { it.title.startsWith("Weekly Update") }
        compose.onNodeWithText("Weekly Update").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id != null }
        val oldPage = model.state.value.selected!!.resource.id
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        picker()
        compose.onNodeWithContentDescription(app.getString(R.string.template_actions, template.title)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.template_edit)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == template.id }
        compose.onAllNodesWithText(app.getString(R.string.edit_text))[0].performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Delivered")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.first().content.contains("Delivered") }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        picker()
        compose.onNodeWithText("Weekly Update").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id != null && model.state.value.selected?.resource?.id != oldPage }
        val newPage = model.state.value.selected!!.resource.id
        check(model.state.value.selected!!.blocks.first().content.contains("Delivered"))
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        picker()
        compose.onNodeWithContentDescription(app.getString(R.string.template_actions, template.title)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.move_to_trash)).performClick()
        compose.onNodeWithText(app.getString(R.string.template_trash_title)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.move_to_trash)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.templates.none { it.id == template.id } }
        ContentStore(app, database).use { store ->
            check(store.load(oldPage)!!.blocks.first().content.contains("Shipped"))
            check(store.load(newPage)!!.blocks.first().content.contains("Delivered"))
        }
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        libraryAction(R.string.trash)
        compose.waitUntil(20_000) { !model.state.value.loading && model.state.value.pages.any { it.id == template.id } }
        compose.onNodeWithText(template.title).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == template.id }
        compose.onNodeWithText(app.getString(R.string.restore)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected == null }
        ContentStore(app, database).use { store -> check(store.ensureBuiltinTemplates().any { it.id == template.id && it.deletedAt == null }) }
    }

    @Test fun templateSubpagesStayOutOfPersonalLibraryAndSearch() {
        val templateChild: String
        val sourceChild: String
        ContentStore(app, database).use { store ->
            val page = store.create("page", "Root")
            sourceChild = store.create("page", "Unique child", parentId = page.id).id
            val template = store.saveAsTemplate(page.id, page.revision)
            templateChild = store.list().single { it.parentId == template.id }.id
        }
        compose.setContent { WorldsTheme { Home(model) } }
        compose.runOnIdle { model.refresh() }
        compose.waitUntil(20_000) { !model.state.value.loading && model.state.value.pages.any { it.id == sourceChild } }
        check(model.state.value.pages.none { it.id == templateChild })
        compose.onNodeWithText(app.getString(R.string.search)).performTextInput("Unique child")
        compose.waitUntil(20_000) { !model.state.value.loading && model.state.value.query == "Unique child" && model.state.value.pages.any { it.id == sourceChild } }
        check(model.state.value.pages.none { it.id == templateChild })
    }

    @Test fun blankTemplateCanBeEditedAndDuplicated() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        libraryAction(R.string.templates_title)
        compose.waitUntil(20_000) { model.state.value.templatesVisible && !model.state.value.templatesLoading }
        compose.onNodeWithText(app.getString(R.string.template_new)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "template" }
        val id = model.state.value.selected!!.resource.id
        pageAction(R.string.rename)
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Custom workflow")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.title == "Custom workflow" }
        insertBlock(R.string.add_paragraph)
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Repeatable steps")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        libraryAction(R.string.templates_title)
        compose.waitUntil(20_000) { model.state.value.templatesVisible && !model.state.value.templatesLoading }
        val original = model.state.value.templates.single { it.id == id }
        compose.onNodeWithContentDescription(app.getString(R.string.template_actions, original.title)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.template_duplicate)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.templates.any { it.title == "Custom workflow (copy)" } }
        val copy = model.state.value.templates.single { it.title == "Custom workflow (copy)" }
        ContentStore(app, database).use { store ->
            check(store.load(copy.id)!!.blocks.single().content.contains("Repeatable steps"))
            check(store.load(copy.id)!!.blocks.single().id != store.load(id)!!.blocks.single().id)
        }
    }

    @Test fun blockRemovalCanBeCanceledAndRestoredFromHistory() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Block recovery")
            store.saveBlocks(created.id, 0, listOf(
                ContentBlock("first", """{"type":"paragraph","content":[{"type":"text","text":"First"}]}"""),
                ContentBlock("second", """{"type":"paragraph","content":[{"type":"text","text":"Second"}]}""")))
            created
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        fun selectRemove() {
            compose.onAllNodesWithText(app.getString(R.string.block_actions))[0].performClick()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.onNodeWithText(app.getString(R.string.insert_paragraph_after)).assertIsDisplayed()
                compose.waitForIdle()
                Thread.sleep(500)
                val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                val capture = app.getExternalFilesDir(null)!!.resolve("block-actions.png")
                capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; screenshot.recycle()
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-block-actions.png").close()
            }
            compose.onNodeWithText(app.getString(R.string.remove_block)).performScrollTo().performClick()
        }
        selectRemove()
        compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
        check(model.state.value.selected!!.blocks.size == 2)
        selectRemove()
        compose.onNodeWithText(app.getString(R.string.remove)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.size == 1 }
        check(model.state.value.selected!!.blocks.single().id == "second")
        pageAction(R.string.versions)
        compose.waitUntil(20_000) { model.state.value.versions != null }
        compose.onNodeWithText(app.getString(R.string.before_block_removal)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.restore)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.size == 2 }
        check(model.state.value.selected!!.blocks.map { it.id } == listOf("first", "second"))
    }

    @Test fun blockDuplicateIsAdjacentAndCanBeEditedIndependently() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Duplicate blocks")
            store.saveBlocks(created.id, 0, listOf(
                ContentBlock("first", """{"type":"paragraph","content":[{"type":"text","text":"Original","marks":[{"type":"bold"}]}]}"""),
                ContentBlock("last", """{"type":"paragraph","content":[{"type":"text","text":"Last"}]}""")))
            created
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        compose.onAllNodesWithText(app.getString(R.string.block_actions))[0].performClick()
        compose.onNodeWithText(app.getString(R.string.duplicate_block)).performScrollTo().performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.size == 3 }
        val blocks = model.state.value.selected!!.blocks
        check(blocks.first().id == "first" && blocks.last().id == "last" && blocks[1].id != "first")
        check(blocks[1].content.contains("bold"))
        compose.onAllNodesWithText(app.getString(R.string.edit_text))[1].performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Copy changed")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks[1].content.contains("Copy changed") }
        check(worlds.content.InlineEditing.text(model.state.value.selected!!.blocks.first().content) == "Original")
    }

    @Test fun projectCreatesEditsLinksAndOwnsChildrenWithoutMovingLinkedPages() {
        val external = ContentStore(app, database).use { it.create("page", "External notes") }
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        libraryAction(R.string.project_new)
        compose.onNodeWithText(app.getString(R.string.project_title)).performTextInput("Launch project")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "project" }
        val projectId = model.state.value.selected!!.resource.id
        compose.onNodeWithText(app.getString(R.string.project_edit)).performClick()
        compose.onNodeWithText(app.getString(R.string.project_status_paused)).performClick()
        compose.onNodeWithText(app.getString(R.string.project_start)).performScrollTo().performTextInput("2026-11-08")
        compose.onNodeWithText(app.getString(R.string.project_due)).performScrollTo().performTextInput("2027-01-01")
        compose.onNodeWithText(app.getString(R.string.project_description)).performScrollTo().performTextInput("Prepare the release")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && runCatching { worlds.content.ProjectEditing.read(model.state.value.selected!!.resource.metadata).status == "paused" }.getOrDefault(false) }
        val info = worlds.content.ProjectEditing.read(model.state.value.selected!!.resource.metadata)
        check(info.start == "2026-11-08" && info.due == "2027-01-01" && info.description == "Prepare the release")
        compose.onNodeWithTag("project-resources").performScrollToNode(hasText(app.getString(R.string.project_link_existing)))
        compose.onNodeWithText(app.getString(R.string.project_link_existing)).performClick()
        compose.onNodeWithText("External notes").performScrollTo().performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && worlds.content.ProjectEditing.read(model.state.value.selected!!.resource.metadata).links.contains(external.id) }
        ContentStore(app, database).use { check(it.load(external.id)!!.resource.parentId == null) }
        compose.onNodeWithText(app.getString(R.string.project_add)).performClick()
        compose.onNodeWithText(app.getString(R.string.project_kind_document)).performClick()
        compose.onNodeWithText(app.getString(R.string.project_item_title)).performTextInput("Project document")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "document" && model.state.value.selected?.resource?.parentId == projectId }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == projectId }
        compose.onNodeWithTag("project-resources").performScrollToNode(hasText("Project document") and hasClickAction())
        compose.onNode(hasText("Project document") and hasClickAction()).assertIsDisplayed()
        check(model.state.value.projectActivity.any { it.resource.title == "Project document" && it.event.kind == "created" })
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-project.png").close()
        }
        compose.onNodeWithTag("project-resources").performScrollToNode(hasText(app.getString(R.string.project_unlink)))
        compose.onNodeWithText(app.getString(R.string.project_unlink)).performClick()
        compose.onNodeWithText(app.getString(R.string.project_unlink_confirm, "External notes")).assertIsDisplayed()
        compose.onAllNodesWithText(app.getString(R.string.project_unlink)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
        compose.waitUntil(20_000) { !model.state.value.busy && worlds.content.ProjectEditing.read(model.state.value.selected!!.resource.metadata).links.isEmpty() }
        ContentStore(app, database).use { check(it.load(external.id)!!.resource.deletedAt == null && it.load(external.id)!!.resource.parentId == null) }
    }

    @Test fun personalPageMovesIntoProjectAndOpensParent() {
        val (project, page) = ContentStore(app, database).use { store ->
            store.create("project", "Destination project", metadata = worlds.content.ProjectEditing.defaultProjectMetadata) to store.create("page", "Move into project")
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.move_page)
        compose.waitUntil(20_000) { model.state.value.moveVisible && !model.state.value.moveLoading }
        compose.onNodeWithText("Destination project").performScrollTo().performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.resource?.parentId == project.id }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == project.id }
        compose.onNode(hasText("Move into project") and hasClickAction()).performScrollTo().assertIsDisplayed()
    }

    @Test fun projectConflictKeepsDraftAndMissingLinks() {
        val project = ContentStore(app, database).use { it.create("project", "Project conflict", metadata = """{"project":{"status":"active","description":"original","links":["missing"]}}""") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(project.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == project.id }
        compose.onNodeWithText(app.getString(R.string.project_missing_links, 1)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.project_edit)).performClick()
        compose.onNodeWithText(app.getString(R.string.project_description)).performScrollTo().performTextClearance()
        compose.onNodeWithText(app.getString(R.string.project_description)).performTextInput("Unsaved project draft")
        ContentStore(app, database).use { it.rename(project.id, project.revision, "Changed elsewhere") }
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithText(app.getString(R.string.project_save_error)).performScrollTo().assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText("Unsaved project draft").performScrollTo().assertIsDisplayed()
        ContentStore(app, database).use { check(worlds.content.ProjectEditing.read(it.load(project.id)!!.resource.metadata).links == listOf("missing")) }
    }

    @Test fun pageKeyboardShortcutsOpenFindAndNavigateWithoutStealingEditorInput() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Keyboard search")
            store.saveBlocks(created.id, 0, listOf(ContentBlock("p", """{"type":"paragraph","content":[{"type":"text","text":"cat cat"}]}"""))); created
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        fun key(code: Int, meta: Int = 0) {
            val instrumentation = InstrumentationRegistry.getInstrumentation(); val now = android.os.SystemClock.uptimeMillis()
            instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_DOWN, code, 0, meta))
            instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_UP, code, 0, meta)); compose.waitForIdle()
        }
        val ctrl = android.view.KeyEvent.META_CTRL_ON; val shift = android.view.KeyEvent.META_SHIFT_ON
        key(android.view.KeyEvent.KEYCODE_F, ctrl or shift)
        check(compose.onAllNodesWithText(app.getString(R.string.find_query)).fetchSemanticsNodes().isEmpty())
        key(android.view.KeyEvent.KEYCODE_F, ctrl)
        compose.onNodeWithText(app.getString(R.string.find_query)).assertIsDisplayed().performTextInput("cat")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 2)).fetchSemanticsNodes().isNotEmpty() }
        key(android.view.KeyEvent.KEYCODE_ENTER)
        compose.onNodeWithText(app.getString(R.string.find_count, 2, 2)).performScrollTo().assertIsDisplayed()
        key(android.view.KeyEvent.KEYCODE_ENTER, shift)
        compose.onNodeWithText(app.getString(R.string.find_count, 1, 2)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithTag("page-keyboard-surface").assertIsFocused(); true }.getOrDefault(false) }
        key(android.view.KeyEvent.KEYCODE_H, ctrl)
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 2)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        compose.onNodeWithText(app.getString(R.string.edit_text)).performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).assertIsDisplayed()
        key(android.view.KeyEvent.KEYCODE_F, ctrl)
        check(compose.onAllNodesWithText(app.getString(R.string.find_query)).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithText(app.getString(R.string.text_content)).assertIsDisplayed()
    }

    @Test fun keyboardHelperPublishesPageFindKeys() {
        val items = pageKeyboardShortcutGroup(app).items; val ctrl = android.view.KeyEvent.META_CTRL_ON
        check(items.size == 2 && items.any { it.keycode == android.view.KeyEvent.KEYCODE_F && it.modifiers == ctrl } && items.any { it.keycode == android.view.KeyEvent.KEYCODE_H && it.modifiers == ctrl })
    }

    @Test fun findCanRevealDistantTaskInLongList() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Long task list")
            val items = org.json.JSONArray()
            repeat(25) { i ->
                val text = if (i == 24) "Unique distant task" else "Task $i"
                val paragraph = org.json.JSONObject().put("type", "paragraph").put("content", org.json.JSONArray().put(org.json.JSONObject().put("type", "text").put("text", text)))
                items.put(org.json.JSONObject().put("type", "taskItem").put("attrs", org.json.JSONObject().put("checked", false)).put("content", org.json.JSONArray().put(paragraph)))
            }
            val list = org.json.JSONObject().put("type", "taskList").put("content", items).toString()
            store.saveBlocks(created.id, 0, listOf(ContentBlock("tasks", list))); created
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.find_replace)
        compose.onNodeWithText(app.getString(R.string.find_query)).performTextInput("distant task")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 1)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_show_block)).performScrollTo().performClick()
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithTag("find-revealed-match").assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText("Unique distant task").assertIsDisplayed()
    }

    @Test fun findCanRevealDistantCellInWideTable() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Wide table")
            val rows = org.json.JSONArray()
            repeat(10) { row ->
                val cells = org.json.JSONArray()
                repeat(8) { col ->
                    val text = if (row == 9 && col == 7) "Unique far cell" else "Cell $row $col"
                    val paragraph = org.json.JSONObject().put("type", "paragraph").put("content", org.json.JSONArray().put(org.json.JSONObject().put("type", "text").put("text", text)))
                    cells.put(org.json.JSONObject().put("type", "tableCell").put("content", org.json.JSONArray().put(paragraph)))
                }
                rows.put(org.json.JSONObject().put("type", "tableRow").put("content", cells))
            }
            store.saveBlocks(created.id, 0, listOf(ContentBlock("table", org.json.JSONObject().put("type", "table").put("content", rows).toString()))); created
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.find_replace)
        compose.onNodeWithText(app.getString(R.string.find_query)).performTextInput("far cell")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 1)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_show_block)).performScrollTo().performClick()
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithTag("find-revealed-match").assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText("Unique far cell").assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(300)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-find-cell.png").close()
        }
    }

    @Test fun findCanRevealDistantBlockInDocumentWithHeader() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("document", "Long document", metadata = """{"doc":{"header":"Running header"}}""")
            val blocks = (0 until 20).map { i ->
                val text = when (i) { 0 -> "First unique target"; 19 -> "Distant unique target"; else -> "Paragraph $i" }
                ContentBlock("block$i", org.json.JSONObject().put("type", "paragraph").put("content", org.json.JSONArray().put(org.json.JSONObject().put("type", "text").put("text", text))).toString())
            }
            store.saveBlocks(created.id, 0, blocks); created
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.find_replace)
        compose.onNodeWithText(app.getString(R.string.find_query)).performTextInput("unique target")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 2)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_next)).performScrollTo()
        compose.onNodeWithText(app.getString(R.string.find_next)).performSemanticsAction(SemanticsActions.OnClick) { check(it()) }
        compose.onNodeWithText(app.getString(R.string.find_count, 2, 2)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.find_show_block)).performScrollTo().performClick()
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithTag("find-revealed-block").assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText("Distant unique target").assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-find-revealed.png").close()
        }
        pageAction(R.string.find_replace)
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 2, 2)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("unique target").assertIsDisplayed()
    }

    @Test fun findReplaceKeepsInlineMathWhileEditingSurroundingText() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Inline find")
            val paragraph = """{"type":"paragraph","content":[{"type":"text","text":"cat "},{"type":"mathInline","attrs":{"latex":"cat^2"}},{"type":"text","text":" cat"}]}"""
            store.saveBlocks(created.id, 0, listOf(ContentBlock("p", paragraph))); created
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.find_replace)
        compose.onNodeWithText(app.getString(R.string.find_query)).performTextInput("cat")
        compose.onNodeWithText(app.getString(R.string.find_replacement)).performTextInput("dog")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 2)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_skipped, 1)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.find_replace_all)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.find_confirm_all, 2)).assertIsDisplayed()
        compose.onAllNodesWithText(app.getString(R.string.find_replace_all)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.single().content.contains("dog") }
        val content = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONArray("content")
        check(content.getJSONObject(0).getString("text") == "dog " && content.getJSONObject(2).getString("text") == " dog")
        check(content.getJSONObject(1).getJSONObject("attrs").getString("latex") == "cat^2")
    }

    @Test fun findReplaceIncludesNestedTasksAndTableCells() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Nested search")
            val list = """{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"cat task"}]},{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"cat nested"}]}]}]}]}]}"""
            val table = """{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"cat cell"}]}]}]}]}"""
            val code = """{"type":"codeBlock","attrs":{"language":"kotlin"},"content":[{"type":"text","text":"cat code"}]}"""
            store.saveBlocks(created.id, 0, listOf(ContentBlock("tasks", list), ContentBlock("table", table), ContentBlock("code", code))); created
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.find_replace)
        compose.onNodeWithText(app.getString(R.string.find_query)).performTextInput("cat")
        compose.onNodeWithText(app.getString(R.string.find_replacement)).performTextInput("dog")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 4)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_count, 1, 4)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.find_replace_all)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.find_confirm_all, 4)).assertIsDisplayed()
        compose.onAllNodesWithText(app.getString(R.string.find_replace_all)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.all { it.content.contains("dog") } }
        val blocks = model.state.value.selected!!.blocks
        check(worlds.content.ListEditing.read(blocks[0].content).items.map { worlds.content.InlineEditing.text(it.paragraph!!) } == listOf("dog task", "dog nested"))
        check(worlds.content.ListEditing.read(blocks[0].content).items.first().checked == true)
        check(worlds.content.InlineEditing.text(worlds.content.TableEditing.read(blocks[1].content).rows[0][0]!!.paragraphs.single()!!) == "dog cell")
        check(worlds.content.CodeEditing.read(blocks[2].content) == worlds.content.CodeEditing.Value("dog code", "kotlin"))
    }

    @Test fun findReplaceMovesThroughMatchesAndPreservesUnsupportedBlocks() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Search page")
            store.saveBlocks(created.id, 0, listOf(
                ContentBlock("first", """{"type":"paragraph","content":[{"type":"text","text":"Hello hello","marks":[{"type":"bold"}]}]}"""),
                ContentBlock("other", """{"type":"unknown","attrs":{"custom":"preserve"}}""")))
            created
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        val originalOther = model.state.value.selected!!.blocks[1].content
        pageAction(R.string.find_replace)
        compose.onNodeWithText(app.getString(R.string.find_query)).performTextInput("hello")
        compose.onNodeWithText(app.getString(R.string.find_replacement)).performTextInput("Hi")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 2)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_count, 1, 2)).performScrollTo().assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("input keyevent 4").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            compose.onNodeWithText(app.getString(R.string.find_count, 1, 2)).performScrollTo().assertIsDisplayed()
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-find-replace.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.find_next)).performScrollTo()
        compose.onNodeWithText(app.getString(R.string.find_next)).performSemanticsAction(SemanticsActions.OnClick) { check(it()) }
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 2, 2)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_count, 2, 2)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.find_replace_one)).performScrollTo().performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.firstOrNull()?.content?.contains("Hi") == true }
        check(worlds.content.InlineEditing.text(model.state.value.selected!!.blocks[0].content) == "Hello Hi")
        compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.find_count, 1, 1)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(app.getString(R.string.find_replace_all)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.find_confirm_all, 1)).assertIsDisplayed()
        compose.onAllNodesWithText(app.getString(R.string.find_replace_all)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
        compose.waitUntil(20_000) { !model.state.value.busy && worlds.content.InlineEditing.text(model.state.value.selected!!.blocks[0].content) == "Hi Hi" }
        check(model.state.value.selected!!.blocks[1].content == originalOther)
        check(worlds.content.InlineEditing.hasMark(model.state.value.selected!!.blocks[0].content, 0, 2, "bold"))
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        ContentStore(app, database).use { check(it.versions(page.id).size >= 2) }
    }

    @Test fun documentTypographyChangesVisibleTextAndPersists() {
        val page = ContentStore(app, database).use { store ->
            val p = store.create("document", "Typography", metadata = """{"doc":{"fontSize":12,"lineHeight":1.5}}""")
            store.saveBlocks(p.id, p.revision, listOf(ContentBlock("body", """{"type":"paragraph","content":[{"type":"text","text":"Document body text"}]}"""))); p
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        val before = compose.onNodeWithText("Document body text").fetchSemanticsNode().boundsInRoot.height
        pageAction(R.string.document_typography)
        compose.onNodeWithContentDescription(app.getString(R.string.document_body_size)).performSemanticsAction(SemanticsActions.SetProgress) { it(24f) }
        compose.onNodeWithContentDescription(app.getString(R.string.document_line_spacing)).performSemanticsAction(SemanticsActions.SetProgress) { it(2f) }
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.onNodeWithText(app.getString(R.string.document_body_size_value, 24f)).assertIsDisplayed()
            compose.waitForIdle(); Thread.sleep(1000)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("document-typography.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-document-typography.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.resource.metadata).getJSONObject("doc").optDouble("fontSize") == 24.0 }
        val after = compose.onNodeWithText("Document body text").fetchSemanticsNode().boundsInRoot.height
        check(after > before)
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected == null }
        compose.onNodeWithText("Typography").performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        val settings = documentTypography(model.state.value.selected!!.resource.metadata)
        check(settings.size == 24f && settings.leading == 2f)
    }

    @Test fun documentRunningTextConflictKeepsDraft() {
        val page = ContentStore(app, database).use { it.create("document", "Concurrent document", metadata = """{"doc":{"header":"original"}}""") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.document_running_text)
        compose.onNodeWithText(app.getString(R.string.document_header)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.document_header)).performTextInput("Unsent draft")
        ContentStore(app, database).use { it.rename(page.id, page.revision, "Changed elsewhere") }
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithText(app.getString(R.string.document_running_error)).assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText("Unsent draft").assertIsDisplayed()
        ContentStore(app, database).use { check(org.json.JSONObject(it.load(page.id)!!.resource.metadata).getJSONObject("doc").getString("header") == "original") }
    }

    @Test fun documentCreationAndParagraphAlignmentPersist() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        libraryAction(R.string.new_document)
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Document test")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "document" }
        val document = model.state.value.selected!!.resource
        val docMetadata = org.json.JSONObject(document.metadata).getJSONObject("doc")
        check(docMetadata.getString("size") == "A4" && docMetadata.getJSONObject("margins").getInt("left") == 22)
        insertBlock(R.string.add_paragraph)
        compose.onNodeWithText(app.getString(R.string.document_style_subtitle)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.image_align_right)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performScrollTo().performTextInput("Aligned paragraph")
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInputSelection(TextRange(0, 7))
        compose.onNodeWithText(app.getString(R.string.document_text_size)).performScrollTo().performClick()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.onNodeWithText(app.getString(R.string.document_size_default)).assertIsDisplayed()
            compose.waitForIdle(); Thread.sleep(400)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("document-text-size.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-document-text-size.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.document_size_value, "24")).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.size == 1 }
        val raw = model.state.value.selected!!.blocks.single().content
        check(org.json.JSONObject(raw).getJSONObject("attrs").getString("textAlign") == "right")
        check(org.json.JSONObject(raw).getJSONObject("attrs").getString("pstyle") == "subtitle")
        check(previewBlock(raw).alignment == androidx.compose.ui.text.style.TextAlign.Right)
        check(previewBlock(raw).paragraphStyle == "subtitle")
        check(previewBlock(raw).hasCustomFontSize && previewBlock(raw).text.spanStyles.any { it.item.fontSize.value == 32f })
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("document-alignment.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-document-alignment.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected == null }
        compose.onNodeWithText("Document test").performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == document.id }
        check(model.state.value.selected!!.blocks.single().content == raw)
        pageAction(R.string.document_running_text)
        compose.onNodeWithText(app.getString(R.string.document_header)).performTextInput("Project header")
        compose.onNodeWithText(app.getString(R.string.document_footer)).performTextInput("Project footer")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.resource.metadata).getJSONObject("doc").optString("footer") == "Project footer" }
        compose.onNodeWithTag("page-blocks").performScrollToNode(hasText("Project header"))
        compose.onNodeWithText("Project header").assertIsDisplayed()
        compose.onNodeWithTag("page-blocks").performScrollToNode(hasText("Project footer"))
        compose.onNodeWithText("Project footer").assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("document-running-text.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-document-running-text.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected == null }
        compose.onNodeWithText("Document test").performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == document.id }
        check(org.json.JSONObject(model.state.value.selected!!.resource.metadata).getJSONObject("doc").getString("header") == "Project header")
    }

    @Test fun selectedTextCanGainAndRemoveLinkWithoutLosingBold() {
        val page = ContentStore(app, database).use { it.create("page", "Link editing") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        insertBlock(R.string.add_paragraph)
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Hello world")
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInputSelection(TextRange(0, 5))
        compose.onNodeWithText(app.getString(R.string.bold)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.inline_link)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.inline_link_address)).performTextInput("javascript:bad")
        compose.onNodeWithText(app.getString(R.string.inline_link_apply)).performClick()
        compose.onNodeWithText(app.getString(R.string.inline_link_invalid)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.inline_link_address)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.inline_link_address)).performTextInput("https://example.com")
        compose.onNodeWithText(app.getString(R.string.inline_link_apply)).performClick()
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.isNotEmpty() }
        val saved = model.state.value.selected!!.blocks.single().content
        check(worlds.content.InlineEditing.hasMark(saved, 0, 5, "bold") && worlds.content.InlineEditing.hasMark(saved, 0, 5, "link"))
        val marks = org.json.JSONObject(saved).getJSONArray("content").getJSONObject(0).getJSONArray("marks")
        check((0 until marks.length()).any { marks.getJSONObject(it).optJSONObject("attrs")?.optString("href") == "https://example.com" })
        compose.onNodeWithText(app.getString(R.string.edit_text)).performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInputSelection(TextRange(0, 5))
        compose.onNodeWithText(app.getString(R.string.inline_link)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && !worlds.content.InlineEditing.hasMark(model.state.value.selected!!.blocks.single().content, 0, 5, "link") }
        check(worlds.content.InlineEditing.hasMark(model.state.value.selected!!.blocks.single().content, 0, 5, "bold"))
    }

    @Test fun previewLinkInvokesUriHandlerOnClick() {
        var opened: String? = null
        val uriHandler = object : androidx.compose.ui.platform.UriHandler { override fun openUri(uri: String) { opened = uri } }
        val raw = """{"type":"paragraph","content":[{"type":"text","text":"Open Worlds","marks":[{"type":"link","attrs":{"href":"https://example.com"}}]}]}"""
        compose.setContent {
            androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalUriHandler provides uriHandler) {
                androidx.compose.material3.Text(previewBlock(raw).text)
            }
        }
        compose.onNodeWithText("Open Worlds").performClick()
        compose.waitForIdle()
        check(opened == "https://example.com")
    }

    @Test fun inlineCodeHighlightAndColorsSurviveSaveAndReopen() {
        val page = ContentStore(app, database).use { it.create("page", "Color editing") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        insertBlock(R.string.add_paragraph)
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Colored text")
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInputSelection(TextRange(0, 7))
        compose.onNodeWithText(app.getString(R.string.inline_code)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.inline_highlight)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.inline_color)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.inline_text_color)).assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            Thread.sleep(500)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("inline-colors.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-inline-colors.png").close()
        }
        compose.onAllNodesWithText(app.getString(R.string.color_blue))[0].performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.inline_color)).performScrollTo().performClick()
        compose.onAllNodesWithText(app.getString(R.string.color_red))[1].performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.isNotEmpty() }
        val raw = model.state.value.selected!!.blocks.single().content
        check(worlds.content.InlineEditing.hasMark(raw, 0, 7, "code") && worlds.content.InlineEditing.hasMark(raw, 0, 7, "highlight"))
        val marks = org.json.JSONObject(raw).getJSONArray("content").getJSONObject(0).getJSONArray("marks")
        val style = (0 until marks.length()).map { marks.getJSONObject(it) }.single { it.getString("type") == "textStyle" }.getJSONObject("attrs")
        check(style.getString("color") == "#64a8ff" && style.getString("backgroundColor") == "rgba(255, 111, 111, 0.24)")
        compose.onNodeWithText(app.getString(R.string.edit_text)).performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).assertIsDisplayed()
    }

    @Test fun subpageCanBeCreatedOpenedAndNavigatedBackToParent() {
        val parent = ContentStore(app, database).use { it.create("page", "Parent page") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(parent.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == parent.id }
        compose.onNodeWithText(app.getString(R.string.new_subpage)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Child page")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.title == "Child page" }
        val child = model.state.value.selected!!.resource
        check(child.parentId == parent.id)
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == parent.id && model.state.value.children.any { it.id == child.id } }
        compose.onNodeWithText("Child page").performScrollTo().assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            Thread.sleep(500)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("subpages.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-subpages.png").close()
        }
        compose.onNodeWithText("Child page").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == child.id }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == parent.id }
        ContentStore(app, database).use { store -> check(store.children(parent.id).single().id == child.id) }
    }

    @Test fun movePagePreservesSubpagesAndCanReturnToPersonalRoot() {
        val (source, target, child) = ContentStore(app, database).use { store ->
            val source = store.create("page", "Moving page")
            val child = store.createSubpage(source.id, source.revision, "Nested page")
            val target = store.create("page", "Destination")
            Triple(source, target, child)
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(source.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == source.id }
        pageAction(R.string.move_page)
        compose.waitUntil(20_000) { model.state.value.moveVisible && !model.state.value.moveLoading }
        check(model.state.value.moveDestinations.none { it.resource.id == child.id || it.resource.id == source.id })
        compose.onNodeWithText("Destination").assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            Thread.sleep(500)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("move-page.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-move-page.png").close()
        }
        compose.onNodeWithText("Destination").performScrollTo().performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.resource?.parentId == target.id }
        ContentStore(app, database).use { check(it.load(child.id)!!.resource.parentId == source.id) }
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == target.id }
        compose.onNodeWithText("Moving page").performScrollTo().performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == source.id }
        pageAction(R.string.move_page)
        compose.waitUntil(20_000) { model.state.value.moveVisible && !model.state.value.moveLoading }
        compose.onNodeWithText(app.getString(R.string.move_page_root)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.resource?.parentId == null }
        ContentStore(app, database).use { check(it.load(child.id)!!.resource.parentId == source.id) }
    }

    @Test fun gifAnimatesInPageAndExportsOriginal() {
        if (android.os.Build.VERSION.SDK_INT < 28) return
        val bytes = android.util.Base64.decode("R0lGODlhEAAMAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAHgAAACwAAAAAEAAMAAAIGQABCBxIsKDBgwgTKlzIsKHDhxAjSpwoMCAAIfkEAR4AAQAsAAAAABAADACBAAD/AAAAAAAAAAAACBkAAQgcSLCgwYMIEypcyLChw4cQI0qcKDAgADs=", android.util.Base64.DEFAULT)
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Animated image")
            store.insertImage(created.id, created.revision, "animation.gif", bytes); created
        }
        val destination = app.cacheDir.resolve("animation-${UUID.randomUUID()}.gif")
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
            compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription("animation.gif").assertIsDisplayed(); true }.getOrDefault(false) }
            val image = compose.onNodeWithContentDescription("animation.gif")
            fun color(): Int { val frame = image.captureToImage().asAndroidBitmap(); return frame.getPixel(frame.width / 2, frame.height / 2) }
            val colors = mutableSetOf<Int>()
            repeat(8) { colors.add(color()); Thread.sleep(160) }
            check(colors.size > 1) { "GIF preview did not advance" }
            val block = model.state.value.selected!!.blocks.single()
            compose.runOnIdle {
                checkNotNull(model.beginImageExport(block.id)).also { check(it.mime == "image/gif") }
                model.finishImageExport(Uri.fromFile(destination))
            }
            compose.waitUntil(20_000) { !model.state.value.busy }
            check(model.state.value.imageStatus == R.string.image_export_success && destination.readBytes().contentEquals(bytes))
        } finally { destination.delete() }
    }

    @Test fun galleryImportsReordersAndRemovesWithoutLosingOtherBlocks() {
        val bitmap = android.graphics.Bitmap.createBitmap(30, 20, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(64, 145, 94)) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val gallery = ContentStore(app, database).use { store ->
            val created = store.create("gallery", "Field photos", metadata = """{"gallery":{"view":"grid","future":42},"other":true}""")
            val saved = store.insertImage(created.id, created.revision, "first.png", bytes)
            val doc = store.load(created.id)!!
            store.saveBlocks(created.id, saved.revision, doc.blocks + ContentBlock("future-block", """{"type":"futureNode","attrs":{"value":7}}"""))
            created
        }
        val file = java.io.File(app.cacheDir, "gallery-test.png").apply { writeBytes(bytes) }
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(gallery.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == gallery.id }
            compose.onNodeWithText("Field photos").assertIsDisplayed()
            check(model.beginImageImport())
            model.finishImageImport(Uri.fromFile(file))
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.size == 3 }
            check(model.state.value.selected!!.blocks.count { org.json.JSONObject(it.content).optString("type") == "galleryItem" } == 2)
            val importedName = org.json.JSONObject(model.state.value.selected!!.blocks.last().content).getJSONObject("attrs").getString("name")
            val importedId = model.state.value.selected!!.blocks.last().id
            val exported = java.io.File(app.cacheDir, "gallery-export.png")
            try {
                check(model.beginImageExport(importedId) != null)
                model.finishImageExport(Uri.fromFile(exported))
                compose.waitUntil(20_000) { !model.state.value.busy }
                check(model.state.value.imageStatus == R.string.gallery_export_success && exported.readBytes().contentEquals(bytes))
            } finally { exported.delete() }
            compose.onNodeWithText(app.getString(R.string.gallery_list)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.resource.metadata).getJSONObject("gallery").getString("view") == "list" }
            val metadata = org.json.JSONObject(model.state.value.selected!!.resource.metadata)
            check(metadata.getJSONObject("gallery").getInt("future") == 42 && metadata.getBoolean("other"))
            compose.onNodeWithText(app.getString(R.string.gallery_grid)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.resource.metadata).getJSONObject("gallery").getString("view") == "grid" }
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(400)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-gallery.png").close()
            }
            val options = compose.onAllNodes(androidx.compose.ui.test.hasContentDescription(app.getString(R.string.gallery_item_options)))
            options[1].performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_move_first)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.first().content).getJSONObject("attrs").optString("name") == importedName }
            compose.onAllNodes(androidx.compose.ui.test.hasContentDescription(app.getString(R.string.gallery_item_options)))[0].performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_remove)).performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_remove_confirm, importedName)).assertIsDisplayed()
            compose.onAllNodesWithText(app.getString(R.string.gallery_remove)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.size == 2 }
            val saved = model.state.value.selected!!
            check(saved.blocks.any { it.id == "future-block" } && saved.blocks.any { org.json.JSONObject(it.content).optJSONObject("attrs")?.optString("name") == "first.png" })
            model.back(); model.open(gallery.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == gallery.id }
            check(model.state.value.selected!!.blocks.size == 2)
        } finally { file.delete() }
    }

    @Test fun galleryPlaysAudioAndVideoAndExportsOriginal() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val audio = assets.open("gallery-audio.m4a").use { it.readBytes() }
        val video = assets.open("gallery-video.mp4").use { it.readBytes() }
        val gallery = ContentStore(app, database).use { store ->
            val created = store.create("gallery", "Media gallery", metadata = """{"gallery":{"view":"grid"}}""")
            store.insertGalleryMedia(created.id, created.revision, "sound.m4a", "audio/mp4", audio.inputStream()); created
        }
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, "clip-${UUID.randomUUID().toString().take(6)}.mp4")
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
        }
        val source = checkNotNull(app.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        checkNotNull(app.contentResolver.openOutputStream(source)).use { it.write(video) }
        val exported = java.io.File(app.cacheDir, "gallery-video-export.mp4")
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(gallery.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == gallery.id }
            check(model.beginImageImport()); model.finishImageImport(source)
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.size == 2 }
            val videoId = model.state.value.selected!!.blocks.last().id
            check(model.beginImageExport(videoId)?.mime == "video/mp4"); model.finishImageExport(Uri.fromFile(exported))
            compose.waitUntil(20_000) { !model.state.value.busy }
            check(model.state.value.imageStatus == R.string.gallery_export_success && exported.readBytes().contentEquals(video))
            compose.onNodeWithText(app.getString(R.string.gallery_audio)).performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.gallery_play)).fetchSemanticsNodes().isNotEmpty() && compose.onAllNodes(androidx.compose.ui.test.hasText(app.getString(R.string.gallery_preparing))).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText(app.getString(R.string.gallery_play)).performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_pause)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.close)).performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_video)).performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.gallery_play)).fetchSemanticsNodes().isNotEmpty() && compose.onAllNodesWithText(app.getString(R.string.gallery_preparing)).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText(app.getString(R.string.gallery_play)).performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_pause)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(1500)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-gallery-video.png").close()
            }
            compose.onNodeWithText(app.getString(R.string.close)).performClick()
        } finally {
            app.contentResolver.delete(source, null, null); exported.delete()
            ContentStore(app, database).use { store -> store.load(gallery.id)?.blocks?.forEach { block ->
                val id = org.json.JSONObject(block.content).optJSONObject("attrs")?.optString("attachmentId").orEmpty()
                store.galleryMediaFile(id)?.delete()
            } }
        }
    }

    @Test fun streamCreatesEditsAndLoadsProgressiveHlsAndDashFromLocalServer() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val mp4 = assets.open("gallery-video.mp4").use { it.readBytes() }
        val playlist = assets.open("stream-hls/index.m3u8").use { it.readBytes() }
        val segment = assets.open("stream-hls/segment000.ts").use { it.readBytes() }
        val server = okhttp3.mockwebserver.MockWebServer()
        server.dispatcher = object : okhttp3.mockwebserver.Dispatcher() {
            override fun dispatch(request: okhttp3.mockwebserver.RecordedRequest): okhttp3.mockwebserver.MockResponse {
                val path = request.path.orEmpty().substringBefore('?')
                if (path.startsWith("/dash/")) {
                    val name = path.substringAfterLast('/')
                    val bytes = runCatching { assets.open("stream-dash/$name").use { it.readBytes() } }.getOrNull() ?: return okhttp3.mockwebserver.MockResponse().setResponseCode(404)
                    return okhttp3.mockwebserver.MockResponse().setHeader("Content-Type", if (name.endsWith(".mpd")) "application/dash+xml" else "video/mp4").setBody(okio.Buffer().write(bytes))
                }
                val (contentType, bytes) = when (path) {
                    "/clip.mp4" -> "video/mp4" to mp4
                    "/index.m3u8" -> "application/vnd.apple.mpegurl" to playlist
                    "/segment000.ts" -> "video/mp2t" to segment
                    else -> return okhttp3.mockwebserver.MockResponse().setResponseCode(404)
                }
                return okhttp3.mockwebserver.MockResponse().setHeader("Content-Type", contentType).setBody(okio.Buffer().write(bytes))
            }
        }
        server.start()
        try {
            compose.setContent { WorldsTheme { Home(model) } }
            compose.waitUntil(20_000) { !model.state.value.loading }
            libraryAction(R.string.stream_add)
            compose.onNodeWithText(app.getString(R.string.stream_link)).performTextInput(server.url("/clip.mp4").toString())
            compose.onNodeWithText(app.getString(R.string.stream_name)).performTextInput("Local test stream")
            compose.onNodeWithText(app.getString(R.string.create)).performClick()
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "stream" }
            compose.waitUntil(30_000) { compose.onAllNodesWithText(app.getString(R.string.stream_ready)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(app.getString(R.string.stream_http)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.stream_edit)).performClick()
            compose.onNodeWithText(app.getString(R.string.stream_link)).performTextClearance()
            compose.onNodeWithText(app.getString(R.string.stream_link)).performTextInput(server.url("/index.m3u8").toString())
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && worlds.content.StreamEditing.read(model.state.value.selected!!.resource.metadata)?.format == "hls" }
            compose.waitUntil(30_000) { compose.onAllNodesWithText(app.getString(R.string.stream_ready)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(app.getString(R.string.stream_hls)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(500)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-stream.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            }
            compose.onNodeWithText(app.getString(R.string.stream_edit)).performClick()
            compose.onNodeWithText(app.getString(R.string.stream_link)).performTextClearance()
            compose.onNodeWithText(app.getString(R.string.stream_link)).performTextInput(server.url("/dash/index.mpd").toString())
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && worlds.content.StreamEditing.read(model.state.value.selected!!.resource.metadata)?.format == "dash" }
            compose.waitUntil(30_000) { compose.onAllNodesWithText(app.getString(R.string.stream_ready)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(app.getString(R.string.stream_dash)).assertIsDisplayed()
            val id = model.state.value.selected!!.resource.id
            model.back(); model.open(id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == id }
            check(worlds.content.StreamEditing.read(model.state.value.selected!!.resource.metadata)?.format == "dash")
        } finally { server.shutdown() }
    }

    @Test fun fileLinksToGalleryAndKeepsOriginalThroughRemoval() {
        val bitmap = android.graphics.Bitmap.createBitmap(80, 60, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(70, 125, 165)) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val (file, gallery) = ContentStore(app, database).use { store -> store.importFileResource("linked.png", "image/png", bytes.inputStream()) to store.create("gallery", "Existing gallery") }
        val id = worlds.content.FileAttachment.read(file.metadata)!!.id
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(file.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == file.id }
            compose.waitUntil(20_000) { runCatching { compose.onNodeWithText(app.getString(R.string.file_add_gallery)).assertIsDisplayed(); true }.getOrDefault(false) }
            compose.onNodeWithText(app.getString(R.string.file_add_gallery)).performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithText("Existing gallery").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("Existing gallery").performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.file_gallery_success)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(app.getString(R.string.file_add_gallery)).performClick()
            compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.gallery_new)).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(app.getString(R.string.gallery_new)).performClick()
            compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("New linked gallery")
            compose.onNodeWithText(app.getString(R.string.create)).performClick()
            compose.waitUntil(20_000) { ContentStore(app, database).use { it.list().any { item -> item.title == "New linked gallery" } } }
            compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.file_gallery_success)).fetchSemanticsNodes().isNotEmpty() }
            model.open(gallery.id); compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == gallery.id }
            val linked = model.state.value.selected!!.blocks.single()
            check(org.json.JSONObject(linked.content).getJSONObject("attrs").getString("attachmentId") == id)
            compose.waitUntil(20_000) { compose.onAllNodesWithText("linked.png").fetchSemanticsNodes().isNotEmpty() }
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(500)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-linked-gallery.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            }
            val exported = java.io.File(app.cacheDir, "linked-export.png")
            try { check(model.beginImageExport(linked.id) != null); model.finishImageExport(Uri.fromFile(exported)); compose.waitUntil(20_000) { !model.state.value.busy }; check(exported.readBytes().contentEquals(bytes)) } finally { exported.delete() }
            compose.onNodeWithContentDescription(app.getString(R.string.gallery_item_options)).performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_remove)).performClick()
            compose.onAllNodesWithText(app.getString(R.string.gallery_remove)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.isEmpty() }
            ContentStore(app, database).use { check(it.privateFile(id)!!.readBytes().contentEquals(bytes) && it.load(file.id)!!.resource.deletedAt == null) }
        } finally { ContentStore(app, database).use { it.privateFile(id)?.delete() } }
    }

    @Test fun fileMediaPlaysInItsOwnView() {
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("gallery-video.mp4").use { it.readBytes() }
        val file = ContentStore(app, database).use { it.importFileResource("clip.mp4", "video/mp4", bytes.inputStream()) }
        val id = worlds.content.FileAttachment.read(file.metadata)!!.id
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(file.id)
            compose.waitUntil(20_000) { compose.onAllNodesWithText(app.getString(R.string.gallery_play)).fetchSemanticsNodes().isNotEmpty() && compose.onAllNodesWithText(app.getString(R.string.gallery_preparing)).fetchSemanticsNodes().isEmpty() }
            compose.onNodeWithText(app.getString(R.string.gallery_play)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.gallery_pause)).assertIsDisplayed()
        } finally { ContentStore(app, database).use { it.privateFile(id)?.delete() } }
    }

    @Test fun fileImportInsideProjectExportsOriginalAndUsesReadOnlyIntent() {
        val bitmap = android.graphics.Bitmap.createBitmap(80, 60, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(70, 125, 165)) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val project = ContentStore(app, database).use { it.create("project", "File project", metadata = worlds.content.ProjectEditing.defaultProjectMetadata) }
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, "worlds-file-${UUID.randomUUID().toString().take(6)}.png")
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "image/png")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
        }
        val source = checkNotNull(app.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        checkNotNull(app.contentResolver.openOutputStream(source)).use { it.write(bytes) }
        val exported = java.io.File(app.cacheDir, "file-test-export.png")
        var attachmentId: String? = null
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(project.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == project.id }
            check(model.beginFileImport(model.state.value.selected!!.resource)); model.finishFileImport(source)
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.resource?.kind == "file" }
            val resource = model.state.value.selected!!.resource
            val attachment = checkNotNull(worlds.content.FileAttachment.read(resource.metadata)); attachmentId = attachment.id
            check(resource.parentId == project.id && attachment.mime == "image/png")
            val original = ContentStore(app, database).use { checkNotNull(it.privateFile(attachment.id)) }
            val chooser = fileOpenIntent(app, attachment, original)
            @Suppress("DEPRECATION") val view = chooser.getParcelableExtra<android.content.Intent>(android.content.Intent.EXTRA_INTENT)!!
            check(view.action == android.content.Intent.ACTION_VIEW && view.flags and android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION != 0 && view.flags and android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION == 0)
            check(app.contentResolver.openInputStream(view.data!!)!!.use { it.readBytes() }.contentEquals(bytes))
            val request = checkNotNull(model.beginFileExport()); check(request.mime == "image/png")
            model.finishFileExport(Uri.fromFile(exported)); compose.waitUntil(20_000) { !model.state.value.busy }
            check(model.state.value.fileStatus == R.string.file_export_success && exported.readBytes().contentEquals(bytes))
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(500)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-file.png").close()
            }
            compose.onNodeWithText(app.getString(R.string.file_size)).performScrollTo().assertIsDisplayed()
            model.back(); compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == project.id }
            check(model.state.value.children.any { it.id == resource.id })
        } finally {
            app.contentResolver.delete(source, null, null); exported.delete()
            attachmentId?.let { id -> ContentStore(app, database).use { it.privateFile(id)?.delete() } }
        }
    }

    @Test fun presentationAddsPositionsAndRemovesElementsAndImportsImage() {
        val bitmap = android.graphics.Bitmap.createBitmap(60, 40, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(70, 145, 105)) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val file = java.io.File(app.cacheDir, "slide-image.png").apply { writeBytes(bytes) }
        val deck = ContentStore(app, database).use { it.create("presentation", "Canvas test") }
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(deck.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
            val slideId = model.state.value.selected!!.blocks.single().id
            compose.onNodeWithText(app.getString(R.string.slide_add_element)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.slide_add_ellipse)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").length() == 3 }
            check(model.beginSlideImageImport(slideId)); model.finishImageImport(Uri.fromFile(file))
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").length() == 4 }
            compose.onNodeWithText(app.getString(R.string.slide_elements)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.slide_element_number, 3, app.getString(R.string.slide_add_ellipse))).performClick()
            compose.onNodeWithText(app.getString(R.string.slide_x)).performTextClearance()
            compose.onNodeWithText(app.getString(R.string.slide_x)).performTextInput("100")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2).getInt("x") == 100 }
            compose.onNodeWithText(app.getString(R.string.slide_present)).performScrollTo().performClick()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(800)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-slide-elements.png").close()
            }
            compose.onNodeWithText(app.getString(R.string.slide_exit)).performClick()
            compose.onNodeWithText(app.getString(R.string.slide_elements)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.slide_element_number, 3, app.getString(R.string.slide_add_ellipse))).performClick()
            compose.onNodeWithText(app.getString(R.string.slide_element_remove)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.slide_element_remove_confirm)).assertIsDisplayed()
            compose.onAllNodesWithText(app.getString(R.string.slide_element_remove)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").length() == 3 }
        } finally { file.delete() }
    }

    @Test fun presentationFullscreenNavigatesAndReturnsToSelectedSlide() {
        val deck = ContentStore(app, database).use { it.create("presentation", "Presenter test") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(deck.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        compose.onNodeWithText(app.getString(R.string.slide_add)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.size == 2 }
        compose.onNodeWithText(app.getString(R.string.slide_present)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_count, 1, 2)).assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-presentation-fullscreen.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.slide_next)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_count, 2, 2)).assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_LEFT)
        compose.onNodeWithText(app.getString(R.string.slide_count, 1, 2)).assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_DPAD_RIGHT)
        compose.onNodeWithText(app.getString(R.string.slide_count, 2, 2)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.slide_exit)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_count, 2, 2)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.slide_edit)).assertIsDisplayed()
    }

    @Test fun presentationResizeHandleUpdatesAndPersistsDimensions() {
        val deck = ContentStore(app, database).use { it.create("presentation", "Resize slide") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(deck.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        compose.onNodeWithText(app.getString(R.string.slide_add_element)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.slide_add_rect)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").length() == 3 }
        compose.onNodeWithText(app.getString(R.string.slide_move_mode)).performScrollTo().performClick()
        val canvas = compose.onNodeWithTag("slide_move_canvas").performScrollTo()
        canvas.performTouchInput { down(center); up() }
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(300)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-slide-resize.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        }
        canvas.performTouchInput {
            val start = Offset(center.x * 1.234375f, center.y * 1.41667f)
            down(start); moveTo(Offset(start.x + 100f, start.y + 50f)); up()
        }
        compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2).getInt("w") > 350 }
        val element = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2)
        check(element.getInt("h") > 320 && element.getInt("x") == 490 && element.getInt("y") == 210)
        model.back(); model.open(deck.id); compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        val saved = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2)
        check(saved.getInt("w") == element.getInt("w") && saved.getInt("h") == element.getInt("h"))
    }

    @Test fun presentationMoveModeDragsAndPersistsSlideElement() {
        val deck = ContentStore(app, database).use { it.create("presentation", "Move slide") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(deck.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        compose.onNodeWithText(app.getString(R.string.slide_edit)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_text_number, 1)).performTextInput("Move this title")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.single().content.contains("Move this title") }
        val original = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(0)
        compose.onNodeWithText(app.getString(R.string.slide_move_mode)).performScrollTo().performClick()
        compose.onNodeWithTag("slide_move_canvas").performScrollTo().performTouchInput {
            down(Offset(center.x - 100f, center.y - 20f)); moveTo(Offset(center.x + 100f, center.y - 20f)); up()
        }
        compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(0).getInt("x") > original.getInt("x") + 100 }
        val moved = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(0)
        check(moved.getInt("w") == original.getInt("w") && moved.getInt("h") == original.getInt("h"))
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.onNodeWithTag("slide_move_canvas").performScrollTo()
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-slide-move.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        }
        compose.onNodeWithText(app.getString(R.string.slide_move_done)).performScrollTo().performClick()
        model.back(); model.open(deck.id); compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        check(org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(0).getInt("x") == moved.getInt("x"))
    }

    @Test fun presentationVideoImportsAndCanBePositioned() {
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("gallery-video.mp4").use { it.readBytes() }
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, "worlds-slide-video-${UUID.randomUUID()}.mp4")
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
        }
        val source = checkNotNull(app.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        checkNotNull(app.contentResolver.openOutputStream(source)).use { it.write(bytes) }
        val deck = ContentStore(app, database).use { it.create("presentation", "Video slide") }
        var attachment: String? = null
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(deck.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
            val slideId = model.state.value.selected!!.blocks.single().id
            check(model.beginSlideVideoImport(slideId)); model.finishImageImport(source)
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").length() == 3 }
            val video = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2)
            attachment = video.getString("attachmentId")
            check(video.getString("type") == "video" && ContentStore(app, database).use { it.galleryMediaFile(attachment!!)!!.readBytes().contentEquals(bytes) })
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(1000)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-slide-video.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            }
            compose.onNodeWithText(app.getString(R.string.slide_elements)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.slide_element_number, 3, app.getString(R.string.slide_add_video))).performClick()
            compose.onNodeWithText(app.getString(R.string.slide_x)).performTextClearance(); compose.onNodeWithText(app.getString(R.string.slide_x)).performTextInput("100")
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2).getInt("x") == 100 }
            model.back(); model.open(deck.id); compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
            check(org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2).getString("attachmentId") == attachment)
        } finally { app.contentResolver.delete(source, null, null); attachment?.let { id -> ContentStore(app, database).use { it.galleryMediaFile(id)?.delete() } } }
    }

    @Test fun slideVideoPlaybackReleasesWhenClosed() {
        val bytes = InstrumentationRegistry.getInstrumentation().context.assets.open("gallery-video.mp4").use { it.readBytes() }
        val deck = ContentStore(app, database).use { store -> val d = store.create("presentation", "Playback"); val slide = store.load(d.id)!!.blocks.single(); store.insertGalleryMedia(d.id, d.revision, "clip.mp4", "video/mp4", bytes.inputStream(), slideId = slide.id); d }
        val attachment = ContentStore(app, database).use { org.json.JSONObject(it.load(deck.id)!!.blocks.single().content).getJSONObject("attrs").getJSONArray("elements").getJSONObject(2).getString("attachmentId") }
        var player: androidx.media3.exoplayer.ExoPlayer? = null
        val showing = androidx.compose.runtime.mutableStateOf(true)
        try {
            compose.setContent { WorldsTheme { if (showing.value) SlideVideo(attachment, database, androidx.compose.ui.Modifier, onPlayer = { player = it }) } }
            compose.waitUntil(30_000) { var ready = false; compose.runOnIdle { ready = player?.playbackState == androidx.media3.common.Player.STATE_READY }; ready }
            compose.runOnIdle { check(player?.isPlaying == false); player!!.play() }
            compose.waitUntil(20_000) { var playing = false; compose.runOnIdle { playing = player?.isPlaying == true }; playing }
            compose.runOnIdle { showing.value = false }
            compose.waitUntil(20_000) { player == null }
        } finally { ContentStore(app, database).use { it.galleryMediaFile(attachment)?.delete() } }
    }

    @Test fun presentationBackgroundImageImportsAndRemoves() {
        val bitmap = android.graphics.Bitmap.createBitmap(80, 50, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.rgb(54, 122, 96)) }
        android.graphics.Canvas(bitmap).drawRect(8f, 8f, 72f, 18f, android.graphics.Paint().apply { color = android.graphics.Color.rgb(226, 176, 110) })
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val filename = "worlds-slide-bg-${UUID.randomUUID()}.png"
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename); put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "image/png")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
        }
        val fixture = checkNotNull(app.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        checkNotNull(app.contentResolver.openOutputStream(fixture)).use { it.write(bytes) }
        val deck = ContentStore(app, database).use { it.create("presentation", "Background image") }
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(deck.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
            val slideId = model.state.value.selected!!.blocks.single().id
            check(model.beginSlideImageImport(slideId, background = true)); model.finishImageImport(null)
            check(!org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONObject("background").has("attachmentId"))
            compose.onNodeWithText(app.getString(R.string.slide_background)).performClick()
            compose.onNodeWithText(app.getString(R.string.slide_background_picture)).performScrollTo().performClick()
            val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
            fun findFile(node: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? {
                if (node == null) return null
                if (node.contentDescription?.toString()?.startsWith(filename) == true) return node
                for (i in 0 until node.childCount) findFile(node.getChild(i))?.let { return it }
                return null
            }
            val deadline = System.currentTimeMillis() + 20_000; var clicked = false
            while (System.currentTimeMillis() < deadline && !clicked) {
                val target = findFile(automation.rootInActiveWindow)
                if (target != null) {
                    clicked = target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)
                }
                if (!clicked) Thread.sleep(200)
            }
            check(clicked) { "Background image was not found in system picker" }
            try {
                compose.waitUntil(20_000) { !model.state.value.busy && org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONObject("background").has("attachmentId") }
            } catch (error: Throwable) {
                throw AssertionError("Background import did not finish; status=${model.state.value.imageStatus}, active window=${automation.rootInActiveWindow?.packageName}", error)
            }
            val attachment = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONObject("background").getString("attachmentId")
            check(ContentStore(app, database).use { it.imageBytes(attachment)!!.contentEquals(bytes) })
            compose.waitUntil(20_000) { compose.onAllNodes(androidx.compose.ui.test.hasContentDescription(app.getString(R.string.image_description))).fetchSemanticsNodes().isNotEmpty() }
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(400)
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-slide-background.png").close()
            }
            model.back(); model.open(deck.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
            check(org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONObject("background").getString("attachmentId") == attachment)
            compose.onNodeWithText(app.getString(R.string.slide_background)).performClick()
            compose.onNodeWithText(app.getString(R.string.slide_background_remove_picture)).performScrollTo().performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && !org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").getJSONObject("background").has("attachmentId") }
            check(ContentStore(app, database).use { it.imageBytes(attachment)!!.contentEquals(bytes) })
        } finally { app.contentResolver.delete(fixture, null, null) }
    }

    @Test fun presentationBackgroundAndTextStylePersist() {
        val deck = ContentStore(app, database).use { it.create("presentation", "Formatting") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(deck.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        compose.onNodeWithText(app.getString(R.string.slide_background)).performClick()
        compose.onNodeWithText("#14532d").performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.single().content.contains("#14532d") }
        compose.onNodeWithText(app.getString(R.string.slide_elements)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.slide_element_number, 1, app.getString(R.string.slide_add_text))).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_text_style)).performScrollTo().performClick()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(300)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-slide-format.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.slide_font_size)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.slide_font_size)).performTextInput("48")
        compose.onNodeWithText(app.getString(R.string.italic)).performClick()
        compose.onNodeWithText(app.getString(R.string.image_align_right)).performClick()
        compose.onNodeWithText("#e5484d").performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.single().content.contains("#e5484d") }
        model.back(); model.open(deck.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        val attrs = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs")
        val style = attrs.getJSONArray("elements").getJSONObject(0).getJSONObject("style")
        check(attrs.getJSONObject("background").getString("color") == "#14532d")
        check(style.getInt("fontSize") == 48 && style.getBoolean("italic") && style.getString("align") == "right" && style.getString("color") == "#e5484d")
    }

    @Test fun presentationLayoutMenuPreservesTextAndPersists() {
        val deck = ContentStore(app, database).use { it.create("presentation", "Layouts") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(deck.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        compose.onNodeWithText(app.getString(R.string.slide_edit)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_text_number, 1)).performTextInput("Kept title")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.single().content.contains("Kept title") }
        compose.onNodeWithText(app.getString(R.string.slide_layout)).performClick()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(300)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-slide-layouts.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.slide_layout_columns)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.single().content.contains("two-columns") }
        compose.onNodeWithText("Kept title").assertIsDisplayed()
        model.back(); model.open(deck.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deck.id }
        val attrs = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs")
        check(attrs.getString("layout") == "two-columns" && attrs.getJSONArray("elements").length() == 3)
        check(attrs.getJSONArray("elements").getJSONObject(0).getString("text") == "Kept title")
    }

    @Test fun presentationCreatesEditsPresentsAndManagesSlides() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        libraryAction(R.string.presentation_new)
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Launch plan")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "presentation" }
        compose.onNodeWithText(app.getString(R.string.slide_edit)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_text_number, 1)).performTextInput("Launch plan")
        compose.onNodeWithText(app.getString(R.string.slide_text_number, 2)).performTextInput("The next milestone")
        compose.onNodeWithText(app.getString(R.string.slide_notes)).performScrollTo().performTextInput("Remember the demo")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.first().content.contains("Remember the demo") }
        compose.onNodeWithText(app.getString(R.string.slide_present)).performClick()
        compose.onNodeWithText("The next milestone").assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-presentation.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.slide_exit)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_add)).performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.size == 2 }
        compose.onNodeWithText(app.getString(R.string.slide_next)).performClick()
        compose.onNodeWithText(app.getString(R.string.slide_duplicate)).performScrollTo().performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.size == 3 }
        compose.onNodeWithText(app.getString(R.string.slide_up)).performScrollTo().performClick()
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.first().content.contains("title-body") }
        compose.onNodeWithText(app.getString(R.string.slide_remove)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.slide_remove_confirm)).assertIsDisplayed()
        compose.onAllNodesWithText(app.getString(R.string.slide_remove)).let { it[it.fetchSemanticsNodes().lastIndex].performClick() }
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected!!.blocks.size == 2 }
        val deckId = model.state.value.selected!!.resource.id
        model.back(); model.open(deckId)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == deckId }
        check(model.state.value.selected!!.blocks.any { it.content.contains("Remember the demo") })
    }

    @Test fun galleryCanBeCreatedFromLibrary() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        libraryAction(R.string.gallery_new)
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Trip gallery")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "gallery" }
        compose.onNodeWithText(app.getString(R.string.gallery_empty)).assertIsDisplayed()
        check(org.json.JSONObject(model.state.value.selected!!.resource.metadata).getJSONObject("gallery").getString("view") == "grid")
    }

    @Test fun imageImportUsesSystemDocumentPicker() {
        val filename = "worlds-import-${UUID.randomUUID()}.png"
        val bitmap = android.graphics.Bitmap.createBitmap(20, 20, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.GREEN) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val page = ContentStore(app, database).use { it.create("page", "Picker import") }
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "image/png")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS)
        }
        val fixture = checkNotNull(app.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values))
        checkNotNull(app.contentResolver.openOutputStream(fixture)).use { it.write(bytes) }
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
            insertBlock(R.string.image_insert)
            val deadline = System.currentTimeMillis() + 20_000
            var clicked = false
            fun findFile(node: android.view.accessibility.AccessibilityNodeInfo?): android.view.accessibility.AccessibilityNodeInfo? {
                if (node == null) return null
                if (node.contentDescription?.toString()?.startsWith(filename) == true) return node
                for (i in 0 until node.childCount) findFile(node.getChild(i))?.let { return it }
                return null
            }
            while (System.currentTimeMillis() < deadline && !clicked) {
                val root = automation.rootInActiveWindow
                val target = findFile(root)
                if (target != null) {
                    clicked = target.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)
                }
                if (!clicked) Thread.sleep(200)
            }
            fun describe(node: android.view.accessibility.AccessibilityNodeInfo?, depth: Int = 0): String {
                if (node == null || depth > 30) return ""
                return "${node.text} [${node.contentDescription}] ${node.viewIdResourceName}\n" + (0 until node.childCount).joinToString("") { describe(node.getChild(it), depth + 1) }
            }
            check(clicked) { "Image file was not found in system picker: ${describe(automation.rootInActiveWindow)}" }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.size == 1 }
            val attrs = org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs")
            ContentStore(app, database).use { check(it.imageBytes(attrs.getString("attachmentId"))!!.contentEquals(bytes)) }
        } finally { app.contentResolver.delete(fixture, null, null) }
    }

    @Test fun imageExportUsesSystemDocumentPicker() {
        val filename = "worlds-picker-${UUID.randomUUID()}.png"
        val bitmap = android.graphics.Bitmap.createBitmap(20, 20, android.graphics.Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.RED) }
        val bytes = java.io.ByteArrayOutputStream().also { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }.toByteArray(); bitmap.recycle()
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Picker test")
            store.insertImage(created.id, created.revision, filename, bytes)
            created
        }
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val output = "/sdcard/Download/$filename"
        try {
            compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
            compose.onNodeWithText(app.getString(R.string.block_actions)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.image_export)).performClick()
            val deadline = System.currentTimeMillis() + 20_000
            var clicked = false
            while (System.currentTimeMillis() < deadline && !clicked) {
                val root = automation.rootInActiveWindow
                val button = root?.findAccessibilityNodeInfosByText("Save")?.firstOrNull { it.isClickable && it.isEnabled }
                if (button != null) clicked = button.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK)
                if (!clicked) Thread.sleep(200)
            }
            check(clicked) { "System save button was not found" }
            compose.waitUntil(20_000) { !model.state.value.busy }
            check(model.state.value.imageStatus == R.string.image_export_success)
            val actual = automation.executeShellCommand("cat $output").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
            check(actual.contentEquals(bytes))
        } finally { automation.executeShellCommand("rm -f $output").close() }
    }

    @Test fun selectedImageIsStoredDisplayedAndReopened() {
        val page = ContentStore(app, database).use { it.create("page", "Picture page") }
        val file = app.cacheDir.resolve("page-image-${UUID.randomUUID()}.png")
        val bitmap = android.graphics.Bitmap.createBitmap(320, 200, android.graphics.Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.rgb(52, 92, 122))
        canvas.drawRect(40f, 40f, 280f, 160f, android.graphics.Paint().apply { color = android.graphics.Color.rgb(230, 192, 127) })
        file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; bitmap.recycle()
        try {
            compose.setContent { WorldsTheme { Home(model) } }
            model.open(page.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
            compose.runOnIdle { check(model.beginImageImport()); model.finishImageImport(Uri.fromFile(file)) }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.selected?.blocks?.size == 1 }
            compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription("image").assertIsDisplayed(); true }.getOrDefault(false) }
            val raw = model.state.value.selected!!.blocks.single().content
            val attachment = org.json.JSONObject(raw).getJSONObject("attrs").getString("attachmentId")
            ContentStore(app, database).use { check(it.imageBytes(attachment)!!.contentEquals(file.readBytes())) }
            val blockId = model.state.value.selected!!.blocks.single().id
            val destination = app.cacheDir.resolve("export-${UUID.randomUUID()}.png")
            try {
                compose.runOnIdle {
                    val request = checkNotNull(model.beginImageExport(blockId))
                    check(request.mime == "image/png")
                    model.finishImageExport(null)
                    check(!model.state.value.busy)
                    checkNotNull(model.beginImageExport(blockId))
                    model.finishImageExport(Uri.fromFile(destination))
                }
                compose.waitUntil(20_000) { !model.state.value.busy }
                check(model.state.value.imageStatus == R.string.image_export_success)
                check(destination.readBytes().contentEquals(file.readBytes()))
                compose.runOnIdle { checkNotNull(model.beginImageExport(blockId)); model.finishImageExport(Uri.parse("content://missing.provider/image")) }
                compose.waitUntil(20_000) { !model.state.value.busy }
                check(model.state.value.imageStatus == R.string.image_export_error)
                compose.runOnIdle { checkNotNull(model.beginImageExport(blockId)); model.finishImageExport(null) }
            } finally { destination.delete() }
            compose.onNodeWithText(app.getString(R.string.block_actions)).performClick()
            compose.onNodeWithText(app.getString(R.string.image_export)).assertIsDisplayed()
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                compose.waitForIdle(); Thread.sleep(500)
                val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                val capture = app.getExternalFilesDir(null)!!.resolve("image-actions.png")
                capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; screenshot.recycle()
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-image-actions.png").close()
            }
            compose.onNodeWithText(app.getString(R.string.image_settings)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.image_caption)).performTextInput("A test caption")
            compose.onNodeWithContentDescription(app.getString(R.string.image_width_label)).performSemanticsAction(SemanticsActions.SetProgress) { it(50f) }
            compose.onNodeWithText(app.getString(R.string.image_align_right)).performScrollTo().performClick()
            compose.onNodeWithText(app.getString(R.string.save)).performClick()
            compose.waitUntil(20_000) { !model.state.value.busy && runCatching { org.json.JSONObject(model.state.value.selected!!.blocks.single().content).getJSONObject("attrs").optString("caption") == "A test caption" }.getOrDefault(false) }
            val edited = model.state.value.selected!!.blocks.single().content
            val editedAttrs = org.json.JSONObject(edited).getJSONObject("attrs")
            check(editedAttrs.getInt("display") == 50 && editedAttrs.getString("align") == "right")
            if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
                Thread.sleep(500)
                val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                val capture = app.getExternalFilesDir(null)!!.resolve("page-image.png")
                capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }; screenshot.recycle()
                InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-page-image.png").close()
            }
            compose.onNodeWithText(app.getString(R.string.back)).performClick()
            compose.waitUntil(20_000) { model.state.value.selected == null }
            compose.onNodeWithText("Picture page").performClick()
            compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription("A test caption").assertIsDisplayed(); true }.getOrDefault(false) }
            check(model.state.value.selected!!.blocks.single().content == edited)
        } finally { file.delete() }
    }


    @Test fun importedProjectOpensAndRestoresItsUndoHistory() {
        val sourceName = "source-${UUID.randomUUID()}.db"
        val packageFile = app.cacheDir.resolve("import-${UUID.randomUUID()}.worldsdraw")
        val source = DrawingStore(app, sourceName)
        var importedId: String? = null
        try {
            source.loadOrCreate("original")
            source.addStroke("original", 0, listOf(StrokeSample(20.0, 30.0, 0.7, 0.0, 0.0, 1.0)), StrokeBrush(), false)
            val undone = source.toggle("original", 1, false)
            packageFile.writeBytes(DrawingPackage.encode(undone.toString()))
            compose.setContent { WorldsTheme { Home(model) } }
            compose.waitUntil(20_000) { !model.state.value.loading }
            compose.onNodeWithContentDescription(app.getString(R.string.library_more_actions)).performClick()
            compose.onNodeWithText(app.getString(R.string.drawing_import)).performScrollTo().assertIsDisplayed()
            compose.runOnIdle { model.importDrawing(Uri.fromFile(packageFile)) }
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "drawing" }
            importedId = model.state.value.selected!!.resource.id
            compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
            compose.onNodeWithContentDescription(app.getString(R.string.drawing_redo)).performClick()
            compose.waitUntil(20_000) {
                DrawingStore(app).use { drawing -> runCatching { drawing.loadOrCreate(importedId!!).getInt("revision") == 3 }.getOrDefault(false) }
            }
            ContentStore(app, database).use { assert(it.pendingDrawing(importedId!!) == null) }
        } finally {
            source.close(); app.deleteDatabase(sourceName); packageFile.delete()
            importedId?.let { id -> DrawingStore(app).use { it.writableDatabase.delete("drawings", "id=?", arrayOf(id)) } }
        }
    }

    @Test fun createsFindsAndReopensARealLocalPage() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        compose.onNodeWithText(app.getString(R.string.new_page)).performClick()
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Orchard notes")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        try { compose.waitUntil(20_000) { model.state.value.selected?.resource?.title == "Orchard notes" } }
        catch (e: AssertionError) { throw AssertionError("State after create: ${model.state.value}", e) }
        compose.onNodeWithText("Orchard notes").assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(10_000) { model.state.value.pages.any { it.title == "Orchard notes" } }
        compose.onNodeWithText(app.getString(R.string.search)).performTextInput("Missing phrase")
        compose.waitUntil(10_000) { model.state.value.query == "Missing phrase" && model.state.value.pages.isEmpty() }
        compose.onNodeWithText(app.getString(R.string.no_results)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.search)).performImeAction()
        compose.onNodeWithText(app.getString(R.string.search)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.search)).performTextInput("Orchard")
        compose.waitUntil(10_000) { model.state.value.query == "Orchard" && model.state.value.pages.size == 1 }
        compose.onNodeWithText("Orchard notes").performClick()
        compose.waitUntil(10_000) { model.state.value.selected != null }
        compose.onNodeWithText(app.getString(R.string.insert_block)).assertIsDisplayed()
        ContentStore(app, database).use { check(it.list().single().title == "Orchard notes") }
    }

    @Test fun renameVersionsAndTrashRoundTrip() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        compose.onNodeWithText(app.getString(R.string.new_page)).performClick()
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("First title")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.title == "First title" }
        pageAction(R.string.versions)
        compose.waitUntil(10_000) { model.state.value.versions != null }
        compose.onNodeWithText(app.getString(R.string.save_version)).performClick()
        compose.waitUntil(10_000) { model.state.value.versions?.size == 1 && !model.state.value.busy }
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        pageAction(R.string.rename)
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextClearance()
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Second title")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(10_000) { model.state.value.selected?.resource?.title == "Second title" }
        pageAction(R.string.versions)
        compose.waitUntil(10_000) { model.state.value.versions?.size == 1 }
        compose.onNodeWithText(app.getString(R.string.restore)).performClick()
        compose.waitUntil(10_000) { model.state.value.selected?.resource?.title == "First title" && model.state.value.versions == null }
        pageAction(R.string.move_to_trash)
        compose.waitUntil(10_000) { model.state.value.selected == null && model.state.value.pages.isEmpty() }
        libraryAction(R.string.trash)
        compose.waitUntil(10_000) { model.state.value.trash && model.state.value.pages.size == 1 }
        compose.onNodeWithText("First title").performClick()
        compose.waitUntil(10_000) { model.state.value.selected?.resource?.deletedAt != null }
        compose.onNodeWithText(app.getString(R.string.restore)).performClick()
        compose.waitUntil(10_000) { model.state.value.selected == null && model.state.value.pages.isEmpty() }
        libraryAction(R.string.pages)
        compose.waitUntil(10_000) { !model.state.value.trash && model.state.value.pages.any { it.title == "First title" } }
        ContentStore(app, database).use { check(it.versions(model.state.value.pages.single().id).size == 2) }
    }

    @Test fun previewShowsTextAndWarnsAboutUnsupportedBlocks() {
        val diagram = """{"type":"mermaid","attrs":{"code":"graph TD; A-->B"}}"""
        ContentStore(app, database).use {
            val page = it.create("page", "Formatting test")
            val paragraph = """{"type":"paragraph","content":[{"type":"text","text":"Bold sample","marks":[{"type":"bold"}]}]}"""
            it.saveBlocks(page.id, 0, listOf(ContentBlock("text", paragraph), ContentBlock("diagram", diagram)))
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.refresh()
        compose.waitUntil(20_000) { model.state.value.pages.any { it.title == "Formatting test" } }
        compose.onNodeWithText("Formatting test").performClick()
        compose.waitUntil(10_000) { model.state.value.selected != null }
        compose.onNodeWithText("Bold sample").assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.preview_incomplete)).assertIsDisplayed()
        ContentStore(app, database).use { check(it.load(model.state.value.selected!!.resource.id)!!.blocks[1].content.contains("graph TD")) }
    }

    @Test fun createsAndFormatsParagraphInEditor() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        compose.onNodeWithText(app.getString(R.string.new_page)).performClick()
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Editor test")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected != null }
        insertBlock(R.string.add_paragraph)
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Hello world")
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInputSelection(TextRange(0, 5))
        compose.onNodeWithText(app.getString(R.string.bold)).performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.isNotEmpty() }
        val block = model.state.value.selected!!.blocks.single().content
        check(worlds.content.InlineEditing.text(block) == "Hello world")
        check(worlds.content.InlineEditing.hasMark(block, 0, 5, "bold"))
        ContentStore(app, database).use { check(it.load(model.state.value.selected!!.resource.id)!!.blocks.single().content == block) }
    }

    @Test fun createsAndEditsCodeBlockOnPage() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        compose.onNodeWithText(app.getString(R.string.new_page)).performClick()
        compose.onNodeWithText(app.getString(R.string.page_title)).performTextInput("Code page")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected != null }
        insertBlock(R.string.add_code)
        compose.onNodeWithText(app.getString(R.string.code_language)).performTextInput("kotlin")
        compose.onNodeWithText(app.getString(R.string.code_content)).performTextInput("println(42)")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.isNotEmpty() }
        compose.onNodeWithText("println(42)").assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.edit_text)).performClick()
        compose.onNodeWithText(app.getString(R.string.code_content)).performTextInput("!")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && worlds.content.CodeEditing.read(model.state.value.selected!!.blocks.single().content).text.contains("!") }
        ContentStore(app, database).use {
            val saved = it.load(model.state.value.selected!!.resource.id)!!.blocks.single().content
            check(worlds.content.CodeEditing.read(saved).language == "kotlin")
            check(worlds.content.CodeEditing.read(saved).text.contains("!"))
        }
    }

    @Test fun importedCalloutShowsAndEditsParagraphWithoutLosingOtherChildren() {
        val page = ContentStore(app, database).use {
            val p = it.create("page", "Callout page")
            val node = """{"type":"callout","attrs":{"tone":"note"},"content":[{"type":"paragraph","content":[{"type":"text","text":"Remember this"}]},{"type":"unknown","attrs":{"keep":true}}]}"""
            it.saveBlocks(p.id, 0, listOf(ContentBlock("callout", node))); p
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected != null }
        compose.onNodeWithText("Remember this").assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.preview_incomplete)).assertIsDisplayed()
        compose.onNodeWithContentDescription(app.getString(R.string.edit_container_paragraph, 1)).performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("!")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.resource.revision == 2L }
        ContentStore(app, database).use {
            val block = org.json.JSONObject(it.load(page.id)!!.blocks.single().content)
            check(block.getJSONArray("content").getJSONObject(1).getJSONObject("attrs").getBoolean("keep"))
            check(worlds.content.InlineEditing.text(worlds.content.ContainerEditing.read(block.toString()).paragraphs[0]!!).contains("!"))
        }
    }

    @Test fun importedTableRendersAndEditsCell() {
        val page = ContentStore(app, database).use {
            val p = it.create("page", "Table page")
            val node = """{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Name"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Status"}]}]}]}]}"""
            it.saveBlocks(p.id, 0, listOf(ContentBlock("table", node))); p
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected != null }
        compose.onNodeWithText("Name").assertIsDisplayed()
        compose.onNodeWithContentDescription(app.getString(R.string.edit_table_cell, 1, 1, 1)).performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("!")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.resource.revision == 2L }
        ContentStore(app, database).use {
            val table = worlds.content.TableEditing.read(it.load(page.id)!!.blocks.single().content)
            check(worlds.content.InlineEditing.text(table.rows[0][0]!!.paragraphs.single()!!).contains("!"))
            check(worlds.content.InlineEditing.text(table.rows[0][1]!!.paragraphs.single()!!) == "Status")
        }
    }

    @Test fun tableCellMenuConfirmsDeleteAndPreservesOtherColumn() {
        val page = ContentStore(app, database).use {
            val p = it.create("page", "Table actions")
            val node = """{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"First"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Second"}]}]}]}]}"""
            it.saveBlocks(p.id, 0, listOf(ContentBlock("table", node))); p
        }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected != null }
        compose.onNodeWithContentDescription(app.getString(R.string.table_cell_actions, 1, 1)).performClick()
        compose.onNodeWithText(app.getString(R.string.delete_table_column)).performClick()
        compose.onNodeWithText(app.getString(R.string.delete_table_confirm)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
        check(model.state.value.selected!!.resource.revision == 1L)
        compose.onNodeWithContentDescription(app.getString(R.string.table_cell_actions, 1, 1)).performClick()
        compose.onNodeWithText(app.getString(R.string.delete_table_column)).performClick()
        compose.onNodeWithText(app.getString(R.string.remove)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected!!.resource.revision == 2L }
        ContentStore(app, database).use {
            val table = worlds.content.TableEditing.read(it.load(page.id)!!.blocks.single().content)
            check(table.rows.single().size == 1)
            check(worlds.content.InlineEditing.text(table.rows[0][0]!!.paragraphs.single()!!) == "Second")
        }
    }

    @Test fun staleEditorRetainsDraftAndDoesNotOverwriteNewerPage() {
        val page = ContentStore(app, database).use { it.create("page", "Conflict test") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected != null }
        insertBlock(R.string.add_paragraph)
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Unsaved draft")
        ContentStore(app, database).use { it.rename(page.id, page.revision, "Newer title") }
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editorSaveError }
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithText(app.getString(R.string.editor_error)).assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithText(app.getString(R.string.editor_error)).assertIsDisplayed()
        compose.onNodeWithText("Unsaved draft").assertIsDisplayed()
        ContentStore(app, database).use { check(it.load(page.id)!!.blocks.isEmpty()) }
    }

    @Test fun insertsHeadingAfterBlockAndMovesItWithoutChangingDiagram() {
        val diagram = """{"type":"mermaid","attrs":{"bid":"diagram","code":"graph TD; A-->B"}}"""
        val page = ContentStore(app, database).use {
            val created = it.create("page", "Structure test")
            it.saveBlocks(created.id, 0, listOf(ContentBlock("a", """{"type":"paragraph","attrs":{"bid":"a"},"content":[{"type":"text","text":"First"}]}"""), ContentBlock("diagram", diagram)))
            created
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected != null }
        compose.onAllNodesWithText(app.getString(R.string.block_actions))[0].performClick()
        compose.onNodeWithText(app.getString(R.string.insert_heading_after)).performClick()
        compose.onNodeWithText(app.getString(R.string.heading_level, 2)).performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Middle")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected!!.blocks.size == 3 }
        val inserted = model.state.value.selected!!.blocks
        check(inserted[0].id == "a" && inserted[2].id == "diagram")
        check(org.json.JSONObject(inserted[1].content).getJSONObject("attrs").getInt("level") == 2)
        compose.onAllNodesWithText(app.getString(R.string.block_actions))[1].performScrollTo().performClick()
        compose.onNodeWithText(app.getString(R.string.move_block_down)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected!!.blocks.last().id == inserted[1].id && !model.state.value.busy }
        check(model.state.value.selected!!.blocks[1].content == diagram)
    }

    @Test fun createsEditsAndChecksTaskItems() {
        val page = ContentStore(app, database).use { it.create("page", "Tasks") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        insertBlock(R.string.task_list)
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("First task")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected?.blocks?.size == 1 }
        compose.onNodeWithText("First task").assertIsDisplayed()
        compose.onNodeWithContentDescription(app.getString(R.string.task_item, 1)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 2L && !model.state.value.busy }
        compose.onNodeWithText(app.getString(R.string.add_list_item)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 3L && !model.state.value.busy }
        compose.onAllNodesWithText(app.getString(R.string.edit_text))[1].performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Second task")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.editor == null && model.state.value.selected?.resource?.revision == 4L }
        compose.onNodeWithText("Second task").assertIsDisplayed()
        val list = worlds.content.ListEditing.read(model.state.value.selected!!.blocks.single().content)
        check(list.items.size == 2 && list.items[0].checked == true && list.items[1].checked == false)
        check(worlds.content.InlineEditing.text(list.items[1].paragraph!!) == "Second task")
    }

    @Test fun nestedTaskActionsEditCheckMoveAndRemove() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Nested tasks")
            store.insertList(created.id, "tasks", 0, "taskList", """{"type":"paragraph","content":[{"type":"text","text":"Parent"}]}""")
            created
        }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 1L }
        compose.onNodeWithContentDescription(app.getString(R.string.list_item_actions, "1")).performClick()
        compose.onNodeWithText(app.getString(R.string.list_add_nested)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 2L && !model.state.value.busy }
        compose.onAllNodesWithText(app.getString(R.string.edit_text))[1].performClick()
        compose.onNodeWithText(app.getString(R.string.text_content)).performTextInput("Child")
        compose.onNodeWithText(app.getString(R.string.save)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 3L && model.state.value.editor == null }
        compose.onNodeWithContentDescription(app.getString(R.string.nested_task_item, "1.1")).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 4L && !model.state.value.busy }
        compose.onNodeWithContentDescription(app.getString(R.string.list_item_actions, "1.1")).performClick()
        compose.onNodeWithText(app.getString(R.string.list_insert_after)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 5L && !model.state.value.busy }
        compose.onNodeWithContentDescription(app.getString(R.string.list_item_actions, "1.2")).performClick()
        compose.onNodeWithText(app.getString(R.string.move_list_item_up)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 6L && !model.state.value.busy }
        compose.onNodeWithContentDescription(app.getString(R.string.list_item_actions, "1.1")).performClick()
        compose.onNodeWithText(app.getString(R.string.remove_list_item)).performClick()
        compose.onNodeWithText(app.getString(R.string.remove)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 7L && !model.state.value.busy }
        val list = worlds.content.ListEditing.read(model.state.value.selected!!.blocks.single().content)
        check(list.items.size == 2 && list.items[1].checked == true && worlds.content.InlineEditing.text(list.items[1].paragraph!!) == "Child")
    }

    @Test fun exportsAndCopiesMarkdownFromTheOpenedPage() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Project notes")
            store.saveBlocks(created.id, 0, listOf(ContentBlock("p", """{"type":"paragraph","content":[{"type":"text","text":"Important","marks":[{"type":"bold"}]}]}""")))
            created
        }
        val output = app.cacheDir.resolve("export-${UUID.randomUUID()}.md")
        try {
            compose.setContent { WorldsTheme { Home(model) } }
            model.open(page.id)
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
            pageAction(R.string.markdown_export)
            compose.onNodeWithText(app.getString(R.string.markdown_explanation)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.markdown_copy)).performClick()
            compose.waitUntil(20_000) { model.state.value.markdownStatus == R.string.markdown_copy_success }
            val clipboard = app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            check(clipboard.primaryClip!!.getItemAt(0).text.toString() == "# Project notes\n\n**Important**\n")
            compose.runOnIdle {
                check(model.beginMarkdownExport() == "Project notes.md")
                model.finishMarkdownExport(Uri.fromFile(output))
            }
            compose.waitUntil(20_000) { model.state.value.markdownStatus == R.string.markdown_export_success }
            check(output.readText() == "# Project notes\n\n**Important**\n")
            check(model.state.value.selected!!.resource.revision == 1L)
        } finally { output.delete() }
    }

    @Test fun markdownFilenameDoesNotSplitEmoji() {
        val page = ContentStore(app, database).use { it.create("page", "a".repeat(79) + "😀") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        compose.runOnIdle {
            check(model.beginMarkdownExport() == "a".repeat(79) + ".md")
            model.finishMarkdownExport(null)
        }
    }

    @Test fun sharesCurrentMarkdownThroughChooserAndShowsLaunchFailure() {
        val page = ContentStore(app, database).use { store ->
            val created = store.create("page", "Shared notes")
            store.saveBlocks(created.id, 0, listOf(ContentBlock("p", """{"type":"paragraph","content":[{"type":"text","text":"Important","marks":[{"type":"bold"}]}]}""")))
            created
        }
        var captured: android.content.Intent? = null
        var fail = false
        compose.setContent { WorldsTheme { Home(model, shareLauncher = { if (fail) error("No chooser"); captured = it }) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        pageAction(R.string.markdown_export)
        compose.onNodeWithText(app.getString(R.string.markdown_share)).assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            Thread.sleep(500)
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("markdown-sharing.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-markdown-sharing.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.markdown_share)).performClick()
        compose.waitUntil(20_000) { captured != null && !model.state.value.busy }
        val chooser = captured!!
        @Suppress("DEPRECATION") val send = chooser.getParcelableExtra<android.content.Intent>(android.content.Intent.EXTRA_INTENT)!!
        check(chooser.action == android.content.Intent.ACTION_CHOOSER && send.action == android.content.Intent.ACTION_SEND && send.type == "text/plain")
        check(send.getStringExtra(android.content.Intent.EXTRA_SUBJECT) == "Shared notes")
        check(send.getStringExtra(android.content.Intent.EXTRA_TEXT) == "# Shared notes\n\n**Important**\n")
        check(model.state.value.selected!!.resource.revision == 1L)
        fail = true
        pageAction(R.string.markdown_export)
        compose.onNodeWithText(app.getString(R.string.markdown_share)).performClick()
        compose.waitUntil(20_000) { model.state.value.markdownStatus == R.string.markdown_share_error }
        check(runCatching { markdownShareIntent("Large", "x".repeat(100_001)) }.isFailure)
    }

    @Test fun canceledOrFailedMarkdownExportLeavesPageIntact() {
        val page = ContentStore(app, database).use { it.create("page", "Export check") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        val before = model.state.value.selected!!
        compose.runOnIdle { check(model.beginMarkdownExport() != null); model.finishMarkdownExport(null) }
        compose.waitUntil(20_000) { !model.state.value.busy }
        check(model.state.value.selected == before && model.state.value.markdownStatus == null)
        compose.runOnIdle { check(model.beginMarkdownExport() != null); model.finishMarkdownExport(Uri.fromFile(app.cacheDir)) }
        compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.markdownStatus == R.string.markdown_export_error }
        check(model.state.value.selected == before)
        ContentStore(app, database).use { check(it.load(page.id) == before) }
    }

    @Test fun importsMarkdownAsNewPageAndRestoresOriginalBytes() {
        val input = app.cacheDir.resolve("input-${UUID.randomUUID()}.md")
        val output = app.cacheDir.resolve("original-${UUID.randomUUID()}.md")
        val original = "# Heading\r\n\r\n- [ ] First task\r\n- [x] Second task\r\n".toByteArray()
        input.writeBytes(original)
        try {
            compose.setContent { WorldsTheme { Home(model) } }
            compose.waitUntil(20_000) { !model.state.value.loading }
            libraryAction(R.string.markdown_import)
            compose.onNodeWithText(app.getString(R.string.markdown_import_explanation)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.cancel)).performClick()
            compose.runOnIdle { model.importMarkdown(Uri.fromFile(input)) }
            compose.waitUntil(20_000) { model.state.value.selected?.markdownSourceName != null }
            compose.onNodeWithText("Heading").assertIsDisplayed()
            compose.onNodeWithText("First task").assertIsDisplayed()
            compose.onNodeWithContentDescription(app.getString(R.string.task_item, 1)).performClick()
            compose.waitUntil(20_000) { model.state.value.selected?.resource?.revision == 2L && !model.state.value.busy }
            pageAction(R.string.markdown_export)
            compose.onNodeWithText(app.getString(R.string.markdown_save_original)).assertIsDisplayed()
            compose.onNodeWithText(app.getString(R.string.markdown_copy)).performClick()
            compose.waitUntil(20_000) { model.state.value.markdownStatus == R.string.markdown_copy_success }
            compose.runOnIdle { check(model.beginMarkdownExport(original = true) != null); model.finishMarkdownExport(Uri.fromFile(output)) }
            compose.waitUntil(20_000) { model.state.value.markdownStatus == R.string.markdown_export_success }
            check(output.readBytes().contentEquals(original))
            check(model.state.value.selected!!.resource.revision == 2L)
        } finally { input.delete(); output.delete() }
    }

    @Test fun invalidUtf8DoesNotCreatePage() {
        val input = app.cacheDir.resolve("invalid-${UUID.randomUUID()}.md")
        input.writeBytes(byteArrayOf(0xC3.toByte(), 0x28))
        try {
            compose.setContent { WorldsTheme { Home(model) } }
            compose.waitUntil(20_000) { !model.state.value.loading }
            compose.runOnIdle { model.importMarkdown(Uri.fromFile(input)) }
            compose.waitUntil(20_000) { !model.state.value.busy && model.state.value.importError == R.string.markdown_import_error }
            ContentStore(app, database).use { check(it.list().isEmpty()) }
        } finally { input.delete() }
    }

    @Test fun drawsAndRestoresInkOnRealCanvas() {
        compose.setContent { WorldsTheme { Home(model) } }
        compose.waitUntil(20_000) { !model.state.value.loading }
        libraryAction(R.string.new_drawing)
        compose.onNodeWithText(app.getString(R.string.drawing_title)).performTextInput("Ink test")
        compose.onNodeWithText(app.getString(R.string.create)).performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.kind == "drawing" }
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        val id = model.state.value.selected!!.resource.id
        drawingControl(R.string.drawing_settings)
        compose.onNodeWithText(app.getString(R.string.drawing_blue)).performClick()
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_pen_width_label)).performScrollTo().performSemanticsAction(SemanticsActions.SetProgress) { it(40f) }
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).performTouchInput {
            down(Offset(center.x - 80f, center.y)); moveTo(Offset(center.x + 80f, center.y)); up()
        }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 1 } }
        DrawingStore(app).use {
            val scene = it.loadOrCreate(id).getJSONObject("scene")
            val brush = scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0)).getJSONObject("brush")
            check(brush.getString("color") == "#245b93" && brush.getDouble("size") == 40.0)
        }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_undo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 0 } }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_redo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 1 } }
        drawingControl(R.string.drawing_eraser)
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).performTouchInput {
            down(Offset(center.x, center.y - 30f)); moveTo(Offset(center.x, center.y + 30f)); up()
        }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 2 } }
        DrawingStore(app).use {
            val scene = it.loadOrCreate(id).getJSONObject("scene")
            check(scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(1)).getBoolean("erase"))
        }
        val frame = compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).captureToImage().asAndroidBitmap()
        val middle = frame.getPixel(frame.width / 2, frame.height / 2)
        val stroke = frame.getPixel(frame.width / 2 - 40, frame.height / 2)
        check(android.graphics.Color.red(middle) > 240 && android.graphics.Color.green(middle) > 240 && android.graphics.Color.blue(middle) > 240)
        check(android.graphics.Color.blue(stroke) > android.graphics.Color.red(stroke) * 2)
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-drawing-cached-eraser.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.drawing_export)).performClick()
        compose.onNodeWithText(app.getString(R.string.drawing_export_png)).assertIsDisplayed()
        compose.onNodeWithText(app.getString(R.string.drawing_export_project)).assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(android.view.KeyEvent.KEYCODE_BACK)
        compose.onNodeWithText(app.getString(R.string.back)).performClick()
        compose.waitUntil(10_000) { model.state.value.selected == null }
        compose.onNodeWithText("Ink test").performClick()
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == id }
        DrawingStore(app).use { check(it.loadOrCreate(id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 2) }
    }

    @Test fun multiSelectionMovesAndRemovesAsOneUndoableOperation() {
        val page = ContentStore(app, database).use { it.create("drawing", "Group selection") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        val canvas = compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas))
        canvas.performTouchInput { down(Offset(center.x - 80f, center.y - 45f)); moveTo(Offset(center.x + 80f, center.y - 45f)); up() }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 1 } }
        canvas.performTouchInput { down(Offset(center.x - 80f, center.y + 45f)); moveTo(Offset(center.x + 80f, center.y + 45f)); up() }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 2 } }
        val before = DrawingStore(app).use { it.loadOrCreate(page.id).getJSONObject("scene").toString() }
        drawingControl(R.string.drawing_select)
        compose.onNodeWithText(app.getString(R.string.drawing_multi_select)).performClick()
        canvas.performTouchInput { down(Offset(center.x, center.y - 45f)); up() }
        canvas.performTouchInput { down(Offset(center.x, center.y + 45f)); up() }
        compose.onNodeWithText(app.getString(R.string.drawing_clear_selection, 2)).assertIsDisplayed()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-drawing-multiselect.png").use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() }
        }
        canvas.performTouchInput { down(Offset(center.x, center.y - 45f)); moveTo(Offset(center.x + 60f, center.y - 15f)); up() }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 3 } }
        val moved = DrawingStore(app).use { it.loadOrCreate(page.id) }
        val original = org.json.JSONObject(before); val nodes = original.getJSONObject("nodes"); val order = original.getJSONArray("nodeOrder")
        repeat(2) { i -> val id = order.getString(i); check(moved.getJSONObject("scene").getJSONObject("nodes").getJSONObject(id).getDouble("x") > nodes.getJSONObject(id).getDouble("x")) }
        compose.onNodeWithText(app.getString(R.string.drawing_remove_strokes)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 4 && it.loadOrCreate(page.id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 0 } }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_undo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 5 && it.loadOrCreate(page.id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 2 } }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_undo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 6 } }
        check(DrawingStore(app).use { DrawingPackage.equalJson(original, it.loadOrCreate(page.id).getJSONObject("scene")) })
    }

    @Test fun selectsAndMovesStrokeOnCanvas() {
        val page = ContentStore(app, database).use { it.create("drawing", "Selection test") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        val canvas = compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas))
        canvas.performTouchInput { down(Offset(center.x - 80f, center.y)); moveTo(Offset(center.x + 80f, center.y)); up() }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 1 } }
        val before = DrawingStore(app).use { val scene = it.loadOrCreate(page.id).getJSONObject("scene"); scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0)).getDouble("x") }
        drawingControl(R.string.drawing_select)
        canvas.performTouchInput { down(center); moveTo(Offset(center.x + 60f, center.y + 30f)); up() }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 2 } }
        DrawingStore(app).use { val scene = it.loadOrCreate(page.id).getJSONObject("scene"); check(scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0)).getDouble("x") > before) }
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-stroke-selection.png").close()
        }
        compose.onNodeWithText(app.getString(R.string.drawing_remove_stroke)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 3 && it.loadOrCreate(page.id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 0 } }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_undo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 4 && it.loadOrCreate(page.id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 1 } }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_undo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 5 } }
        DrawingStore(app).use { val scene = it.loadOrCreate(page.id).getJSONObject("scene"); check(scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0)).getDouble("x") == before) }
    }

    @Test fun pencilToolDrawsAndPersistsFromCanvas() {
        val page = ContentStore(app, database).use { it.create("drawing", "Pencil test") }
        compose.setContent { WorldsTheme { Home(model) } }; model.open(page.id)
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        drawingControl(R.string.drawing_pencil)
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).performTouchInput {
            down(Offset(center.x - 90f, center.y)); moveTo(Offset(center.x, center.y - 35f)); moveTo(Offset(center.x + 90f, center.y)); up()
        }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 1 } }
        DrawingStore(app).use {
            val scene = it.loadOrCreate(page.id).getJSONObject("scene")
            val brush = scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0)).getJSONObject("brush")
            check(brush.getString("kind") == "natural-pencil" && brush.getBoolean("pressureOpacity"))
        }
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            compose.waitForIdle(); Thread.sleep(400)
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p /sdcard/Download/worlds-pencil.png").close()
        }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_undo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 0 } }
    }

    @Test fun highlighterToolCreatesEditableYellowStroke() {
        val page = ContentStore(app, database).use { it.create("drawing", "Highlight") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        drawingControl(R.string.drawing_highlighter)
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).performTouchInput {
            down(Offset(center.x - 80f, center.y)); moveTo(Offset(center.x + 80f, center.y)); up()
        }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 1 } }
        DrawingStore(app).use {
            val scene = it.loadOrCreate(page.id).getJSONObject("scene")
            val brush = scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0)).getJSONObject("brush")
            check(brush.getString("kind") == "highlighter" && brush.getDouble("opacity") == 0.35 && brush.getString("color") == "#e6c235")
        }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_undo)).performClick()
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 2 } }
        DrawingStore(app).use { it.writableDatabase.delete("drawings", "id=?", arrayOf(page.id)) }
    }

    @Test fun drawingSettingsToggleSurvivesDialogReopen() {
        val page = ContentStore(app, database).use { it.create("drawing", "Sketch") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        drawingControl(R.string.drawing_settings)
        val toggle = compose.onNodeWithContentDescription(app.getString(R.string.drawing_barrel_eraser))
        toggle.performScrollTo().assertIsOff().performClick().assertIsOn()
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        drawingControl(R.string.drawing_settings)
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_barrel_eraser)).performScrollTo().assertIsOn()
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        compose.waitForIdle()
        if (InstrumentationRegistry.getArguments().getString("captureWorldsUi") == "true") {
            Thread.sleep(500) // Let the system dialog's window exit animation finish before capture.
            val screenshot = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val capture = app.getExternalFilesDir(null)!!.resolve("drawing-toolbar.png")
            capture.outputStream().use { screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
            InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cp ${capture.absolutePath} /sdcard/Download/worlds-drawing-toolbar.png").close()
        }
        DrawingStore(app).use { it.writableDatabase.delete("drawings", "id=?", arrayOf(page.id)) }
    }

    @Test fun drawingKeyboardShortcutsEditHistoryAndRespectSettingsDialog() {
        val page = ContentStore(app, database).use { it.create("drawing", "Keyboard sketch") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        fun key(code: Int, meta: Int = 0) {
            val instrumentation = InstrumentationRegistry.getInstrumentation()
            val now = android.os.SystemClock.uptimeMillis()
            instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_DOWN, code, 0, meta))
            instrumentation.sendKeySync(android.view.KeyEvent(now, now, android.view.KeyEvent.ACTION_UP, code, 0, meta))
            compose.waitForIdle()
        }
        key(android.view.KeyEvent.KEYCODE_H)
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).performTouchInput { down(center); moveTo(Offset(center.x + 80f, center.y)); up() }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 1 } }
        DrawingStore(app).use {
            val scene = it.loadOrCreate(page.id).getJSONObject("scene")
            check(scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0)).getJSONObject("brush").getString("kind") == "highlighter")
        }
        key(android.view.KeyEvent.KEYCODE_Z, android.view.KeyEvent.META_CTRL_ON)
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 2 } }
        key(android.view.KeyEvent.KEYCODE_Y, android.view.KeyEvent.META_CTRL_ON)
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getInt("revision") == 3 } }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_zoom_in)).performClick()
        compose.onNodeWithText(app.getString(R.string.drawing_zoom_value, 125)).assertIsDisplayed()
        key(android.view.KeyEvent.KEYCODE_0, android.view.KeyEvent.META_CTRL_ON)
        compose.onNodeWithText(app.getString(R.string.drawing_zoom_value, 100)).assertIsDisplayed()
        drawingControl(R.string.drawing_settings)
        key(android.view.KeyEvent.KEYCODE_E)
        compose.onNodeWithText(app.getString(R.string.close)).performClick()
        val highlighter = app.getString(R.string.drawing_highlighter)
        if (compose.onAllNodes(androidx.compose.ui.test.hasContentDescription(highlighter)).fetchSemanticsNodes().isNotEmpty())
            compose.onNodeWithContentDescription(highlighter).assertIsDisplayed()
        else compose.onNodeWithText(highlighter).assertIsDisplayed()
        DrawingStore(app).use { it.writableDatabase.delete("drawings", "id=?", arrayOf(page.id)) }
    }

    @Test fun keyboardHelperPublishesImplementedDrawingKeys() {
        val items = drawingKeyboardShortcutGroup(app).items
        fun has(code: Int, modifiers: Int) = items.any { it.keycode == code && it.modifiers == modifiers }
        val ctrl = android.view.KeyEvent.META_CTRL_ON
        check(items.size == 8 && has(android.view.KeyEvent.KEYCODE_B, 0) && has(android.view.KeyEvent.KEYCODE_P, 0) && has(android.view.KeyEvent.KEYCODE_H, 0) && has(android.view.KeyEvent.KEYCODE_E, 0))
        check(has(android.view.KeyEvent.KEYCODE_Z, ctrl) && has(android.view.KeyEvent.KEYCODE_Z, ctrl or android.view.KeyEvent.META_SHIFT_ON))
        check(has(android.view.KeyEvent.KEYCODE_Y, ctrl) && has(android.view.KeyEvent.KEYCODE_0, ctrl))
    }

    @Test fun pinchAndPanChangeViewportWithoutCreatingInk() {
        val page = ContentStore(app, database).use { it.create("drawing", "Zoom test") }
        compose.setContent { WorldsTheme { Home(model) } }
        model.open(page.id)
        compose.waitUntil(20_000) { model.state.value.selected?.resource?.id == page.id }
        compose.waitUntil(20_000) { runCatching { compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).assertIsDisplayed(); true }.getOrDefault(false) }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).performTouchInput {
            down(0, Offset(center.x - 100f, center.y))
            down(1, Offset(center.x + 100f, center.y))
            moveTo(0, Offset(center.x - 150f, center.y))
            moveTo(1, Offset(center.x + 250f, center.y))
            up(1); up(0)
        }
        compose.onNodeWithText(app.getString(R.string.drawing_zoom_value, 200)).assertIsDisplayed()
        DrawingStore(app).use { check(it.loadOrCreate(page.id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 0) }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).performTouchInput { down(center); up() }
        compose.waitUntil(20_000) { DrawingStore(app).use { it.loadOrCreate(page.id).getJSONObject("scene").getJSONArray("nodeOrder").length() == 1 } }
        val size = compose.onNodeWithContentDescription(app.getString(R.string.drawing_canvas)).fetchSemanticsNode().size
        val fit = minOf(size.width / 1280.0, size.height / 720.0)
        DrawingStore(app).use {
            val scene = it.loadOrCreate(page.id).getJSONObject("scene")
            val node = scene.getJSONObject("nodes").getJSONObject(scene.getJSONArray("nodeOrder").getString(0))
            val x = node.getDouble("x") + node.getJSONArray("samples").getJSONObject(0).getDouble("x")
            check(kotlin.math.abs(x - (640.0 - 50.0 / (fit * 2))) < 2.0) { "Unexpected zoomed stroke coordinate: $x" }
        }
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_fit)).performClick()
        compose.onNodeWithText(app.getString(R.string.drawing_zoom_value, 100)).assertIsDisplayed()
        compose.onNodeWithContentDescription(app.getString(R.string.drawing_zoom_in)).performClick()
        compose.onNodeWithText(app.getString(R.string.drawing_zoom_value, 125)).assertIsDisplayed()
    }
}
