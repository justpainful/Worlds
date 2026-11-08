import XCTest
@testable import WorldsMCPApprovalCoordinator
import WorldsMCPApprovalViews

private actor Access: MCPAccessChecking {
    var allowed = true
    func setAllowed(_ value: Bool) { allowed = value }
    func requireEdit(identity: MCPRunIdentity) async throws {
        if !allowed { throw MCPApprovalCoordinatorError.denied }
    }
}

private actor Gateway: MCPRenameGateway {
    var title = "Old"
    var calls = 0
    var cancelled = false
    func currentTitle(identity: MCPRunIdentity) async throws -> String { title }
    func changeTitle(_ value: String) { title = value }
    func commit(identity: MCPRunIdentity, title: String, expectedTitle: String, approvalID: UUID) async throws -> String {
        guard !cancelled else { throw MCPApprovalCoordinatorError.cancelled }
        guard self.title == expectedTitle else { throw MCPApprovalCoordinatorError.changed }
        calls += 1; self.title = title; return title
    }
    func cancel(runID: UUID) async { cancelled = true }
    func snapshot() -> (String, Int) { (title, calls) }
}

final class MCPApprovalCoordinatorTests: XCTestCase {
    private func binding() -> MCPRunIdentity {
        MCPRunIdentity(runID: UUID(), copyID: UUID(), serverID: "server", userID: "user", workspaceID: "workspace", pageID: "page")
    }
    func testApprovalIsSingleUseAndBoundToDisplayedTitle() async throws {
        let access = Access(), gateway = Gateway()
        let subject = MCPApprovalCoordinator(binding: binding(), access: access, gateway: gateway)
        let prompt = try await subject.prepareRename(pageID: "page", title: "New")
        XCTAssertEqual(prompt.currentTitle, "Old")
        let result = try await subject.decide(.approve(prompt.id))
        XCTAssertEqual(result, "New")
        do { _ = try await subject.decide(.approve(prompt.id)); XCTFail("Approval replayed") } catch { }
        let snapshot = await gateway.snapshot(); XCTAssertEqual(snapshot.0, "New"); XCTAssertEqual(snapshot.1, 1)
    }
    func testChangedAccessOrBaselineDoesNotWrite() async throws {
        let access = Access(), gateway = Gateway()
        let first = MCPApprovalCoordinator(binding: binding(), access: access, gateway: gateway)
        let prompt = try await first.prepareRename(pageID: "page", title: "New")
        await access.setAllowed(false)
        do { _ = try await first.decide(.approve(prompt.id)); XCTFail("Access changed") } catch { }
        await access.setAllowed(true)
        let second = MCPApprovalCoordinator(binding: binding(), access: access, gateway: gateway)
        let next = try await second.prepareRename(pageID: "page", title: "New")
        await gateway.changeTitle("Concurrent edit")
        do { _ = try await second.decide(.approve(next.id)); XCTFail("Baseline changed") } catch { }
        let snapshot = await gateway.snapshot(); XCTAssertEqual(snapshot.0, "Concurrent edit"); XCTAssertEqual(snapshot.1, 0)
    }
    func testDeclineCancelAndWrongPageNeverWrite() async throws {
        let access = Access(), gateway = Gateway()
        let first = MCPApprovalCoordinator(binding: binding(), access: access, gateway: gateway)
        do { _ = try await first.prepareRename(pageID: "other", title: "New"); XCTFail("Wrong page") } catch { }
        let prompt = try await first.prepareRename(pageID: "page", title: "New")
        _ = try await first.decide(.decline(prompt.id))
        let second = MCPApprovalCoordinator(binding: binding(), access: access, gateway: gateway)
        let another = try await second.prepareRename(pageID: "page", title: "New")
        await second.cancel()
        do { _ = try await second.decide(.approve(another.id)); XCTFail("Cancelled") } catch { }
        let snapshot = await gateway.snapshot(); XCTAssertEqual(snapshot.0, "Old"); XCTAssertEqual(snapshot.1, 0)
    }
}
