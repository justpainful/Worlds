import Foundation
import SQLite3
import Darwin

public enum ConversationStorageError: Error { case invalidDatabase, unavailable, invalidData, database }
public struct StoredConversationMessage: Sendable, Equatable {
    public let id: String; public let role: String; public let content: String
    public let stepsJSON: String; public let operationID: String?; public let metadataJSON: String; public let createdAt: Int64
}
/// Experimental isolated store for the original ai_chats and ai_messages tables.
/// Cross-process session ownership is not established; do not use on live data.
public actor SQLiteConversationStore: ConversationStore {
    nonisolated(unsafe) private let db: OpaquePointer
    private var activeChats: Set<String> = []
    private var activeRuns: [String: UUID] = [:]
    private var ownedChats: Set<String> = []
    private var ownedSessions: [String: String] = [:]
    private var acceptedRuns: [UUID: String] = [:]
    private let isolatedJournal: IsolatedRecoveryJournal?
    private let isolatedStoreLease: IsolatedStoreLease?
    public init(database: URL, isolatedJournal: IsolatedRecoveryJournal? = nil) throws {
        guard database.isFileURL, !database.path.utf8.contains(0) else { throw ConversationStorageError.invalidDatabase }
        if let isolatedJournal {
            guard database.standardizedFileURL == isolatedJournal.directory.appendingPathComponent("conversation.db").standardizedFileURL else { throw ConversationStorageError.invalidDatabase }
            // This check assumes a private, stable parent directory. It is not
            // atomic with SQLite's subsequent pathname-based open.
            var info = stat()
            guard lstat(database.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
                  info.st_uid == getuid(), info.st_nlink == 1, (info.st_mode & 0o077) == 0 else { throw ConversationStorageError.invalidDatabase }
        }
        let storeLease = try isolatedJournal?.acquireStoreLease()
        var db: OpaquePointer?
        guard sqlite3_open_v2(database.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db else {
            if let db { sqlite3_close_v2(db) }; throw ConversationStorageError.database
        }
        do {
            sqlite3_busy_timeout(db, 5000)
            try Self.exec(db, "PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL")
            let q = try Self.prepare(db, "PRAGMA user_version"); defer { sqlite3_finalize(q) }
            guard sqlite3_step(q) == SQLITE_ROW, sqlite3_column_int(q, 0) == 11 else { throw ConversationStorageError.invalidDatabase }
            if isolatedJournal != nil {
                try Self.exec(db, "CREATE TABLE IF NOT EXISTS native_isolated_owner(chat_id TEXT PRIMARY KEY,session_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS native_isolated_pending(run_id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,payload BLOB NOT NULL);")
            }
            self.db = db
            self.isolatedJournal = isolatedJournal
            self.isolatedStoreLease = storeLease
        } catch { sqlite3_close_v2(db); throw error }
    }
    deinit { sqlite3_close_v2(db) }
    private static func exec(_ db: OpaquePointer, _ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw ConversationStorageError.database }
    }
    private static func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
        var q: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &q, nil) == SQLITE_OK, let q else { throw ConversationStorageError.database }
        return q
    }
    private static func bind(_ q: OpaquePointer, _ values: [String]) throws {
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (i, value) in values.enumerated() {
            guard !value.utf8.contains(0), sqlite3_bind_text(q, Int32(i + 1), value, -1, transient) == SQLITE_OK else { throw ConversationStorageError.invalidData }
        }
    }
    private func execute(_ sql: String, _ values: [String]) throws {
        let q = try Self.prepare(db, sql); defer { sqlite3_finalize(q) }
        try Self.bind(q, values)
        guard sqlite3_step(q) == SQLITE_DONE else { throw ConversationStorageError.database }
    }
    private func transaction<T>(_ block: () throws -> T) throws -> T {
        try Self.exec(db, "BEGIN IMMEDIATE")
        do { let result = try block(); try Self.exec(db, "COMMIT"); return result }
        catch { try? Self.exec(db, "ROLLBACK"); throw error }
    }
    private func now() -> String { String(Int64(Date().timeIntervalSince1970 * 1000)) }
    private func insert(chat: String, role: String, content: String, steps: String, operation: String?, meta: String) throws {
        let q = try Self.prepare(db, "INSERT INTO ai_messages(id,chat_id,role,content,steps,op_id,meta,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)")
        defer { sqlite3_finalize(q) }
        try Self.bind(q, [UUID().uuidString.lowercased(),chat,role,content,steps])
        if let operation { let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self); guard sqlite3_bind_text(q, 6, operation, -1, transient) == SQLITE_OK else { throw ConversationStorageError.database } }
        else { sqlite3_bind_null(q, 6) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        guard sqlite3_bind_text(q, 7, meta, -1, transient) == SQLITE_OK, sqlite3_bind_int64(q, 8, Int64(now())!) == SQLITE_OK, sqlite3_step(q) == SQLITE_DONE else { throw ConversationStorageError.database }
        try execute("UPDATE ai_chats SET updated_at=?2 WHERE id=?1", [chat, now()])
    }
    public func begin(chatID: String?, prompt: String, runID: UUID) throws -> ConversationRun {
        guard !prompt.isEmpty, prompt.utf8.count <= 512 * 1024 else { throw ConversationStorageError.invalidData }
        let opened: ConversationRun = try transaction {
            let duplicate = try Self.prepare(db, "SELECT 1 FROM ai_messages WHERE role='user' AND json_valid(meta) AND json_extract(meta,'$.nativeRunId')=?1 LIMIT 1")
            defer { sqlite3_finalize(duplicate) }
            try Self.bind(duplicate, [runID.uuidString.lowercased()])
            guard sqlite3_step(duplicate) == SQLITE_DONE else { throw ConversationStorageError.unavailable }
            let id: String, session: String, resume: Bool
            if let chatID {
                let q = try Self.prepare(db, "SELECT session_id,(SELECT COUNT(*) FROM ai_messages m WHERE m.chat_id=c.id AND m.role='assistant' AND json_extract(m.meta,'$.sessionOk')=1) FROM ai_chats c WHERE id=?1 AND page_id IS NULL")
                defer { sqlite3_finalize(q) }
                try Self.bind(q, [chatID]); guard sqlite3_step(q) == SQLITE_ROW, let text = sqlite3_column_text(q, 0) else { throw ConversationStorageError.unavailable }
                guard ownedChats.contains(chatID), !activeChats.contains(chatID) else { throw ConversationStorageError.unavailable }
                id = chatID; session = String(cString: text); resume = sqlite3_column_int64(q, 1) > 0
                guard UUID(uuidString: session) != nil, ownedSessions[chatID] == session else { throw ConversationStorageError.unavailable }
            } else {
                id = UUID().uuidString.lowercased(); session = UUID().uuidString.lowercased(); resume = false
                let line = prompt.split(whereSeparator: \.isNewline).first(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }).map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
                let title = line.isEmpty ? "New chat" : String(line.prefix(60)) + (line.count > 60 ? "…" : "")
                try execute("INSERT INTO ai_chats(id,title,page_id,session_id,created_at,updated_at) VALUES(?1,?2,NULL,?3,?4,?4)", [id,title,session,now()])
                if isolatedJournal != nil { try execute("INSERT INTO native_isolated_owner(chat_id,session_id) VALUES(?1,?2)", [id,session]) }
            }
            let meta = "{\"nativeRunId\":\"\(runID.uuidString.lowercased())\"}"
            try insert(chat: id, role: "user", content: prompt, steps: "[]", operation: nil, meta: meta)
            return ConversationRun(chatID: id, sessionID: session, resume: resume)
        }
        ownedChats.insert(opened.chatID)
        ownedSessions[opened.chatID] = opened.sessionID
        activeChats.insert(opened.chatID)
        activeRuns[opened.chatID] = runID
        acceptedRuns[runID] = opened.chatID
        return opened
    }
    /// Available only for runs accepted by this store instance.
    public func acceptedChatID(runID: UUID) -> String? { acceptedRuns[runID] }
    public func isolatedOwnedChatIDs() throws -> [String] {
        guard isolatedJournal != nil else { throw ConversationStorageError.unavailable }
        let q = try Self.prepare(db, "SELECT c.id FROM ai_chats c JOIN native_isolated_owner o ON o.chat_id=c.id AND o.session_id=c.session_id WHERE c.page_id IS NULL ORDER BY c.created_at,c.id")
        defer { sqlite3_finalize(q) }
        var ids: [String] = []
        while true {
            let status = sqlite3_step(q)
            if status == SQLITE_DONE { return ids }
            guard status == SQLITE_ROW, let value = sqlite3_column_text(q, 0) else { throw ConversationStorageError.invalidData }
            let id = String(cString: value)
            guard UUID(uuidString: id) != nil else { throw ConversationStorageError.invalidData }
            ids.append(id)
        }
    }
    /// Restricted to a dedicated experimental database under the locked private directory.
    public func restoreIsolatedChat(_ chatID: String) throws {
        guard isolatedJournal != nil, UUID(uuidString: chatID) != nil else { throw ConversationStorageError.unavailable }
        let q = try Self.prepare(db, "SELECT c.session_id FROM ai_chats c JOIN native_isolated_owner o ON o.chat_id=c.id AND o.session_id=c.session_id WHERE c.id=?1 AND c.page_id IS NULL")
        defer { sqlite3_finalize(q) }; try Self.bind(q, [chatID])
        guard sqlite3_step(q) == SQLITE_ROW, let text = sqlite3_column_text(q, 0) else { throw ConversationStorageError.unavailable }
        let session = String(cString: text)
        guard UUID(uuidString: session) != nil else { throw ConversationStorageError.invalidData }
        ownedChats.insert(chatID); ownedSessions[chatID] = session
    }
    public func stageIsolatedResponse(_ response: IsolatedPendingResponse) throws {
        guard isolatedJournal != nil, activeRuns[response.chatID] == response.runID,
              acceptedRuns[response.runID] == response.chatID, response.text.utf8.count <= 8 * 1024 * 1024,
              response.steps.count <= 20_000 else { throw ConversationStorageError.unavailable }
        let payload = try JSONEncoder().encode(response)
        guard payload.count <= 10 * 1024 * 1024, let encoded = String(data: payload, encoding: .utf8) else { throw ConversationStorageError.invalidData }
        try transaction {
            let check = try Self.prepare(db, "SELECT payload FROM native_isolated_pending WHERE run_id=?1")
            defer { sqlite3_finalize(check) }; try Self.bind(check, [response.runID.uuidString.lowercased()])
            let status = sqlite3_step(check)
            if status == SQLITE_ROW {
                guard let value = sqlite3_column_blob(check, 0), sqlite3_column_bytes(check, 0) <= 10 * 1024 * 1024,
                      try JSONDecoder().decode(IsolatedPendingResponse.self, from: Data(bytes: value, count: Int(sqlite3_column_bytes(check, 0)))) == response else { throw ConversationStorageError.invalidData }
            } else if status == SQLITE_DONE {
                try execute("INSERT INTO native_isolated_pending(run_id,chat_id,payload) VALUES(?1,?2,?3)", [response.runID.uuidString.lowercased(), response.chatID, encoded])
            } else { throw ConversationStorageError.database }
        }
    }
    public func isolatedPendingResponses() throws -> [IsolatedPendingResponse] {
        guard isolatedJournal != nil else { throw ConversationStorageError.unavailable }
        let q = try Self.prepare(db, "SELECT run_id,chat_id,payload FROM native_isolated_pending ORDER BY rowid")
        defer { sqlite3_finalize(q) }
        var result: [IsolatedPendingResponse] = []
        while true {
            let status = sqlite3_step(q)
            if status == SQLITE_DONE { return result }
            guard status == SQLITE_ROW, let id = sqlite3_column_text(q, 0), let chat = sqlite3_column_text(q, 1),
                  let payload = sqlite3_column_text(q, 2), sqlite3_column_bytes(q, 2) <= 10 * 1024 * 1024 else { throw ConversationStorageError.invalidData }
            let record = try JSONDecoder().decode(IsolatedPendingResponse.self, from: Data(bytes: payload, count: Int(sqlite3_column_bytes(q, 2))))
            guard record.runID.uuidString.lowercased() == String(cString: id), record.chatID == String(cString: chat) else { throw ConversationStorageError.invalidData }
            result.append(record)
        }
    }
    public func recoverIsolatedResponse(_ response: IsolatedPendingResponse) throws {
        guard isolatedJournal != nil, let session = ownedSessions[response.chatID] else { throw ConversationStorageError.unavailable }
        let data = try JSONEncoder().encode(response)
        guard data.count <= 10 * 1024 * 1024,
              let steps = String(data: try JSONEncoder().encode(response.steps), encoding: .utf8) else { throw ConversationStorageError.invalidData }
        let run = response.runID.uuidString.lowercased()
        let meta = "{\"sessionOk\":\(response.sessionOK ? "true" : "false"),\"isError\":\(response.isError ? "true" : "false")}"
        try transaction {
            let q = try Self.prepare(db, "SELECT p.payload FROM native_isolated_pending p JOIN native_isolated_owner o ON o.chat_id=p.chat_id JOIN ai_chats c ON c.id=o.chat_id AND c.session_id=o.session_id WHERE p.run_id=?1 AND p.chat_id=?2 AND c.session_id=?3 AND c.page_id IS NULL AND EXISTS(SELECT 1 FROM ai_messages WHERE chat_id=p.chat_id AND role='user' AND json_valid(meta) AND json_extract(meta,'$.nativeRunId')=p.run_id)")
            defer { sqlite3_finalize(q) }; try Self.bind(q, [run,response.chatID,session])
            guard sqlite3_step(q) == SQLITE_ROW, let value = sqlite3_column_blob(q, 0), sqlite3_column_bytes(q, 0) <= 10 * 1024 * 1024,
                  try JSONDecoder().decode(IsolatedPendingResponse.self, from: Data(bytes: value, count: Int(sqlite3_column_bytes(q, 0)))) == response else { throw ConversationStorageError.unavailable }
            let existing = try Self.prepare(db, "SELECT role,content,steps,meta FROM ai_messages WHERE chat_id=?1 AND op_id=?2")
            defer { sqlite3_finalize(existing) }; try Self.bind(existing, [response.chatID,run])
            let status = sqlite3_step(existing)
            if status == SQLITE_ROW {
                let values: [String] = (0..<4).compactMap { index in sqlite3_column_text(existing, Int32(index)).map { String(cString: $0) } }
                guard values.count == 4, values[0] == "assistant", values[1] == response.text,
                      let stepData = values[2].data(using: .utf8), try JSONDecoder().decode([ConversationStep].self, from: stepData) == response.steps,
                      values[3] == meta, sqlite3_step(existing) == SQLITE_DONE else { throw ConversationStorageError.invalidData }
            } else if status == SQLITE_DONE {
                try insert(chat: response.chatID, role: "assistant", content: response.text, steps: steps, operation: run, meta: meta)
            } else { throw ConversationStorageError.database }
            try execute("DELETE FROM native_isolated_pending WHERE run_id=?1", [run])
        }
    }
    public func messages(chatID: String) throws -> [StoredConversationMessage] {
        guard ownedChats.contains(chatID), let session = ownedSessions[chatID] else { throw ConversationStorageError.unavailable }
        return try transaction {
            let page = try Self.prepare(db, "SELECT 1 FROM ai_chats WHERE id=?1 AND page_id IS NULL AND session_id=?2")
            defer { sqlite3_finalize(page) }
            try Self.bind(page, [chatID, session])
            guard sqlite3_step(page) == SQLITE_ROW else { throw ConversationStorageError.unavailable }
            let q = try Self.prepare(db, "SELECT id,role,content,steps,op_id,meta,created_at FROM ai_messages WHERE chat_id=?1 ORDER BY created_at,rowid")
            defer { sqlite3_finalize(q) }; try Self.bind(q, [chatID])
            func text(_ index: Int32) throws -> String {
                guard sqlite3_column_type(q, index) == SQLITE_TEXT, let p = sqlite3_column_text(q, index),
                      let result = String(data: Data(bytes: p, count: Int(sqlite3_column_bytes(q, index))), encoding: .utf8) else { throw ConversationStorageError.invalidData }
                return result
            }
            var result: [StoredConversationMessage] = []
            while true {
                let status = sqlite3_step(q)
                if status == SQLITE_DONE { return result }
                guard status == SQLITE_ROW else { throw ConversationStorageError.database }
                let operation: String? = try sqlite3_column_type(q, 4) == SQLITE_NULL ? nil : text(4)
                result.append(.init(id: try text(0), role: try text(1), content: try text(2), stepsJSON: try text(3), operationID: operation, metadataJSON: try text(5), createdAt: sqlite3_column_int64(q, 6)))
            }
        }
    }
    public func finish(chatID: String, runID: UUID, text: String, steps: [ConversationStep], isError: Bool, sessionOK: Bool) throws {
        guard activeChats.contains(chatID), activeRuns[chatID] == runID, acceptedRuns[runID] == chatID, let session = ownedSessions[chatID], text.utf8.count <= 8 * 1024 * 1024, steps.count <= 20_000 else { throw ConversationStorageError.invalidData }
        let json = try JSONEncoder().encode(steps)
        guard let encoded = String(data: json, encoding: .utf8) else { throw ConversationStorageError.invalidData }
        let meta = "{\"sessionOk\":\(sessionOK ? "true" : "false"),\"isError\":\(isError ? "true" : "false")}"
        try transaction {
            // Recheck ownership and enforce one assistant result per run.
            let q = try Self.prepare(db, "SELECT COUNT(*) FROM ai_chats WHERE id=?1 AND page_id IS NULL AND session_id=?3 AND NOT EXISTS(SELECT 1 FROM ai_messages WHERE chat_id=?1 AND op_id=?2)")
            defer { sqlite3_finalize(q) }
            try Self.bind(q, [chatID,runID.uuidString.lowercased(),session])
            guard sqlite3_step(q) == SQLITE_ROW, sqlite3_column_int(q, 0) == 1 else { throw ConversationStorageError.unavailable }
            try insert(chat: chatID, role: "assistant", content: text, steps: encoded, operation: runID.uuidString.lowercased(), meta: meta)
            if isolatedJournal != nil {
                let pending = try Self.prepare(db, "SELECT payload FROM native_isolated_pending WHERE run_id=?1 AND chat_id=?2")
                defer { sqlite3_finalize(pending) }; try Self.bind(pending, [runID.uuidString.lowercased(), chatID])
                guard sqlite3_step(pending) == SQLITE_ROW, let value = sqlite3_column_blob(pending, 0), sqlite3_column_bytes(pending, 0) <= 10 * 1024 * 1024,
                      try JSONDecoder().decode(IsolatedPendingResponse.self, from: Data(bytes: value, count: Int(sqlite3_column_bytes(pending, 0)))) == IsolatedPendingResponse(runID: runID, chatID: chatID, text: text, steps: steps, isError: isError, sessionOK: sessionOK) else { throw ConversationStorageError.invalidData }
                try execute("DELETE FROM native_isolated_pending WHERE run_id=?1 AND chat_id=?2", [runID.uuidString.lowercased(),chatID])
            }
        }
        activeChats.remove(chatID)
        activeRuns.removeValue(forKey: chatID)
    }
}
