import Foundation
import SwiftUI
import WorldsCollaboration

/// Isolated operation panel for a single known plain-text fixture. This is not
/// a general collaborative editor or a CRDT undo manager.
@MainActor final class CheckedEditModel: ObservableObject {
    @Published var draft = ""
    @Published private(set) var status = "Preparing the isolated session."
    @Published private(set) var text = ""
    @Published private(set) var busy = false
    @Published private(set) var canUndo = false
    @Published private(set) var needsReview = false
    @Published private(set) var testHold = false
    @Published private(set) var session: CollaborationSession?
    private var store: SQLiteCollaborationStore?
    private var runner: Task<Void, Error>?
    private var directory: URL?
    private var closeRequested = false
    private var testContinuation: CheckedContinuation<Void, Never>?
    private var undo: (text: String, expected: String, offset: UInt32, state: Data)?
    private let page = "fixture-page", workspace = "fixture-workspace"
    private let base = Data(base64Encoded: "AQTpBwAHAQdkZWZhdWx0AwlwYXJhZ3JhcGgoAOkHAANiaWQBdwdibG9jay0xBwDpBwAGBADpBwIKSGVsbG8g8J+MjQA=")!

    func start() async {
        guard session == nil, !busy else { return }
        busy = true; defer { finishOperation() }
        do {
            let env = ProcessInfo.processInfo.environment
            guard env["WORLDS_REQUIRE_LIVE_SERVICE"] == "1", env["WORLDS_LIVE_SYNC_URL"] == "ws://127.0.0.1:18790",
                  let token = env["WORLDS_LIVE_EDITOR_TOKEN"], !token.isEmpty,
                  let fixture = Bundle.main.url(forResource: "worlds-collab-editor-v11", withExtension: "db") else { throw CheckedEditError.configuration }
            let dir = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("worlds-checked-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
            directory = dir
            let path = dir.appendingPathComponent("editor.db")
            try FileManager.default.copyItem(at: fixture, to: path)
            let db = try SQLiteCollaborationStore(databaseURL: path, pageID: page, userID: "editor", workspaceID: workspace)
            store = db
            try await db.appendLocal(pageID: page, channel: 0, update: base)
            let doc = "checked" + UUID().uuidString.replacingOccurrences(of: "-", with: "")
            let live = try CollaborationSession(pageID: page, workspaceID: workspace, documentID: doc, expectedUserID: "editor", serverURL: URL(string: "http://127.0.0.1:18790")!, store: db, tokenProvider: { _ in token })
            session = live
            runner = Task { try await live.run() }
            let snapshot = try await readySnapshot(live)
            text = try fixtureText(snapshot)
            status = "Document opened. Appending requires current edit permission."
        } catch { status = "Could not open the isolated session: \(error.localizedDescription)"; await close() }
    }

    func append() async {
        guard let session, !busy, !needsReview, !draft.isEmpty else { return }
        let insertion = draft
        guard !insertion.contains("\n"), !insertion.contains("\r"), !insertion.utf8.contains(0), insertion.utf8.count <= 16_384 else { status = "Use a single line of text."; return }
        busy = true; defer { finishOperation() }
        if ProcessInfo.processInfo.arguments.contains("--test-hold-checked-operation") {
            await withCheckedContinuation { continuation in
                testContinuation = continuation
                testHold = true
            }
        }
        guard !closeRequested else { return }
        do {
            let before = try await session.plainEditorSnapshot()
            let original = try fixtureText(before)
            let offset = original.utf16.count
            guard offset <= Int(UInt32.max) else { throw CheckedEditError.unsupported }
            try await session.insertPlain(blockIndex: 0, blockID: "block-1", expected: original, offset: UInt32(offset), insertion: insertion, expectedState: before.state)
            // Do not clear the draft or offer inverse deletion until the server
            // has reauthenticated and the exact committed projection is read.
            let after = try await readySnapshot(session)
            let current = try fixtureText(after)
            guard current == original + insertion else { throw CheckedEditError.changed }
            text = current
            if draft == insertion { draft = "" }
            undo = (insertion, current, UInt32(offset), after.state); canUndo = true
            status = "Inserted locally. The outbox may still contain pending changes."
        } catch {
            undo = nil; canUndo = false; needsReview = true
            status = "The insert outcome could not be confirmed: \(error.localizedDescription). The draft is retained and further edits are disabled."
        }
    }

    func undoLast() async {
        guard let session, let item = undo, !busy else { return }
        busy = true; defer { finishOperation() }
        do {
            let current = try await session.plainEditorSnapshot()
            guard current.state == item.state, try fixtureText(current) == item.expected else { throw CheckedEditError.changed }
            let length = item.text.utf16.count
            guard length <= Int(UInt32.max) else { throw CheckedEditError.unsupported }
            try await session.deletePlain(blockIndex: 0, blockID: "block-1", expected: item.expected, offset: item.offset, length: UInt32(length), expectedState: item.state)
            undo = nil; canUndo = false
            let after = try await readySnapshot(session)
            text = try fixtureText(after)
            status = "The last insertion was removed locally."
        } catch {
            undo = nil; canUndo = false; needsReview = true
            status = "The undo outcome could not be confirmed: \(error.localizedDescription). Further edits are disabled."
        }
    }

    func close() async {
        if busy { closeRequested = true; releaseTestHold(); return }
        closeRequested = false
        let old = session; session = nil
        if let old { await old.stop() }
        _ = try? await runner?.value; runner = nil; store = nil
        if let directory { try? FileManager.default.removeItem(at: directory) }
        directory = nil; undo = nil; canUndo = false
    }

    private func finishOperation() {
        busy = false
        if closeRequested { Task { await close() } }
    }

    func releaseTestHold() {
        let continuation = testContinuation
        testContinuation = nil; testHold = false
        continuation?.resume()
    }

    private func readySnapshot(_ session: CollaborationSession) async throws -> PlainEditorProjection {
        for _ in 0..<200 {
            if let snapshot = try? await session.plainEditorSnapshot() { return snapshot }
            try await Task.sleep(for: .milliseconds(100))
        }
        throw CheckedEditError.unavailable
    }
    private func fixtureText(_ snapshot: PlainEditorProjection) throws -> String {
        guard let root = try JSONSerialization.jsonObject(with: snapshot.json) as? [String: Any],
              let blocks = root["content"] as? [[String: Any]], blocks.count == 1,
              blocks[0]["type"] as? String == "paragraph",
              let attrs = blocks[0]["attrs"] as? [String: Any], attrs["bid"] as? String == "block-1",
              let children = blocks[0]["content"] as? [[String: Any]], children.count == 1,
              children[0]["type"] as? String == "text", let value = children[0]["text"] as? String,
              children[0]["marks"] == nil else { throw CheckedEditError.unsupported }
        return value
    }
}

private enum CheckedEditError: LocalizedError {
    case configuration, unsupported, changed, unavailable
    var errorDescription: String? {
        switch self {
        case .configuration: return "The local service or fixture credentials are missing"
        case .unsupported: return "The fixture no longer has the supported plain paragraph"
        case .changed: return "The document changed since the operation"
        case .unavailable: return "The authenticated document is unavailable"
        }
    }
}

struct CheckedEditHarnessView: View {
    @StateObject private var model = CheckedEditModel()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Checked plain-text operation").font(.headline)
            Text("This isolated fixture supports appending one line and reversing the last insertion only while the complete state is unchanged.")
            if let session = model.session { CollaborationConnectionView(session: session) }
            Text(model.text).accessibilityIdentifier("checked.document")
            TextField("Text to append", text: $model.draft)
                .disabled(model.busy || model.needsReview)
                .accessibilityIdentifier("checked.draft")
            HStack {
                Button("Append") { Task { await model.append() } }.disabled(model.busy || model.needsReview || model.session == nil || model.draft.isEmpty).accessibilityIdentifier("checked.append")
                Button("Undo last insertion") { Task { await model.undoLast() } }.disabled(model.busy || !model.canUndo).accessibilityIdentifier("checked.undo")
            }
            if model.testHold {
                Button("Continue test operation") { model.releaseTestHold() }
                    .accessibilityIdentifier("checked.test-continue")
            }
            Text(model.status).accessibilityIdentifier("checked.status")
        }
        .task { await model.start() }
        .onDisappear { Task { await model.close() } }
    }
}
