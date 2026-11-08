import Foundation
import SwiftUI
import WorldsCollaboration

@main
struct CollaborationHarnessApp: App {
    @StateObject private var model = HarnessModel()
    var body: some Scene {
        WindowGroup {
            VStack(alignment: .leading, spacing: 16) {
                Text("Collaboration integration harness").font(.title2)
                Text("Disposable fixtures and local service only. No user workspace is opened.")
                Button("Run local scenario") { model.start() }.disabled(model.running).accessibilityIdentifier("scenario.start")
                if model.running { ProgressView() }
                Text(model.status).textSelection(.enabled).accessibilityIdentifier("scenario.status")
                Spacer()
            }.padding().frame(minWidth: 520, minHeight: 250)
        }
    }
}

@MainActor
final class HarnessModel: ObservableObject {
    @Published private(set) var status = "Start the isolated Worker and provide fixture tokens before running."
    @Published private(set) var running = false
    private let page = "fixture-page"
    private let workspace = "fixture-workspace"
    private let base = Data(base64Encoded: "AQbpBwAEAQZzaGFyZWQKSGVsbG8g8J+MjQcBB2RlZmF1bHQDCXBhcmFncmFwaAcA6QcIBgYA6QcJBGJvbGQEdHJ1ZYTpBwoNWWpzIHJpY2ggdGV4dIbpBxcEYm9sZARudWxsAA==")!
    private let alice = Data(base64Encoded: "AQHRDwDE6QcF6QcGBkFsaWNlIAA=")!
    private let bob = Data(base64Encoded: "AQHSDwDE6QcF6QcGBEJvYiAA")!

    func start() {
        guard !running else { return }
        running = true
        Task {
            defer { running = false }
            do { try await scenario(); status = "Passed: two replicas converged, offline outbox survived session restart, and viewer write was refused." }
            catch { status = "Scenario failed: \(error)" }
        }
    }

    private func scenario() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["WORLDS_REQUIRE_LIVE_SERVICE"] == "1",
              environment["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790",
              let editor = environment["WORLDS_LIVE_EDITOR_TOKEN"], !editor.isEmpty,
              let viewer = environment["WORLDS_LIVE_VIEWER_TOKEN"], !viewer.isEmpty else { throw HarnessError.configuration }
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("worlds-collab-harness-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        func store(_ kind: String, _ name: String) throws -> SQLiteCollaborationStore {
            guard let fixture = Bundle.main.url(forResource: "worlds-collab-\(kind)-v11", withExtension: "db") else { throw HarnessError.fixture }
            let path = root.appendingPathComponent("\(name).db")
            try FileManager.default.copyItem(at: fixture, to: path)
            return try SQLiteCollaborationStore(databaseURL: path, pageID: page, userID: kind, workspaceID: workspace)
        }
        let a = try store("editor", "a"), b = try store("editor", "b"), v = try store("viewer", "v")
        let doc = "harness" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        func session(_ store: SQLiteCollaborationStore, _ user: String, _ token: String, _ document: String) throws -> CollaborationSession {
            try CollaborationSession(pageID: page, workspaceID: workspace, documentID: document, expectedUserID: user,
                                     serverURL: URL(string: "http://127.0.0.1:18790")!, store: store, tokenProvider: { _ in token })
        }
        try await a.appendLocal(pageID: page, channel: 0, update: base)
        try await a.appendLocal(pageID: page, channel: 0, update: alice)
        let first = try session(a, "editor", editor, doc), second = try session(b, "editor", editor, doc)
        let firstRun = Task { try await first.run() }, secondRun = Task { try await second.run() }
        do {
            status = "Waiting for two authenticated replicas…"
            let initial = try NativeCRDTDocument(); try initial.apply(base); try initial.apply(alice)
            try await waitForConvergence(a, b, initial)
            await second.stop(); try await secondRun.value
            status = "Queueing an offline change in the isolated second replica…"
            try await b.appendLocal(pageID: page, channel: 0, update: bob)
            guard try await b.maximumPendingID(pageID: page, channel: 0) != nil else { throw HarnessError.outbox }
            let expected = try NativeCRDTDocument(); try expected.apply(base); try expected.apply(alice); try expected.apply(bob)
            let reopened = try session(b, "editor", editor, doc)
            let reopenedRun = Task { try await reopened.run() }
            do { try await waitForConvergence(a, b, expected); await reopened.stop(); try await reopenedRun.value }
            catch { await reopened.stop(); _ = try? await reopenedRun.value; throw error }
            await first.stop(); try await firstRun.value
        } catch {
            await first.stop(); await second.stop(); _ = try? await firstRun.value; _ = try? await secondRun.value
            throw error
        }
        status = "Checking server refusal using the isolated viewer fixture…"
        try await v.appendLocal(pageID: page, channel: 0, update: base)
        let denied = try session(v, "viewer", viewer, doc + "viewer")
        let deniedRun = Task { try await denied.run() }
        do {
            var archived = false
            for _ in 0..<150 {
                if try await v.maximumPendingID(pageID: page, channel: 0) == nil { archived = true; break }
                try await Task.sleep(for: .milliseconds(100))
            }
            guard archived else { throw HarnessError.timeout }
            do { try await deniedRun.value; throw HarnessError.refusal }
            catch CollaborationError.rejected(_) { }
            guard try await v.load(pageID: page, channel: 0) == [Data([0, 0])] else { throw HarnessError.refusal }
        } catch { await denied.stop(); _ = try? await deniedRun.value; throw error }
    }

    private func waitForConvergence(_ a: SQLiteCollaborationStore, _ b: SQLiteCollaborationStore, _ expected: NativeCRDTDocument) async throws {
        for _ in 0..<200 {
            let da = try NativeCRDTDocument(), db = try NativeCRDTDocument()
            for update in try await a.load(pageID: page, channel: 0) { try da.apply(update) }
            for update in try await b.load(pageID: page, channel: 0) { try db.apply(update) }
            if try await a.maximumPendingID(pageID: page, channel: 0) == nil,
               try await b.maximumPendingID(pageID: page, channel: 0) == nil,
               try da.diff(expected.vector()) == Data([0, 0]), try expected.diff(da.vector()) == Data([0, 0]),
               try db.diff(expected.vector()) == Data([0, 0]), try expected.diff(db.vector()) == Data([0, 0]) { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw HarnessError.timeout
    }
}

enum HarnessError: Error { case configuration, fixture, outbox, timeout, refusal }
