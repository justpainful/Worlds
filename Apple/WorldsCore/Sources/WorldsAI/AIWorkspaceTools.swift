import Foundation
import WorldsModels

// The assistant's workspace tools, mirroring Android's `AiTools.kt`: the same
// ten tools with the desktop MCP names, descriptions and argument schemas,
// run over any `AIWorkspace`. The app passes the person's own database through
// RustStore's checked operations; tests use an in memory workspace.

/// A live personal page as the tools see it. `revision` is the page's
/// `updated_at` in milliseconds, which every write compares.
public struct AIWorkspacePage: Sendable, Equatable {
    public let id: String
    public var title: String
    public let kind: String
    public let parentID: String?
    public var revision: Int64
    public let archived: Bool

    public init(id: String, title: String, kind: String, parentID: String?, revision: Int64, archived: Bool = false) {
        self.id = id
        self.title = title
        self.kind = kind
        self.parentID = parentID
        self.revision = revision
        self.archived = archived
    }
}

/// One stored block: its id and its ProseMirror node exactly as stored.
public struct AIWorkspaceBlock: Sendable, Equatable {
    public let id: String
    public let content: JSONValue

    public init(id: String, content: JSONValue) {
        self.id = id
        self.content = content
    }
}

public struct AIWorkspaceDocument: Sendable, Equatable {
    public var page: AIWorkspacePage
    public var blocks: [AIWorkspaceBlock]

    public init(page: AIWorkspacePage, blocks: [AIWorkspaceBlock]) {
        self.page = page
        self.blocks = blocks
    }
}

/// Failures a workspace reports to the tools. Texts are sent to the model, so
/// they never include file paths or keys.
public enum AIWorkspaceError: Error, Sendable, Equatable {
    /// The page changed since it was read.
    case conflict
    /// The workspace cannot be written on this device, with the reason.
    case readOnly(String)
    /// The store refused the change, with a short reason.
    case refused(String)
    case notFound
}

/// The store calls the tools need. Every write is checked against the revision
/// (and for blocks, the exact current blocks and the page kind) in one
/// transaction, so it can never overwrite an edit made meanwhile.
public protocol AIWorkspace: Sendable {
    /// Live personal pages and their blocks, read in one transaction. Pages in
    /// Trash and shared pages are left out.
    func documents() async throws -> [AIWorkspaceDocument]
    /// Creates an empty page. Reuse the operation ID only to retry the same request.
    func createPage(title: String, parentID: String?, operationID: UUID) async throws -> AIWorkspacePage
    /// Replaces the whole ordered block list and returns the new revision.
    func saveBlocks(pageID: String, kind: String, expectedRevision: Int64, expected: [AIWorkspaceBlock], blocks: [AIWorkspaceBlock]) async throws -> Int64
    func rename(pageID: String, expectedRevision: Int64, expectedTitle: String, title: String, operationID: UUID) async throws -> AIWorkspacePage
    /// Keeps the current page as a named version and returns its id. The revision does not change.
    func createVersion(pageID: String, expectedRevision: Int64, label: String) async throws -> String
    /// Restores a version; the current state is kept as a version first.
    func restoreVersion(pageID: String, versionID: String, expectedRevision: Int64) async throws
    /// Moves the page and its subpages to Trash.
    func trash(pageID: String, expectedRevision: Int64) async throws
}

/// A page the assistant changed in one reply. An existing page or document
/// keeps the version captured before its first change; another kind, which
/// the assistant can only rename, keeps its earlier title; a page the
/// assistant created moves to Trash on undo.
public struct AIPageChange: Sendable, Equatable, Codable {
    public let pageID: String
    public var title: String
    public let versionID: String?
    public let created: Bool
    public let previousTitle: String?

    public init(pageID: String, title: String, versionID: String?, created: Bool, previousTitle: String? = nil) {
        self.pageID = pageID
        self.title = title
        self.versionID = versionID
        self.created = created
        self.previousTitle = previousTitle
    }
}

/// The tool set, with the desktop MCP tools' names, descriptions and argument schemas.
public enum AITools {
    private static func schema(_ properties: [String: JSONValue], required: [String] = []) -> JSONValue {
        .object(["type": .string("object"), "properties": .object(properties), "required": .array(required.map { .string($0) })])
    }

    private static func string(_ description: String? = nil) -> JSONValue {
        var value: [String: JSONValue] = ["type": .string("string")]
        if let description { value["description"] = .string(description) }
        return .object(value)
    }

    private static let pageID = string("Page id")
    private static let markdown = string("Content in Worlds Markdown")
    private static let integer: JSONValue = .object(["type": .string("integer")])
    private static let boolean: JSONValue = .object(["type": .string("boolean")])

    public static let all: [AIToolDefinition] = [
        AIToolDefinition(
            name: "workspace_overview",
            description: "A snapshot of the whole workspace: counts, recently edited pages and the current local date and time. Call this first when you need orientation.",
            schema: schema([:])),
        AIToolDefinition(
            name: "pages_list",
            description: "List pages as a tree (id, title, parent, flags). Use parentId to list one branch.",
            schema: schema(["parentId": string(), "includeArchived": boolean])),
        AIToolDefinition(
            name: "pages_search",
            description: "Full-text search page titles and content (Arabic and English).",
            schema: schema(["query": string(), "limit": integer], required: ["query"])),
        AIToolDefinition(
            name: "pages_read",
            description: "Read a page: metadata, assistant instructions, blocks (id, type, markdown), subpages and backlinks.",
            schema: schema(["pageId": pageID], required: ["pageId"])),
        AIToolDefinition(
            name: "pages_create",
            description: "Create a page (optionally inside a parent) with initial Markdown content.",
            schema: schema(["title": string(), "parentId": string(), "icon": string("single emoji"), "markdown": markdown], required: ["title"])),
        AIToolDefinition(
            name: "pages_append_markdown",
            description: "Add content at the end of a page.",
            schema: schema(["pageId": pageID, "markdown": markdown], required: ["pageId", "markdown"])),
        AIToolDefinition(
            name: "blocks_update",
            description: "Replace one block's content. If the Markdown yields several blocks, the first replaces the block and the rest are inserted after it.",
            schema: schema(["blockId": string(), "markdown": markdown], required: ["blockId", "markdown"])),
        AIToolDefinition(
            name: "pages_rename",
            description: "Rename a page.",
            schema: schema(["pageId": pageID, "title": string()], required: ["pageId", "title"])),
        AIToolDefinition(
            name: "tasks_add",
            description: "Add checklist items to a page (at the end, or after a block).",
            schema: schema([
                "pageId": string("Page id"),
                "items": .object(["type": .string("array"), "items": string()]),
                "afterBlockId": string("Block id"),
            ], required: ["pageId", "items"])),
        AIToolDefinition(
            name: "tasks_list",
            description: "Checklist items across the workspace or one page, with their page, block id, index and state. Use it for to-do overviews.",
            schema: schema([
                "pageId": string("Page id"),
                "status": .object(["type": .string("string"), "enum": .array([.string("open"), .string("done"), .string("all")])]),
                "limit": integer,
            ])),
    ]

    public static var names: [String] { all.map(\.name) }
    /// Tools that change the workspace.
    public static let writing: Set<String> = ["pages_create", "pages_append_markdown", "blocks_update", "pages_rename", "tasks_add"]
    /// Kinds whose content is a list of ProseMirror blocks the assistant may edit.
    public static let editableKinds: Set<String> = ["page", "document"]
    /// Kinds a new page may be created inside.
    public static let parentKinds: Set<String> = ["page", "document", "project"]
    /// Planning kinds with their own views on the desktop and Android; never shown to the assistant.
    static let ownViewKinds: Set<String> = ["task", "event", "inbox", "goal", "assignment", "exam", "requirement", "subject"]
    /// Longest tool output sent back to the model, in characters.
    public static let maxOutput = 60_000
    public static let versionLabel = "Before assistant changes"
}

private struct ToolFailure: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

/// Runs the assistant's tools over an `AIWorkspace`. Every write checks the
/// page revision, so it cannot overwrite an edit made meanwhile. Before the
/// first change to an existing page or document a version is captured, and
/// pages the assistant creates are remembered, so `changes` can undo the whole
/// reply. When `readOnlyReason` is set, the tools that write return an error
/// with that reason and change nothing.
public actor AIToolRunner {
    private let workspace: any AIWorkspace
    private let readOnlyReason: String?
    private let timeZone: TimeZone
    private let now: @Sendable () -> Date
    private var changeLog: [AIPageChange] = []
    /// Versions captured in this reply, with the revision they were taken at.
    private var versions: [String: (id: String, revision: Int64)] = [:]

    public init(workspace: any AIWorkspace, readOnlyReason: String? = nil, timeZone: TimeZone = .current,
                now: @escaping @Sendable () -> Date = { Date() }) {
        self.workspace = workspace
        self.readOnlyReason = readOnlyReason
        self.timeZone = timeZone
        self.now = now
    }

    /// The pages changed so far, in the order they were first changed.
    public var changes: [AIPageChange] { changeLog }

    public func call(_ name: String, _ input: [String: JSONValue]) async -> AIToolResult {
        do {
            let value: JSONValue
            switch name {
            case "workspace_overview": value = try await overview()
            case "pages_list": value = try await pagesList(input)
            case "pages_search": value = try await pagesSearch(input)
            case "pages_read": value = try await pagesRead(input)
            case "pages_create": value = try await pagesCreate(input)
            case "pages_append_markdown": value = try await appendMarkdown(input)
            case "blocks_update": value = try await blocksUpdate(input)
            case "pages_rename": value = try await pagesRename(input)
            case "tasks_add": value = try await tasksAdd(input)
            case "tasks_list": value = try await tasksList(input)
            default: throw ToolFailure("there is no tool named \(name)")
            }
            return AIToolResult(output: Self.compact(value.aiCompact), isError: false)
        } catch let failure as ToolFailure {
            return AIToolResult(output: "Error: \(failure.message)", isError: true)
        } catch AIWorkspaceError.conflict {
            return AIToolResult(output: "Error: the page changed while you were working on it. Read it again, then retry.", isError: true)
        } catch AIWorkspaceError.readOnly(let reason) {
            return AIToolResult(output: "Error: the workspace is read only on this device, so nothing was changed. \(reason)", isError: true)
        } catch AIWorkspaceError.refused(let reason) {
            return AIToolResult(output: "Error: \(reason)", isError: true)
        } catch AIWorkspaceError.notFound {
            return AIToolResult(output: "Error: page not found", isError: true)
        } catch AIMarkdownError.tooComplex {
            return AIToolResult(output: "Error: the Markdown is too large or too complex.", isError: true)
        } catch is CancellationError {
            return AIToolResult(output: "Error: cancelled", isError: true)
        } catch {
            return AIToolResult(output: "Error: the workspace could not be read or changed.", isError: true)
        }
    }

    // MARK: Arguments

    private func string(_ input: [String: JSONValue], _ key: String) throws -> String {
        guard let value = input[key]?.aiString, !value.aiIsBlank else { throw ToolFailure("missing argument `\(key)`") }
        return value
    }

    private func optionalString(_ input: [String: JSONValue], _ key: String) -> String? {
        guard let value = input[key]?.aiString, !value.aiIsBlank else { return nil }
        return value
    }

    private func integer(_ input: [String: JSONValue], _ key: String, default fallback: Int, range: ClosedRange<Int>) -> Int {
        var value = fallback
        switch input[key] {
        case .integer(let number)?: value = Int(clamping: number)
        case .number(let number)? where number.isFinite: value = Int(clamping: Int64(max(-1.0e15, min(1.0e15, number))))
        case .string(let text)?: value = Int(text.trimmingCharacters(in: .whitespacesAndNewlines)) ?? fallback
        default: break
        }
        return min(max(value, range.lowerBound), range.upperBound)
    }

    private func requireWritable() throws {
        if let readOnlyReason { throw AIWorkspaceError.readOnly(readOnlyReason) }
    }

    // MARK: Pages

    /// Live pages the assistant may see: no templates or anything inside them, no planning kinds.
    private func visible() async throws -> [AIWorkspaceDocument] {
        let all = try await workspace.documents()
        var hidden = Set(all.filter { $0.page.kind == "template" }.map(\.page.id))
        var grew = true
        while grew {
            grew = false
            for doc in all where !hidden.contains(doc.page.id) {
                if let parent = doc.page.parentID, hidden.contains(parent) {
                    hidden.insert(doc.page.id)
                    grew = true
                }
            }
        }
        return all.filter { !hidden.contains($0.page.id) && !AITools.ownViewKinds.contains($0.page.kind) }
    }

    private func page(_ id: String, in docs: [AIWorkspaceDocument]) throws -> AIWorkspaceDocument {
        guard let doc = docs.first(where: { $0.page.id == id }) else { throw ToolFailure("page not found") }
        return doc
    }

    private func editable(_ id: String, in docs: [AIWorkspaceDocument]) throws -> AIWorkspaceDocument {
        let doc = try page(id, in: docs)
        guard AITools.editableKinds.contains(doc.page.kind) else {
            throw ToolFailure("this \(doc.page.kind) cannot be edited by the assistant on iPhone, iPad and Mac; only pages and documents can")
        }
        return doc
    }

    private func time(_ milliseconds: Int64) -> String {
        Self.format(Date(timeIntervalSince1970: TimeInterval(milliseconds) / 1000), "yyyy-MM-dd'T'HH:mm:ss", timeZone)
    }

    private static func format(_ date: Date, _ pattern: String, _ zone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = zone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }

    private func brief(_ page: AIWorkspacePage) -> JSONValue {
        .object(["id": .string(page.id), "title": .string(page.title), "kind": .string(page.kind), "updatedAt": .string(time(page.revision))])
    }

    private func overview() async throws -> JSONValue {
        let pages = try await visible().map(\.page)
        let date = now()
        var byKind: [String: JSONValue] = [:]
        for page in pages { byKind[page.kind] = .integer((byKind[page.kind]?.aiInt ?? 0) + 1) }
        let recent = pages.sorted { $0.revision > $1.revision }.prefix(12).map { brief($0) }
        var out: [String: JSONValue] = [
            "now": .object([
                "local": .string(Self.format(date, "yyyy-MM-dd'T'HH:mm:ss", timeZone)),
                "weekday": .string(Self.format(date, "EEEE", timeZone)),
                "timeZone": .string(timeZone.identifier),
            ]),
            "counts": .object(["pages": .integer(Int64(pages.count)), "byKind": .object(byKind)]),
            "recent": .array(Array(recent)),
            "device": .string("iPhone, iPad or Mac"),
        ]
        if let readOnlyReason { out["readOnly"] = .string(readOnlyReason) }
        return .object(out)
    }

    private func pagesList(_ input: [String: JSONValue]) async throws -> JSONValue {
        let includeArchived = input["includeArchived"]?.aiBool ?? false
        let all = try await visible().map(\.page).filter { includeArchived || !$0.archived }
        let ids = Set(all.map(\.id))
        let root = optionalString(input, "parentId")
        if let root, !ids.contains(root) { throw ToolFailure("page not found") }
        var children: [String: [AIWorkspacePage]] = [:]
        for page in all {
            let parent = page.parentID.flatMap { ids.contains($0) ? $0 : nil } ?? ""
            children[parent, default: []].append(page)
        }
        var out: [JSONValue] = []
        func walk(_ parent: String, _ depth: Int) {
            for page in children[parent] ?? [] {
                if out.count >= 500 { return }
                out.append(.object([
                    "id": .string(page.id), "title": .string(page.title), "kind": .string(page.kind),
                    "parentId": page.parentID.map { JSONValue.string($0) } ?? JSONValue.null, "depth": .integer(Int64(depth)),
                    "updatedAt": .string(time(page.revision)),
                ]))
                if depth < 12 { walk(page.id, depth + 1) }
            }
        }
        walk(root ?? "", 0)
        return .array(out)
    }

    private func pagesSearch(_ input: [String: JSONValue]) async throws -> JSONValue {
        let query = try string(input, "query").trimmingCharacters(in: .whitespacesAndNewlines)
        let limit = integer(input, "limit", default: 15, range: 1...50)
        let docs = try await visible()
        let titles = Dictionary(docs.map { ($0.page.id, $0.page.title) }, uniquingKeysWith: { first, _ in first })
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
        var titleHits: [(AIWorkspaceDocument, String)] = []
        var contentHits: [(AIWorkspaceDocument, String)] = []
        for doc in docs {
            let snippet = Self.snippet(doc, query)
            if doc.page.title.range(of: query, options: options) != nil {
                titleHits.append((doc, snippet))
            } else if !snippet.isEmpty {
                contentHits.append((doc, snippet))
            }
        }
        let hits = (titleHits + contentHits).prefix(limit).map { hit -> JSONValue in
            let doc = hit.0
            let parent: JSONValue = doc.page.parentID.flatMap { titles[$0] }.map { JSONValue.string($0) } ?? JSONValue.null
            return JSONValue.object([
                "pageId": .string(doc.page.id), "title": .string(doc.page.title), "kind": .string(doc.page.kind),
                "parent": parent, "snippet": .string(hit.1),
            ])
        }
        return .array(Array(hits))
    }

    static func snippet(_ doc: AIWorkspaceDocument, _ query: String) -> String {
        for block in doc.blocks {
            let text = AIMarkdownExport.block(block.content).replacingOccurrences(of: "\n", with: " ")
            guard let match = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) else { continue }
            let start = text.index(match.lowerBound, offsetBy: -60, limitedBy: text.startIndex) ?? text.startIndex
            let end = text.index(match.upperBound, offsetBy: 60, limitedBy: text.endIndex) ?? text.endIndex
            return String(text[start..<match.lowerBound]) + "«" + String(text[match]) + "»" + String(text[match.upperBound..<end])
        }
        return ""
    }

    private func pagesRead(_ input: [String: JSONValue]) async throws -> JSONValue {
        let docs = try await visible()
        let doc = try page(try string(input, "pageId"), in: docs)
        let byID = Dictionary(docs.map { ($0.page.id, $0.page) }, uniquingKeysWith: { first, _ in first })
        var crumbs: [String] = []
        var parent = doc.page.parentID
        var guardCount = 0
        while let id = parent, guardCount < 32, let ancestor = byID[id] {
            crumbs.append(ancestor.title)
            parent = ancestor.parentID
            guardCount += 1
        }
        let isEditable = AITools.editableKinds.contains(doc.page.kind)
        var blocks: [JSONValue] = []
        var size = 0
        var truncated = false
        if isEditable {
            for block in doc.blocks {
                let markdown = AIMarkdownExport.block(block.content)
                size += markdown.count
                if size > AITools.maxOutput - 4_000 { truncated = true; break }
                blocks.append(.object([
                    "id": .string(block.id),
                    "type": .string(AIMarkdownExport.type(block.content)),
                    "markdown": .string(markdown),
                ]))
            }
        }
        let subpages = docs.filter { $0.page.parentID == doc.page.id }.map { child in
            JSONValue.object(["id": .string(child.page.id), "title": .string(child.page.title), "kind": .string(child.page.kind)])
        }
        var out: [String: JSONValue] = [
            "id": .string(doc.page.id), "title": .string(doc.page.title), "kind": .string(doc.page.kind),
            "editable": .bool(isEditable && readOnlyReason == nil),
            "path": .array(crumbs.reversed().map { JSONValue.string($0) }),
            "blocks": .array(blocks),
            "subpages": .array(subpages),
            "updatedAt": .string(time(doc.page.revision)),
        ]
        if truncated { out["truncated"] = .bool(true) }
        if !isEditable { out["note"] = .string("This \(doc.page.kind) has no block content the assistant can read on iPhone, iPad and Mac.") }
        if let readOnlyReason { out["readOnly"] = .string(readOnlyReason) }
        return .object(out)
    }

    // MARK: Writes

    /// The version to keep for this page, captured before its first change in
    /// this reply. A version taken at an older revision is not reused, so undo
    /// never skips an edit made between two attempts.
    private func versionBeforeChange(_ page: AIWorkspacePage) async throws -> String? {
        if let existing = changeLog.first(where: { $0.pageID == page.id }) { return existing.versionID }
        guard AITools.editableKinds.contains(page.kind) else { return nil }
        if let cached = versions[page.id], cached.revision == page.revision { return cached.id }
        let id = try await workspace.createVersion(pageID: page.id, expectedRevision: page.revision, label: AITools.versionLabel)
        versions[page.id] = (id, page.revision)
        return id
    }

    private func record(_ after: AIPageChange) {
        if let index = changeLog.firstIndex(where: { $0.pageID == after.pageID }) {
            changeLog[index].title = after.title
        } else {
            changeLog.append(after)
        }
    }

    /// Parsed Markdown as blocks with fresh ids.
    private func blocks(from markdown: String) throws -> [AIWorkspaceBlock] {
        let nodes = try AIMarkdownImport.parse(markdown)
        if nodes.isEmpty { throw ToolFailure("the Markdown produced no blocks") }
        return nodes.map { node in
            let id = Self.newBlockID()
            return AIWorkspaceBlock(id: id, content: Self.withBlockID(node, id))
        }
    }

    static func newBlockID() -> String {
        UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "")
    }

    static func withBlockID(_ node: JSONValue, _ id: String) -> JSONValue {
        guard case .object(var object) = node else { return node }
        var attrs = object["attrs"]?.aiObject ?? [:]
        attrs["bid"] = .string(id)
        object["attrs"] = .object(attrs)
        return .object(object)
    }

    /// An existing block as it is submitted again: its node must carry its own id.
    private func submitted(_ block: AIWorkspaceBlock) throws -> AIWorkspaceBlock {
        guard case .object(let object) = block.content else {
            throw ToolFailure("this page has a block the assistant cannot keep safely here")
        }
        if let bid = object["attrs"]?.aiObject?["bid"], bid != .null, bid != .string(block.id) {
            throw ToolFailure("this page has a block the assistant cannot keep safely here")
        }
        return AIWorkspaceBlock(id: block.id, content: Self.withBlockID(block.content, block.id))
    }

    private func save(_ doc: AIWorkspaceDocument, _ blocks: [AIWorkspaceBlock]) async throws {
        let versionID = try await versionBeforeChange(doc.page)
        _ = try await workspace.saveBlocks(pageID: doc.page.id, kind: doc.page.kind, expectedRevision: doc.page.revision,
                                           expected: doc.blocks, blocks: blocks)
        record(AIPageChange(pageID: doc.page.id, title: doc.page.title, versionID: versionID, created: false))
    }

    private static func ids(_ blocks: [AIWorkspaceBlock]) -> JSONValue { .array(blocks.map { .string($0.id) }) }

    private func pagesCreate(_ input: [String: JSONValue]) async throws -> JSONValue {
        try requireWritable()
        let title = String(try string(input, "title").trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        let parentID = optionalString(input, "parentId")
        if let parentID {
            let parent = try page(parentID, in: try await visible())
            guard AITools.parentKinds.contains(parent.page.kind) else { throw ToolFailure("a page cannot be created inside a \(parent.page.kind)") }
        }
        let initial = try optionalString(input, "markdown").map { try blocks(from: $0) }
        let created = try await workspace.createPage(title: title, parentID: parentID, operationID: UUID())
        record(AIPageChange(pageID: created.id, title: created.title, versionID: nil, created: true))
        if let initial {
            _ = try await workspace.saveBlocks(pageID: created.id, kind: created.kind, expectedRevision: created.revision, expected: [], blocks: initial)
        }
        return .object(["pageId": .string(created.id), "title": .string(created.title)])
    }

    private func appendMarkdown(_ input: [String: JSONValue]) async throws -> JSONValue {
        try requireWritable()
        let doc = try editable(try string(input, "pageId"), in: try await visible())
        let added = try blocks(from: try string(input, "markdown"))
        let kept = try doc.blocks.map { try submitted($0) }
        try await save(doc, kept + added)
        return .object(["inserted": Self.ids(added)])
    }

    private func blocksUpdate(_ input: [String: JSONValue]) async throws -> JSONValue {
        try requireWritable()
        let blockID = try string(input, "blockId")
        let markdown = try string(input, "markdown")
        let docs = try await visible()
        let holds: (AIWorkspaceDocument) -> Bool = { candidate in candidate.blocks.contains(where: { block in block.id == blockID }) }
        guard let doc = docs.first(where: { candidate in AITools.editableKinds.contains(candidate.page.kind) && holds(candidate) }),
              let index = doc.blocks.firstIndex(where: { block in block.id == blockID }) else {
            if docs.contains(where: holds) {
                throw ToolFailure("this block is on a resource the assistant cannot edit here; only pages and documents can be edited")
            }
            throw ToolFailure("block not found")
        }
        var fresh = try blocks(from: markdown)
        var first = fresh.removeFirst().content.aiObject ?? [:]
        var attrs = first["attrs"]?.aiObject ?? [:]
        attrs["bid"] = .string(blockID)
        // Keep an explicit direction the person set.
        if case .string(let direction)? = doc.blocks[index].content.aiObject?["attrs"]?.aiObject?["dir"], direction == "ltr" || direction == "rtl" {
            attrs["dir"] = .string(direction)
        }
        first["attrs"] = .object(attrs)
        var updated = try doc.blocks.map { try submitted($0) }
        updated[index] = AIWorkspaceBlock(id: blockID, content: .object(first))
        updated.insert(contentsOf: fresh, at: index + 1)
        try await save(doc, updated)
        return .object(["updated": .string(blockID), "inserted": Self.ids(fresh)])
    }

    private func pagesRename(_ input: [String: JSONValue]) async throws -> JSONValue {
        let doc = try page(try string(input, "pageId"), in: try await visible())
        let title = String(try string(input, "title").trimmingCharacters(in: .whitespacesAndNewlines).prefix(500))
        if doc.page.title == title { return .object(["pageId": .string(doc.page.id), "title": .string(title)]) }
        try requireWritable()
        let versionID = try await versionBeforeChange(doc.page)
        let renamed = try await workspace.rename(pageID: doc.page.id, expectedRevision: doc.page.revision,
                                                 expectedTitle: doc.page.title, title: title, operationID: UUID())
        let previous: String? = AITools.editableKinds.contains(doc.page.kind) ? nil : doc.page.title
        if changeLog.contains(where: { $0.pageID == doc.page.id }) {
            record(AIPageChange(pageID: doc.page.id, title: renamed.title, versionID: versionID, created: false))
        } else {
            record(AIPageChange(pageID: doc.page.id, title: renamed.title, versionID: versionID, created: false, previousTitle: previous))
        }
        return .object(["pageId": .string(renamed.id), "title": .string(renamed.title)])
    }

    private func tasksAdd(_ input: [String: JSONValue]) async throws -> JSONValue {
        try requireWritable()
        let doc = try editable(try string(input, "pageId"), in: try await visible())
        let items = (input["items"]?.aiArray ?? []).compactMap { item -> String? in
            guard let text = item.aiString else { return nil }
            let line = text.replacingOccurrences(of: "\\s*\\n\\s*", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
            return line.isEmpty ? nil : line
        }
        if items.isEmpty { throw ToolFailure("items is empty") }
        let added = try blocks(from: items.map { "- [ ] \($0)" }.joined(separator: "\n"))
        var updated = try doc.blocks.map { try submitted($0) }
        var position = updated.count
        if let after = optionalString(input, "afterBlockId") {
            guard let index = updated.firstIndex(where: { $0.id == after }) else { throw ToolFailure("block not found on this page") }
            position = index + 1
        }
        updated.insert(contentsOf: added, at: position)
        try await save(doc, updated)
        return .object(["inserted": Self.ids(added)])
    }

    private func tasksList(_ input: [String: JSONValue]) async throws -> JSONValue {
        let status = optionalString(input, "status") ?? "open"
        let limit = integer(input, "limit", default: 200, range: 1...500)
        let docs = try await visible()
        let pages: [AIWorkspaceDocument]
        if let id = optionalString(input, "pageId") {
            pages = [try page(id, in: docs)]
        } else {
            pages = docs.filter { AITools.editableKinds.contains($0.page.kind) }
        }
        var open = 0
        var done = 0
        var items: [JSONValue] = []
        for doc in pages {
            for block in doc.blocks {
                var index = 0
                Self.forTasks(block.content) { item in
                    let checked = item.aiObject?["attrs"]?.aiObject?["checked"] == .bool(true)
                    if checked { done += 1 } else { open += 1 }
                    let keep: Bool
                    switch status {
                    case "done": keep = checked
                    case "all": keep = true
                    default: keep = !checked
                    }
                    if keep && items.count < limit {
                        items.append(.object([
                            "pageId": .string(doc.page.id), "page": .string(doc.page.title), "blockId": .string(block.id),
                            "index": .integer(Int64(index)), "text": .string(AIPlainText.spaced(item)), "checked": .bool(checked),
                        ]))
                    }
                    index += 1
                }
            }
        }
        return .object(["open": .integer(Int64(open)), "done": .integer(Int64(done)), "items": .array(items)])
    }

    private static func forTasks(_ node: JSONValue, _ visit: (JSONValue) -> Void) {
        if AIMarkdownExport.type(node) == "taskItem" { visit(node) }
        for child in AIMarkdownExport.children(node) { forTasks(child, visit) }
    }

    static func compact(_ text: String) -> String {
        if text.count <= AITools.maxOutput { return text }
        return String(text.prefix(AITools.maxOutput)) + "\n[truncated: ask for less, for example one page or a smaller limit]"
    }
}

/// Undoes every change one reply made, newest first.
public enum AIUndo {
    /// Titles of the pages that were put back and of those that could not be.
    public struct Result: Sendable, Equatable {
        public let undone: [String]
        public let failed: [String]
    }

    public static func undo(_ workspace: any AIWorkspace, changes: [AIPageChange]) async -> Result {
        var undone: [String] = []
        var failed: [String] = []
        let created = Set(changes.filter(\.created).map(\.pageID))
        for change in changes.reversed() {
            do {
                let docs = try await workspace.documents()
                let byID = Dictionary(docs.map { ($0.page.id, $0.page) }, uniquingKeysWith: { first, _ in first })
                let current = byID[change.pageID]
                if change.created {
                    // Already gone or already in Trash counts as undone. A page inside
                    // another page this reply created goes to Trash with that page.
                    if let current, !hasAncestor(current, in: created, byID: byID) {
                        try await workspace.trash(pageID: change.pageID, expectedRevision: current.revision)
                    }
                } else if let versionID = change.versionID {
                    guard let current else { throw AIWorkspaceError.notFound }
                    try await workspace.restoreVersion(pageID: change.pageID, versionID: versionID, expectedRevision: current.revision)
                } else if let previous = change.previousTitle {
                    guard let current else { throw AIWorkspaceError.notFound }
                    if current.title != previous {
                        // Only the assistant's own title is put back; a later rename stays.
                        guard current.title == change.title else { throw AIWorkspaceError.conflict }
                        _ = try await workspace.rename(pageID: change.pageID, expectedRevision: current.revision,
                                                       expectedTitle: current.title, title: previous, operationID: UUID())
                    }
                }
                undone.append(change.title)
            } catch {
                failed.append(change.title)
            }
        }
        return Result(undone: undone, failed: failed)
    }

    private static func hasAncestor(_ page: AIWorkspacePage, in ids: Set<String>, byID: [String: AIWorkspacePage]) -> Bool {
        var parent = page.parentID
        var steps = 0
        while let id = parent, steps < 128 {
            if ids.contains(id) && byID[id] != nil { return true }
            parent = byID[id]?.parentID
            steps += 1
        }
        return false
    }
}
