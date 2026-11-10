import Foundation
import WorldsModels

extension JSONValue {
    var aiObject: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
    var aiArray: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var aiString: String? { if case .string(let value) = self { return value }; return nil }
    var aiBool: Bool? { if case .bool(let value) = self { return value }; return nil }
}

/// Converts Claude's line-delimited stream-json format into typed events.
/// Unknown event types are ignored, preserving forwards compatibility.
public enum ClaudeStreamParser {
    public static func events(line: Data) throws -> [ClaudeEvent] {
        let value = try JSONDecoder().decode(JSONValue.self, from: line)
        guard let object = value.aiObject, let type = object["type"]?.aiString else { throw ClaudeError.streamMalformed }
        let content = object["message"]?.aiObject?["content"]?.aiArray ?? []
        switch type {
        case "assistant":
            return content.compactMap { part in
                guard let object = part.aiObject else { return nil }
                switch object["type"]?.aiString {
                case "text": return .text(object["text"]?.aiString ?? "")
                case "tool_use":
                    let name = object["name"]?.aiString ?? ""
                    let prefix = "mcp__worlds__"
                    return .tool(name: name.hasPrefix(prefix) ? String(name.dropFirst(prefix.count)) : name, input: object["input"])
                default: return nil
                }
            }
        case "user":
            return content.compactMap { part in
                guard let object = part.aiObject, object["type"]?.aiString == "tool_result" else { return nil }
                return .toolResult(isError: object["is_error"]?.aiBool ?? false)
            }
        case "result": return [.result(text: object["result"]?.aiString ?? "", isError: object["is_error"]?.aiBool ?? false)]
        default: return []
        }
    }
}
