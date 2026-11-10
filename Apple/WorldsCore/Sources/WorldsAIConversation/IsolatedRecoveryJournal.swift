import Foundation
import SQLite3
import Darwin

public struct IsolatedPendingResponse: Codable, Sendable, Equatable {
    public let runID: UUID
    public let chatID: String
    public let text: String
    public let steps: [ConversationStep]
    public let isError: Bool
    public let sessionOK: Bool
    public init(runID: UUID, chatID: String, text: String, steps: [ConversationStep], isError: Bool, sessionOK: Bool) {
        self.runID = runID; self.chatID = chatID; self.text = text; self.steps = steps
        self.isError = isError; self.sessionOK = sessionOK
    }
}

public enum IsolatedRecoveryError: Error { case unsafeDirectory, inUse, storage, invalidRecord }

final class IsolatedStoreGate: @unchecked Sendable {
    private let lock = NSLock()
    private var occupied = false
    func acquire() throws -> IsolatedStoreLease {
        lock.lock(); defer { lock.unlock() }
        guard !occupied else { throw IsolatedRecoveryError.inUse }
        occupied = true
        return IsolatedStoreLease(gate: self)
    }
    fileprivate func release() { lock.lock(); defer { lock.unlock() }; occupied = false }
}
final class IsolatedStoreLease: @unchecked Sendable {
    private let gate: IsolatedStoreGate
    fileprivate init(gate: IsolatedStoreGate) { self.gate = gate }
    deinit { gate.release() }
}

/// Private experimental outbox. The exclusive lock is held for its lifetime.
/// This is not an authorization mechanism for a Worlds database.
public actor IsolatedRecoveryJournal {
    nonisolated(unsafe) private let db: OpaquePointer
    public nonisolated let directory: URL
    private nonisolated let storeGate = IsolatedStoreGate()
    nonisolated func acquireStoreLease() throws -> IsolatedStoreLease { try storeGate.acquire() }
    private let lockFD: Int32

    public init(directory: URL) throws {
        guard directory.isFileURL else { throw IsolatedRecoveryError.unsafeDirectory }
        var info = stat()
        guard lstat(directory.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
              info.st_uid == getuid(), (info.st_mode & 0o077) == 0 else { throw IsolatedRecoveryError.unsafeDirectory }
        let lockPath = directory.appendingPathComponent("recovery.lock").path
        let descriptor = open(lockPath, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw IsolatedRecoveryError.storage }
        var lockInfo = stat()
        guard fstat(descriptor, &lockInfo) == 0, (lockInfo.st_mode & S_IFMT) == S_IFREG,
              lockInfo.st_uid == getuid(), lockInfo.st_nlink == 1, (lockInfo.st_mode & 0o077) == 0 else {
            close(descriptor); throw IsolatedRecoveryError.unsafeDirectory
        }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { close(descriptor); throw IsolatedRecoveryError.inUse }
        let path = directory.appendingPathComponent("recovery.sqlite3").path
        var existing = stat()
        if lstat(path, &existing) == 0 {
            guard (existing.st_mode & S_IFMT) == S_IFREG, existing.st_uid == getuid(), existing.st_nlink == 1,
                  (existing.st_mode & 0o077) == 0 else { flock(descriptor, LOCK_UN); close(descriptor); throw IsolatedRecoveryError.unsafeDirectory }
        } else if errno != ENOENT { flock(descriptor, LOCK_UN); close(descriptor); throw IsolatedRecoveryError.storage }
        var handle: OpaquePointer?
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let handle else {
            if let handle { sqlite3_close_v2(handle) }; flock(descriptor, LOCK_UN); close(descriptor); throw IsolatedRecoveryError.storage
        }
        guard chmod(path, 0o600) == 0,
              sqlite3_exec(handle, "PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS pending(run_id TEXT PRIMARY KEY, payload BLOB NOT NULL); CREATE TABLE IF NOT EXISTS owned_chat(chat_id TEXT PRIMARY KEY, session_id TEXT NOT NULL);", nil, nil, nil) == SQLITE_OK else {
            sqlite3_close_v2(handle); flock(descriptor, LOCK_UN); close(descriptor); throw IsolatedRecoveryError.storage
        }
        self.db = handle; self.lockFD = descriptor; self.directory = directory.standardizedFileURL
    }
    deinit { sqlite3_close_v2(db); flock(lockFD, LOCK_UN); close(lockFD) }

    public func remember(chatID: String, sessionID: String) throws {
        guard UUID(uuidString: chatID) != nil, UUID(uuidString: sessionID) != nil else { throw IsolatedRecoveryError.invalidRecord }
        if let prior = try sessionIDForChat(chatID) {
            guard prior == sessionID else { throw IsolatedRecoveryError.invalidRecord }
            return
        }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "INSERT INTO owned_chat(chat_id,session_id) VALUES(?1,?2)", -1, &statement, nil) == SQLITE_OK, let statement else { throw IsolatedRecoveryError.storage }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(statement, 1, chatID, -1, transient) == SQLITE_OK,
              sqlite3_bind_text(statement, 2, sessionID, -1, transient) == SQLITE_OK,
              sqlite3_step(statement) == SQLITE_DONE else { throw IsolatedRecoveryError.storage }
    }
    public func sessionIDForChat(_ chatID: String) throws -> String? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT session_id FROM owned_chat WHERE chat_id=?1", -1, &statement, nil) == SQLITE_OK, let statement else { throw IsolatedRecoveryError.storage }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(statement, 1, chatID, -1, transient) == SQLITE_OK else { throw IsolatedRecoveryError.storage }
        let result = sqlite3_step(statement)
        if result == SQLITE_DONE { return nil }
        guard result == SQLITE_ROW, let value = sqlite3_column_text(statement, 0) else { throw IsolatedRecoveryError.storage }
        return String(cString: value)
    }

    public func put(_ response: IsolatedPendingResponse) throws {
        guard !response.chatID.isEmpty, response.chatID.utf8.count <= 256,
              response.text.utf8.count <= 8 * 1024 * 1024, response.steps.count <= 20_000 else { throw IsolatedRecoveryError.invalidRecord }
        if let existing = try records().first(where: { $0.runID == response.runID }) {
            guard existing == response else { throw IsolatedRecoveryError.invalidRecord }
            return
        }
        let payload = try JSONEncoder().encode(response)
        guard payload.count <= 10 * 1024 * 1024 else { throw IsolatedRecoveryError.invalidRecord }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "INSERT INTO pending(run_id,payload) VALUES(?1,?2)", -1, &statement, nil) == SQLITE_OK, let statement else { throw IsolatedRecoveryError.storage }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(statement, 1, response.runID.uuidString.lowercased(), -1, transient) == SQLITE_OK,
              payload.withUnsafeBytes({ sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32(payload.count), transient) }) == SQLITE_OK,
              sqlite3_step(statement) == SQLITE_DONE else { throw IsolatedRecoveryError.storage }
    }
    public func records() throws -> [IsolatedPendingResponse] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT run_id,payload FROM pending ORDER BY rowid", -1, &statement, nil) == SQLITE_OK, let statement else { throw IsolatedRecoveryError.storage }
        defer { sqlite3_finalize(statement) }
        var results: [IsolatedPendingResponse] = []
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return results }
            guard status == SQLITE_ROW, let id = sqlite3_column_text(statement, 0), let bytes = sqlite3_column_blob(statement, 1),
                  sqlite3_column_bytes(statement, 1) <= 10 * 1024 * 1024 else { throw IsolatedRecoveryError.invalidRecord }
            let record = try JSONDecoder().decode(IsolatedPendingResponse.self, from: Data(bytes: bytes, count: Int(sqlite3_column_bytes(statement, 1))))
            guard record.runID.uuidString.lowercased() == String(cString: id), record.text.utf8.count <= 8 * 1024 * 1024, record.steps.count <= 20_000 else { throw IsolatedRecoveryError.invalidRecord }
            results.append(record)
        }
    }
    public func remove(runID: UUID) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, "DELETE FROM pending WHERE run_id=?1", -1, &statement, nil) == SQLITE_OK, let statement else { throw IsolatedRecoveryError.storage }
        defer { sqlite3_finalize(statement) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(statement, 1, runID.uuidString.lowercased(), -1, transient) == SQLITE_OK,
              sqlite3_step(statement) == SQLITE_DONE else { throw IsolatedRecoveryError.storage }
    }
}
