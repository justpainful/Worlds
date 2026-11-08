import SwiftUI

/// Contains only the information needed to review one proposed rename.
/// The host must bind this request to the exact pending tool call and recheck
/// identity, page rights and baseline before committing any write.
public struct MCPRenameApproval: Identifiable, Sendable {
    public let id: UUID
    public let runID: UUID
    public let copyID: UUID
    public let pageID: String
    public let currentTitle: String
    public let proposedTitle: String
    public init(id: UUID, runID: UUID, copyID: UUID, pageID: String, currentTitle: String, proposedTitle: String) throws {
        guard !pageID.isEmpty, pageID.utf8.count <= 1024, !pageID.utf8.contains(0),
              currentTitle.utf8.count <= 4096, !proposedTitle.isEmpty, proposedTitle.utf8.count <= 4096 else { throw MCPApprovalError.invalidRequest }
        self.id = id; self.runID = runID; self.copyID = copyID; self.pageID = pageID
        self.currentTitle = currentTitle; self.proposedTitle = proposedTitle
    }
}
public enum MCPApprovalError: Error { case invalidRequest }
public enum MCPRenameDecision: Sendable, Equatable { case approve(UUID), decline(UUID) }

@MainActor public final class MCPRenameDecisionState: ObservableObject {
    private let id: UUID
    private let respond: @MainActor (MCPRenameDecision) -> Void
    @Published public private(set) var resolved = false
    public init(id: UUID, respond: @escaping @MainActor (MCPRenameDecision) -> Void) { self.id = id; self.respond = respond }
    public func approve() { finish(.approve(id)) }
    public func decline() { finish(.decline(id)) }
    private func finish(_ decision: MCPRenameDecision) {
        guard !resolved else { return }
        resolved = true; respond(decision)
    }
}

/// A dismissal is a decline. This view never executes a tool itself.
public struct MCPRenameApprovalView: View {
    private let request: MCPRenameApproval
    @StateObject private var decision: MCPRenameDecisionState
    @Environment(\.dismiss) private var dismiss
    public init(request: MCPRenameApproval, respond: @escaping @MainActor (MCPRenameDecision) -> Void) {
        self.request = request; _decision = StateObject(wrappedValue: MCPRenameDecisionState(id: request.id, respond: respond))
    }
    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Claude requests permission to rename this page in the selected local copy.")
                }
                Section("Current title") { Text(verbatim: Self.visible(request.currentTitle)).textSelection(.enabled) }
                Section("Proposed title") { Text(verbatim: Self.visible(request.proposedTitle)).textSelection(.enabled) }
                Section("Destination") {
                    LabeledContent("Page ID", value: Self.visible(request.pageID))
                    LabeledContent("Local copy", value: request.copyID.uuidString.lowercased())
                }.font(.caption)
                Section {
                    Button("Approve rename") { decision.approve(); dismiss() }
                        .disabled(decision.resolved).accessibilityIdentifier("mcp-approve-rename")
                    Button("Decline", role: .cancel) { decision.decline(); dismiss() }
                        .disabled(decision.resolved).accessibilityIdentifier("mcp-decline-rename")
                }
            }
            .navigationTitle("Review page rename")
            .onDisappear { decision.decline() }
        }
    }
    /// Directional and control characters are shown explicitly rather than
    /// allowing a title to conceal or rearrange the proposed change.
    static func visible(_ raw: String) -> String {
        var output = ""
        for scalar in raw.unicodeScalars {
            let n = scalar.value
            if CharacterSet.controlCharacters.contains(scalar) || (0x202A...0x202E).contains(n) || (0x2066...0x2069).contains(n) {
                output += String(format: "\\u{%04X}", n)
            } else { output.unicodeScalars.append(scalar) }
        }
        return output.isEmpty ? "Untitled" : output
    }
}
