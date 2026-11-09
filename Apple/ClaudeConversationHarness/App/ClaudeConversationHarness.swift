#if os(macOS)
import SwiftUI
import WorldsAI
import WorldsAIConversation
import WorldsAIViews
import WorldsAIConversationBridge

#if DEBUG
import SQLite3
private actor HarnessFixtureRunner: ConversationRunner {
    func run(_ request: ClaudeRequest, timeout: TimeInterval, onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ClaudeResult {
        guard request.mcp == nil else { throw ClaudeConversationBridgeError.unexpectedTool }
        if request.prompt == "Cancel fixture" { try await Task.sleep(for: .seconds(30)) }
        onEvent(.text("Fixture response"))
        return ClaudeResult(text: "Fixture response", isError: false)
    }
    func cancel(runID: UUID) async {}
}
#endif

#if os(macOS)
import AppKit

@MainActor
final class HarnessAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.async {
            if let window = NSApp.windows.first {
                window.makeKeyAndOrderFront(nil)
            }
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            for window in sender.windows {
                window.makeKeyAndOrderFront(nil)
            }
        }
        return true
    }
}
#endif

@main
struct ClaudeConversationHarnessApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(HarnessAppDelegate.self) private var appDelegate
    #endif
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
            guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw ClaudeConversationBridgeError.unavailable }
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            var root = support.appendingPathComponent("WorldsClaudeHarness", isDirectory: true)
            #if DEBUG
            let arguments = ProcessInfo.processInfo.arguments
            let fixtureID: UUID?
            if let index = arguments.firstIndex(of: "--isolated-ui-fixture"), arguments.indices.contains(index + 1), let id = UUID(uuidString: arguments[index + 1]) {
                fixtureID = id
                root = support.appendingPathComponent("WorldsClaudeHarness-UI-\(id.uuidString)", isDirectory: true)
            } else { fixtureID = nil }
            #endif
            if !FileManager.default.fileExists(atPath: root.path) {
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            }
            let journal = try IsolatedRecoveryJournal(directory: root)
            let database = root.appendingPathComponent("conversation.db")
            if !FileManager.default.fileExists(atPath: database.path) {
                try FileManager.default.copyItem(at: fixture, to: database)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: database.path)
            }
            #if DEBUG
            if fixtureID != nil && (arguments.contains("--fixture-fail-save") || arguments.contains("--fixture-allow-save")) {
                var handle: OpaquePointer?
                guard sqlite3_open_v2(database.path, &handle, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let handle else {
                    if let handle { sqlite3_close_v2(handle) }
                    throw ClaudeConversationBridgeError.unavailable
                }
                let sql = arguments.contains("--fixture-fail-save")
                    ? "CREATE TRIGGER IF NOT EXISTS ui_refuse_assistant BEFORE INSERT ON ai_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'fixture'); END;"
                    : "DROP TRIGGER IF EXISTS ui_refuse_assistant;"
                let result = sqlite3_exec(handle, sql, nil, nil, nil)
                sqlite3_close_v2(handle)
                guard result == SQLITE_OK else { throw ClaudeConversationBridgeError.unavailable }
            }
            #endif
            let store = try SQLiteConversationStore(database: database, isolatedJournal: journal)
            let runner: any ConversationRunner
            #if DEBUG
            if fixtureID != nil { runner = HarnessFixtureRunner() }
            else {
                guard let executable = ClaudeExecutable.discover() else { throw ClaudeError.executableUnavailable }
                let audit = try JSONLineRunAudit(url: root.appendingPathComponent("audit.jsonl"))
                runner = try ClaudeRunner(executable: executable, audit: audit)
            }
            #else
            guard let executable = ClaudeExecutable.discover() else { throw ClaudeError.executableUnavailable }
            let audit = try JSONLineRunAudit(url: root.appendingPathComponent("audit.jsonl"))
            runner = try ClaudeRunner(executable: executable, audit: audit)
            #endif
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
        .onAppear {
            #if os(macOS)
            NSApp.activate(ignoringOtherApps: true)
            DispatchQueue.main.async {
                NSApp.windows.first?.makeKeyAndOrderFront(nil)
            }
            #endif
        }
    }
}
#endif
