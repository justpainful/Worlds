import Foundation
import XCTest
import WorldsModels
@testable import WorldsAI

/// RustStore's rules for the calls the tools use, in memory: revisions, page
/// kinds and the current blocks must match, block nodes carry their own id,
/// Trash hides pages, versions keep title and blocks, and restoring a version
/// first keeps the current state as a version.
actor MemoryWorkspace: AIWorkspace {
    private struct Snapshot {
        let pageID: String
        let title: String
        let blocks: [AIWorkspaceBlock]
    }

    private var pages: [AIWorkspaceDocument] = []
    private var trashed: Set<String> = []
    private var snapshots: [String: Snapshot] = [:]
    private var clock: Int64 = 1_700_000_000_000
    private var next = 0
    private var staleReads = false

    @discardableResult
    func add(_ title: String, kind: String = "page", parentID: String? = nil, markdown: String = "") throws -> AIWorkspacePage {
        next += 1
        clock += 1
        let id = "page\(next)"
        var blocks: [AIWorkspaceBlock] = []
        for node in try AIMarkdownImport.parse(markdown) {
            next += 1
            let bid = "block\(next)"
            blocks.append(AIWorkspaceBlock(id: bid, content: AIToolRunner.withBlockID(node, bid)))
        }
        let page = AIWorkspacePage(id: id, title: title, kind: kind, parentID: parentID, revision: clock)
        pages.append(AIWorkspaceDocument(page: page, blocks: blocks))
        return page
    }

    /// Someone else saved after every read from now on.
    func setStaleReads(_ value: Bool) { staleReads = value }

    func page(_ id: String) -> AIWorkspacePage? { pages.first { $0.page.id == id }?.page }
    func isTrashed(_ id: String) -> Bool { trashed.contains(id) }
    func blocks(_ id: String) -> [AIWorkspaceBlock] { pages.first { $0.page.id == id }?.blocks ?? [] }
    func versionCount(_ id: String) -> Int { snapshots.values.filter { $0.pageID == id }.count }
    func markdown(_ id: String) -> String { blocks(id).map { AIMarkdownExport.block($0.content) }.joined(separator: "\n\n") }

    /// An edit made outside the assistant.
    func setBlocks(_ id: String, _ blocks: [AIWorkspaceBlock]) {
        guard let index = pages.firstIndex(where: { $0.page.id == id }) else { return }
        pages[index].blocks = blocks
        bump(index)
    }

    private func bump(_ index: Int) {
        clock += 1
        pages[index].page.revision = clock
    }

    private func live(_ id: String, _ expectedRevision: Int64) throws -> Int {
        guard let index = pages.firstIndex(where: { $0.page.id == id }), !trashed.contains(id) else { throw AIWorkspaceError.notFound }
        if pages[index].page.revision != expectedRevision { throw AIWorkspaceError.conflict }
        return index
    }

    func documents() async throws -> [AIWorkspaceDocument] {
        pages.filter { !trashed.contains($0.page.id) }.map { doc in
            var copy = doc
            if staleReads { copy.page.revision -= 1 }
            return copy
        }
    }

    func createPage(title: String, parentID: String?, operationID: UUID) async throws -> AIWorkspacePage {
        if let parentID, pages.first(where: { $0.page.id == parentID }) == nil || trashed.contains(parentID) {
            throw AIWorkspaceError.refused("parent unavailable")
        }
        return try add(title, parentID: parentID)
    }

    func saveBlocks(pageID: String, kind: String, expectedRevision: Int64, expected: [AIWorkspaceBlock], blocks: [AIWorkspaceBlock]) async throws -> Int64 {
        let index = try live(pageID, expectedRevision)
        guard pages[index].page.kind == kind else { throw AIWorkspaceError.conflict }
        guard ["page", "document"].contains(kind) else { throw AIWorkspaceError.refused("only page and document blocks are supported") }
        guard pages[index].blocks == expected else { throw AIWorkspaceError.conflict }
        guard Set(blocks.map(\.id)).count == blocks.count else { throw AIWorkspaceError.refused("invalid block ID") }
        for block in blocks where block.content.aiObject?["attrs"]?.aiObject?["bid"] != .string(block.id) {
            throw AIWorkspaceError.refused("invalid block identity")
        }
        pages[index].blocks = blocks
        bump(index)
        return pages[index].page.revision
    }

    func rename(pageID: String, expectedRevision: Int64, expectedTitle: String, title: String, operationID: UUID) async throws -> AIWorkspacePage {
        let index = try live(pageID, expectedRevision)
        guard pages[index].page.title == expectedTitle else { throw AIWorkspaceError.conflict }
        pages[index].page.title = title
        bump(index)
        return pages[index].page
    }

    func createVersion(pageID: String, expectedRevision: Int64, label: String) async throws -> String {
        let index = try live(pageID, expectedRevision)
        guard ["page", "document"].contains(pages[index].page.kind) else { throw AIWorkspaceError.refused("only page and document versions are supported") }
        next += 1
        let id = "v\(next)"
        snapshots[id] = Snapshot(pageID: pageID, title: pages[index].page.title, blocks: pages[index].blocks)
        return id
    }

    func restoreVersion(pageID: String, versionID: String, expectedRevision: Int64) async throws {
        let index = try live(pageID, expectedRevision)
        guard let snapshot = snapshots[versionID], snapshot.pageID == pageID else { throw AIWorkspaceError.refused("version unavailable") }
        next += 1
        snapshots["v\(next)"] = Snapshot(pageID: pageID, title: pages[index].page.title, blocks: pages[index].blocks)
        pages[index].blocks = snapshot.blocks
        pages[index].page.title = snapshot.title
        bump(index)
    }

    func trash(pageID: String, expectedRevision: Int64) async throws {
        _ = try live(pageID, expectedRevision)
        var subtree = [pageID]
        var cursor = 0
        while cursor < subtree.count {
            let parent = subtree[cursor]
            subtree.append(contentsOf: pages.filter { $0.page.parentID == parent }.map(\.page.id))
            cursor += 1
        }
        // Like RustStore, a subtree with a page already in Trash is refused.
        if subtree.contains(where: { trashed.contains($0) }) { throw AIWorkspaceError.refused("page is shared, deleted, or unavailable") }
        trashed.formUnion(subtree)
    }
}

private func parsed(_ output: String) throws -> JSONValue {
    try XCTUnwrap(JSONValue.aiParse(output), output)
}

final class AIWorkspaceToolsTests: XCTestCase {
    private func ok(_ result: AIToolResult, file: StaticString = #filePath, line: UInt = #line) throws -> JSONValue {
        XCTAssertFalse(result.isError, result.output, file: file, line: line)
        return try parsed(result.output)
    }

    @discardableResult
    private func failed(_ result: AIToolResult, file: StaticString = #filePath, line: UInt = #line) -> String {
        XCTAssertTrue(result.isError, result.output, file: file, line: line)
        XCTAssertTrue(result.output.hasPrefix("Error: "), result.output, file: file, line: line)
        return result.output
    }

    func testToolsMatchTheDesktopNamesAndShapes() throws {
        XCTAssertEqual(AITools.names, ["workspace_overview", "pages_list", "pages_search", "pages_read", "pages_create",
                                       "pages_append_markdown", "blocks_update", "pages_rename", "tasks_add", "tasks_list"])
        func required(_ name: String) -> [String] {
            let tool = AITools.all.first { $0.name == name }
            return (tool?.schema.aiObject?["required"]?.aiArray ?? []).compactMap(\.aiString)
        }
        XCTAssertEqual(required("pages_read"), ["pageId"])
        XCTAssertEqual(required("pages_create"), ["title"])
        XCTAssertEqual(required("pages_append_markdown"), ["pageId", "markdown"])
        XCTAssertEqual(required("blocks_update"), ["blockId", "markdown"])
        XCTAssertEqual(required("pages_rename"), ["pageId", "title"])
        XCTAssertEqual(required("tasks_add"), ["pageId", "items"])
        XCTAssertEqual(required("pages_search"), ["query"])
        XCTAssertEqual(required("tasks_list"), [])
        let properties = AITools.all.first { $0.name == "tasks_list" }?.schema.aiObject?["properties"]?.aiObject
        XCTAssertEqual(properties?["status"]?.aiObject?["enum"]?.aiArray?.count, 3)
        let items = AITools.all.first { $0.name == "tasks_add" }?.schema.aiObject?["properties"]?.aiObject?["items"]
        XCTAssertEqual(items?.aiObject?["type"]?.aiString, "array")
        for tool in AITools.all { XCTAssertEqual(tool.schema.aiObject?["type"]?.aiString, "object", tool.name) }
    }

    func testOverviewListsCountsRecentPagesAndTheTime() async throws {
        let ws = MemoryWorkspace()
        try await ws.add("Plan")
        try await ws.add("Budget", kind: "spreadsheet")
        let template = try await ws.add("Meeting notes", kind: "template")
        try await ws.add("Inside the template", parentID: template.id)
        let runner = AIToolRunner(workspace: ws, timeZone: TimeZone(identifier: "UTC")!, now: { Date(timeIntervalSince1970: 0) })
        let out = try ok(await runner.call("workspace_overview", [:]))
        XCTAssertEqual(out.aiObject?["now"]?.aiObject?["local"]?.aiString, "1970-01-01T00:00:00")
        XCTAssertEqual(out.aiObject?["now"]?.aiObject?["weekday"]?.aiString, "Thursday")
        XCTAssertEqual(out.aiObject?["counts"]?.aiObject?["pages"]?.aiInt, 2)
        XCTAssertEqual(out.aiObject?["counts"]?.aiObject?["byKind"]?.aiObject?["spreadsheet"]?.aiInt, 1)
        XCTAssertEqual(out.aiObject?["recent"]?.aiArray?.first?.aiObject?["title"]?.aiString, "Budget")
        XCTAssertNil(out.aiObject?["readOnly"])
    }

    func testListShowsTheTreeAndHidesTemplatesAndTrash() async throws {
        let ws = MemoryWorkspace()
        let parent = try await ws.add("Projects")
        let child = try await ws.add("Worlds", parentID: parent.id)
        let old = try await ws.add("Old")
        try await ws.trash(pageID: old.id, expectedRevision: old.revision)
        try await ws.add("Template", kind: "template")
        let runner = AIToolRunner(workspace: ws)
        let all = try ok(await runner.call("pages_list", [:])).aiArray ?? []
        XCTAssertEqual(all.compactMap { $0.aiObject?["title"]?.aiString }, ["Projects", "Worlds"])
        XCTAssertEqual(all.last?.aiObject?["depth"]?.aiInt, 1)
        let branch = try ok(await runner.call("pages_list", ["parentId": .string(parent.id)])).aiArray ?? []
        XCTAssertEqual(branch.first?.aiObject?["id"]?.aiString, child.id)
        failed(await runner.call("pages_list", ["parentId": .string("missing")]))
    }

    func testSearchReturnsSnippetsAroundTheMatch() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("Trip", markdown: "Pack the passport and the charger\n\nBook the hotel")
        try await ws.add("Other", markdown: "Nothing here")
        let runner = AIToolRunner(workspace: ws)
        let hits = try ok(await runner.call("pages_search", ["query": .string("HOTEL")])).aiArray ?? []
        XCTAssertEqual(hits.count, 1)
        XCTAssertEqual(hits.first?.aiObject?["pageId"]?.aiString, page.id)
        XCTAssertEqual(hits.first?.aiObject?["snippet"]?.aiString, "Book the «hotel»")
        failed(await runner.call("pages_search", [:]))
    }

    func testReadShowsBlocksSubpagesAndPath() async throws {
        let ws = MemoryWorkspace()
        let root = try await ws.add("Home")
        let page = try await ws.add("Plan", parentID: root.id, markdown: "# Goals\n\n- [ ] Ship\n\nنص عربي")
        try await ws.add("Notes", parentID: page.id)
        let runner = AIToolRunner(workspace: ws)
        let out = try ok(await runner.call("pages_read", ["pageId": .string(page.id)])).aiObject ?? [:]
        XCTAssertEqual(out["title"]?.aiString, "Plan")
        XCTAssertEqual(out["editable"], .bool(true))
        XCTAssertEqual(out["path"]?.aiArray?.first?.aiString, "Home")
        let blocks = out["blocks"]?.aiArray ?? []
        XCTAssertEqual(blocks.compactMap { $0.aiObject?["type"]?.aiString }, ["heading", "taskList", "paragraph"])
        XCTAssertEqual(blocks.first?.aiObject?["markdown"]?.aiString, "# Goals")
        XCTAssertEqual(blocks.last?.aiObject?["markdown"]?.aiString, "نص عربي")
        XCTAssertEqual(out["subpages"]?.aiArray?.first?.aiObject?["title"]?.aiString, "Notes")
        let message1 = failed(await runner.call("pages_read", ["pageId": .string("nope")]))
        XCTAssertTrue(message1.contains("page not found"), message1)
        failed(await runner.call("pages_read", [:]))
    }

    func testCreatedPagesAreUndoneByMovingThemToTrash() async throws {
        let ws = MemoryWorkspace()
        let parent = try await ws.add("Projects")
        let runner = AIToolRunner(workspace: ws)
        let created = try ok(await runner.call("pages_create", [
            "title": .string("Launch"), "parentId": .string(parent.id), "markdown": .string("# Launch\n\nFirst step"),
        ]))
        let id = try XCTUnwrap(created.aiObject?["pageId"]?.aiString)
        let inside = try ok(await runner.call("pages_create", ["title": .string("Inside"), "parentId": .string(id)]))
        let insideID = try XCTUnwrap(inside.aiObject?["pageId"]?.aiString)
        let launch = await ws.page(id)
        XCTAssertEqual(launch?.parentID, parent.id)
        let launchMarkdown = await ws.markdown(id)
        XCTAssertEqual(launchMarkdown, "# Launch\n\nFirst step")
        _ = try ok(await runner.call("pages_append_markdown", ["pageId": .string(id), "markdown": .string("Second step")]))
        let changes = await runner.changes
        XCTAssertEqual(changes, [
            AIPageChange(pageID: id, title: "Launch", versionID: nil, created: true),
            AIPageChange(pageID: insideID, title: "Inside", versionID: nil, created: true),
        ])
        let versions = await ws.versionCount(id)
        XCTAssertEqual(versions, 0)

        // The page inside goes to Trash with the page around it.
        let result = await AIUndo.undo(ws, changes: changes)
        XCTAssertEqual(result.undone, ["Inside", "Launch"])
        XCTAssertEqual(result.failed, [])
        let launchTrashed = await ws.isTrashed(id)
        let insideTrashed = await ws.isTrashed(insideID)
        let parentTrashed = await ws.isTrashed(parent.id)
        XCTAssertTrue(launchTrashed)
        XCTAssertTrue(insideTrashed)
        XCTAssertFalse(parentTrashed)
    }

    func testEditsToExistingPagesAreUndoneInOneStep() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("Plan", markdown: "Hello\n\nKeep me")
        let other = try await ws.add("Groceries")
        let runner = AIToolRunner(workspace: ws)
        let read = try ok(await runner.call("pages_read", ["pageId": .string(page.id)]))
        let firstBlock = try XCTUnwrap(read.aiObject?["blocks"]?.aiArray?.first?.aiObject?["id"]?.aiString)

        let updated = try ok(await runner.call("blocks_update", ["blockId": .string(firstBlock), "markdown": .string("Hi **there**\n\nInserted")]))
        XCTAssertEqual(updated.aiObject?["updated"]?.aiString, firstBlock)
        XCTAssertEqual(updated.aiObject?["inserted"]?.aiArray?.count, 1)
        var markdown = await ws.markdown(page.id)
        XCTAssertEqual(markdown, "Hi **there**\n\nInserted\n\nKeep me")
        _ = try ok(await runner.call("pages_rename", ["pageId": .string(page.id), "title": .string("Plan v2")]))
        _ = try ok(await runner.call("tasks_add", ["pageId": .string(other.id), "items": .array([.string("Milk"), .string("  "), .string("Eggs\nlarge")])]))
        markdown = await ws.markdown(other.id)
        XCTAssertEqual(markdown, "- [ ] Milk\n- [ ] Eggs large")

        // One version per page, captured before its first change.
        var versions = await ws.versionCount(page.id)
        XCTAssertEqual(versions, 1)
        let changes = await runner.changes
        XCTAssertEqual(changes.map(\.pageID), [page.id, other.id])
        XCTAssertEqual(changes.first?.title, "Plan v2")
        XCTAssertEqual(changes.first?.created, false)
        XCTAssertNotNil(changes.first?.versionID)

        let result = await AIUndo.undo(ws, changes: changes)
        XCTAssertEqual(result.undone.count, 2)
        XCTAssertEqual(result.failed, [])
        let title = await ws.page(page.id)?.title
        XCTAssertEqual(title, "Plan")
        markdown = await ws.markdown(page.id)
        XCTAssertEqual(markdown, "Hello\n\nKeep me")
        markdown = await ws.markdown(other.id)
        XCTAssertEqual(markdown, "")
        // The assistant's version is kept too, in the page's history.
        versions = await ws.versionCount(page.id)
        XCTAssertEqual(versions, 2)
    }

    func testBlockUpdateKeepsAnExplicitDirection() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("Notes", markdown: "Old")
        let blockValue = await ws.blocks(page.id).first
        let block = try XCTUnwrap(blockValue)
        var node = block.content.aiObject ?? [:]
        var attrs = node["attrs"]?.aiObject ?? [:]
        attrs["dir"] = .string("rtl")
        node["attrs"] = .object(attrs)
        await ws.setBlocks(page.id, [AIWorkspaceBlock(id: block.id, content: .object(node))])
        let runner = AIToolRunner(workspace: ws)
        _ = try ok(await runner.call("blocks_update", ["blockId": .string(block.id), "markdown": .string("جديد")]))
        let saved = await ws.blocks(page.id).first?.content.aiObject?["attrs"]?.aiObject
        XCTAssertEqual(saved?["dir"], .string("rtl"))
        XCTAssertEqual(saved?["bid"], .string(block.id))
        failed(await runner.call("blocks_update", ["blockId": .string("missing"), "markdown": .string("x")]))
    }

    func testTasksAreAddedAfterABlockAndListedByState() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("Week", markdown: "# Monday\n\n- [x] Gym\n- [ ] Call mum\n\n# Tuesday")
        let headingValue = await ws.blocks(page.id).first?.id
        let heading = try XCTUnwrap(headingValue)
        let runner = AIToolRunner(workspace: ws)
        _ = try ok(await runner.call("tasks_add", ["pageId": .string(page.id), "items": .array([.string("Read")]), "afterBlockId": .string(heading)]))
        let markdown = await ws.markdown(page.id)
        XCTAssertTrue(markdown.hasPrefix("# Monday\n\n- [ ] Read\n\n- [x] Gym"), markdown)
        let open = try ok(await runner.call("tasks_list", [:])).aiObject ?? [:]
        XCTAssertEqual(open["open"]?.aiInt, 2)
        XCTAssertEqual(open["done"]?.aiInt, 1)
        XCTAssertEqual((open["items"]?.aiArray ?? []).compactMap { $0.aiObject?["text"]?.aiString }, ["Read", "Call mum"])
        let done = try ok(await runner.call("tasks_list", ["status": .string("done"), "pageId": .string(page.id)])).aiObject ?? [:]
        XCTAssertEqual(done["items"]?.aiArray?.first?.aiObject?["text"]?.aiString, "Gym")
        XCTAssertEqual(done["items"]?.aiArray?.first?.aiObject?["index"]?.aiInt, 0)
        let limited = try ok(await runner.call("tasks_list", ["status": .string("all"), "limit": .string("2")])).aiObject ?? [:]
        XCTAssertEqual(limited["items"]?.aiArray?.count, 2)
        XCTAssertEqual(limited["open"]?.aiInt, 2)
        failed(await runner.call("tasks_add", ["pageId": .string(page.id), "items": .array([])]))
        failed(await runner.call("tasks_add", ["pageId": .string(page.id), "items": .array([.string("x")]), "afterBlockId": .string("missing")]))
    }

    func testOnlyPagesAndDocumentsAreEdited() async throws {
        let ws = MemoryWorkspace()
        let sheet = try await ws.add("Budget", kind: "spreadsheet")
        let template = try await ws.add("Template", kind: "template")
        let runner = AIToolRunner(workspace: ws)
        let message2 = failed(await runner.call("pages_append_markdown", ["pageId": .string(sheet.id), "markdown": .string("x")]))
        XCTAssertTrue(message2.contains("only pages and documents"), message2)
        failed(await runner.call("pages_read", ["pageId": .string(template.id)]))
        failed(await runner.call("pages_create", ["title": .string("Inside"), "parentId": .string(sheet.id)]))
        // A rename works on any kind and is undoable like any other change.
        _ = try ok(await runner.call("pages_rename", ["pageId": .string(sheet.id), "title": .string("Budget 2027")]))
        let changes = await runner.changes
        XCTAssertEqual(changes, [AIPageChange(pageID: sheet.id, title: "Budget 2027", versionID: nil, created: false, previousTitle: "Budget")])
        let result = await AIUndo.undo(ws, changes: changes)
        XCTAssertEqual(result.undone, ["Budget 2027"])
        let title = await ws.page(sheet.id)?.title
        XCTAssertEqual(title, "Budget")
    }

    func testARenameMadeLaterIsNotUndone() async throws {
        let ws = MemoryWorkspace()
        let sheet = try await ws.add("Budget", kind: "spreadsheet")
        let runner = AIToolRunner(workspace: ws)
        _ = try ok(await runner.call("pages_rename", ["pageId": .string(sheet.id), "title": .string("Budget 2027")]))
        let currentValue = await ws.page(sheet.id)
        let current = try XCTUnwrap(currentValue)
        _ = try await ws.rename(pageID: sheet.id, expectedRevision: current.revision, expectedTitle: current.title, title: "Mine", operationID: UUID())
        let result = await AIUndo.undo(ws, changes: await runner.changes)
        XCTAssertEqual(result.failed, ["Budget 2027"])
        let title = await ws.page(sheet.id)?.title
        XCTAssertEqual(title, "Mine")
    }

    func testStaleRevisionsAreRefusedAndNothingChanges() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("Plan", markdown: "Original")
        await ws.setStaleReads(true)
        let before = await ws.markdown(page.id)
        let runner = AIToolRunner(workspace: ws)
        let message3 = failed(await runner.call("pages_append_markdown", ["pageId": .string(page.id), "markdown": .string("More")]))
        XCTAssertTrue(message3.contains("changed"), message3)
        let after = await ws.markdown(page.id)
        XCTAssertEqual(after, before)
        let changes = await runner.changes
        XCTAssertTrue(changes.isEmpty)
    }

    func testReadOnlyWorkspaceRefusesWritesWithTheReason() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("Plan", markdown: "Original")
        let reason = "This database is in iCloud Drive, where saving to it could damage it."
        let runner = AIToolRunner(workspace: ws, readOnlyReason: reason)
        let cases: [(String, [String: JSONValue])] = [
            ("pages_append_markdown", ["pageId": .string(page.id), "markdown": .string("More")]),
            ("pages_create", ["title": .string("New")]),
            ("pages_rename", ["pageId": .string(page.id), "title": .string("Other")]),
            ("tasks_add", ["pageId": .string(page.id), "items": .array([.string("Milk")])]),
        ]
        for (name, input) in cases {
            let output = failed(await runner.call(name, input))
            XCTAssertTrue(output.contains("read only"), output)
            XCTAssertTrue(output.contains(reason), output)
        }
        let read = try ok(await runner.call("pages_read", ["pageId": .string(page.id)])).aiObject ?? [:]
        XCTAssertEqual(read["editable"], .bool(false))
        XCTAssertEqual(read["readOnly"]?.aiString, reason)
        let markdown = await ws.markdown(page.id)
        XCTAssertEqual(markdown, "Original")
        let versions = await ws.versionCount(page.id)
        XCTAssertEqual(versions, 0)
        let changes = await runner.changes
        XCTAssertTrue(changes.isEmpty)
    }

    func testUndoReportsPagesItCouldNotPutBack() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("Plan", markdown: "One")
        let runner = AIToolRunner(workspace: ws)
        _ = try ok(await runner.call("pages_append_markdown", ["pageId": .string(page.id), "markdown": .string("Two")]))
        let currentValue = await ws.page(page.id)
        let current = try XCTUnwrap(currentValue)
        try await ws.trash(pageID: page.id, expectedRevision: current.revision)
        let result = await AIUndo.undo(ws, changes: await runner.changes)
        XCTAssertEqual(result.failed, ["Plan"])
        XCTAssertEqual(result.undone, [])
    }

    func testBadArgumentsAndUnknownToolsAreErrors() async throws {
        let ws = MemoryWorkspace()
        let page = try await ws.add("P")
        let runner = AIToolRunner(workspace: ws)
        let message4 = failed(await runner.call("pages_create", ["title": .string("  ")]))
        XCTAssertTrue(message4.contains("title"), message4)
        let message5 = failed(await runner.call("pages_delete", [:]))
        XCTAssertTrue(message5.contains("no tool named"), message5)
        failed(await runner.call("pages_append_markdown", ["pageId": .string(page.id), "markdown": .string("   ")]))
        failed(await runner.call("pages_append_markdown", ["pageId": .integer(5), "markdown": .string("x")]))
        let changes = await runner.changes
        XCTAssertTrue(changes.isEmpty)
    }

    func testLongOutputIsCapped() {
        let long = String(repeating: "a", count: AITools.maxOutput + 10)
        let capped = AIToolRunner.compact(long)
        XCTAssertTrue(capped.hasSuffix("[truncated: ask for less, for example one page or a smaller limit]"))
        XCTAssertEqual(AIToolRunner.compact("short"), "short")
    }

    func testChangesSurviveCoding() throws {
        let changes = [
            AIPageChange(pageID: "p1", title: "Plan", versionID: "v1", created: false),
            AIPageChange(pageID: "p2", title: "New", versionID: nil, created: true),
            AIPageChange(pageID: "p3", title: "Budget 2027", versionID: nil, created: false, previousTitle: "Budget"),
        ]
        let data = try JSONEncoder().encode(changes)
        XCTAssertEqual(try JSONDecoder().decode([AIPageChange].self, from: data), changes)
        let steps = [AIToolStep(tool: "tasks_add", ok: true), AIToolStep(tool: "pages_read", ok: false)]
        XCTAssertEqual(try JSONDecoder().decode([AIToolStep].self, from: JSONEncoder().encode(steps)), steps)
    }
}

final class AIMarkdownTests: XCTestCase {
    private func roundTrip(_ markdown: String) throws -> String {
        try AIMarkdownImport.parse(markdown).map { AIMarkdownExport.block($0) }.joined(separator: "\n\n")
    }

    func testBlocksRoundTrip() throws {
        let source = """
        # Title

        ## Section

        A paragraph with **bold**, *italic*, ~~strike~~, ==highlight==, `code` and a [link](https://example.com).

        - one
        - two

        1. first
        2. second

        - [ ] open
        - [x] done

        > quoted

        > [!warning] Careful

        ```swift
        let x = 1
        ```

        ---

        | Name | Value |
        |---|---|
        | a | 1 |

        نص عربي مع @[صفحة](page:abc)
        """
        XCTAssertEqual(try roundTrip(source), source)
    }

    func testNodeShapes() throws {
        let nodes = try AIMarkdownImport.parse("- [x] Done\n\nLine one\nLine two")
        XCTAssertEqual(nodes.count, 2)
        let item = nodes[0].aiObject?["content"]?.aiArray?.first?.aiObject
        XCTAssertEqual(item?["type"]?.aiString, "taskItem")
        XCTAssertEqual(item?["attrs"]?.aiObject?["checked"], .bool(true))
        let paragraph = nodes[1].aiObject?["content"]?.aiArray ?? []
        XCTAssertEqual(paragraph.compactMap { $0.aiObject?["type"]?.aiString }, ["text", "hardBreak", "text"])
        XCTAssertEqual(try AIMarkdownImport.parse("   \n\n"), [])
        XCTAssertEqual(try AIMarkdownImport.parse("a\r\nb\r\n").count, 1)
        XCTAssertEqual(AIPlainText.text(nodes[1]), "Line one\nLine two")
    }

    func testLimitsAreEnforced() {
        XCTAssertThrowsError(try AIMarkdownImport.parse(String(repeating: "x", count: AIMarkdownImport.maxBytes + 1)))
    }
}
