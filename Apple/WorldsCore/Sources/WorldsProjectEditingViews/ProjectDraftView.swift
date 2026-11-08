import SwiftUI
import WorldsProjects
import WorldsProjectEditing

/// A personal, live page supplied by the host's authorized snapshot.
public struct ProjectLinkCandidate: Sendable, Identifiable {
    public let id: String
    public let title: String
    public let kind: String
    public let parentID: String?
    public let archived: Bool
    public let sortKey: Double
    public let createdAt: Int64
    public let updatedAt: Int64
    public init(id: String, title: String, kind: String, parentID: String?, archived: Bool, sortKey: Double, createdAt: Int64, updatedAt: Int64) {
        self.id = id; self.title = title; self.kind = kind; self.parentID = parentID
        self.archived = archived; self.sortKey = sortKey; self.createdAt = createdAt; self.updatedAt = updatedAt
    }
    fileprivate var resource: ProjectResource {
        ProjectResource(id: id, title: title, kind: kind, parentID: parentID, archived: archived,
                        deletedAt: nil, sortKey: sortKey, createdAt: createdAt, updatedAt: updatedAt)
    }
}

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
    @Published var links: [String] = []
    private var stagedDescription = "", stagedStatus = "active", stagedStart = "", stagedDue = ""
    var hasUnstagedChanges: Bool { descriptionText != stagedDescription || status != stagedStatus || start != stagedStart || due != stagedDue }
    private let repository: any ProjectRepository
    private let projectID: String
    let candidates: [ProjectLinkCandidate]
    let allowsLinkEditing: Bool
    var availableLinks: [ProjectLinkCandidate] {
        candidates.filter { $0.id != projectID && $0.kind != "template" && !links.contains($0.id) && !($0.parentID == projectID && !$0.archived) }
    }
    private var session: ProjectEditingSession?

    init(repository: any ProjectRepository, projectID: String, candidates: [ProjectLinkCandidate], allowsLinkEditing: Bool) {
        self.repository = repository; self.projectID = projectID; self.candidates = candidates; self.allowsLinkEditing = allowsLinkEditing
    }
    func load() async {
        guard !busy else { return }
        loading = true; error = nil; ready = false
        do { session = try await ProjectEditingSession.open(repository: repository, projectID: projectID); await refresh(); ready = true; hasSession = true }
        catch { self.error = projectErrorMessage(error) }
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
        } catch { self.error = projectErrorMessage(error) }
    }
    func changeLink(_ change: ProjectChange) async {
        guard let session, !busy, ready else { return }
        await stage()
        guard error == nil, ready, !busy else { return }
        busy = true; defer { busy = false }
        do {
            try await session.change(change, authorizedResources: candidates.map(\.resource))
            didSave = false; error = nil; await refresh()
        } catch { self.error = projectErrorMessage(error) }
    }
    func undo() async { await history(redo: false) }
    func redo() async { await history(redo: true) }
    private func history(redo: Bool) async {
        guard let session, !busy, ready else { return }
        busy = true; defer { busy = false }
        do { if redo { try await session.redo() } else { try await session.undo() }; didSave = false; error = nil; await refresh() }
        catch { self.error = projectErrorMessage(error) }
    }
    func save() async -> Bool {
        guard let session, !busy, ready else { return false }
        await stage()
        guard error == nil, ready, !busy else { return false }
        busy = true; defer { busy = false }
        do { _ = try await session.save(); error = nil; await refresh(); didSave = true; return true }
        catch { self.error = "The project could not be saved. \(projectErrorMessage(error))"; ready = false; return false }
    }
    private func refresh() async {
        guard let session else { return }
        let project = await session.current()
        descriptionText = project.description; status = project.status; links = project.links
        start = project.start ?? ""; due = project.due ?? ""
        stagedDescription = descriptionText; stagedStatus = status; stagedStart = start; stagedDue = due
        canUndo = await session.canUndo(); canRedo = await session.canRedo()
    }
}

/// Messages never identify a page whose access cannot be established.
private func projectErrorMessage(_ error: Error) -> String {
    if let project = error as? ProjectError {
        switch project {
        case .invalidLinks:
            return "Project links are malformed or duplicated. Link changes are blocked to avoid removing data. Review the links in the original Worlds project; a new local copy will not include edits made here."
        case .invalidResource:
            return "This page is no longer eligible for linking. Reload the project and try again."
        case .conflict:
            return "The project changed elsewhere. Reload it before saving again."
        case .invalidDate:
            return "Enter a valid date in YYYY-MM-DD format."
        case .invalidStatus:
            return "Choose an available project status."
        case .invalidMetadata, .notProject:
            return "The project data is unavailable or invalid. Reload the project before editing."
        }
    }
    let detail = error.localizedDescription
    if detail == "page unavailable" || detail == "page is shared, deleted, or unavailable" || detail.hasPrefix("unavailable_project_link:") {
        return "The project or a linked page is unavailable or no longer personal. Check access in the original Worlds project and create a new local copy if needed. A new copy will not include edits made here."
    }
    if detail == "duplicate project link" {
        return "Project links are malformed or duplicated. Link changes are blocked to avoid removing data. Review the links in the original Worlds project; a new local copy will not include edits made here."
    }
    return detail
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
    @State private var showLinkPicker = false
    private let onSaved: @MainActor () -> Void
    public init(projectID: String, repository: any ProjectRepository, candidates: [ProjectLinkCandidate] = [], allowsLinkEditing: Bool = false, onSaved: @escaping @MainActor () -> Void) {
        _model = StateObject(wrappedValue: ProjectDraftModel(repository: repository, projectID: projectID, candidates: candidates, allowsLinkEditing: allowsLinkEditing))
        self.onSaved = onSaved
    }
    public var body: some View {
        Form {
            if model.loading { ProgressView("Loading project") }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(error)
                    .accessibilityIdentifier("project-editing-error")
            }
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
                if model.allowsLinkEditing {
                  Section("Linked pages") {
                    ForEach(Array(model.links.enumerated()), id: \.offset) { _, id in
                        let title = model.candidates.first(where: { $0.id == id })?.title ?? "Unavailable linked page"
                        HStack {
                            Text(title.isEmpty ? "Untitled" : title)
                            Spacer()
                            Button("Unlink") { Task { await model.changeLink(.unlink(id)) } }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Unlink \(title.isEmpty ? "Untitled" : title)")
                                .accessibilityIdentifier("project-unlink.\(id)")
                        }
                    }
                    if !model.availableLinks.isEmpty {
                        Button("Link existing page") { showLinkPicker = true }
                            .accessibilityIdentifier("project-link-menu")
                    }
                }
                }
                if model.didSave && !model.hasUnstagedChanges { Text("Project saved").accessibilityIdentifier("project-saved") }
                Button("Stage changes") { Task { await model.stage() } }.disabled(model.busy || !model.ready || !model.hasUnstagedChanges)
                Text("Undo and redo apply to staged changes before saving.").font(.caption).foregroundStyle(.secondary)
                ViewThatFits(in: .horizontal) {
                    HStack { editorActions }
                    VStack(alignment: .leading, spacing: 12) { editorActions }
                }
            }
            if !model.ready && !model.loading {
                Button("Reload project") {
                    if model.hasSession { confirmReload = true }
                    else { Task { await model.load() } }
                }
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
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    focusedField = nil
                    Task { if await model.save() { onSaved() } }
                }.disabled(model.busy || !model.ready)
            }
            #endif
            ToolbarItem(placement: .cancellationAction) {
                Button("Close") {
                    if model.hasSession && (model.hasUnstagedChanges || model.canUndo || !model.ready) { confirmClose = true }
                    else { dismiss() }
                }.disabled(model.busy)
            }
        }
        .sheet(isPresented: $showLinkPicker) {
            NavigationStack {
                List(model.availableLinks) { candidate in
                    Button(candidate.title.isEmpty ? "Untitled" : candidate.title) {
                        showLinkPicker = false
                        Task { await model.changeLink(.link(candidate.id)) }
                    }
                    .accessibilityIdentifier("project-link.\(candidate.id)")
                }
                .navigationTitle("Link existing page")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { showLinkPicker = false }
                    }
                }
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
        #if os(macOS)
        Button("Save") { Task { if await model.save() { onSaved() } } }.disabled(model.busy || !model.ready)
        #endif
    }

}
