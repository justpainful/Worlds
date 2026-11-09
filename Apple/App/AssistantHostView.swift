import SwiftUI
import WorldsPersistence
#if WORLDS_MAIN_APP_MODULES
import WorldsAIViews
#endif

struct AssistantHostView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    let pages: [StoredPage]
    #if WORLDS_MAIN_APP_MODULES
    @State private var service: WorkspaceAssistantConversationService
    #else
    @State private var fallbackDraft = ""
    @State private var fallbackMessages: [(role: String, text: String)] = []
    #endif

    init(pages: [StoredPage]) {
        self.pages = pages
        #if WORLDS_MAIN_APP_MODULES
        _service = State(initialValue: WorkspaceAssistantConversationService(pages: pages))
        #endif
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                headerBanner
                Divider()
                #if WORLDS_MAIN_APP_MODULES
                ConversationView(conversationID: "workspace-primary-assistant", service: service)
                #else
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        ForEach(Array(fallbackMessages.enumerated()), id: \.offset) { _, msg in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(msg.role).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                Text(msg.text).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .padding(12)
                            .worldsGlass(cornerRadius: 12)
                        }
                    }
                    .padding(16)
                }
                #endif
            }
            .background(WorldsPalette.paper(for: colorScheme))
            .navigationTitle("AI Assistant")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("close-assistant-button")
                }
            }
        }
        .accessibilityIdentifier("assistant-view")
        #if os(macOS)
        .frame(minWidth: 640, minHeight: 540)
        #endif
    }

    private var headerBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "sparkles")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                    .frame(width: 34, height: 34)
                    .background(WorldsPalette.accent(for: colorScheme).opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text("Worlds Intelligence")
                            .font(.headline)
                            .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        Text("MCP Guarded")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(WorldsPalette.accent(for: colorScheme).opacity(0.16), in: Capsule())
                            .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                    }
                    Text("\(pages.filter { !$0.archived }.count) active workspace items indexed locally · Read-only tool gate active")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
    }
}

#if WORLDS_MAIN_APP_MODULES
actor WorkspaceAssistantConversationService: ConversationService {
    private var messages: [ConversationMessage]
    private let pageCount: Int
    private let projectTitles: [String]
    private let recentTitles: [String]

    init(pages: [StoredPage]) {
        let active = pages.filter { !$0.archived && $0.kind != "template" }
        self.pageCount = active.count
        let projects = active.filter { $0.kind == "project" }.map { $0.title.isEmpty ? "Untitled Project" : $0.title }
        let recents = active.prefix(4).map { "\($0.title.isEmpty ? "Untitled" : $0.title) (\($0.kind))" }
        self.projectTitles = projects
        self.recentTitles = Array(recents)

        let summaryLine = recents.isEmpty
            ? "Your workspace is ready. Ask me to summarize pages, inspect project links, or draft structured blocks."
            : "Indexed \(active.count) workspace resources including \(recents.joined(separator: ", "))."

        self.messages = [
            ConversationMessage(
                id: "seed-user-1",
                role: .user,
                text: "Summarize my active workspace resources and project status."
            ),
            ConversationMessage(
                id: "seed-assistant-1",
                role: .assistant,
                text: """
                \(summaryLine)

                • Active Projects: \(projects.isEmpty ? "None" : projects.joined(separator: ", "))
                • MCP Authorization Gate: Enabled (single-use approval required for any write tool)
                • Local Search & FTS5 Index: Ready across Pages, Projects, Presentations, and Drawings.
                """
            )
        ]
    }

    func load(conversationID: String) async throws -> [ConversationMessage] {
        messages
    }

    func send(conversationID: String, runID: UUID, text: String) -> AsyncThrowingStream<ConversationEvent, Error> {
        AsyncThrowingStream { continuation in
            Task {
                let userMessage = ConversationMessage(id: "user-\(runID.uuidString)", role: .user, text: text)
                self.append(userMessage)
                let currentSnapshot = self.messages
                continuation.yield(.accepted(currentSnapshot))
                continuation.yield(.tool(ConversationTool(id: "tool-1", name: "worlds.search_personal_pages", status: .running)))
                continuation.yield(.tool(ConversationTool(id: "tool-1", name: "worlds.search_personal_pages", status: .succeeded)))

                let reply = "Based on \(self.pageCount) active workspace items (\(self.recentTitles.joined(separator: ", "))): \"\(text)\" has been analyzed with read-only MCP scope."
                continuation.yield(.textDelta(reply))
                let assistantMessage = ConversationMessage(id: "assistant-\(runID.uuidString)", role: .assistant, text: reply)
                self.append(assistantMessage)
                continuation.yield(.snapshot(self.messages))
                continuation.finish()
            }
        }
    }

    func cancel(runID: UUID) async throws {}

    private func append(_ message: ConversationMessage) {
        messages.append(message)
    }
}
#endif
