import Foundation
import SQLite3

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
    public init(database: URL) throws {
        guard database.isFileURL, !database.path.utf8.contains(0) else { throw ConversationStorageError.invalidDatabase }
        var db: OpaquePointer?
        guard sqlite3_open_v2(database.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let db else {
            if let db { sqlite3_close_v2(db) }; throw ConversationStorageError.database
        }
        do {
            sqlite3_busy_timeout(db, 5000)
            try Self.exec(db, "PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL")
            let q = try Self.prepare(db, "PRAGMA user_version"); defer { sqlite3_finalize(q) }
            guard sqlite3_step(q) == SQLITE_ROW, sqlite3_column_int(q, 0) == 11 else { throw ConversationStorageError.invalidDatabase }
            self.db = db
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
        }
        activeChats.remove(chatID)
        activeRuns.removeValue(forKey: chatID)
    }
}
