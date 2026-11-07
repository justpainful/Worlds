import Foundation
import WorldsModels
#if os(macOS)
import Darwin

public actor ClaudeRunner {
    private let executable: URL
    private let audit: any RunAuditSink
    private let authorizer: (any WorldsMCPAuthorizer)?
    private var reserved = false
    private var active: (id: UUID, process: Process)?
    private var cancelled = false

    public init(executable: URL, audit: any RunAuditSink, authorizer: (any WorldsMCPAuthorizer)? = nil) throws {
        guard executable.isFileURL, FileManager.default.isExecutableFile(atPath: executable.path) else { throw ClaudeError.executableUnavailable }
        self.executable = executable
        self.audit = audit
        self.authorizer = authorizer
    }

    public func cancel(runID: UUID) {
        guard let active, active.id == runID else { return }
        cancelled = true
        if active.process.isRunning { active.process.terminate() }
    }

    public func run(_ request: ClaudeRequest, timeout: TimeInterval = 300, onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ClaudeResult {
        guard !reserved else { throw ClaudeError.busy }
        reserved = true
        defer { reserved = false }
        guard !request.prompt.isEmpty, request.prompt.utf8.count <= 512 * 1024, request.systemPrompt.utf8.count <= 256 * 1024,
              UUID(uuidString: request.sessionID) != nil, (1...3600).contains(timeout),
              !request.model.isEmpty, request.model.utf8.count <= 128, !request.effort.isEmpty, request.effort.utf8.count <= 32 else { throw ClaudeError.invalidRequest }
        if let server = request.mcp {
            guard server.executable.isFileURL, FileManager.default.isExecutableFile(atPath: server.executable.path),
                  let authorizer, try await authorizer.authorize(executable: server.executable, runID: request.runID) else { throw ClaudeError.invalidRequest }
        }
        if Task.isCancelled { throw ClaudeError.cancelled }
        do { try await audit.record(.init(runID: request.runID, state: "started")) } catch { throw ClaudeError.auditUnavailable }
        do {
            if Task.isCancelled { throw ClaudeError.cancelled }
            let result = try await execute(request, timeout: timeout, onEvent: onEvent)
            do { try await audit.record(.init(runID: request.runID, state: result.isError ? "error" : "completed")) } catch { throw ClaudeError.auditUnavailable }
            return result
        } catch {
            do { try await audit.record(.init(runID: request.runID, state: error is CancellationError || cancelled ? "cancelled" : "error")) } catch { throw ClaudeError.auditUnavailable }
            throw error
        }
    }

    private func execute(_ request: ClaudeRequest, timeout: TimeInterval, onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ClaudeResult {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("worlds-ai-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: folder) }
        let configURL = folder.appendingPathComponent("mcp.json")
        var servers: [String: Any] = [:]
        if let server = request.mcp {
            servers["worlds"] = ["type": "stdio", "command": server.executable.path, "args": ["--mcp", "--actor", "ai", "--op", request.runID.uuidString.lowercased()]]
        }
        let config = try JSONSerialization.data(withJSONObject: ["mcpServers": servers])
        guard FileManager.default.createFile(atPath: configURL.path, contents: config, attributes: [.posixPermissions: 0o600]) else { throw ClaudeError.launchFailed("Could not create runtime configuration") }
        let process = Process()
        let stdout = Pipe(), stderr = Pipe(), stdin = Pipe()
        process.executableURL = executable
        process.currentDirectoryURL = folder
        process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
        process.arguments = ["-p", "--model", request.model, "--effort", request.effort, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config", configURL.path, "--tools", "", "--allowedTools", request.mcp == nil ? "" : "mcp__worlds", "--system-prompt", request.systemPrompt, request.resume ? "--resume" : "--session-id", request.sessionID]
        let inherited = ProcessInfo.processInfo.environment
        var env = inherited.filter { key, _ in !key.hasPrefix("CLAUDE_CODE_") && !key.hasPrefix("CLAUDE_PREVIEW_") && !["CLAUDECODE", "CLAUDE_PID", "CLAUDE_AGENT_SDK_VERSION"].contains(key) }
        if inherited["CLAUDECODE"] != nil || inherited["CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH"] != nil { env.removeValue(forKey: "ANTHROPIC_BASE_URL") }
        process.environment = env
        cancelled = false
        do { try process.run() } catch { throw ClaudeError.launchFailed("The executable could not be started") }
        active = (request.runID, process)
        defer { active = nil; if process.isRunning { process.terminate() } }
        // Drain both pipes concurrently so a large stderr stream cannot block the child.
        let stdoutReader = stdout.fileHandleForReading
        let stderrReader = stderr.fileHandleForReading
        let stdinWriter = stdin.fileHandleForWriting
        let output = Task.detached { try Self.readEvents(stdoutReader, onEvent: onEvent) }
        let errors = Task.detached { Self.drain(stderrReader) }
        let message: [String: Any] = ["type": "user", "message": ["role": "user", "content": [["type": "text", "text": request.prompt]]]]
        var data = try JSONSerialization.data(withJSONObject: message); data.append(10)
        let input = data
        let writer = Task.detached {
            try stdinWriter.write(contentsOf: input)
            try stdinWriter.close()
        }
        do {
            let deadline = Date().addingTimeInterval(timeout)
            var terminationSent: Date?
            while process.isRunning {
                if cancelled || Task.isCancelled || Date() >= deadline {
                    if terminationSent == nil { process.terminate(); terminationSent = Date() }
                    else if Date().timeIntervalSince(terminationSent!) > 2 { Darwin.kill(process.processIdentifier, SIGKILL) }
                }
                try await Task.sleep(for: .milliseconds(50))
            }
            try await writer.value
            let events = try await output.value
            _ = await errors.value
            if cancelled || Task.isCancelled { throw ClaudeError.cancelled }
            if Date() >= deadline { throw ClaudeError.timedOut }
            guard process.terminationStatus == 0 else { throw ClaudeError.processFailed(process.terminationStatus) }
            return events
        } catch {
            if process.isRunning { process.terminate(); Darwin.kill(process.processIdentifier, SIGKILL) }
            try? stdinWriter.close()
            try? stdoutReader.close()
            try? stderrReader.close()
            writer.cancel(); output.cancel(); errors.cancel()
            if cancelled || error is CancellationError { throw ClaudeError.cancelled }
            throw error
        }
    }

    private nonisolated static func readEvents(_ handle: FileHandle, onEvent: @Sendable (ClaudeEvent) -> Void) throws -> ClaudeResult {
        var buffer = Data(), collected = "", final: ClaudeResult?
        var count = 0
        func consume(_ line: Data) throws {
            guard !line.isEmpty else { return }
            count += 1; guard count <= 20_000 else { throw ClaudeError.streamMalformed }
            let events = try ClaudeStreamParser.events(line: line)
            for event in events {
                switch event {
                case .text(let value):
                    guard collected.utf8.count + value.utf8.count <= 8 * 1024 * 1024 else { throw ClaudeError.streamMalformed }
                    collected += value
                case .result(let text, let error): final = ClaudeResult(text: text, isError: error)
                default: break
                }
                onEvent(event)
            }
        }
        while let chunk = try handle.read(upToCount: 65536), !chunk.isEmpty {
            buffer.append(chunk)
            while let newline = buffer.firstIndex(of: 10) {
                let line = Data(buffer[..<newline]); buffer.removeSubrange(...newline)
                guard line.count <= 1024 * 1024 else { throw ClaudeError.streamMalformed }
                try consume(line)
            }
            guard buffer.count <= 1024 * 1024 else { throw ClaudeError.streamMalformed }
        }
        if !buffer.isEmpty { try consume(buffer) }
        guard let final else { throw ClaudeError.streamMalformed }
        return final
    }
    private nonisolated static func drain(_ handle: FileHandle) {
        while let data = try? handle.read(upToCount: 65536), !data.isEmpty { }
    }
}
#else
public actor ClaudeRunner {
    public init(executable: URL, audit: any RunAuditSink, authorizer: (any WorldsMCPAuthorizer)? = nil) throws { throw ClaudeError.unsupportedPlatform }
    public func cancel(runID: UUID) {}
    public func run(_ request: ClaudeRequest, timeout: TimeInterval = 300, onEvent: @escaping @Sendable (ClaudeEvent) -> Void) async throws -> ClaudeResult { throw ClaudeError.unsupportedPlatform }
}
#endif




