#if os(macOS)
import SwiftUI
import WorldsAI
import WorldsAIConversation
import WorldsAIViews
import WorldsAIConversationBridge

@main
struct ClaudeConversationHarnessApp: App {
    var body: some Scene { WindowGroup { HarnessRoot() } }
}

@MainActor private final class HarnessState: ObservableObject {
    @Published var service: ClaudeConversationService?
    @Published var error: String?
    @Published var loading = false
    let conversationID = UUID().uuidString
    func start() async {
        guard !loading, service == nil else { return }
        loading = true; defer { loading = false }
        do {
            guard let executable = ClaudeExecutable.discover() else { throw ClaudeError.executableUnavailable }
            guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw ClaudeConversationBridgeError.unavailable }
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let root = support.appendingPathComponent("WorldsClaudeHarness", isDirectory: true)
            if !FileManager.default.fileExists(atPath: root.path) {
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            }
            let journal = try IsolatedRecoveryJournal(directory: root)
            let database = root.appendingPathComponent("conversation.db")
            if !FileManager.default.fileExists(atPath: database.path) {
                try FileManager.default.copyItem(at: fixture, to: database)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: database.path)
            }
            let store = try SQLiteConversationStore(database: database, isolatedJournal: journal)
            let audit = try JSONLineRunAudit(url: root.appendingPathComponent("audit.jsonl"))
            let runner = try ClaudeRunner(executable: executable, audit: audit)
            let owned = try await store.isolatedOwnedChatIDs()
            guard owned.count <= 1 else { throw ClaudeConversationBridgeError.invalidResponse }
            if let chatID = owned.first {
                service = try await ClaudeConversationService.restoreIsolated(conversationID: conversationID, chatID: chatID, store: store, runner: runner, journal: journal)
            } else {
                service = try ClaudeConversationService(conversationID: conversationID, store: store, runner: runner, recoveryJournal: journal)
            }
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
private struct HarnessRoot: View {
    @StateObject private var state = HarnessState()
    var body: some View {
        Group {
            if let service = state.service {
                ConversationView(conversationID: state.conversationID, service: service)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Isolated Claude conversation").font(.title2.weight(.semibold))
                    Text("Uses your local Claude Code runtime when you send a message. This private experimental conversation persists on this Mac. It has no Worlds page, attachment, MCP or tool access.")
                    if let error = state.error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
                    if state.loading { ProgressView("Preparing conversation") }
                    else { Button("Start") { Task { await state.start() } }.buttonStyle(.borderedProminent) }
                }.padding(24).frame(maxWidth: 640, alignment: .leading)
            }
        }
        .frame(minWidth: 460, minHeight: 440)
    }
}
#endif
