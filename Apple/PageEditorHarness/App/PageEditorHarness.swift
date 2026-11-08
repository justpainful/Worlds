import SwiftUI
import WorldsLocalImport
import WorldsEditorPersistence
import WorldsNativeEditor

@main
struct PageEditorHarnessApp: App {
    var body: some Scene {
        WindowGroup {
            HarnessRoot()
                .environment(\.layoutDirection, ProcessInfo.processInfo.arguments.contains("--test-rtl") ? .rightToLeft : .leftToRight)
                .environment(\.dynamicTypeSize, ProcessInfo.processInfo.arguments.contains("--test-large-text") ? .accessibility3 : .large)
        }
    }
}

@MainActor private final class HarnessState: ObservableObject {
    @Published var copyURL: URL?
    @Published var model: NativeEditorModel?
    @Published var failure: String?
    @Published var loading = false
    @Published var saved = false
    @Published var originalUnchanged = false
    @Published var reopenedHasBold = false
    @Published var reopenedArabic = false
    private var sourceURL: URL?
    private var sourceBytes: Data?
    private var persistence: PersonalEditorPersistence?

    func importFixture() async {
        guard !loading, copyURL == nil else { return }
        loading = true; defer { loading = false }
        do {
            guard let source = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw HarnessError.fixture }
            let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
            let selected = root.appendingPathComponent("source.db")
            try FileManager.default.copyItem(at: source, to: selected)
            sourceURL = selected; sourceBytes = try Data(contentsOf: selected)
            #if DEBUG
            let coordinator = try LocalProjectImportCoordinator.isolatedTestCoordinator(root: root.appendingPathComponent("private", isDirectory: true), backup: NativeSQLiteBackup())
            let copy = try await coordinator.importCopy(from: selected)
            copyURL = copy.databaseURL; failure = nil
            #else
            throw HarnessError.fixture
            #endif
        } catch { failure = error.localizedDescription }
    }
    func openPage() async {
        guard !loading, let copyURL else { return }
        loading = true; defer { loading = false }
        do {
            let store = try await PersonalEditorPersistence.open(databaseURL: copyURL, pageID: "fixture-page")
            persistence = store
            let document = try JSONSerialization.jsonObject(with: store.initialDocument.json())
            reopenedHasBold = originalUnchanged && hasExactBoldFixture(document)
            reopenedArabic = originalUnchanged && hasExactArabicFixture(document)
            model = NativeEditorModel(document: store.initialDocument, baseRevision: store.initialRevision)
            saved = false; failure = nil
        } catch { failure = error.localizedDescription }
    }
    private func hasExactArabicFixture(_ value: Any) -> Bool {
        guard let document = value as? [String: Any], document["type"] as? String == "doc",
              let blocks = document["content"] as? [[String: Any]], blocks.count == 1,
              blocks[0]["type"] as? String == "paragraph",
              let runs = blocks[0]["content"] as? [[String: Any]], !runs.isEmpty else { return false }
        var text = ""
        for run in runs {
            guard run["type"] as? String == "text", let fragment = run["text"] as? String else { return false }
            text += fragment
        }
        return text == "مسألة رياضيات 123"
    }
    private func hasExactBoldFixture(_ value: Any) -> Bool {
        guard let document = value as? [String: Any], document["type"] as? String == "doc",
              let blocks = document["content"] as? [[String: Any]], blocks.count == 1,
              blocks[0]["type"] as? String == "paragraph",
              let runs = blocks[0]["content"] as? [[String: Any]], !runs.isEmpty else { return false }
        var text = ""
        for run in runs {
            guard run["type"] as? String == "text", let fragment = run["text"] as? String,
                  !fragment.isEmpty, let marks = run["marks"] as? [[String: Any]],
                  marks.contains(where: { $0["type"] as? String == "bold" }) else { return false }
            text += fragment
        }
        return text == "Edited fixture"
    }
    func save() async {
        guard let model, let persistence, !model.nativeEditPending, model.recoverableNativeText == nil else { return }
        do {
            try await model.save(using: persistence)
            guard let sourceURL, let sourceBytes, try Data(contentsOf: sourceURL) == sourceBytes else { throw HarnessError.sourceChanged }
            originalUnchanged = true; saved = !model.dirty; failure = nil
        } catch { failure = error.localizedDescription }
    }
    func close() {
        guard let model, !model.hasUnresolvedInput else { return }
        self.model = nil; persistence = nil
    }
    func discardForTest() {
        guard let model, !model.saving, !model.nativeEditPending else { return }
        self.model = nil; persistence = nil
    }
}
private enum HarnessError: LocalizedError {
    case fixture, sourceChanged
    var errorDescription: String? {
        switch self {
        case .fixture: return "The isolated test database is unavailable."
        case .sourceChanged: return "The original test database changed unexpectedly."
        }
    }
}

private struct HarnessRoot: View {
    @StateObject private var state = HarnessState()
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Isolated page editor test").font(.title2)
                Text("Only a synthetic local copy is edited. Attachments and sync are unavailable. Unsupported structures and rich paste may be refused; recovery is in memory only.")
                if let failure = state.failure { Text(failure).accessibilityIdentifier("editor-harness-error") }
                if state.loading { ProgressView() }
                else if state.copyURL == nil { Button("Import test copy") { Task { await state.importFixture() } } }
                else { Button("Open test page") { Task { await state.openPage() } } }
                if state.originalUnchanged { Text("Original unchanged").accessibilityIdentifier("editor-source-unchanged") }
            }.padding()
        }
        .sheet(isPresented: Binding(get: { state.model != nil }, set: { if !$0 { state.close() } })) {
            if let model = state.model { HarnessEditor(model: model, state: state) }
        }
    }
}
private struct HarnessEditor: View {
    @ObservedObject var model: NativeEditorModel
    @ObservedObject var state: HarnessState
    @State private var discard = false
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("Editing a test copy. Some content and input methods are not supported.").font(.caption)
                NativeEditorView(model: model).frame(minHeight: 240)
                if let failure = state.failure { Text(failure).accessibilityIdentifier("editor-save-error") }
                if state.saved && !model.dirty { Text("Page saved").accessibilityIdentifier("editor-page-saved") }
                if state.reopenedHasBold { Text("Reopened bold formatting").accessibilityIdentifier("editor-reopened-bold") }
                if state.reopenedArabic { Text("Reopened exact Arabic text").accessibilityIdentifier("editor-reopened-arabic") }
            }
            .padding()
            .navigationTitle("Edit test page")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        if model.hasUnresolvedInput { discard = true } else { state.close() }
                    }.disabled(model.saving || model.nativeEditPending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await state.save() } }
                        .disabled(!model.dirty || model.saving || model.nativeEditPending || model.recoverableNativeText != nil)
                }
            }
            .confirmationDialog("Discard unsaved test edits?", isPresented: $discard) {
                Button("Discard", role: .destructive) { state.discardForTest() }
                Button("Cancel", role: .cancel) {}
            }
            .interactiveDismissDisabled(model.hasUnresolvedInput)
        }
    }
}
