import Foundation
import CoreFoundation
import SQLite3

/// This is an opaque record snapshot, not a portable Worlds project package.
public struct DrawingRecordSnapshot: Codable, Equatable, Sendable {
    public struct Operation: Codable, Equatable, Sendable {
        public let id: String; public let revision: Int64; public let actor: String
        public let payload: String; public let createdAt: Int64
    }
    public struct Version: Codable, Equatable, Sendable {
        public let id: String; public let revision: Int64; public let label: String
        public let author: String; public let scene: String; public let createdAt: Int64
    }
    public let pageID: String; public let revision: Int64
    public let seed: String; public let scene: String; public let searchText: String
    public let thumbnailID: String?; public let updatedAt: Int64
    public let operations: [Operation]; public let versions: [Version]
}
public enum DrawingStorageError: Error { case invalidInput, unsupportedSchema, unavailable, invalidData, database }

/// Personal records only; this reader never opens a database for writing or migrates it.
public actor DrawingStorageReader {
    nonisolated(unsafe) private let db: OpaquePointer
    public init(url: URL) throws {
        guard url.isFileURL, !url.path.isEmpty, !url.path.utf8.contains(0) else { throw DrawingStorageError.invalidInput }
        var connection: OpaquePointer?
        guard sqlite3_open_v2(url.path, &connection, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let connection else { if let connection { sqlite3_close_v2(connection) }; throw DrawingStorageError.database }
        do {
            sqlite3_busy_timeout(connection, 5000)
            try Self.exec(connection, "PRAGMA query_only=ON")
            try Self.exec(connection, "PRAGMA trusted_schema=OFF")
            let q = try Self.prepare(connection, "PRAGMA user_version"); defer { sqlite3_finalize(q) }
            guard sqlite3_step(q) == SQLITE_ROW, (10...11).contains(Int(sqlite3_column_int(q, 0))) else { throw DrawingStorageError.unsupportedSchema }
            db = connection
        } catch { sqlite3_close_v2(connection); throw error }
    }
    deinit { sqlite3_close_v2(db) }
    private static func exec(_ db: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw DrawingStorageError.database }
    }
    private static func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw DrawingStorageError.database }
        return statement
    }
    private static func bind(_ statement: OpaquePointer, _ value: String) throws {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard !value.isEmpty, !value.utf8.contains(0), sqlite3_bind_text(statement, 1, value, -1, transient) == SQLITE_OK else { throw DrawingStorageError.invalidInput }
    }
    private static func text(_ statement: OpaquePointer, _ column: Int32) throws -> String {
        guard sqlite3_column_type(statement, column) == SQLITE_TEXT,
              let pointer = sqlite3_column_text(statement, column) else { throw DrawingStorageError.invalidData }
        let count = Int(sqlite3_column_bytes(statement, column))
        guard let value = String(data: Data(bytes: pointer, count: count), encoding: .utf8) else { throw DrawingStorageError.invalidData }
        return value
    }
    private static func next(_ statement: OpaquePointer) throws -> Bool {
        let status = sqlite3_step(statement)
        if status == SQLITE_DONE { return false }
        guard status == SQLITE_ROW else { throw DrawingStorageError.database }
        return true
    }
    /// Consistent read transaction across page authorization, document, operations and versions.
    public func snapshot(pageID: String) throws -> DrawingRecordSnapshot {
        try Self.exec(db, "BEGIN")
        do {
            let page = try Self.prepare(db, "SELECT metadata FROM pages WHERE id=?1 AND kind='drawing' AND deleted_at IS NULL AND workspace_id IS NULL AND NOT EXISTS (SELECT 1 FROM drawing_sync_state WHERE page_id=pages.id)")
            defer { sqlite3_finalize(page) }
            try Self.bind(page, pageID)
            guard try Self.next(page) else { throw DrawingStorageError.unavailable }
            let metadata = try Self.text(page, 0)
            guard let object = (try? JSONSerialization.jsonObject(with: Data(metadata.utf8))) as? [String: Any] else { throw DrawingStorageError.invalidData }
            if let sync = object["sync"] {
                guard let sync = sync as? [String: Any] else { throw DrawingStorageError.unavailable }
                if let shared = sync["shared"] {
                    guard let flag = shared as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID(), !flag.boolValue else { throw DrawingStorageError.unavailable }
                }
            }
            let doc = try Self.prepare(db, "SELECT revision,seed,scene,search_text,thumbnail_id,updated_at FROM drawing_documents WHERE page_id=?1")
            defer { sqlite3_finalize(doc) }
            try Self.bind(doc, pageID)
            guard try Self.next(doc) else { throw DrawingStorageError.unavailable }
            let revision = sqlite3_column_int64(doc, 0), seed = try Self.text(doc, 1), scene = try Self.text(doc, 2)
            let search = try Self.text(doc, 3)
            let thumbnail: String? = try sqlite3_column_type(doc, 4) == SQLITE_NULL ? nil : Self.text(doc, 4)
            let updated = sqlite3_column_int64(doc, 5)
            let operationsQuery = try Self.prepare(db, "SELECT id,revision,actor,payload,created_at FROM drawing_operations WHERE page_id=?1 ORDER BY revision")
            defer { sqlite3_finalize(operationsQuery) }
            try Self.bind(operationsQuery, pageID)
            var operations: [DrawingRecordSnapshot.Operation] = []
            while try Self.next(operationsQuery) {
                operations.append(.init(id: try Self.text(operationsQuery, 0), revision: sqlite3_column_int64(operationsQuery, 1), actor: try Self.text(operationsQuery, 2), payload: try Self.text(operationsQuery, 3), createdAt: sqlite3_column_int64(operationsQuery, 4)))
            }
            let versionsQuery = try Self.prepare(db, "SELECT id,revision,label,author,scene,created_at FROM drawing_versions WHERE page_id=?1 ORDER BY created_at,id")
            defer { sqlite3_finalize(versionsQuery) }
            try Self.bind(versionsQuery, pageID)
            var versions: [DrawingRecordSnapshot.Version] = []
            while try Self.next(versionsQuery) {
                versions.append(.init(id: try Self.text(versionsQuery, 0), revision: sqlite3_column_int64(versionsQuery, 1), label: try Self.text(versionsQuery, 2), author: try Self.text(versionsQuery, 3), scene: try Self.text(versionsQuery, 4), createdAt: sqlite3_column_int64(versionsQuery, 5)))
            }
            try Self.exec(db, "COMMIT")
            return DrawingRecordSnapshot(pageID: pageID, revision: revision, seed: seed, scene: scene, searchText: search, thumbnailID: thumbnail, updatedAt: updated, operations: operations, versions: versions)
        } catch { try? Self.exec(db, "ROLLBACK"); throw error }
    }
}
