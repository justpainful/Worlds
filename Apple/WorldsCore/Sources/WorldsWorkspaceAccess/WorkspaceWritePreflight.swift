import Foundation
import SQLite3

/// Whether a database the person opened may be written in place.
public enum WorkspaceWriteAccess: Sendable, Equatable {
    case writable
    case readOnly(Reason)

    public enum Reason: String, Sendable, Equatable {
        /// Not an existing regular local file.
        case notLocalFile
        /// iCloud Drive or another file provider. SQLite cannot coordinate
        /// with their syncing, which can replace the file under an open writer.
        case cloudStorage
        /// A network or unknown volume, where SQLite file locks are unreliable.
        case networkVolume
        /// The file or its folder (needed for the WAL and lock files) is read only.
        case notWritable
        /// RustStore writes only schema version 11, the desktop's current schema.
        case unsupportedSchema
        /// The file is not a Worlds database.
        case notWorldsDatabase
        /// SQLite could not open the database for writing.
        case unavailable
    }
}

/// What is known about where a database file lives.
public struct WorkspaceLocationFacts: Sendable, Equatable {
    public var path: String
    public var resolvedPath: String
    public var isRegularFile: Bool
    public var isUbiquitous: Bool?
    public var volumeIsLocal: Bool?
    public var isWritable: Bool
    public var directoryIsWritable: Bool

    public init(path: String, resolvedPath: String, isRegularFile: Bool, isUbiquitous: Bool?, volumeIsLocal: Bool?, isWritable: Bool, directoryIsWritable: Bool) {
        self.path = path
        self.resolvedPath = resolvedPath
        self.isRegularFile = isRegularFile
        self.isUbiquitous = isUbiquitous
        self.volumeIsLocal = volumeIsLocal
        self.isWritable = isWritable
        self.directoryIsWritable = directoryIsWritable
    }
}

/// Decides, before any editor opens, whether the person's own database can be
/// written in place. Every check fails closed: the database then stays read
/// only and the person can still make an independent local copy.
public enum WorkspaceWritePreflight {
    public static let supportedSchemaVersion = 11

    /// Path components used by iCloud Drive and File Provider extensions on
    /// macOS and iOS. Their syncing replaces files without SQLite's locks.
    static let cloudPathMarkers = [
        "/Library/Mobile Documents/",
        "/Library/CloudStorage/",
        "/File Provider Storage/",
        "/com~apple~CloudDocs/",
    ]

    public enum LockProbe: Sendable, Equatable {
        /// A write lock was taken and released at once.
        case acquired
        /// Another writer (for example the desktop app) holds the lock. The
        /// database is writable; RustStore waits for its turn on every save.
        case busy
        case failed
    }

    /// The location part of the decision, with no file access.
    public static func locationProblem(_ facts: WorkspaceLocationFacts) -> WorkspaceWriteAccess.Reason? {
        guard facts.isRegularFile else { return .notLocalFile }
        if facts.isUbiquitous == true { return .cloudStorage }
        for path in [facts.path, facts.resolvedPath] where cloudPathMarkers.contains(where: { path.contains($0) }) {
            return .cloudStorage
        }
        guard facts.volumeIsLocal == true else { return .networkVolume }
        guard facts.isWritable, facts.directoryIsWritable else { return .notWritable }
        return nil
    }

    /// The complete decision from gathered facts.
    public static func decide(location: WorkspaceLocationFacts, schemaVersion: Int?, hasWorldsTables: Bool, lock: LockProbe) -> WorkspaceWriteAccess {
        if let problem = locationProblem(location) { return .readOnly(problem) }
        guard let schemaVersion else { return .readOnly(.unavailable) }
        guard hasWorldsTables else { return .readOnly(.notWorldsDatabase) }
        guard schemaVersion == supportedSchemaVersion else { return .readOnly(.unsupportedSchema) }
        switch lock {
        case .acquired, .busy: return .writable
        case .failed: return .readOnly(.unavailable)
        }
    }

    /// Reads the location facts, then opens the database for writing and takes
    /// and releases a write lock (`BEGIN IMMEDIATE` then `ROLLBACK`). No data
    /// changes. Call off the main actor while holding any security scope.
    public static func evaluate(_ url: URL) -> WorkspaceWriteAccess {
        guard url.isFileURL, !url.path.isEmpty, !url.path.utf8.contains(0) else { return .readOnly(.notLocalFile) }
        let facts = locationFacts(url)
        if let problem = locationProblem(facts) { return .readOnly(problem) }
        let probe = probeDatabase(url)
        return decide(location: facts, schemaVersion: probe.schemaVersion, hasWorldsTables: probe.hasWorldsTables, lock: probe.lock)
    }

    public static func locationFacts(_ url: URL) -> WorkspaceLocationFacts {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey, .isUbiquitousItemKey, .volumeIsLocalKey, .isWritableKey]
        let values = try? url.resourceValues(forKeys: keys)
        let directory = url.deletingLastPathComponent()
        return WorkspaceLocationFacts(
            path: url.standardizedFileURL.path,
            resolvedPath: url.resolvingSymlinksInPath().standardizedFileURL.path,
            isRegularFile: values?.isRegularFile == true && values?.isSymbolicLink != true,
            isUbiquitous: values?.isUbiquitousItem,
            volumeIsLocal: values?.volumeIsLocal,
            isWritable: values?.isWritable == true,
            directoryIsWritable: FileManager.default.isWritableFile(atPath: directory.path)
        )
    }

    struct DatabaseProbe: Equatable {
        var schemaVersion: Int?
        var hasWorldsTables: Bool
        var lock: LockProbe
    }

    static func probeDatabase(_ url: URL) -> DatabaseProbe {
        var handle: OpaquePointer?
        // No SQLITE_OPEN_CREATE: a missing file must never become a new database.
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db = handle else {
            if let handle { sqlite3_close_v2(handle) }
            return DatabaseProbe(schemaVersion: nil, hasWorldsTables: false, lock: .failed)
        }
        defer { sqlite3_close_v2(db) }
        sqlite3_busy_timeout(db, 1500)
        _ = sqlite3_exec(db, "PRAGMA trusted_schema = OFF", nil, nil, nil)
        var version: Int?
        var statement: OpaquePointer?
        if sqlite3_prepare_v2(db, "PRAGMA user_version", -1, &statement, nil) == SQLITE_OK, let statement {
            if sqlite3_step(statement) == SQLITE_ROW { version = Int(sqlite3_column_int64(statement, 0)) }
            sqlite3_finalize(statement)
        }
        // The columns RustStore reads and writes for personal pages.
        var tables = true
        for sql in ["SELECT id,kind,metadata,workspace_id,deleted_at,updated_at FROM pages LIMIT 0",
                    "SELECT id,page_id,content,sort_key FROM blocks LIMIT 0",
                    "SELECT page_id,kind,origin,at FROM changes LIMIT 0",
                    "SELECT id,page_id,snapshot FROM versions LIMIT 0"] {
            var check: OpaquePointer?
            let status = sqlite3_prepare_v2(db, sql, -1, &check, nil)
            if let check { sqlite3_finalize(check) }
            if status != SQLITE_OK { tables = false; break }
        }
        guard version != nil, tables else { return DatabaseProbe(schemaVersion: version, hasWorldsTables: tables, lock: .failed) }
        let lock: LockProbe
        switch sqlite3_exec(db, "BEGIN IMMEDIATE", nil, nil, nil) {
        case SQLITE_OK:
            _ = sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
            lock = .acquired
        case SQLITE_BUSY, SQLITE_LOCKED:
            lock = .busy
        default:
            lock = .failed
        }
        return DatabaseProbe(schemaVersion: version, hasWorldsTables: tables, lock: lock)
    }
}
