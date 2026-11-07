#if canImport(WorldsRustStore)
import Foundation
import WorldsRustStore

public enum AutomationDriverError: Error { case invalidURL, invalidResponse, failed(String) }
public struct DueAutomation: Decodable, Sendable {
    public let id: String
    public let scheduledFor: Int64
}
public struct ClaimedAutomation: Decodable, Sendable {
    public let runId: String
    public let status: String
    public let scheduledFor: Int64
    public let nextRunAt: Int64?
}
private struct AutomationRequest: Encodable, Sendable {
    let operation: String
    let path: String
    var automationID: String? = nil
    var expectedDue: Int64? = nil
    var actionID: String? = nil
    enum CodingKeys: String, CodingKey {
        case operation, path
        case automationID = "automation_id", expectedDue = "expected_due", actionID = "action_id"
    }
}
private struct AutomationResponse<T: Decodable & Sendable>: Decodable, Sendable {
    let ok: Bool
    let value: T?
    let error: String?
}
private struct Declined: Decodable, Sendable { let status: String }

/// Explicit foreground lifecycle only. No network delivery or background registration.
public actor NativeAutomationStore {
    private let url: URL
    public init(url: URL) throws {
        guard url.isFileURL, !url.path.isEmpty, !url.path.utf8.contains(0) else { throw AutomationDriverError.invalidURL }
        self.url = url
    }
    private func call<T: Decodable & Sendable>(_ request: AutomationRequest, as: T.Type) async throws -> T {
        let url = self.url
        return try await Task.detached(priority: .userInitiated) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard FileManager.default.fileExists(atPath: url.path) else { throw AutomationDriverError.invalidURL }
            let input = try JSONEncoder().encode(request)
            let pointer = input.withUnsafeBytes { worlds_store_call($0.bindMemory(to: UInt8.self).baseAddress, $0.count) }
            guard let pointer else { throw AutomationDriverError.invalidResponse }
            defer { worlds_store_free(pointer) }
            guard let text = String(validatingUTF8: pointer), let data = text.data(using: .utf8),
                  let result = try? JSONDecoder().decode(AutomationResponse<T>.self, from: data) else { throw AutomationDriverError.invalidResponse }
            guard result.ok else { throw AutomationDriverError.failed(result.error ?? "Automation operation failed") }
            guard let value = result.value else { throw AutomationDriverError.invalidResponse }
            return value
        }.value
    }
    public func due() async throws -> [DueAutomation] {
        try await call(AutomationRequest(operation: "automation_due", path: url.path), as: [DueAutomation].self)
    }
    public func claim(_ due: DueAutomation) async throws -> ClaimedAutomation {
        try await call(AutomationRequest(operation: "automation_claim", path: url.path, automationID: due.id, expectedDue: due.scheduledFor), as: ClaimedAutomation.self)
    }
    /// Declining is a local transaction. Approval and external delivery are unavailable.
    public func decline(actionID: String) async throws {
        _ = try await call(AutomationRequest(operation: "automation_decline", path: url.path, actionID: actionID), as: Declined.self)
    }
}

public struct AutomationIssue: Sendable { public let automationID: String; public let message: String }

/// Start explicitly when the app is active and stop when it leaves the foreground.
public actor ForegroundAutomationScheduler {
    private let store: NativeAutomationStore
    private var task: Task<Void, Never>?
    private var polling = false
    public private(set) var issues: [AutomationIssue] = []
    public init(store: NativeAutomationStore) { self.store = store }

    public func poll() async throws -> [ClaimedAutomation] {
        guard !polling else { return [] }
        polling = true; defer { polling = false }
        let entries = try await store.due()
        var runs: [ClaimedAutomation] = []
        var failures: [AutomationIssue] = []
        for entry in entries {
            try Task.checkCancellation()
            do { runs.append(try await store.claim(entry)) }
            catch { failures.append(AutomationIssue(automationID: entry.id, message: String(describing: error))) }
        }
        issues = failures
        return runs
    }
    public func start() {
        guard task == nil else { return }
        task = Task { [weak self] in
            do {
                try await Task.sleep(for: .seconds(3))
                while !Task.isCancelled {
                    guard let self else { return }
                    do { _ = try await self.poll() }
                    catch is CancellationError { return }
                    catch { await self.recordFailure(error) }
                    try await Task.sleep(for: .seconds(15))
                }
            } catch { return }
        }
    }
    private func recordFailure(_ error: Error) { issues = [AutomationIssue(automationID: "", message: String(describing: error))] }
    public func stop() { task?.cancel(); task = nil }
}
#endif
