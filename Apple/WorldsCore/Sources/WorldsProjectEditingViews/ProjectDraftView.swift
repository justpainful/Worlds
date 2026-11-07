import SwiftUI
import WorldsProjects
import WorldsProjectEditing

@MainActor
private final class ProjectDraftModel: ObservableObject {
    @Published var descriptionText = ""
    @Published var status = "active"
    @Published var start = ""
    @Published var due = ""
    @Published var loading = true
    @Published var busy = false
    @Published var error: String?
    @Published var canUndo = false
    @Published var canRedo = false
    @Published var ready = false
    @Published var didSave = false
    @Published var hasSession = false
    private var stagedDescription = "", stagedStatus = "active", stagedStart = "", stagedDue = ""
    var hasUnstagedChanges: Bool { descriptionText != stagedDescription || status != stagedStatus || start != stagedStart || due != stagedDue }
    private let repository: any ProjectRepository
    private let projectID: String
    private var session: ProjectEditingSession?

    init(repository: any ProjectRepository, projectID: String) { self.repository = repository; self.projectID = projectID }
    func load() async {
        guard !busy else { return }
        loading = true; error = nil; ready = false
        do { session = try await ProjectEditingSession.open(repository: repository, projectID: projectID); await refresh(); ready = true; hasSession = true }
        catch { self.error = error.localizedDescription }
        loading = false
    }
    func stage() async {
        guard let session, !busy, ready else { return }
        busy = true; defer { busy = false }
        do {
            let original = await session.current()
            let startValue = start.isEmpty ? nil : start, dueValue = due.isEmpty ? nil : due
            var changes: [ProjectChange] = []
            if descriptionText != original.description { changes.append(.description(descriptionText)) }
            if status != original.status { changes.append(.status(status)) }
            if startValue != original.start { changes.append(.start(startValue)) }
            if dueValue != original.due { changes.append(.due(dueValue)) }
            // Validate every input before mutating the session, so invalid dates
            // cannot partially apply the rest of the form.
            var validated = original
            for change in changes { try validated.apply(change, projectID: projectID, resources: []) }
            for change in changes { try await session.change(change, authorizedResources: []) }
            if !changes.isEmpty { didSave = false }
            error = nil; await refresh()
        } catch { self.error = String(describing: error) }
    }
    func undo() async { await history(redo: false) }
    func redo() async { await history(redo: true) }
    private func history(redo: Bool) async {
        guard let session, !busy, ready else { return }
        busy = true; defer { busy = false }
        do { if redo { try await session.redo() } else { try await session.undo() }; didSave = false; error = nil; await refresh() }
        catch { self.error = String(describing: error) }
    }
    func save() async -> Bool {
        guard let session, !busy, ready else { return false }
        await stage()
        guard error == nil, ready, !busy else { return false }
        busy = true; defer { busy = false }
        do { _ = try await session.save(); error = nil; await refresh(); didSave = true; return true }
        catch { self.error = "The project could not be saved. Reload before trying again: \(error.localizedDescription)"; ready = false; return false }
    }
    private func refresh() async {
        guard let session else { return }
        let project = await session.current()
        descriptionText = project.description; status = project.status
        start = project.start ?? ""; due = project.due ?? ""
        stagedDescription = descriptionText; stagedStatus = status; stagedStart = start; stagedDue = due
        canUndo = await session.canUndo(); canRedo = await session.canRedo()
    }
}

/// Experimental: the host supplies a real authorized repository and controls
/// activation. This view is not connected to the app until reviewed on Apple.
public struct ProjectDraftView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: ProjectDraftModel
    private enum Field: Hashable { case start, due, description }
    @FocusState private var focusedField: Field?
    @State private var confirmReload = false
    @State private var confirmClose = false
    private let onSaved: @MainActor () -> Void
    public init(projectID: String, repository: any ProjectRepository, onSaved: @escaping @MainActor () -> Void) {
        _model = StateObject(wrappedValue: ProjectDraftModel(repository: repository, projectID: projectID))
        self.onSaved = onSaved
    }
    public var body: some View {
        Form {
            if model.loading { ProgressView("Loading project") }
            if let error = model.error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            if model.hasSession {
                Picker("Status", selection: $model.status) {
                    Text("Planned").tag("planned"); Text("Active").tag("active")
                    Text("Paused").tag("paused"); Text("Done").tag("done")
                }
                TextField("Start (YYYY-MM-DD)", text: $model.start).focused($focusedField, equals: .start)
                TextField("Due (YYYY-MM-DD)", text: $model.due).focused($focusedField, equals: .due)
                TextField("Description", text: $model.descriptionText, axis: .vertical)
                    .focused($focusedField, equals: .description)
                    .accessibilityIdentifier("project-description")
                if model.didSave && !model.hasUnstagedChanges { Text("Project saved").accessibilityIdentifier("project-saved") }
                Button("Stage changes") { Task { await model.stage() } }.disabled(model.busy || !model.ready || !model.hasUnstagedChanges)
                Text("Undo and redo apply to staged changes before saving.").font(.caption).foregroundStyle(.secondary)
                ViewThatFits(in: .horizontal) {
                    HStack { editorActions }
                    VStack(alignment: .leading, spacing: 12) { editorActions }
                }
            }
            if !model.ready && !model.loading {
                Button("Reload project") { confirmReload = true }
            }
        }
        #if os(macOS)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        #endif
        .disabled(model.busy || model.loading)
        .interactiveDismissDisabled(model.busy || (model.hasSession && (model.hasUnstagedChanges || model.canUndo || !model.ready)))
        .toolbar {
            #if os(iOS)
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
                    .accessibilityIdentifier("project-dismiss-keyboard")
            }
            #endif
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") {
                    if model.hasSession && (model.hasUnstagedChanges || model.canUndo || !model.ready) { confirmClose = true }
                    else { dismiss() }
                }.disabled(model.busy)
            }
        }
        .confirmationDialog("Close and discard unsaved changes?", isPresented: $confirmClose) {
            Button("Discard", role: .destructive) { dismiss() }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Reload and discard unsaved changes?", isPresented: $confirmReload) {
            Button("Reload", role: .destructive) { Task { await model.load() } }
            Button("Cancel", role: .cancel) {}
        }
        .navigationTitle("Edit project")
        .task { await model.load() }
    }
    @ViewBuilder private var editorActions: some View {
        Button("Undo") { Task { await model.undo() } }.disabled(model.busy || !model.ready || !model.canUndo || model.hasUnstagedChanges)
        Button("Redo") { Task { await model.redo() } }.disabled(model.busy || !model.ready || !model.canRedo || model.hasUnstagedChanges)
        Button("Save") { Task { if await model.save() { onSaved() } } }.disabled(model.busy || !model.ready)
    }

}
