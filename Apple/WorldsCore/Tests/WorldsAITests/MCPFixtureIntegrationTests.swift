#if os(macOS)
import Foundation
import XCTest
@testable import WorldsAI

private struct FixtureMCPAuthorizer: WorldsMCPAuthorizer {
    let permitted: URL
    func authorize(executable: URL, runID: UUID) async throws -> Bool { executable == permitted }
}
private actor FixtureAudit: RunAuditSink {
    private(set) var states: [String] = []
    func record(_ event: RunAuditEvent) async throws { states.append(event.state) }
}

final class MCPFixtureIntegrationTests: XCTestCase {
    func testRunnerUsesScopedOriginalProtocolFixture() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["WORLDS_REQUIRE_MCP_FIXTURE"] == "1" else { throw XCTSkip("MCP fixture integration was not requested") }
        guard let path = env["WORLDS_MCP_FIXTURE_BIN"], !path.isEmpty else { return XCTFail("MCP fixture binary is required") }
        let server = URL(fileURLWithPath: path).standardizedFileURL
        guard server.lastPathComponent == "worlds_mcp_fixture", FileManager.default.isExecutableFile(atPath: server.path) else { return XCTFail("Invalid MCP fixture binary") }
        let source = try XCTUnwrap(Bundle.module.url(forResource: "claude-mcp-fixture", withExtension: "py", subdirectory: "Fixtures"))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-ai-mcp-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let executable = directory.appendingPathComponent("provider-fixture.py")
        try FileManager.default.copyItem(at: source, to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let audit = FixtureAudit()
        let runner = try ClaudeRunner(executable: executable, audit: audit, authorizer: FixtureMCPAuthorizer(permitted: server))
        let request = ClaudeRequest(prompt: "synthetic fixture", systemPrompt: "fixture", sessionID: UUID().uuidString, mcp: AuthorizedMCPServer(executable: server))
        let result = try await runner.run(request) { _ in }
        XCTAssertEqual(result.text, "Fixture read completed")
        XCTAssertFalse(result.isError)
        let states = await audit.states; XCTAssertEqual(states, ["started", "completed"])
    }
}
#endif
