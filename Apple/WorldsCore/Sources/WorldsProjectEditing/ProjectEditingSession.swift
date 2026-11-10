import Foundation
import WorldsProjects
import WorldsModels

public enum ProjectEditingError: Error, Equatable { case saveInProgress, reloadRequired, invalidResponse }

/// Personal project draft. Callers must supply an already authorized repository.
/// The full original metadata is the CAS baseline, even if timestamps collide.
public actor ProjectEditingSession {
    public nonisolated let initial: ProjectRecord
    private let repository: any ProjectRepository
    private var baseline: ProjectRecord
    private var draft: ProjectMetadata
    private var undoStack: [ProjectMetadata] = []
    private var redoStack: [ProjectMetadata] = []
    private var saving = false
    private var invalidated = false

    private init(repository: any ProjectRepository, record: ProjectRecord) throws {
        guard record.kind == "project" else { throw ProjectError.notProject }
        self.repository = repository; initial = record; baseline = record
        draft = try ProjectMetadata(source: record.metadata)
    }
    public static func open(repository: any ProjectRepository, projectID: String) async throws -> ProjectEditingSession {
        let record = try await repository.readProject(id: projectID)
        guard record.id == projectID else { throw ProjectEditingError.invalidResponse }
        return try ProjectEditingSession(repository: repository, record: record)
    }
    public func current() -> ProjectMetadata { draft }
    public func canUndo() -> Bool { !undoStack.isEmpty }
    public func canRedo() -> Bool { !redoStack.isEmpty }
    public func change(_ change: ProjectChange, authorizedResources: [ProjectResource]) throws {
        guard !saving else { throw ProjectEditingError.saveInProgress }
        guard !invalidated else { throw ProjectEditingError.reloadRequired }
        var updated = draft
        try updated.apply(change, projectID: baseline.id, resources: authorizedResources)
        guard updated != draft else { return }
        undoStack.append(draft); if undoStack.count > 120 { undoStack.removeFirst() }
        redoStack.removeAll(); draft = updated
    }
    public func undo() throws {
        guard !saving else { throw ProjectEditingError.saveInProgress }
        guard !invalidated else { throw ProjectEditingError.reloadRequired }
        if let previous = undoStack.popLast() { redoStack.append(draft); draft = previous }
    }
    public func redo() throws {
        guard !saving else { throw ProjectEditingError.saveInProgress }
        guard !invalidated else { throw ProjectEditingError.reloadRequired }
        if let next = redoStack.popLast() { undoStack.append(draft); draft = next }
    }
    public func save() async throws -> ProjectRecord {
        guard !saving else { throw ProjectEditingError.saveInProgress }
        guard !invalidated else { throw ProjectEditingError.reloadRequired }
        guard draft.source != baseline.metadata else { return baseline }
        saving = true; defer { saving = false }
        do {
            let result = try await repository.compareAndSwapProject(id: baseline.id, expectedRevision: baseline.revision, expectedMetadata: baseline.metadata, metadata: draft.source)
            guard result.id == baseline.id, result.kind == "project", result.metadata == draft.source else { throw ProjectEditingError.invalidResponse }
            baseline = result
            // Undo is for unsaved edits only. A saved change cannot be silently
            // reversed without a fresh, conflict-checked transaction.
            undoStack.removeAll(); redoStack.removeAll()
            return result
        } catch {
            // The commit may have succeeded before an error was delivered.
            invalidated = true
            throw error
        }
    }
}
