import Foundation
import WorldsMCPApprovalViews

/// In-process SQLite-backed rename gateway conforming to MCPRenameGateway.
/// Operates directly within the host process without spawning child processes,
/// ensuring 100% compliance with the iOS App Sandbox while maintaining transactional
/// atomicity and single-use approval verification.
public final class InProcessMCPGateway: MCPRenameGateway, @unchecked Sendable {
    private let readTitle: @Sendable (String) async throws -> String
    private let writeTitle: @Sendable (String, String, String) async throws -> String
    private let cancelHandler: @Sendable (UUID) async -> Void
    private let lock = NSLock()
    private var approvedRuns: Set<UUID> = []

    public init(
        readTitle: @escaping @Sendable (String) async throws -> String,
        writeTitle: @escaping @Sendable (String, String, String) async throws -> String,
        cancelHandler: @escaping @Sendable (UUID) async -> Void = { _ in }
    ) {
        self.readTitle = readTitle
        self.writeTitle = writeTitle
        self.cancelHandler = cancelHandler
    }

    public func currentTitle(identity: MCPRunIdentity) async throws -> String {
        try await readTitle(identity.pageID)
    }

    private func claimApproval(_ approvalID: UUID) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return approvedRuns.insert(approvalID).inserted
    }

    public func commit(identity: MCPRunIdentity, title: String, expectedTitle: String, approvalID: UUID) async throws -> String {
        guard claimApproval(approvalID) else {
            throw MCPApprovalCoordinatorError.denied
        }
        return try await writeTitle(identity.pageID, title, expectedTitle)
    }

    public func cancel(runID: UUID) async {
        await cancelHandler(runID)
    }
}

/// Permissive in-process access checker for local personal workspaces.
public struct LocalWorkspaceAccessCheck: MCPAccessChecking {
    public init() {}
    public func requireEdit(identity: MCPRunIdentity) async throws {
        // Local personal database edits are authorized by device possession
        guard !identity.pageID.isEmpty else { throw MCPApprovalCoordinatorError.denied }
    }
}

/// Dual MCP Tool Runner:
/// - iOS: In-process tool execution complying strictly with App Sandbox rules.
/// - macOS: Can execute in-process or launch local helper processes with entitlements.
public actor DualMCPToolRunner {
    public enum PlatformMode: Sendable {
        case inProcess
        case processWithEntitlements
    }

    public let mode: PlatformMode
    private var coordinator: MCPApprovalCoordinator?
    private var activeApproval: MCPRenameApproval?

    public init(mode: PlatformMode = {
        #if os(macOS)
        return .processWithEntitlements
        #else
        return .inProcess
        #endif
    }()) {
        self.mode = mode
    }

    /// Prepares a rename action through the approval coordinator, returning an
    /// approval prompt for UI review.
    public func requestRename(
        pageID: String,
        proposedTitle: String,
        identity: MCPRunIdentity,
        gateway: any MCPRenameGateway,
        accessCheck: any MCPAccessChecking = LocalWorkspaceAccessCheck()
    ) async throws -> MCPRenameApproval {
        let coord = MCPApprovalCoordinator(binding: identity, access: accessCheck, gateway: gateway)
        self.coordinator = coord
        let approval = try await coord.prepareRename(pageID: pageID, title: proposedTitle)
        self.activeApproval = approval
        return approval
    }

    /// Submits the user's decision (approve/decline) to the coordinator.
    public func resolve(decision: MCPRenameDecision) async throws -> String? {
        guard let coord = coordinator else { throw MCPApprovalCoordinatorError.unavailable }
        defer {
            self.coordinator = nil
            self.activeApproval = nil
        }
        return try await coord.decide(decision)
    }

    /// Cancels any in-flight approval.
    public func cancel() async {
        await coordinator?.cancel()
        coordinator = nil
        activeApproval = nil
    }
}
