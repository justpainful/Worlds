import XCTest
@testable import WorldsMCPApprovalViews

final class MCPRenameApprovalTests: XCTestCase {
    @MainActor func testDecisionIsSingleUseAndDismissalCannotOverrideApproval() {
        let id = UUID()
        var results: [MCPRenameDecision] = []
        let state = MCPRenameDecisionState(id: id) { results.append($0) }
        state.approve(); state.decline(); state.approve()
        XCTAssertEqual(results, [.approve(id)])
    }
    @MainActor func testDismissalDeclinesOnlyOnce() {
        let id = UUID()
        var results: [MCPRenameDecision] = []
        let state = MCPRenameDecisionState(id: id) { results.append($0) }
        state.decline(); state.decline(); state.approve()
        XCTAssertEqual(results, [.decline(id)])
    }
    @MainActor func testReviewEscapesDirectionalAndLineControls() throws {
        XCTAssertEqual(MCPRenameApprovalView.visible("hello\n\u{202e}abc"), "hello\\u{000A}\\u{202E}abc")
        XCTAssertThrowsError(try MCPRenameApproval(id: UUID(), runID: UUID(), copyID: UUID(), pageID: "", currentTitle: "old", proposedTitle: "new"))
    }
}
