import Foundation
import WorldsModels

public enum ClaudeError: Error, LocalizedError, Sendable {
    case unsupportedPlatform, executableUnavailable, busy, invalidRequest, launchFailed(String), cancelled, timedOut, processFailed(Int32), streamMalformed, auditUnavailable
    public var errorDescription: String? {
        switch self {
        case .unsupportedPlatform: return "The local Claude runtime is unavailable on this platform."
        case .executableUnavailable: return "Claude Code could not be found."
        case .busy: return "Another Claude run is already active."
        case .invalidRequest: return "The request is invalid."
        case .launchFailed(let message): return "Could not start the runtime: \(message)"
        case .cancelled: return "The run was cancelled."
        case .timedOut: return "The run exceeded its time limit."
        case .processFailed(let code): return "The runtime exited with status \(code)."
        case .streamMalformed: return "The runtime returned an invalid event stream."
        case .auditUnavailable: return "The run audit could not be saved."
        }
    }
}

public enum ClaudeEvent: Sendable, Equatable {
    case text(String)
    case tool(name: String, input: JSONValue?)
    case toolResult(isError: Bool)
    case result(text: String, isError: Bool)
}

public struct RunAuditEvent: Codable, Sendable {
    public let runID: UUID
    public let timestamp: Date
    public let state: String
    public init(runID: UUID, state: String) { self.runID = runID; self.timestamp = Date(); self.state = state }
}
public protocol RunAuditSink: Sendable {
    func record(_ event: RunAuditEvent) async throws
}

/// An MCP executable is supplied only after the host has established the user's
/// permission and confirmed that the server enforces the same permissions.
public protocol WorldsMCPAuthorizer: Sendable {
    func authorize(executable: URL, runID: UUID) async throws -> Bool
}
public struct AuthorizedMCPServer: Sendable {
    public let executable: URL
    public init(executable: URL) { self.executable = executable }
}
public struct ClaudeRequest: Sendable {
    public let runID: UUID
    public let prompt: String
    public let systemPrompt: String
    public let sessionID: String
    public let resume: Bool
    public let model: String
    public let effort: String
    public let mcp: AuthorizedMCPServer?
    public init(runID: UUID = UUID(), prompt: String, systemPrompt: String, sessionID: String, resume: Bool = false, model: String = "haiku", effort: String = "low", mcp: AuthorizedMCPServer? = nil) {
        self.runID = runID; self.prompt = prompt; self.systemPrompt = systemPrompt; self.sessionID = sessionID; self.resume = resume; self.model = model; self.effort = effort; self.mcp = mcp
    }
}
public struct ClaudeResult: Sendable {
    public let text: String
    public let isError: Bool
}

public enum ClaudeExecutable {
    /// Returns an executable file only; this function never runs it.
    public static func discover(configured: URL? = nil, environment: [String: String] = ProcessInfo.processInfo.environment, home: URL = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)) -> URL? {
        var candidates: [URL] = []
        if let configured { candidates.append(configured) }
        for item in (environment["PATH"] ?? "").split(separator: ":") where !item.isEmpty {
            let path = String(item)
            if path.hasPrefix("/") { candidates.append(URL(fileURLWithPath: path, isDirectory: true).appendingPathComponent("claude")) }
        }
        candidates.append(home.appendingPathComponent(".local/bin/claude"))
        candidates.append(home.appendingPathComponent(".claude/local/claude"))
        return candidates.first { url in
            var directory: ObjCBool = false
            return url.isFileURL && FileManager.default.fileExists(atPath: url.path, isDirectory: &directory) && !directory.boolValue && FileManager.default.isExecutableFile(atPath: url.path)
        }
    }
}


