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
                        Text(message.role == .user ? "You" : "Assistant")
                            .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                        Text(message.text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .accessibilityElement(children: .combine)
                }
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
                    ProgressView(model.stopping ? "Stopping" : "Waiting for a response")
                }
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red).accessibilityLabel("Error: \(error)")
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
        .tint(colorScheme == .dark ? Color(red: 210/255, green: 164/255, blue: 110/255) : Color(red: 138/255, green: 88/255, blue: 32/255))
        .task { await model.load() }
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
