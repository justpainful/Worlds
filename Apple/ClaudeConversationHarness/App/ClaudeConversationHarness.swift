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
            let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("worlds-claude-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            let database = root.appendingPathComponent("conversation.db")
            try FileManager.default.copyItem(at: fixture, to: database)
            let store = try SQLiteConversationStore(database: database)
            let audit = try JSONLineRunAudit(url: root.appendingPathComponent("audit.jsonl"))
            let runner = try ClaudeRunner(executable: executable, audit: audit)
            service = try ClaudeConversationService(conversationID: conversationID, store: store, runner: runner)
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
                    Text("Uses your local Claude Code runtime when you send a message. This temporary conversation has no Worlds page, attachment, MCP or tool access.")
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
