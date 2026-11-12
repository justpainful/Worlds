import SwiftUI
#if DEBUG && os(macOS)
import AppKit
#endif

/// A host must inject an authorized service. No preview data or runtime setup is
/// supplied by this view. It does not create or select conversations.
public struct ConversationView: View {
    @StateObject private var model: ConversationViewModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if DEBUG && os(macOS)
    @State private var fixtureNativeDetails = "unavailable"
    @State private var fixtureReferenceDraft = ""
    #endif

    public init(conversationID: String, service: any ConversationService) {
        _model = StateObject(wrappedValue: ConversationViewModel(conversationID: conversationID, service: service))
    }
    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if model.loading && model.messages.isEmpty {
                    ProgressView("Loading conversation")
                } else if model.messages.isEmpty && !model.running && model.error == nil {
                    ContentUnavailableView("No messages", systemImage: "text.bubble", description: Text("Write a message to start this conversation."))
                }
                ForEach(model.messages) { message in
                    VStack(alignment: .leading, spacing: 6) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(message.role == .user ? LocalizedStringKey("You") : LocalizedStringKey("Assistant"))
                                .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            if !message.text.isEmpty {
                                Text(message.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("conversation-message")
                        if message.role == .assistant && !message.steps.isEmpty { finishedSteps(message.steps) }
                        if message.role == .assistant && message.chatOnly { chatOnlyNote }
                        if message.role == .assistant, let changes = message.changes, !changes.pages.isEmpty {
                            changesRow(message.id, changes)
                        }
                    }
                }
                if model.running && model.chatOnly { chatOnlyNote }
                if !model.tools.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(model.tools) { tool in
                            Label(tool.name, systemImage: icon(for: tool.status))
                                .font(.caption).foregroundStyle(.secondary)
                                .accessibilityValue(status(for: tool.status))
                        }
                    }
                }
                if !model.streamedText.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Assistant").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(model.streamedText).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }.accessibilityElement(children: .combine)
                } else if model.running {
                    ProgressView(model.stopping ? LocalizedStringKey("Stopping") : LocalizedStringKey("Waiting for a response"))
                }
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("conversation-error")
                        .accessibilityLabel("Error: \(error)")
                    if model.canRetrySave {
                        Button("Retry saving response") { Task { await model.retrySave() } }
                            .disabled(model.retryingSave)
                    }
                    if !model.running && !model.canRetrySave {
                        Button("Reload conversation") { Task { await model.load() } }
                    }
                }
            }
            .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .safeAreaInset(edge: .bottom) { composer }
        #if DEBUG && os(macOS)
        .overlay(alignment: .topLeading) {
            if ProcessInfo.processInfo.arguments.contains("--isolated-ui-fixture") {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    Text("loading=\(model.loading) loaded=\(model.loaded) running=\(model.running) active=\(NSApp.isActive) modal=\(NSApp.modalWindow != nil) native=\(fixtureNativeDetails)")
                        .font(.caption2).accessibilityIdentifier("conversation-fixture-diagnostics")
                        .accessibilityLabel("loading=\(model.loading) loaded=\(model.loaded) running=\(model.running) active=\(NSApp.isActive) modal=\(NSApp.modalWindow != nil) native=\(fixtureNativeDetails)")
                        .background(FixtureTextEditorProbe(output: $fixtureNativeDetails).frame(width: 0, height: 0).accessibilityHidden(true))
                }
                .allowsHitTesting(false)
            }
        }
        #endif
        .navigationTitle("Conversation")
        .tint(colorScheme == .dark ? Color(red: 46/255, green: 146/255, blue: 255/255) : Color(red: 0/255, green: 102/255, blue: 204/255))
        .task {
            #if os(macOS)
            NSApp.activate(ignoringOtherApps: true)
            for window in NSApp.windows {
                window.makeKeyAndOrderFront(nil)
            }
            #endif
            await model.load()
        }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            #if DEBUG && os(macOS)
            if ProcessInfo.processInfo.arguments.contains("--isolated-ui-fixture") &&
                ProcessInfo.processInfo.arguments.contains("--diagnose-reference-editor") {
                TextEditor(text: $fixtureReferenceDraft)
                    .frame(height: 48)
                    .accessibilityLabel("Diagnostic editor")
                    .accessibilityIdentifier("conversation-fixture-reference-editor")
            }
            #endif
            TextEditor(text: $model.draft)
                .frame(minHeight: 64, maxHeight: 140)
                .accessibilityLabel("Message")
                .disabled(model.running || model.loading)
            HStack {
                Spacer()
                if model.running {
                    Button { Task { await model.stop() } } label: { Label("Stop", systemImage: "stop.fill") }
                        .disabled(model.stopping)
                } else {
                    Button { Task { await model.send() } } label: { Label("Send", systemImage: "arrow.up") }
                        .disabled(!model.loaded || model.loading || model.canRetrySave || model.retryingSave || model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: 760)
        .frame(maxWidth: .infinity)
        .background(.regularMaterial)
    }
    /// Steps of a finished reply, folded behind a count, as on the desktop and Android.
    private func finishedSteps(_ steps: [ConversationTool]) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(steps) { step in
                    Label(step.name, systemImage: icon(for: step.status))
                        .font(.caption).foregroundStyle(.secondary)
                        .accessibilityValue(status(for: step.status))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Label("Steps: \(steps.count)", systemImage: "list.bullet")
                .font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("conversation-steps")
    }

    private var chatOnlyNote: some View {
        Label("This model cannot use Worlds tools, so this reply is chat only.", systemImage: "bubble.left")
            .font(.caption).foregroundStyle(.secondary)
            .accessibilityIdentifier("conversation-chat-only")
    }

    /// What one reply changed, with Open and Undo.
    private func changesRow(_ messageID: String, _ changes: ConversationChanges) -> some View {
        let names = changes.pages.map { $0.title.isEmpty ? String(localized: "Untitled") : $0.title }
            .joined(separator: String(localized: ", "))
        let openable = changes.pages.first { $0.openable }
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { changesSummary(changes, names); Spacer(minLength: 8); changesButtons(messageID, changes, openable) }
            VStack(alignment: .leading, spacing: 6) { changesSummary(changes, names); HStack(spacing: 10) { changesButtons(messageID, changes, openable) } }
        }
        .padding(10)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("conversation-changes")
    }

    private func changesSummary(_ changes: ConversationChanges, _ names: String) -> some View {
        Label {
            Group {
                if changes.undone { Text("Undone: \(names)") } else { Text("Changed: \(names)") }
            }
            .font(.callout).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: changes.undone ? "arrow.uturn.backward.circle" : "pencil.circle")
        }
        .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private func changesButtons(_ messageID: String, _ changes: ConversationChanges, _ openable: ConversationChangedPage?) -> some View {
        if model.supportsWorkspaceActions {
            if let openable {
                Button { Task { await model.open(pageID: openable.id) } } label: { Label("Open", systemImage: "arrow.up.forward.square") }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("conversation-open-change")
            }
            if !changes.undone {
                Button { Task { await model.undo(messageID: messageID) } } label: {
                    if model.undoing == messageID { ProgressView().controlSize(.small) } else { Label("Undo", systemImage: "arrow.uturn.backward") }
                }
                .buttonStyle(.borderless)
                .disabled(model.running || model.undoing != nil)
                .accessibilityIdentifier("conversation-undo-change")
            }
        }
    }

    private func icon(for status: ConversationTool.Status) -> String {
        switch status { case .running: return "ellipsis.circle"; case .succeeded: return "checkmark.circle"; case .failed: return "exclamationmark.circle" }
    }
    private func status(for status: ConversationTool.Status) -> String {
        switch status { case .running: return "Running"; case .succeeded: return "Completed"; case .failed: return "Failed" }
    }
}

#if DEBUG && os(macOS)
/// Fixture-only observation. Does not focus, edit, or enable the native control.
private struct FixtureTextEditorProbe: NSViewRepresentable {
    @Binding var output: String
    func makeNSView(context: Context) -> NSView { NSView(frame: .zero) }
    func updateNSView(_ probe: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = probe.window, let root = window.contentView else { return }
            @MainActor func collectText(_ view: NSView, into results: inout [NSTextView]) {
                if let text = view as? NSTextView { results.append(text) }
                for child in view.subviews { collectText(child, into: &results) }
            }
            var texts: [NSTextView] = []
            collectText(root, into: &texts)
            let details = texts.enumerated().map { index, text in
                var ancestors: [String] = []
                var cursor: NSView? = text
                while let view = cursor {
                    ancestors.append("\(type(of: view)):ax=\(view.isAccessibilityEnabled()),hidden=\(view.isHidden)")
                    cursor = view.superview
                }
                return "index=\(index),identifier=\(text.accessibilityIdentifier()),editable=\(text.isEditable),selectable=\(text.isSelectable),key=\(window.isKeyWindow),firstResponder=\(window.firstResponder === text),ancestors=\(ancestors.joined(separator: ">"))"
            }.joined(separator: " | ")
            let report = "count=\(texts.count) \(details)"
            if output != report { output = report }
        }
    }
}
#endif
