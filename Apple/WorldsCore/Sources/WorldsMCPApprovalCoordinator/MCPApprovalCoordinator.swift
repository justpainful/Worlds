import Foundation
import WorldsIdentityContinuity
import WorldsMCPApprovalViews

public struct MCPRunIdentity: Sendable, Equatable {
    public let runID: UUID
    public let copyID: UUID
    public let serverID: String
    public let userID: String
    public let workspaceID: String
    public let pageID: String
    public init(runID: UUID, copyID: UUID, serverID: String, userID: String, workspaceID: String, pageID: String) {
        self.runID = runID; self.copyID = copyID; self.serverID = serverID
        self.userID = userID; self.workspaceID = workspaceID; self.pageID = pageID
    }
}

public enum MCPApprovalCoordinatorError: Error, Equatable {
    case unavailable, denied, changed, cancelled
}

/// The gateway must bind its process, database and account independently. Its
/// commit must compare the baseline and request inside the same transaction as
/// the authorization gate and execute only the audited original rename tool.
/// A remote access lookup alone cannot establish that guarantee.
public protocol MCPRenameGateway: Sendable {
    func currentTitle(identity: MCPRunIdentity) async throws -> String
    func commit(identity: MCPRunIdentity, title: String, expectedTitle: String, approvalID: UUID) async throws -> String
    func cancel(runID: UUID) async
}

public protocol MCPAccessChecking: Sendable {
    func requireEdit(identity: MCPRunIdentity) async throws
}

/// Actual identity-service lookup, not a durable or atomic authorization token.
public struct MCPIdentityAccessCheck: MCPAccessChecking {
    private let identity: IdentitySessionCoordinator
    public init(identity: IdentitySessionCoordinator) { self.identity = identity }
    public func requireEdit(identity binding: MCPRunIdentity) async throws {
        let level = try await identity.currentWorkspacePageLevel(workspaceID: binding.workspaceID, pageID: binding.pageID, expectedUserID: binding.userID)
        guard level == .edit || level == .full else { throw MCPApprovalCoordinatorError.denied }
    }
}

/// Experimental coordinator. No production gateway exists yet and this type is
/// deliberately not connected to Claude or the application.
public actor MCPApprovalCoordinator {
    private enum State {
        case idle, preparing(UUID), waiting(MCPRenameApproval), checking(UUID), executing(UUID), finished
    }
    private let binding: MCPRunIdentity
    private let access: any MCPAccessChecking
    private let gateway: any MCPRenameGateway
    private var state: State = .idle

    public init(binding: MCPRunIdentity, access: any MCPAccessChecking, gateway: any MCPRenameGateway) {
        self.binding = binding; self.access = access; self.gateway = gateway
    }

    public func prepareRename(pageID: String, title: String) async throws -> MCPRenameApproval {
        guard case .idle = state, pageID == binding.pageID else { throw MCPApprovalCoordinatorError.unavailable }
        let id = UUID(); state = .preparing(id)
        do {
            try await access.requireEdit(identity: binding)
            guard case .preparing(id) = state else { throw MCPApprovalCoordinatorError.cancelled }
            let old = try await gateway.currentTitle(identity: binding)
            guard case .preparing(id) = state else { throw MCPApprovalCoordinatorError.cancelled }
            let prompt = try MCPRenameApproval(id: id, runID: binding.runID, copyID: binding.copyID, pageID: pageID, currentTitle: old, proposedTitle: title)
            state = .waiting(prompt); return prompt
        } catch { state = .finished; throw error }
    }

    public func decide(_ decision: MCPRenameDecision) async throws -> String? {
        guard case .waiting(let prompt) = state else { throw MCPApprovalCoordinatorError.unavailable }
        switch decision {
        case .decline(let id):
            guard id == prompt.id else { throw MCPApprovalCoordinatorError.unavailable }
            state = .finished; return nil
        case .approve(let id):
            guard id == prompt.id else { throw MCPApprovalCoordinatorError.unavailable }
            state = .checking(id)
            do {
                try await access.requireEdit(identity: binding)
                guard case .checking(id) = state else { throw MCPApprovalCoordinatorError.cancelled }
                state = .executing(id)
                // Once handed to the gateway, its commit/cancel race determines
                // the real outcome. Never report a committed write as cancelled.
                let result = try await gateway.commit(identity: binding, title: prompt.proposedTitle, expectedTitle: prompt.currentTitle, approvalID: id)
                state = .finished; return result
            } catch { state = .finished; throw error }
        }
    }

    public func cancel() async {
        state = .finished
        await gateway.cancel(runID: binding.runID)
    }
}
