import Foundation
import SQLite3

public struct StoredBlock: Sendable, Equatable {
    public let id: String
    public let type: String
    public let contentJSON: String
    public let propertiesJSON: String
    public let direction: String
    public let sortKey: Double

    public init(
        id: String,
        type: String,
        contentJSON: String,
        propertiesJSON: String,
        direction: String,
        sortKey: Double
    ) {
        self.id = id
        self.type = type
        self.contentJSON = contentJSON
        self.propertiesJSON = propertiesJSON
        self.direction = direction
        self.sortKey = sortKey
    }
}

public struct StoredPage: Sendable, Equatable, Identifiable {
    public let id: String
    public let title: String
    public let kind: String
    public let parentID: String?
    public let archived: Bool
    public let sortKey: Double
    public let createdAt: Int64
    public let preview: String
    public let updatedAt: Int64
    public let metadataJSON: String
    public let blocks: [StoredBlock]

    public init(
        id: String,
        title: String,
        kind: String,
        parentID: String?,
        archived: Bool,
        sortKey: Double,
        createdAt: Int64,
        preview: String,
        updatedAt: Int64,
        metadataJSON: String,
        blocks: [StoredBlock]
    ) {
        self.id = id
        self.title = title
        self.kind = kind
        self.parentID = parentID
        self.archived = archived
        self.sortKey = sortKey
        self.createdAt = createdAt
        self.preview = preview
        self.updatedAt = updatedAt
        self.metadataJSON = metadataJSON
        self.blocks = blocks
    }
}

/// A personal page in the desktop's Trash and the deletion time a checked
/// restore compares.
public struct StoredTrashedPage: Sendable, Equatable, Identifiable {
    public let page: StoredPage
    public let deletedAt: Int64
    public var id: String { page.id }
    public init(page: StoredPage, deletedAt: Int64) {
        self.page = page
        self.deletedAt = deletedAt
    }
}

/// Attachment metadata only. The caller must separately authorize and open
/// the matching attachments directory, and must not treat this as an ACL lease.
public struct StoredFileAttachment: Sendable, Equatable {
    public let id: String
    public let pageID: String
    public let kind: String
    public let fileName: String
    public let mime: String
    public let size: Int64
    public let relPath: String
    public let width: Int64?
    public let height: Int64?
    public let createdAt: Int64
}

public struct WorldsSnapshot: Sendable, Equatable {
    public let schemaVersion: Int
    public let pages: [StoredPage]
}

public struct StoredHistoryEntry: Sendable, Equatable, Identifiable {
    public let id: Int64
    public let kind: String
    public let actor: String
    public let summary: String
    public let beforeJSON: String?
    public let afterJSON: String?
    public let createdAt: Int64
}
public enum WorldsDatabaseError: Error, LocalizedError {
    case invalidURL
    case sqlite(String)
    case unsupportedSchema(Int)
    case invalidData(String)
    public var errorDescription: String? {
        switch self {
        case .invalidURL: return "Choose a local database file."
        case .sqlite(let message): return "Database access failed: \(message)"
        case .unsupportedSchema(let version): return "Unsupported Worlds database schema: \(version)."
        case .invalidData(let field): return "Invalid database value: \(field)."
        }
    }
}

/// Read-only access to personal data. Shared workspace rows are intentionally
/// excluded until the native client can enforce the original access rules.
/// Opening does not create or migrate a database. WAL sidecars must be available.
public actor WorldsDatabase {
    nonisolated(unsafe) private let db: OpaquePointer
    private let version: Int
    // A missing sync field or missing shared flag is a legacy personal page.
    // Any malformed shape or non-boolean shared flag is excluded.
    private static let personalMetadata = """
    CASE WHEN json_valid(p.metadata) THEN
      json_type(p.metadata) = 'object' AND
      (SELECT COUNT(*) FROM json_each(p.metadata) WHERE key = 'sync') <= 1 AND
      (json_type(p.metadata, '$.sync') IS NULL OR
       (json_type(p.metadata, '$.sync') = 'object' AND
        (SELECT COUNT(*) FROM json_each(p.metadata, '$.sync') WHERE key = 'shared') <= 1 AND
        (json_type(p.metadata, '$.sync.shared') IS NULL OR json_type(p.metadata, '$.sync.shared') = 'false')))
    ELSE 0 END
    """

    public init(url: URL) throws {
        guard url.isFileURL, !url.path.isEmpty, !url.path.utf8.contains(0) else {
            throw WorldsDatabaseError.invalidURL
        }
        var handle: OpaquePointer?
        let status = sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil)
        guard status == SQLITE_OK, let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Could not open file"
            if let handle { sqlite3_close_v2(handle) }
            throw WorldsDatabaseError.sqlite(message)
        }
        do {
            sqlite3_busy_timeout(handle, 5000)
            try Self.exec(handle, "PRAGMA query_only = ON")
            try Self.exec(handle, "PRAGMA trusted_schema = OFF")
            let schema = try Self.scalarInt(handle, "PRAGMA user_version")
            guard (1...11).contains(schema) else { throw WorldsDatabaseError.unsupportedSchema(schema) }
            self.db = handle
            self.version = schema
        } catch {
            sqlite3_close_v2(handle)
            throw error
        }
    }

    deinit { sqlite3_close_v2(db) }

    /// Reads pages and their blocks in a single SQLite snapshot transaction.
    public func snapshot(includeDeleted: Bool = false) throws -> WorldsSnapshot {
        try Self.exec(db, "BEGIN DEFERRED TRANSACTION")
        do {
            var clauses: [String] = [Self.personalMetadata]
            if !includeDeleted { clauses.append("deleted_at IS NULL") }
            if version >= 5 { clauses.append("workspace_id IS NULL") }
            let filter = clauses.isEmpty ? "" : " WHERE " + clauses.joined(separator: " AND ")
            let sql = "SELECT id, title, kind, parent_id, preview, updated_at, metadata, archived, sort_key, created_at FROM pages p" + filter + " ORDER BY sort_key, created_at"
            let statement = try Self.prepare(db, sql)
            defer { sqlite3_finalize(statement) }
            var pages: [StoredPage] = []
            while true {
                let status = sqlite3_step(statement)
                if status == SQLITE_DONE { break }
                guard status == SQLITE_ROW else { throw Self.error(db) }
                let id = try Self.text(statement, 0, "page.id")
                let metadata = try Self.text(statement, 6, "page.metadata")
                pages.append(StoredPage(
                    id: id, title: try Self.text(statement, 1, "page.title"),
                    kind: try Self.text(statement, 2, "page.kind"),
                    parentID: try Self.optionalText(statement, 3, "page.parent_id"),
                    archived: sqlite3_column_int(statement, 7) != 0,
                    sortKey: sqlite3_column_double(statement, 8),
                    createdAt: sqlite3_column_int64(statement, 9),
                    preview: try Self.text(statement, 4, "page.preview"),
                    updatedAt: sqlite3_column_int64(statement, 5),
                    metadataJSON: metadata,
                    blocks: try blocks(pageID: id)))
            }
            try Self.exec(db, "COMMIT")
            return WorldsSnapshot(schemaVersion: version, pages: pages)
        } catch {
            try? Self.exec(db, "ROLLBACK")
            throw error
        }
    }

    /// Personal pages in the desktop's Trash (`deleted_at` set), one entry per
    /// Trash operation: a page whose parent went to Trash at the same moment
    /// comes back with that parent and is not listed separately. Blocks are
    /// not read. A restore must still be checked by the writer.
    public func trashedPages(limit: Int = 500) throws -> [StoredTrashedPage] {
        let workspace = version >= 5 ? " AND p.workspace_id IS NULL" : ""
        let sql = """
        SELECT p.id, p.title, p.kind, p.parent_id, p.preview, p.updated_at, p.metadata, p.archived, p.sort_key, p.created_at, p.deleted_at
        FROM pages p
        WHERE p.deleted_at IS NOT NULL\(workspace) AND (\(Self.personalMetadata))
          AND NOT EXISTS (SELECT 1 FROM pages pp WHERE pp.id = p.parent_id AND pp.deleted_at = p.deleted_at)
        ORDER BY p.deleted_at DESC, p.sort_key
        LIMIT ?1
        """
        try Self.exec(db, "BEGIN DEFERRED TRANSACTION")
        do {
            let statement = try Self.prepare(db, sql)
            defer { sqlite3_finalize(statement) }
            guard sqlite3_bind_int64(statement, 1, Int64(max(0, limit))) == SQLITE_OK else { throw Self.error(db) }
            var pages: [StoredTrashedPage] = []
            while true {
                let status = sqlite3_step(statement)
                if status == SQLITE_DONE { break }
                guard status == SQLITE_ROW else { throw Self.error(db) }
                guard sqlite3_column_type(statement, 10) == SQLITE_INTEGER else { throw WorldsDatabaseError.invalidData("page.deleted_at") }
                let page = StoredPage(
                    id: try Self.text(statement, 0, "page.id"), title: try Self.text(statement, 1, "page.title"),
                    kind: try Self.text(statement, 2, "page.kind"),
                    parentID: try Self.optionalText(statement, 3, "page.parent_id"),
                    archived: sqlite3_column_int(statement, 7) != 0,
                    sortKey: sqlite3_column_double(statement, 8),
                    createdAt: sqlite3_column_int64(statement, 9),
                    preview: try Self.text(statement, 4, "page.preview"),
                    updatedAt: sqlite3_column_int64(statement, 5),
                    metadataJSON: try Self.text(statement, 6, "page.metadata"),
                    blocks: [])
                pages.append(StoredTrashedPage(page: page, deletedAt: sqlite3_column_int64(statement, 10)))
            }
            try Self.exec(db, "COMMIT")
            return pages
        } catch {
            try? Self.exec(db, "ROLLBACK")
            throw error
        }
    }

    /// Reads only an attachment owned by the same personal, live file page.
    /// Ownership and metadata are checked in one SQLite read transaction.
    public func personalFileAttachment(pageID: String) throws -> StoredFileAttachment? {
        guard !pageID.isEmpty, !pageID.utf8.contains(0) else { throw WorldsDatabaseError.invalidData("page.id") }
        let workspace = version >= 5 ? " AND p.workspace_id IS NULL" : ""
        let sql = """
        SELECT a.id, a.page_id, a.kind, a.file_name, a.mime, a.size, a.rel_path, a.width, a.height, a.created_at
        FROM pages p JOIN attachments a ON a.page_id = p.id
        WHERE p.id = ?1 AND p.kind = 'file' AND p.deleted_at IS NULL \(workspace)
          AND CASE WHEN (\(Self.personalMetadata)) THEN
            (SELECT COUNT(*) FROM json_each(p.metadata) WHERE key = 'file') = 1 AND
            CASE WHEN json_type(p.metadata, '$.file') = 'object' THEN
              (SELECT COUNT(*) FROM json_each(p.metadata, '$.file') WHERE key = 'attachmentId') = 1 AND
              json_type(p.metadata, '$.file.attachmentId') = 'text' AND
              a.id = json_extract(p.metadata, '$.file.attachmentId')
            ELSE 0 END
          ELSE 0 END
        LIMIT 1
        """
        try Self.exec(db, "BEGIN DEFERRED TRANSACTION")
        do {
            let stmt = try Self.prepare(db, sql); defer { sqlite3_finalize(stmt) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(stmt, 1, pageID, -1, transient) == SQLITE_OK else { throw Self.error(db) }
            let status = sqlite3_step(stmt)
            let value: StoredFileAttachment?
            if status == SQLITE_DONE { value = nil }
            else if status == SQLITE_ROW {
                guard sqlite3_column_type(stmt, 5) == SQLITE_INTEGER,
                      sqlite3_column_type(stmt, 9) == SQLITE_INTEGER,
                      [7, 8].allSatisfy({ sqlite3_column_type(stmt, Int32($0)) == SQLITE_NULL || sqlite3_column_type(stmt, Int32($0)) == SQLITE_INTEGER }) else { throw WorldsDatabaseError.invalidData("attachment.metadata") }
                let size = sqlite3_column_int64(stmt, 5)
                guard size >= 0 else { throw WorldsDatabaseError.invalidData("attachment.size") }
                value = StoredFileAttachment(id: try Self.text(stmt, 0, "attachment.id"), pageID: try Self.text(stmt, 1, "attachment.page_id"), kind: try Self.text(stmt, 2, "attachment.kind"), fileName: try Self.text(stmt, 3, "attachment.file_name"), mime: try Self.text(stmt, 4, "attachment.mime"), size: size, relPath: try Self.text(stmt, 6, "attachment.rel_path"), width: sqlite3_column_type(stmt, 7) == SQLITE_NULL ? nil : sqlite3_column_int64(stmt, 7), height: sqlite3_column_type(stmt, 8) == SQLITE_NULL ? nil : sqlite3_column_int64(stmt, 8), createdAt: sqlite3_column_int64(stmt, 9))
            } else { throw Self.error(db) }
            try Self.exec(db, "COMMIT"); return value
        } catch { try? Self.exec(db, "ROLLBACK"); throw error }
    }

    /// Experimental: only a root image block whose attachment record belongs
    /// to the same live personal page. This is a snapshot, not an ACL lease.
    public func personalInlineImage(pageID: String, blockID: String) throws -> StoredFileAttachment? {
        guard !pageID.isEmpty, !blockID.isEmpty, !pageID.utf8.contains(0), !blockID.utf8.contains(0) else { throw WorldsDatabaseError.invalidData("image identity") }
        let workspace = version >= 5 ? " AND p.workspace_id IS NULL" : ""
        let sql = """
        SELECT a.id, a.page_id, a.kind, a.file_name, a.mime, a.size, a.rel_path, a.width, a.height, a.created_at
        FROM pages p JOIN blocks b ON b.page_id = p.id JOIN attachments a ON a.page_id = p.id
        WHERE p.id = ?1 AND b.id = ?2 AND p.kind IN ('page','document') AND p.deleted_at IS NULL \(workspace)
          AND CASE WHEN (\(Self.personalMetadata)) THEN
            NOT EXISTS (SELECT 1 FROM json_tree(p.metadata) WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1)
          ELSE 0 END
          AND CASE WHEN json_valid(b.content) THEN
            json_type(b.content) = 'object' AND
            NOT EXISTS (SELECT 1 FROM json_tree(b.content) WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1) AND
            json_extract(b.content, '$.type') = 'image' AND
            json_type(b.content, '$.attrs') = 'object' AND
            json_type(b.content, '$.attrs.attachmentId') = 'text' AND
            a.id = json_extract(b.content, '$.attrs.attachmentId')
          ELSE 0 END
        LIMIT 1
        """
        try Self.exec(db, "BEGIN DEFERRED TRANSACTION")
        do {
            let stmt = try Self.prepare(db, sql); defer { sqlite3_finalize(stmt) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(stmt, 1, pageID, -1, transient) == SQLITE_OK,
                  sqlite3_bind_text(stmt, 2, blockID, -1, transient) == SQLITE_OK else { throw Self.error(db) }
            let status = sqlite3_step(stmt)
            let value: StoredFileAttachment?
            if status == SQLITE_DONE { value = nil }
            else if status == SQLITE_ROW {
                guard sqlite3_column_type(stmt, 5) == SQLITE_INTEGER, sqlite3_column_type(stmt, 9) == SQLITE_INTEGER,
                      [7, 8].allSatisfy({ sqlite3_column_type(stmt, Int32($0)) == SQLITE_NULL || sqlite3_column_type(stmt, Int32($0)) == SQLITE_INTEGER }) else { throw WorldsDatabaseError.invalidData("attachment.metadata") }
                let size = sqlite3_column_int64(stmt, 5)
                guard size >= 0 else { throw WorldsDatabaseError.invalidData("attachment.size") }
                value = StoredFileAttachment(id: try Self.text(stmt, 0, "attachment.id"), pageID: try Self.text(stmt, 1, "attachment.page_id"), kind: try Self.text(stmt, 2, "attachment.kind"), fileName: try Self.text(stmt, 3, "attachment.file_name"), mime: try Self.text(stmt, 4, "attachment.mime"), size: size, relPath: try Self.text(stmt, 6, "attachment.rel_path"), width: sqlite3_column_type(stmt, 7) == SQLITE_NULL ? nil : sqlite3_column_int64(stmt, 7), height: sqlite3_column_type(stmt, 8) == SQLITE_NULL ? nil : sqlite3_column_int64(stmt, 8), createdAt: sqlite3_column_int64(stmt, 9))
            } else { throw Self.error(db) }
            try Self.exec(db, "COMMIT"); return value
        } catch { try? Self.exec(db, "ROLLBACK"); throw error }
    }

    /// Returns whether the persisted page was updated after the caller's base.
    /// A missing or non-personal page is rejected, never treated as unchanged.
    public func pageChangedSince(id: String, base: Int64) throws -> Bool {
        let current = try snapshot(includeDeleted: true)
        guard let page = current.pages.first(where: { $0.id == id }) else {
            throw WorldsDatabaseError.invalidData("page unavailable")
        }
        return page.updatedAt > base
    }

    /// Simple title-only lookup. This is not the original FTS5 search.
    public func searchPersonalTitles(_ query: String, limit: Int = 30) throws -> [StoredPage] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, limit > 0 else { return [] }
        let data = try snapshot()
        return Array(data.pages.filter { $0.title.localizedCaseInsensitiveContains(query) }
            .sorted { $0.updatedAt > $1.updatedAt }.prefix(min(limit, 1000)))
    }
    /// Reads the original history table. Shared rows are filtered in SQL.
    public func personalHistory(pageID: String, limit: Int = 100) throws -> [StoredHistoryEntry] {
        let workspace = version >= 5 ? " AND p.workspace_id IS NULL" : ""
        let sql = "SELECT h.id,h.kind,h.actor,h.summary,h.before,h.after,h.created_at FROM history h JOIN pages p ON p.id=h.page_id WHERE p.id=?1" + workspace + " AND (" + Self.personalMetadata + ") ORDER BY h.id DESC LIMIT ?2"
        let stmt = try Self.prepare(db, sql)
        defer { sqlite3_finalize(stmt) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(stmt, 1, pageID, -1, transient) == SQLITE_OK,
              sqlite3_bind_int(stmt, 2, Int32(max(1, min(limit, 1000)))) == SQLITE_OK else { throw Self.error(db) }
        var entries: [StoredHistoryEntry] = []
        while true {
            let status = sqlite3_step(stmt)
            if status == SQLITE_DONE { return entries }
            guard status == SQLITE_ROW else { throw Self.error(db) }
            entries.append(StoredHistoryEntry(id: sqlite3_column_int64(stmt, 0), kind: try Self.text(stmt, 1, "history.kind"), actor: try Self.text(stmt, 2, "history.actor"), summary: try Self.text(stmt, 3, "history.summary"), beforeJSON: try Self.optionalText(stmt, 4, "history.before"), afterJSON: try Self.optionalText(stmt, 5, "history.after"), createdAt: sqlite3_column_int64(stmt, 6)))
        }
    }

    /// Authorizes a live personal page and reads its history in one snapshot.
    /// An unavailable page is distinct from a page with no history.
    /// This does not prove that historical entries were created while the page
    /// was personal. Do not expose them without a separate provenance policy.
    public func checkedPersonalHistory(pageID: String, limit: Int = 100) throws -> [StoredHistoryEntry] {
        guard !pageID.isEmpty, !pageID.utf8.contains(0) else { throw WorldsDatabaseError.invalidData("page unavailable") }
        let workspace = version >= 5 ? " AND p.workspace_id IS NULL" : ""
        try Self.exec(db, "BEGIN DEFERRED TRANSACTION")
        do {
            let uniqueMetadata = """
            CASE WHEN json_valid(p.metadata) THEN NOT EXISTS (
                SELECT 1 FROM json_tree(p.metadata)
                WHERE key IS NOT NULL GROUP BY parent, key HAVING COUNT(*) > 1
            ) ELSE 0 END
            """
            let sql = "SELECT 1 FROM pages p WHERE p.id=?1 AND p.deleted_at IS NULL" + workspace + " AND (" + Self.personalMetadata + ") AND (" + uniqueMetadata + ")"
            let stmt = try Self.prepare(db, sql)
            defer { sqlite3_finalize(stmt) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(stmt, 1, pageID, -1, transient) == SQLITE_OK else { throw Self.error(db) }
            let result = sqlite3_step(stmt)
            guard result != SQLITE_DONE else { throw WorldsDatabaseError.invalidData("page unavailable") }
            guard result == SQLITE_ROW else { throw Self.error(db) }
            guard sqlite3_step(stmt) == SQLITE_DONE else { throw WorldsDatabaseError.invalidData("page unavailable") }
            let entries = try personalHistory(pageID: pageID, limit: limit)
            try Self.exec(db, "COMMIT")
            return entries
        } catch {
            try? Self.exec(db, "ROLLBACK")
            throw error
        }
    }
    private func blocks(pageID: String) throws -> [StoredBlock] {
        let stmt = try Self.prepare(db, "SELECT id, type, content, properties, direction, sort_key FROM blocks WHERE page_id = ?1 ORDER BY sort_key")
        defer { sqlite3_finalize(stmt) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(stmt, 1, pageID, -1, transient) == SQLITE_OK else { throw Self.error(db) }
        var blocks: [StoredBlock] = []
        while true {
            let result = sqlite3_step(stmt)
            if result == SQLITE_DONE { return blocks }
            guard result == SQLITE_ROW else { throw Self.error(db) }
            blocks.append(StoredBlock(id: try Self.text(stmt, 0, "block.id"), type: try Self.text(stmt, 1, "block.type"), contentJSON: try Self.text(stmt, 2, "block.content"), propertiesJSON: try Self.text(stmt, 3, "block.properties"), direction: try Self.text(stmt, 4, "block.direction"), sortKey: sqlite3_column_double(stmt, 5)))
        }
    }

    private static func text(_ stmt: OpaquePointer, _ index: Int32, _ field: String) throws -> String {
        guard sqlite3_column_type(stmt, index) == SQLITE_TEXT, let bytes = sqlite3_column_text(stmt, index) else { throw WorldsDatabaseError.invalidData(field) }
        let count = Int(sqlite3_column_bytes(stmt, index))
        guard let value = String(bytes: UnsafeBufferPointer(start: bytes, count: count), encoding: .utf8) else { throw WorldsDatabaseError.invalidData(field) }
        return value
    }
    private static func optionalText(_ stmt: OpaquePointer, _ index: Int32, _ field: String) throws -> String? {
        if sqlite3_column_type(stmt, index) == SQLITE_NULL { return nil }
        return try text(stmt, index, field)
    }
    private static func error(_ db: OpaquePointer) -> WorldsDatabaseError { .sqlite(String(cString: sqlite3_errmsg(db))) }
    private static func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw error(db) }
        return statement
    }
    private static func exec(_ db: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw error(db) }
    }
    private static func scalarInt(_ db: OpaquePointer, _ sql: String) throws -> Int {
        let statement = try prepare(db, sql)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW else { throw error(db) }
        return Int(sqlite3_column_int(statement, 0))
    }
}




