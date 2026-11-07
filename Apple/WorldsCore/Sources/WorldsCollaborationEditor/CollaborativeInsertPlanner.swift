import Foundation
import WorldsModels
import WorldsRichText
import WorldsCollaboration

public enum CollaborativeInsertError: Error, Equatable {
    case markedText, unsupportedSelection, unsupportedContent, invalidBoundary, missingIdentity
}

/// A conservative insertion intent; it does not mutate the editor document.
public struct CollaborativeInsertIntent: Sendable, Equatable {
    public let blockIndex: UInt32
    public let blockID: String
    public let expectedText: String
    public let offsetUTF16: UInt32
    public let text: String

    /// Persists before applying the CRDT update via the session. The UI must
    /// wait for a verified document projection; this is not an optimistic edit.
    public func commit(to session: CollaborationSession) async throws {
        try await session.insertPlain(blockIndex: blockIndex, blockID: blockID, expected: expectedText, offset: offsetUTF16, insertion: text)
    }
}

public enum CollaborativeInsertPlanner {
    /// Only an insertion inside one unformatted top-level paragraph is supported.
    public static func prepare(document: RichTextDocument, selection: NSRange, insertion: String, markedTextPending: Bool) throws -> CollaborativeInsertIntent {
        guard !markedTextPending else { throw CollaborativeInsertError.markedText }
        guard selection.location != NSNotFound, selection.location >= 0, selection.length == 0 else { throw CollaborativeInsertError.unsupportedSelection }
        guard !insertion.isEmpty, insertion.utf8.count <= 16_384, !insertion.utf8.contains(0),
              !insertion.contains("\n"), !insertion.contains("\r"), !insertion.contains("\u{fffc}") else { throw CollaborativeInsertError.unsupportedContent }
        guard case .object(let root) = document.source, case .array(let blocks)? = root["content"] else { throw CollaborativeInsertError.unsupportedContent }
        let projection = document.project()
        let matches = projection.spans.filter { span in
            span.path.indices.count == 2 && selection.location >= span.range.location && selection.location - span.range.location <= span.range.length
        }
        guard matches.count == 1, let span = matches.first, span.marks.isEmpty else { throw CollaborativeInsertError.unsupportedSelection }
        let indices = span.path.indices, index = indices[0]
        guard index >= 0, index < blocks.count, index <= Int(UInt32.max), indices[1] == 0,
              case .object(let paragraph) = blocks[index], case .string("paragraph")? = paragraph["type"],
              case .object(let attrs)? = paragraph["attrs"], case .string(let id)? = attrs["bid"], !id.isEmpty, id.utf8.count <= 1024, !id.utf8.contains(0),
              case .array(let children)? = paragraph["content"], children.count == 1,
              case .object(let node) = children[0], case .string("text")? = node["type"],
              case .string(let expected)? = node["text"], expected.utf8.count <= 16_384, !expected.utf8.contains(0), Set(node.keys).isSubset(of: ["type", "text", "marks"]) else { throw CollaborativeInsertError.unsupportedContent }
        if let marks = node["marks"] { guard case .array(let list) = marks, list.isEmpty else { throw CollaborativeInsertError.unsupportedContent } }
        let sameIDs = blocks.filter { block in
            guard case .object(let obj) = block, case .object(let a)? = obj["attrs"], case .string(let bid)? = a["bid"] else { return false }
            return bid == id
        }
        guard sameIDs.count == 1 else { throw CollaborativeInsertError.missingIdentity }
        let offset = selection.location - span.range.location
        guard offset <= expected.utf16.count,
              let position = expected.utf16.index(expected.utf16.startIndex, offsetBy: offset, limitedBy: expected.utf16.endIndex),
              String.Index(position, within: expected) != nil else { throw CollaborativeInsertError.invalidBoundary }
        guard offset <= Int(UInt32.max) else { throw CollaborativeInsertError.invalidBoundary }
        return CollaborativeInsertIntent(blockIndex: UInt32(index), blockID: id, expectedText: expected, offsetUTF16: UInt32(offset), text: insertion)
    }
}
