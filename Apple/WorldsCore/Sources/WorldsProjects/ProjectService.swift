import Foundation
import WorldsModels

public struct ProjectRecord: Sendable, Equatable {
    public let id: String
    public let kind: String
    public let metadata: JSONValue
    public let revision: Int64
    public init(id: String, kind: String, metadata: JSONValue, revision: Int64) {
        self.id = id; self.kind = kind; self.metadata = metadata; self.revision = revision
    }
}

/// A host implementation must authorize every read and perform compare-and-swap
/// atomically in one transaction. This module does not implement real storage.
public protocol ProjectRepository: Sendable {
    func readProject(id: String) async throws -> ProjectRecord
    func compareAndSwapProject(id: String, expectedRevision: Int64, expectedMetadata: JSONValue, metadata: JSONValue) async throws -> ProjectRecord
}

public actor ProjectService {
    private let repository: any ProjectRepository
    public init(repository: any ProjectRepository) { self.repository = repository }
    /// The supplied resources must already be filtered by the host's ACL.
    public func apply(projectID: String, expectedRevision: Int64, change: ProjectChange, authorizedResources: [ProjectResource]) async throws -> ProjectRecord {
        let current = try await repository.readProject(id: projectID)
        guard current.id == projectID, current.kind == "project" else { throw ProjectError.notProject }
        guard current.revision == expectedRevision else { throw ProjectError.conflict }
        var project = try ProjectMetadata(source: current.metadata)
        try project.apply(change, projectID: projectID, resources: authorizedResources)
        return try await repository.compareAndSwapProject(id: projectID, expectedRevision: expectedRevision, expectedMetadata: current.metadata, metadata: project.source)
    }
}
