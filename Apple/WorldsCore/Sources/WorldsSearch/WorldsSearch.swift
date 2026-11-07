import Foundation
import SQLite3

public struct WorldsSearchHit: Sendable, Equatable, Identifiable {
    public let pageId: String
    public let title: String
    public let icon: String?
    public let kind: String
    /// Highlight spans are delimited by U+E000 and U+E001, as in Worlds.
    public let snippet: String
    public let parentTitle: String?
    public let updatedAt: Int64
    public var id: String { pageId }
}
public enum WorldsSearchError: Error, LocalizedError {
    case invalidURL, invalidQuery, unsupportedSchema(Int), database(String), malformedData
    public var errorDescription: String? {
        switch self {
        case .invalidURL: return "Choose an existing local Worlds database."
        case .invalidQuery: return "The search query is invalid or too long."
        case .unsupportedSchema(let version): return "Unsupported database schema: \(version)."
        case .database(let message): return "Search is unavailable: \(message)"
        case .malformedData: return "Search data is malformed."
        }
    }
}

/// Personal local content only. This does not authorize shared workspaces.
public actor WorldsSearch {
    nonisolated(unsafe) private let db: OpaquePointer
    private let schema: Int
    private let scopedURL: URL
    private let hasScope: Bool
    public init(url: URL) throws {
        guard url.isFileURL, !url.path.isEmpty else { throw WorldsSearchError.invalidURL }
        let hasScope = url.startAccessingSecurityScopedResource()
        var connection: OpaquePointer?
        guard sqlite3_open_v2(url.path, &connection, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let connection else {
            let message = connection.map { String(cString: sqlite3_errmsg($0)) } ?? "Unable to open database"
            if let connection { sqlite3_close_v2(connection) }
            if hasScope { url.stopAccessingSecurityScopedResource() }
            throw WorldsSearchError.database(message)
        }
        do {
            sqlite3_busy_timeout(connection, 5000)
            try Self.execute(connection, "PRAGMA query_only = ON")
            try Self.execute(connection, "PRAGMA trusted_schema = OFF")
            let statement = try Self.prepare(connection, "PRAGMA user_version")
            defer { sqlite3_finalize(statement) }
            guard sqlite3_step(statement) == SQLITE_ROW else { throw Self.error(connection) }
            let version = Int(sqlite3_column_int(statement, 0))
            guard (1...11).contains(version) else { throw WorldsSearchError.unsupportedSchema(version) }
            self.db = connection; self.schema = version; self.scopedURL = url; self.hasScope = hasScope
        } catch { sqlite3_close_v2(connection); if hasScope { url.stopAccessingSecurityScopedResource() }; throw error }
    }
    deinit { sqlite3_close_v2(db); if hasScope { scopedURL.stopAccessingSecurityScopedResource() } }

    /// Uses Worlds' trigram MATCH, BM25, snippet markers, title fallback and
    /// ordering. Archived pages are included; deleted pages are excluded.
    public func search(_ query: String, limit: Int = 30, includeTemplates: Bool = true) throws -> [WorldsSearchHit] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, limit > 0 else { return [] }
        guard q.utf8.count <= 4096, !q.utf8.contains(0) else { throw WorldsSearchError.invalidQuery }
        let cap = min(limit, 1000)
        let kind = includeTemplates ? "" : " AND p.kind != 'template'"
        let access = Self.personal(alias: "p", schema: schema)
        let parentAccess = Self.personal(alias: "pp", schema: schema)
        let parent = "(SELECT pp.title FROM pages pp WHERE pp.id=p.parent_id AND \(parentAccess))"
        let fields = "p.id,p.title,p.icon,p.kind,"
        try Self.execute(db, "BEGIN DEFERRED TRANSACTION")
        do {
            var hits: [WorldsSearchHit] = []
            if q.unicodeScalars.count >= 3 {
                let terms = q.split(whereSeparator: { $0.isWhitespace }).filter { $0.unicodeScalars.count >= 3 }
                let expression = terms.map { "\"" + $0.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }.joined(separator: " AND ")
                if !expression.isEmpty {
                    let sql = "SELECT \(fields)snippet(pages_fts,2,'\u{E000}','\u{E001}','…',12),\(parent),p.updated_at FROM pages_fts f JOIN pages p ON p.id=f.page_id WHERE pages_fts MATCH ?1 AND p.deleted_at IS NULL \(kind) AND \(access) ORDER BY bm25(pages_fts,0.0,8.0,1.0) LIMIT ?2"
                    hits = try queryRows(sql, text: expression, limit: cap)
                }
            }
            if hits.count < cap {
                let pattern = "%" + q.replacingOccurrences(of: "%", with: "\\%").replacingOccurrences(of: "_", with: "\\_") + "%"
                let sql = "SELECT \(fields)p.preview,\(parent),p.updated_at FROM pages p WHERE p.title LIKE ?1 ESCAPE '\\' AND p.deleted_at IS NULL \(kind) AND \(access) ORDER BY p.updated_at DESC LIMIT ?2"
                let extra = try queryRows(sql, text: pattern, limit: cap)
                var ids = Set(hits.map(\.pageId))
                for hit in extra where ids.insert(hit.pageId).inserted { hits.append(hit) }
            }
            try Self.execute(db, "COMMIT")
            return Array(hits.prefix(cap))
        } catch { try? Self.execute(db, "ROLLBACK"); throw error }
    }

    private static func personal(alias: String, schema: Int) -> String {
        let workspace = schema >= 5 ? "\(alias).workspace_id IS NULL AND " : ""
        // CASE avoids extracting from malformed JSON. Unknown sync values fail closed.
        return workspace + "CASE WHEN json_valid(\(alias).metadata) THEN CASE WHEN json_type(\(alias).metadata) != 'object' THEN 0 WHEN json_type(\(alias).metadata,'$.sync') IS NULL THEN 1 WHEN json_type(\(alias).metadata,'$.sync') = 'object' AND (json_type(\(alias).metadata,'$.sync.shared') IS NULL OR json_type(\(alias).metadata,'$.sync.shared') = 'false') THEN 1 ELSE 0 END ELSE 0 END = 1"
    }
    private func queryRows(_ sql: String, text: String, limit: Int) throws -> [WorldsSearchHit] {
        let statement = try Self.prepare(db, sql)
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(statement, 1, text, -1, transient) == SQLITE_OK,
              sqlite3_bind_int(statement, 2, Int32(limit)) == SQLITE_OK else { throw Self.error(db) }
        var hits: [WorldsSearchHit] = []
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return hits }
            guard status == SQLITE_ROW else { throw Self.error(db) }
            hits.append(WorldsSearchHit(pageId: try Self.text(statement, 0), title: try Self.text(statement, 1), icon: try Self.optionalText(statement, 2), kind: try Self.text(statement, 3), snippet: try Self.text(statement, 4), parentTitle: try Self.optionalText(statement, 5), updatedAt: sqlite3_column_int64(statement, 6)))
        }
    }
    private static func text(_ statement: OpaquePointer, _ index: Int32) throws -> String {
        guard sqlite3_column_type(statement, index) == SQLITE_TEXT, let pointer = sqlite3_column_text(statement, index),
              let value = String(bytes: UnsafeBufferPointer(start: pointer, count: Int(sqlite3_column_bytes(statement, index))), encoding: .utf8) else { throw WorldsSearchError.malformedData }
        return value
    }
    private static func optionalText(_ statement: OpaquePointer, _ index: Int32) throws -> String? {
        if sqlite3_column_type(statement, index) == SQLITE_NULL { return nil }
        return try text(statement, index)
    }
    private static func error(_ db: OpaquePointer) -> WorldsSearchError { .database(String(cString: sqlite3_errmsg(db))) }
    private static func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw error(db) }
        return statement
    }
    private static func execute(_ db: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw error(db) }
    }
}



public struct SearchSnippetRun: Sendable, Equatable {
    public let text: String
    public let highlighted: Bool
}

public extension WorldsSearchHit {
    /// Mirrors the command palette's highlight markers without interpreting HTML.
    var snippetRuns: [SearchSnippetRun] {
        let start = "\u{E000}", end = "\u{E001}"
        var remaining = snippet[...]
        var runs: [SearchSnippetRun] = []
        while let opening = remaining.range(of: start), let closing = remaining[opening.upperBound...].range(of: end) {
            if opening.lowerBound > remaining.startIndex { runs.append(.init(text: String(remaining[..<opening.lowerBound]), highlighted: false)) }
            runs.append(.init(text: String(remaining[opening.upperBound..<closing.lowerBound]), highlighted: true))
            remaining = remaining[closing.upperBound...]
        }
        if !remaining.isEmpty { runs.append(.init(text: String(remaining), highlighted: false)) }
        return runs
    }
}
