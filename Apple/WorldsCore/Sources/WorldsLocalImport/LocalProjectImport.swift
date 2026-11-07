import Foundation
import SQLite3
import Darwin

/// Backup implementations must copy a consistent SQLite snapshot, including
/// committed WAL content, into a new directory under the supplied private root.
/// NativeSQLiteBackup provides an experimental Rust implementation.
public protocol LocalSQLiteBackup: Sendable {
    func importSnapshot(source: URL, privateRoot: URL) async throws -> URL
}

public struct LocalProjectCopy: Sendable {
    public let databaseURL: URL
    /// Persist this identifier to reopen this copy; it does not identify the source.
    public let id: UUID
    /// A copy is independent: external attachments and synchronization are absent.
    public let isIndependentCopy = true
}

public struct LocalCopyInventory: Sendable {
    public let copies: [LocalProjectCopy]
    /// Candidate directories that failed validation, including incomplete imports.
    public let rejectedCount: Int
}

public enum LocalImportError: Error {
    case invalidSource, invalidContainer, invalidBackup, unsupportedDatabase
}

/// Experimental coordinator. The returned database is a full snapshot, not a
/// filtered export: callers must continue to enforce all personal access rules.
public actor LocalProjectImportCoordinator {
    private let root: URL
    private let backup: any LocalSQLiteBackup

    public init(backup: any LocalSQLiteBackup) throws {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw LocalImportError.invalidContainer
        }
        // Resolve system path aliases such as /var before creating our own
        // directory; validate our resulting path again before every import.
        self.root = support.resolvingSymlinksInPath().appendingPathComponent("Worlds/LocalCopies", isDirectory: true)
        self.backup = backup
    }

    // Internal injection permits isolated fixtures without redirecting a real user's data.
    init(testRoot: URL, backup: any LocalSQLiteBackup) {
        self.root = testRoot
        self.backup = backup
    }

    #if DEBUG
    public static func isolatedTestCoordinator(root: URL, backup: any LocalSQLiteBackup) throws -> LocalProjectImportCoordinator {
        let temporary = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().standardizedFileURL.path
        let path = root.resolvingSymlinksInPath().standardizedFileURL.path
        guard root.isFileURL, path.hasPrefix(temporary.hasSuffix("/") ? temporary : temporary + "/") else {
            throw LocalImportError.invalidContainer
        }
        return LocalProjectImportCoordinator(testRoot: root.resolvingSymlinksInPath(), backup: backup)
    }
    #endif

    public func importCopy(from source: URL) async throws -> LocalProjectCopy {
        guard source.isFileURL else { throw LocalImportError.invalidSource }
        try Task.checkCancellation()
        try prepareContainer()
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let destination = try await backup.importSnapshot(source: source, privateRoot: root)
        try Task.checkCancellation()
        return try validatedCopy(destination)
    }

    /// Reopens an existing local copy after restart without accessing its source.
    public func restoreCopy(id: UUID) throws -> LocalProjectCopy {
        try prepareContainer()
        let directory = root.appendingPathComponent("worlds-import-\(id.uuidString.lowercased())", isDirectory: true)
        return try validatedCopy(directory.appendingPathComponent("worlds.db"))
    }

    /// Does not remove malformed, incomplete or otherwise inaccessible copies.
    public func listCopies() throws -> LocalCopyInventory {
        try prepareContainer()
        let entries = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        var copies: [LocalProjectCopy] = []
        var rejected = 0
        for entry in entries where entry.lastPathComponent.hasPrefix("worlds-import-") {
            do {
                let copy = try validatedCopy(entry.appendingPathComponent("worlds.db"))
                copies.append(copy)
            } catch { rejected += 1 }
        }
        copies.sort { $0.id.uuidString < $1.id.uuidString }
        return LocalCopyInventory(copies: copies, rejectedCount: rejected)
    }

    private func validatedCopy(_ destination: URL) throws -> LocalProjectCopy {
        try validateLocation(destination)
        try validateDatabase(destination)
        let directory = destination.deletingLastPathComponent().lastPathComponent
        guard let id = UUID(uuidString: String(directory.dropFirst("worlds-import-".count))) else {
            throw LocalImportError.invalidBackup
        }
        return LocalProjectCopy(databaseURL: destination, id: id)
    }

    private func prepareContainer() throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let values = try root.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        let attributes = try FileManager.default.attributesOfItem(atPath: root.path)
        let owner = (attributes[.ownerAccountID] as? NSNumber)?.uint32Value
        let mode = (attributes[.posixPermissions] as? NSNumber)?.uint16Value
        guard values.isDirectory == true, values.isSymbolicLink != true,
              owner == getuid(), let mode, mode & 0o077 == 0,
              root.standardizedFileURL.path == root.resolvingSymlinksInPath().standardizedFileURL.path else {
            throw LocalImportError.invalidContainer
        }
    }

    private func validateLocation(_ url: URL) throws {
        guard url.isFileURL, url.lastPathComponent == "worlds.db" else { throw LocalImportError.invalidBackup }
        let dir = url.deletingLastPathComponent()
        let name = dir.lastPathComponent
        let suffix = String(name.dropFirst("worlds-import-".count))
        var markerStat = stat()
        let markerPath = dir.appendingPathComponent(".incomplete").path
        let markerResult = markerPath.withCString { lstat($0, &markerStat) }
        let markerAbsent = markerResult == -1 && errno == ENOENT
        guard dir.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL,
              markerAbsent,
              name.hasPrefix("worlds-import-"), let id = UUID(uuidString: suffix),
              suffix == id.uuidString.lowercased(),
              url.standardizedFileURL.path == url.resolvingSymlinksInPath().standardizedFileURL.path else {
            throw LocalImportError.invalidBackup
        }
        let attrs = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard attrs.isRegularFile == true, attrs.isSymbolicLink != true else { throw LocalImportError.invalidBackup }
    }

    private func validateDatabase(_ url: URL) throws {
        var db: OpaquePointer?
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK,
              let db else { if let db { sqlite3_close(db) }; throw LocalImportError.unsupportedDatabase }
        defer { sqlite3_close(db) }
        func single(_ sql: String) -> String? {
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { return nil }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_step(statement) == SQLITE_ROW, let value = sqlite3_column_text(statement, 0) else { return nil }
            return String(cString: value)
        }
        guard single("PRAGMA user_version") == "11", single("PRAGMA integrity_check") == "ok" else {
            throw LocalImportError.unsupportedDatabase
        }
        for sql in ["SELECT id,kind,metadata,workspace_id,deleted_at,updated_at FROM pages LIMIT 0",
                    "SELECT id,page_id,content,sort_key FROM blocks LIMIT 0",
                    "SELECT page_id,kind,origin,at FROM changes LIMIT 0"] {
            var statement: OpaquePointer?
            let result = sqlite3_prepare_v2(db, sql, -1, &statement, nil)
            if let statement { sqlite3_finalize(statement) }
            guard result == SQLITE_OK else { throw LocalImportError.unsupportedDatabase }
        }
    }
}
