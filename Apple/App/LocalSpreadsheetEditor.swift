#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
import SwiftUI
import WorldsLocalImport
import WorldsWorkspaceAccess
import WorldsModels
import WorldsNativeWrites
import WorldsResourceRepositories
import WorldsSpreadsheet
import WorldsSpreadsheetViews

/// Loads a spreadsheet from the person's workspace or an independent local
/// copy and saves only its `metadata.sheet`, in the desktop's workbook shape.
@MainActor private final class LocalSpreadsheetState: ObservableObject {
    enum Problem { case open, conflict, save }
    @Published var model: SpreadsheetEditorModel?
    @Published var loading = true
    @Published var saving = false
    @Published var problem: Problem?
    private var baseline: SpreadsheetRecord?
    private var repository: NativeResourceRepository?
    let copy: WorkspaceWriteTarget
    private let pageID: String

    init(copy: WorkspaceWriteTarget, pageID: String) { self.copy = copy; self.pageID = pageID }

    func load() async {
        loading = true; problem = nil
        defer { loading = false }
        do {
            let repository = NativeResourceRepository(store: try NativePersonalStore(url: copy.databaseURL))
            let record = try await repository.readSpreadsheet(id: pageID)
            self.repository = repository
            baseline = record
            model = SpreadsheetEditorModel(workbook: SpreadsheetWorkbook(metadata: record.metadata), editable: true)
        } catch { problem = .open }
    }

    func save(onSaved: @escaping @MainActor () -> Void) async {
        guard !saving, let model, let repository, let baseline else { return }
        model.commitDraft()
        let workbook = model.workbook
        let metadata = workbook.metadata(replacingSheetIn: baseline.metadata)
        saving = true; problem = nil
        defer { saving = false }
        do {
            let updated = try await repository.saveSpreadsheet(id: pageID, baseline: baseline, metadata: metadata)
            self.baseline = updated
            if model.workbook == workbook { model.markSaved() }
            onSaved()
        } catch NativeWriteError.conflict {
            problem = .conflict
        } catch {
            problem = .save
        }
    }
}

struct LocalSpreadsheetEditor: View {
    @StateObject private var state: LocalSpreadsheetState
    private let title: String
    private let onSaved: @MainActor () -> Void

    init(copy: WorkspaceWriteTarget, pageID: String, title: String, onSaved: @escaping @MainActor () -> Void) {
        _state = StateObject(wrappedValue: LocalSpreadsheetState(copy: copy, pageID: pageID))
        self.title = title
        self.onSaved = onSaved
    }

    var body: some View {
        NavigationStack {
            Group {
                if let model = state.model {
                    LocalSpreadsheetScreen(model: model, state: state, title: title, onSaved: onSaved)
                } else if state.loading {
                    ProgressView("Opening spreadsheet")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    LocalSpreadsheetUnavailable()
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 760, idealWidth: 980, minHeight: 540, idealHeight: 720)
        #endif
        .task { await state.load() }
    }
}

private struct LocalSpreadsheetUnavailable: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        ContentUnavailableView("This spreadsheet could not be opened.", systemImage: "tablecells")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .accessibilityIdentifier("spreadsheet-editor-error")
    }
}

/// Observes the model so Save and Close follow unsaved changes.
private struct LocalSpreadsheetScreen: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var model: SpreadsheetEditorModel
    @ObservedObject var state: LocalSpreadsheetState
    let title: String
    let onSaved: @MainActor () -> Void
    @State private var confirmDiscard = false

    private var unsaved: Bool { model.hasChanges || model.draftIsPending }

    var body: some View {
        SpreadsheetEditorView(model: model)
            .safeAreaInset(edge: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(workspaceSaveNotice(state.copy))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if let problem = state.problem { problemText(problem) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(.bar)
            }
            .navigationTitle(title.isEmpty ? String(localized: "Spreadsheet") : title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { if unsaved { confirmDiscard = true } else { dismiss() } }
                        .disabled(state.saving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if state.saving {
                        ProgressView().controlSize(.small).accessibilityLabel(Text("Saving"))
                    } else {
                        Button("Save") { Task { await state.save(onSaved: onSaved) } }
                            .keyboardShortcut("s", modifiers: .command)
                            .disabled(!unsaved)
                            .accessibilityIdentifier("save-local-spreadsheet")
                    }
                }
            }
            .interactiveDismissDisabled(state.saving || unsaved)
            .confirmationDialog("Discard changes?", isPresented: $confirmDiscard) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) { }
            }
    }

    @ViewBuilder
    private func problemText(_ problem: LocalSpreadsheetState.Problem) -> some View {
        switch problem {
        case .conflict:
            Text("This spreadsheet changed elsewhere. Close and reopen it to load the latest version.")
                .font(.footnote).foregroundStyle(.red).accessibilityIdentifier("spreadsheet-editor-conflict")
        case .save, .open:
            Text("The spreadsheet could not be saved. Your changes are still here.")
                .font(.footnote).foregroundStyle(.red).accessibilityIdentifier("spreadsheet-editor-save-error")
        }
    }
}
#endif
