import Foundation
import XCTest
import WorldsModels
@testable import WorldsAI

private actor MemoryAudit: RunAuditSink {
    private var entries: [RunAuditEvent] = []
    func record(_ event: RunAuditEvent) async throws { entries.append(event) }
    func states() -> [String] { entries.map(\.state) }
}

final class WorldsAITests: XCTestCase {
    func testParserHandlesAssistantToolsAndResults() throws {
        let input = #"{"type":"assistant","message":{"content":[{"type":"text","text":"hello"},{"type":"tool_use","name":"mcp__worlds__pages_read","input":{"id":"p"}}]}}"#
        let events = try ClaudeStreamParser.events(line: Data(input.utf8))
        XCTAssertEqual(events, [.text("hello"), .tool(name: "pages_read", input: .object(["id": .string("p")]))])
        let result = #"{"type":"result","result":"done","is_error":false}"#
        XCTAssertEqual(try ClaudeStreamParser.events(line: Data(result.utf8)), [.result(text: "done", isError: false)])
    }
    func testDiscoveryDoesNotRunExecutable() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("claude")
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        XCTAssertEqual(ClaudeExecutable.discover(environment: ["PATH": folder.path], home: folder)?.path, executable.path)
    }
    #if os(macOS)
    func testRealProcessUsesOnlyIsolatedFixtureAndWritesAudit() async throws {
        let original = try XCTUnwrap(Bundle.module.url(forResource: "claude-fixture", withExtension: "sh", subdirectory: "Fixtures"))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("fixture.sh")
        try FileManager.default.copyItem(at: original, to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let audit = try JSONLineRunAudit(url: folder.appendingPathComponent("audit.jsonl"))
        let runner = try ClaudeRunner(executable: executable, audit: audit)
        let request = ClaudeRequest(prompt: "synthetic", systemPrompt: "fixture", sessionID: UUID().uuidString)
        let result = try await runner.run(request) { _ in }
        XCTAssertEqual(result.text, "Fixture answer")
        XCTAssertFalse(result.isError)
        let log = try String(contentsOf: folder.appendingPathComponent("audit.jsonl"), encoding: .utf8)
        XCTAssertTrue(log.contains("started")); XCTAssertTrue(log.contains("completed"))
        XCTAssertFalse(log.contains("synthetic"))
    }
    func testCancellationAndOneRunLimit() async throws {
        let original = try XCTUnwrap(Bundle.module.url(forResource: "slow-fixture", withExtension: "sh", subdirectory: "Fixtures"))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("slow.sh")
        try FileManager.default.copyItem(at: original, to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let audit = MemoryAudit()
        let runner = try ClaudeRunner(executable: executable, audit: audit)
        let request = ClaudeRequest(prompt: "synthetic", systemPrompt: "fixture", sessionID: UUID().uuidString)
        let running = Task { try await runner.run(request) { _ in } }
        try await Task.sleep(for: .milliseconds(250))
        do { _ = try await runner.run(request) { _ in }; XCTFail("Concurrent runs must be rejected") }
        catch ClaudeError.busy { } catch { XCTFail("Unexpected error: \(error)") }
        await runner.cancel(runID: request.runID)
        do { _ = try await running.value; XCTFail("Run should cancel") }
        catch ClaudeError.cancelled { } catch { XCTFail("Unexpected error: \(error)") }
    }
    func testMCPRequiresAuthorizer() async throws {
        let original = try XCTUnwrap(Bundle.module.url(forResource: "claude-fixture", withExtension: "sh", subdirectory: "Fixtures"))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("fixture.sh")
        try FileManager.default.copyItem(at: original, to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let audit = MemoryAudit()
        let runner = try ClaudeRunner(executable: executable, audit: audit)
        let request = ClaudeRequest(prompt: "synthetic", systemPrompt: "fixture", sessionID: UUID().uuidString, mcp: AuthorizedMCPServer(executable: executable))
        do { _ = try await runner.run(request) { _ in }; XCTFail("An authorizer is required") }
        catch ClaudeError.invalidRequest { } catch { XCTFail("Unexpected error: \(error)") }
        let states = await audit.states()
        XCTAssertTrue(states.isEmpty)
    }
    #endif
}

