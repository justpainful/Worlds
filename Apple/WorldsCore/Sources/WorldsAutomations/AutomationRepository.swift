import Foundation
import SQLite3

public enum AutomationRepositoryError: Error { case invalidURL, sqlite(String), invalidJSON }

/// Opens an existing database read-only; no delivery or approval is performed.
public actor AutomationRepository {
    nonisolated(unsafe) private let db: OpaquePointer
    public init(url: URL) throws {
        guard url.isFileURL, !url.path.isEmpty, !url.path.utf8.contains(0) else { throw AutomationRepositoryError.invalidURL }
        var handle: OpaquePointer?
        guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Could not open database"
            if let handle { sqlite3_close_v2(handle) }
            throw AutomationRepositoryError.sqlite(message)
        }
        sqlite3_busy_timeout(handle, 5000)
        self.db = handle
    }
    deinit { sqlite3_close_v2(db) }

    private func query(_ sql: String, _ bind: (OpaquePointer) -> Void = { _ in }, row: (OpaquePointer) throws -> Void) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw AutomationRepositoryError.sqlite(String(cString: sqlite3_errmsg(db)))
        }
        defer { sqlite3_finalize(statement) }
        bind(statement)
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return }
            guard status == SQLITE_ROW else { throw AutomationRepositoryError.sqlite(String(cString: sqlite3_errmsg(db))) }
            try row(statement)
        }
    }
    private func text(_ statement: OpaquePointer, _ column: Int32) -> String? {
        guard let value = sqlite3_column_text(statement, column) else { return nil }
        return String(cString: value)
    }
    private func integer(_ statement: OpaquePointer, _ column: Int32) -> Int64? {
        sqlite3_column_type(statement, column) == SQLITE_NULL ? nil : sqlite3_column_int64(statement, column)
    }
    private func json(_ string: String?) throws -> AutomationJSON? {
        guard let string else { return nil }
        do { return try JSONDecoder().decode(AutomationJSON.self, from: Data(string.utf8)) }
        catch { throw AutomationRepositoryError.invalidJSON }
    }

    public func automations() throws -> [AutomationRecord] {
        var items: [AutomationRecord] = []
        let sql = "SELECT a.id,a.name,a.enabled,a.spec,a.next_run_at,a.last_run_at,a.created_at,a.updated_at,(SELECT status FROM runs r WHERE r.automation_id=a.id ORDER BY COALESCE(r.started_at,r.scheduled_for) DESC LIMIT 1) FROM automations a ORDER BY a.created_at DESC"
        try query(sql) { s in
            guard let id = text(s,0), let name = text(s,1), let specJSON = text(s,3),
                  let created = integer(s,6), let updated = integer(s,7) else { throw AutomationRepositoryError.invalidJSON }
            let spec: AutomationSpec
            do { spec = try JSONDecoder().decode(AutomationSpec.self, from: Data(specJSON.utf8)) }
            catch { throw AutomationRepositoryError.invalidJSON }
            items.append(AutomationRecord(id: id, name: name, enabled: sqlite3_column_int64(s,2) != 0,
                spec: spec, nextRunAt: integer(s,4), lastRunAt: integer(s,5), createdAt: created,
                updatedAt: updated, lastStatus: text(s,8)))
        }
        return items
    }
    public func pending() throws -> [PendingApproval] {
        var items: [PendingApproval] = []
        try query("SELECT id,kind,payload,requested_by,op_id,status,created_at FROM pending_actions WHERE status='pending' ORDER BY created_at") { s in
            guard let id = text(s,0), let kind = text(s,1), let payload = try json(text(s,2)),
                  let actor = text(s,3), let status = text(s,5), let created = integer(s,6) else { throw AutomationRepositoryError.invalidJSON }
            items.append(PendingApproval(id: id, kind: kind, payload: payload, requestedBy: actor,
                                         opId: text(s,4), status: status, createdAt: created))
        }
        return items
    }

    public func runs(automationID: String? = nil, limit: Int = 50) throws -> [AutomationRun] {
        guard automationID?.utf8.contains(0) != true else { throw AutomationRepositoryError.invalidURL }
        var items: [AutomationRun] = []
        let count = min(max(limit, 1), 500)
        let sql = "SELECT id,automation_id,status,trigger,scheduled_for,started_at,finished_at,version_id,output,error FROM runs WHERE (?1 IS NULL OR automation_id=?1) ORDER BY COALESCE(started_at,scheduled_for) DESC LIMIT ?2"
        try query(sql, { s in
            if let automationID {
                let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
                automationID.withCString { _ = sqlite3_bind_text(s, 1, $0, -1, transient) }
            } else { sqlite3_bind_null(s, 1) }
            sqlite3_bind_int64(s, 2, Int64(count))
        }) { s in
            guard let id = text(s,0), let automation = text(s,1), let status = text(s,2), let trigger = text(s,3) else { throw AutomationRepositoryError.invalidJSON }
            items.append(AutomationRun(id: id, automationId: automation, status: status, trigger: trigger,
                scheduledFor: integer(s,4), startedAt: integer(s,5), finishedAt: integer(s,6), versionId: text(s,7),
                output: try json(text(s,8)), error: text(s,9)))
        }
        return items
    }
    /// A single read transaction, filtered before returning any rows. Only
    /// page-backed personal automations and their owned pending actions appear.
    public func personalSnapshot() throws -> PersonalAutomationSnapshot {
        try query("BEGIN DEFERRED") { _ in }
        do {
            var automationRows: [PersonalAutomationSummary] = []
            var runRows: [PersonalAutomationRun] = []
            var approvalRows: [PersonalAutomationApproval] = []
            let personal = """
            p.workspace_id IS NULL AND p.deleted_at IS NULL AND CASE WHEN json_valid(p.metadata) THEN
            json_type(p.metadata) = 'object' AND
            NOT EXISTS (SELECT 1 FROM json_tree(p.metadata) WHERE key IS NOT NULL GROUP BY parent,key HAVING count(*)>1) AND
            (SELECT COUNT(*) FROM json_each(p.metadata) WHERE key='sync') <= 1 AND
            (json_type(p.metadata,'$.sync') IS NULL OR (json_type(p.metadata,'$.sync')='object' AND
            (SELECT COUNT(*) FROM json_each(p.metadata,'$.sync') WHERE key='shared') <= 1 AND
            (json_type(p.metadata,'$.sync.shared') IS NULL OR json_type(p.metadata,'$.sync.shared')='false')))
            ELSE 0 END
            """
            let validSpec = """
            CASE WHEN json_valid(a.spec) THEN json_type(a.spec)='object' AND
            json_type(a.spec,'$.source.pageId')='text' AND
            NOT EXISTS (SELECT 1 FROM json_tree(a.spec) WHERE key IS NOT NULL GROUP BY parent,key HAVING count(*)>1)
            ELSE 0 END
            """
            let base = "FROM automations a JOIN pages p ON p.id=CASE WHEN json_valid(a.spec) THEN json_extract(a.spec,'$.source.pageId') END "
            let filter = " WHERE (\(personal)) AND (\(validSpec))"
            try query("SELECT a.id,a.name,a.enabled,a.next_run_at,a.last_run_at " + base + filter + " ORDER BY a.created_at DESC") { statement in
                guard let id = text(statement,0), let name = text(statement,1) else { throw AutomationRepositoryError.invalidJSON }
                automationRows.append(.init(id: id, name: name, enabled: sqlite3_column_int64(statement,2) != 0,
                    nextRunAt: integer(statement,3), lastRunAt: integer(statement,4)))
            }
            let runs = "SELECT r.id,r.automation_id,r.status,r.trigger,r.scheduled_for,r.started_at,r.finished_at,r.error " + base + " JOIN runs r ON r.automation_id=a.id " + filter + " ORDER BY COALESCE(r.started_at,r.scheduled_for) DESC LIMIT 500"
            try query(runs) { statement in
                guard let id = text(statement,0), let automation = text(statement,1), let status = text(statement,2), let trigger = text(statement,3) else { throw AutomationRepositoryError.invalidJSON }
                runRows.append(.init(id: id, automationID: automation, status: status, trigger: trigger,
                    scheduledFor: integer(statement,4), startedAt: integer(statement,5), finishedAt: integer(statement,6), error: text(statement,7)))
            }
            let actionJoin = """
             JOIN runs r ON r.automation_id=a.id AND r.status='waiting'
             JOIN pending_actions d ON d.op_id=r.id AND d.status='pending' AND d.kind='discord.send' AND d.requested_by='automation'
            """
            let actionGuard = """
            CASE WHEN json_valid(d.payload) THEN json_type(d.payload)='object' AND
            json_extract(d.payload,'$.runId')=r.id AND json_extract(d.payload,'$.automationId')=a.id AND
            json_extract(d.payload,'$.pageId')=p.id AND
            NOT EXISTS (SELECT 1 FROM json_tree(d.payload) WHERE key IS NOT NULL GROUP BY parent,key HAVING count(*)>1)
            ELSE 0 END
            """
            let actions = "SELECT d.id,a.id,d.created_at " + base + actionJoin + filter + " AND (\(actionGuard)) ORDER BY d.created_at"
            try query(actions) { statement in
                guard let id = text(statement,0), let automation = text(statement,1), let created = integer(statement,2) else { throw AutomationRepositoryError.invalidJSON }
                approvalRows.append(.init(id: id, automationID: automation, createdAt: created))
            }
            try query("COMMIT") { _ in }
            return PersonalAutomationSnapshot(automations: automationRows, runs: runRows, pending: approvalRows)
        } catch {
            try? query("ROLLBACK") { _ in }
            throw error
        }
    }

}

public struct PersonalAutomationSummary: Identifiable, Sendable {
    public let id, name: String
    public let enabled: Bool
    public let nextRunAt, lastRunAt: Int64?
}
public struct PersonalAutomationRun: Identifiable, Sendable {
    public let id, automationID, status, trigger: String
    public let scheduledFor, startedAt, finishedAt: Int64?
    public let error: String?
}
public struct PersonalAutomationApproval: Identifiable, Sendable {
    public let id, automationID: String
    public let createdAt: Int64
}
public struct PersonalAutomationSnapshot: Sendable {
    public let automations: [PersonalAutomationSummary]
    public let runs: [PersonalAutomationRun]
    public let pending: [PersonalAutomationApproval]
}
