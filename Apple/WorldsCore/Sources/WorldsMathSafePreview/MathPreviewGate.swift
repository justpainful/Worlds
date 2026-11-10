import Foundation
import SwiftMath

public enum MathPreviewError: Error, Equatable {
    case empty, tooLarge, unsupportedCharacter, unsupportedCommand, nestingLimit, invalidSyntax
}

/// Narrow preview gate. A successful parse is not proof of KaTeX equivalence.
public enum MathPreviewGate {
    public static func validate(_ source: String) throws {
        guard !source.isEmpty else { throw MathPreviewError.empty }
        guard source.utf8.count <= 512 else { throw MathPreviewError.tooLarge }
        let allowedCommands: Set<String> = ["frac", "sqrt", "int"]
        let chars = Array(source.utf8)
        var index = 0, depth = 0
        while index < chars.count {
            let c = chars[index]
            if c == 92 {
                index += 1
                guard index < chars.count else { throw MathPreviewError.invalidSyntax }
                if chars[index] == 44 { index += 1; continue }
                let start = index
                while index < chars.count && ((65...90).contains(chars[index]) || (97...122).contains(chars[index])) { index += 1 }
                guard index > start, let command = String(bytes: chars[start..<index], encoding: .utf8), allowedCommands.contains(command) else { throw MathPreviewError.unsupportedCommand }
                continue
            }
            if c == 123 { depth += 1; if depth > 12 { throw MathPreviewError.nestingLimit } }
            else if c == 125 { depth -= 1; if depth < 0 { throw MathPreviewError.invalidSyntax } }
            else if !((48...57).contains(c) || (65...90).contains(c) || (97...122).contains(c) || [32, 9, 10, 13, 43, 45, 61, 40, 41, 91, 93, 42, 47, 94, 95, 46, 44].contains(c)) { throw MathPreviewError.unsupportedCharacter }
            index += 1
        }
        guard depth == 0 else { throw MathPreviewError.invalidSyntax }
        var error: NSError?
        guard MTMathListBuilder.build(fromString: source, error: &error) != nil else { throw MathPreviewError.invalidSyntax }
    }
}
