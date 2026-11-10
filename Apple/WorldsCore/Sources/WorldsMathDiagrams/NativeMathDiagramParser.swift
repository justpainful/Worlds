import Foundation
import SwiftMath
import MermaidLayout

public struct MermaidSourceDiagnostic: Sendable, Equatable {
    public let line: Int?
    public let message: String
    public init(line: Int?, message: String) { self.line = line; self.message = message }
}
public struct MermaidSourceInspection: Sendable {
    public let diagramType: String?
    public let diagnostics: [MermaidSourceDiagnostic]
    /// The upstream parser has no complete syntax coverage report.
    public var fidelityVerified: Bool { false }
}

public enum NativeMathDiagramParser {
    public static func validateMath(_ source: String) throws {
        guard source.utf8.count <= 64 * 1024 else { throw MathDiagramError.sourceTooLarge }
        var error: NSError?
        guard MTMathListBuilder.build(fromString: source.isEmpty ? "\\square" : source, error: &error) != nil else {
            throw MathDiagramError.unsupportedSyntax(error?.localizedDescription ?? "Unsupported math expression")
        }
    }
    /// This reports upstream diagnostics and some known ignored directives.
    /// An empty list does not establish visual or semantic compatibility.
    public static func inspectMermaid(_ source: String) throws -> MermaidSourceInspection {
        guard source.utf8.count <= 64 * 1024 else { throw MathDiagramError.sourceTooLarge }
        let parsed = MermaidParser.parse(source)
        var issues = MermaidParser.diagnose(source).map { MermaidSourceDiagnostic(line: $0.line, message: $0.message) }
        let pattern = #"(?im)(?:^|;)\s*(classDef|class|style|click|linkStyle)\b"#
        let expression = try NSRegularExpression(pattern: pattern)
        let range = NSRange(source.startIndex..<source.endIndex, in: source)
        for match in expression.matches(in: source, range: range) {
            guard let swiftRange = Range(match.range(at: 1), in: source) else { continue }
            let prefix = source[..<swiftRange.lowerBound]
            let line = prefix.reduce(into: 1) { if $1 == "\n" { $0 += 1 } }
            issues.append(MermaidSourceDiagnostic(line: line, message: "Directive \(source[swiftRange]) may be ignored by the native parser"))
        }
        return MermaidSourceInspection(diagramType: parsed?.typeName, diagnostics: issues)
    }
    public static func validateMermaid(_ source: String) throws -> String {
        let inspection = try inspectMermaid(source)
        if let issue = inspection.diagnostics.first { throw MathDiagramError.unsupportedSyntax(issue.message) }
        guard let kind = inspection.diagramType else { throw MathDiagramError.unsupportedSyntax("Unrecognized or unsupported Mermaid syntax") }
        return kind
    }
}
