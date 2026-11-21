#if WORLDS_MAIN_APP_MODULES
import Foundation
import WorldsAI
import WorldsModels
import WorldsPersistence
#if WORLDS_EXPERIMENTAL_LOCAL_COPY
import WorldsNativeWrites
#endif

/// What the assistant may reach: the database the app is showing and, when
/// it can be written here, the same database as the write target.
struct AssistantWorkspaceAccess: Sendable, Equatable {
    /// The database the pages are read from.
    let readURL: URL
    /// Set only when the preflight found the database writable (or it is a local copy).
    let writeURL: URL?
    /// Why the workspace stays read only, already localized; nil when writable.
    let readOnlyReason: String?
    let isLocalCopy: Bool
}

/// The assistant's tools over the person's own workspace. Reads take one
/// snapshot of the live personal pages; every write goes through RustStore's
/// checked operations, which compare the revision (and for blocks the exact
/// current blocks and the page kind) in one transaction, record the native
/// change origin and refuse shared pages.
struct NativeAIWorkspace: AIWorkspace {
    let access: AssistantWorkspaceAccess

    func documents() async throws -> [AIWorkspaceDocument] {
        let url = access.readURL
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let snapshot: WorldsSnapshot
        do {
            snapshot = try await WorldsDatabase(url: url).snapshot()
        } catch {
            throw AIWorkspaceError.refused("the workspace could not be read")
        }
        let decoder = JSONDecoder()
        return snapshot.pages.map { page in
            let blocks = page.blocks.map { block in
                // A block that cannot be read is passed on unchanged as text, so
                // a save that would have to keep it is refused as a conflict.
                let content = (try? decoder.decode(JSONValue.self, from: Data(block.contentJSON.utf8))) ?? .string(block.contentJSON)
                return AIWorkspaceBlock(id: block.id, content: content)
            }
            let workspacePage = AIWorkspacePage(id: page.id, title: page.title, kind: page.kind, parentID: page.parentID,
                                                revision: page.updatedAt, archived: page.archived)
            return AIWorkspaceDocument(page: workspacePage, blocks: blocks)
        }
    }

    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    private func writer() throws -> NativePersonalStore {
        guard let url = access.writeURL else {
            throw AIWorkspaceError.readOnly(access.readOnlyReason ?? String(localized: "This database cannot be edited here."))
        }
        do { return try NativePersonalStore(url: url) }
        catch { throw AIWorkspaceError.refused("the workspace file is not available") }
    }

    /// Store errors as short texts for the model. RustStore's own messages may
    /// name files, so only fixed texts are passed on.
    private func checked<T: Sendable>(_ work: () async throws -> T) async throws -> T {
        do {
            return try await work()
        } catch let error as AIWorkspaceError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as NativeWriteError {
            switch error {
            case .conflict:
                throw AIWorkspaceError.conflict
            case .teamWorkspace:
                throw AIWorkspaceError.refused("a page at the top level would join the active team workspace; create it inside a personal page instead")
            case .operationFailed(let message):
                if message.hasPrefix("unsupported edit:") {
                    throw AIWorkspaceError.refused("this page has content the assistant cannot change safely here, so nothing was changed")
                }
                if message.contains("shared, deleted, or unavailable") || message.contains("page unavailable") {
                    throw AIWorkspaceError.refused("this page is shared, in Trash or unavailable, so it cannot be changed here")
                }
                if message.hasPrefix("version unavailable") {
                    throw AIWorkspaceError.refused("the saved version is no longer available")
                }
                throw AIWorkspaceError.refused("the workspace store refused the change")
            default:
                throw AIWorkspaceError.refused("the workspace store refused the change")
            }
        } catch {
            throw AIWorkspaceError.refused("the workspace store refused the change")
        }
    }

    private static func object(_ value: JSONValue) throws -> [String: JSONValue] {
        guard case .object(let object) = value else { throw AIWorkspaceError.refused("the workspace store sent an unreadable answer") }
        return object
    }

    private static func revision(_ object: [String: JSONValue]) throws -> Int64 {
        guard case .integer(let revision)? = object["updatedAt"] else { throw AIWorkspaceError.refused("the workspace store sent an unreadable answer") }
        return revision
    }

    private static func string(_ object: [String: JSONValue], _ key: String) -> String? {
        if case .string(let value)? = object[key] { return value }
        return nil
    }

    private static func input(_ blocks: [AIWorkspaceBlock]) -> [NativeBlockInput] {
        blocks.map { NativeBlockInput(id: $0.id, content: $0.content) }
    }

    func createPage(title: String, parentID: String?, operationID: UUID) async throws -> AIWorkspacePage {
        let store = try writer()
        let object = try Self.object(try await checked { try await store.createPageIdempotent(title: title, parent: parentID, operationID: operationID) })
        guard let id = Self.string(object, "id") else { throw AIWorkspaceError.refused("the workspace store sent an unreadable answer") }
        return AIWorkspacePage(id: id, title: Self.string(object, "title") ?? title, kind: Self.string(object, "kind") ?? "page",
                               parentID: Self.string(object, "parentId") ?? parentID, revision: try Self.revision(object))
    }

    func saveBlocks(pageID: String, kind: String, expectedRevision: Int64, expected: [AIWorkspaceBlock], blocks: [AIWorkspaceBlock]) async throws -> Int64 {
        let store = try writer()
        let object = try Self.object(try await checked {
            try await store.saveBlocksCheckedKind(pageID: pageID, base: expectedRevision, expected: Self.input(expected),
                                                  blocks: Self.input(blocks), expectedKind: kind)
        })
        if case .array(let remapped)? = object["remapped"], !remapped.isEmpty {
            throw AIWorkspaceError.refused("the workspace store changed block ids")
        }
        return try Self.revision(object)
    }

    func rename(pageID: String, expectedRevision: Int64, expectedTitle: String, title: String, operationID: UUID) async throws -> AIWorkspacePage {
        let store = try writer()
        let object = try Self.object(try await checked {
            try await store.renamePageChecked(id: pageID, base: expectedRevision, expectedTitle: expectedTitle, title: title, operationID: operationID)
        })
        return AIWorkspacePage(id: Self.string(object, "id") ?? pageID, title: Self.string(object, "title") ?? title,
                               kind: Self.string(object, "kind") ?? "page", parentID: Self.string(object, "parentId"),
                               revision: try Self.revision(object))
    }

    func createVersion(pageID: String, expectedRevision: Int64, label: String) async throws -> String {
        let store = try writer()
        let object = try Self.object(try await checked { try await store.createVersionChecked(pageID: pageID, base: expectedRevision, label: label) })
        guard let id = Self.string(object, "id") else { throw AIWorkspaceError.refused("the workspace store sent an unreadable answer") }
        return id
    }

    func restoreVersion(pageID: String, versionID: String, expectedRevision: Int64) async throws {
        let store = try writer()
        _ = try await checked { try await store.restoreVersionChecked(pageID: pageID, base: expectedRevision, versionID: versionID) }
    }

    func trash(pageID: String, expectedRevision: Int64) async throws {
        let store = try writer()
        try await checked { try await store.trashPage(id: pageID, base: expectedRevision) }
    }
    #else
    private var readOnly: AIWorkspaceError {
        .readOnly(access.readOnlyReason ?? String(localized: "This database cannot be edited here."))
    }
    func createPage(title: String, parentID: String?, operationID: UUID) async throws -> AIWorkspacePage { throw readOnly }
    func saveBlocks(pageID: String, kind: String, expectedRevision: Int64, expected: [AIWorkspaceBlock], blocks: [AIWorkspaceBlock]) async throws -> Int64 { throw readOnly }
    func rename(pageID: String, expectedRevision: Int64, expectedTitle: String, title: String, operationID: UUID) async throws -> AIWorkspacePage { throw readOnly }
    func createVersion(pageID: String, expectedRevision: Int64, label: String) async throws -> String { throw readOnly }
    func restoreVersion(pageID: String, versionID: String, expectedRevision: Int64) async throws { throw readOnly }
    func trash(pageID: String, expectedRevision: Int64) async throws { throw readOnly }
    #endif
}
#endif
