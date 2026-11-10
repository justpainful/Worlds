import Foundation
import WorldsModels
import WorldsRichText
import WorldsCollaboration

public enum CollaborativeInsertError: Error, Equatable {
    case markedText, unsupportedSelection, unsupportedContent, invalidBoundary, missingIdentity, staleProjection
}

/// A conservative insertion intent; it does not mutate the editor document.
public struct CollaborativeInsertIntent: Sendable, Equatable {
    public let blockIndex: UInt32
    public let blockID: String
    public let expectedText: String
    public let offsetUTF16: UInt32
    public let text: String
    fileprivate let state: Data?

    /// Persists before applying the CRDT update via the session. The UI must
    /// wait for a verified document projection; this is not an optimistic edit.
    public func commit(to session: CollaborationSession) async throws {
        guard let state else { throw CollaborativeInsertError.staleProjection }
        try await session.insertPlain(blockIndex: blockIndex, blockID: blockID, expected: expectedText, offset: offsetUTF16, insertion: text, expectedState: state)
    }
}

public struct CollaborativeDeleteIntent: Sendable, Equatable {
    public let blockIndex: UInt32
    public let blockID: String
    public let expectedText: String
    public let offsetUTF16: UInt32
    public let lengthUTF16: UInt32
    fileprivate let state: Data
    public func commit(to session: CollaborationSession) async throws {
        try await session.deletePlain(blockIndex: blockIndex, blockID: blockID, expected: expectedText, offset: offsetUTF16, length: lengthUTF16, expectedState: state)
    }
}
public struct CollaborativeFormatIntent: Sendable, Equatable {
    public let blockIndex: UInt32
    public let blockID: String
    public let expectedText: String
    public let offsetUTF16: UInt32
    public let lengthUTF16: UInt32
    public let mark: String
    public let enabled: Bool
    fileprivate let state: Data
    public func commit(to session: CollaborationSession) async throws {
        try await session.formatPlain(blockIndex: blockIndex, blockID: blockID, expected: expectedText, offset: offsetUTF16, length: lengthUTF16, mark: mark, enabled: enabled, expectedState: state)
    }
}

public enum CollaborativeInsertPlanner {
    public static func prepareFormat(session: CollaborationSession, displayed: RichTextDocument, selection: NSRange, mark: String, enabled: Bool, markedTextPending: Bool) async throws -> CollaborativeFormatIntent {
        guard !markedTextPending else { throw CollaborativeInsertError.markedText }
        guard ["bold", "italic", "underline", "strike"].contains(mark), selection.location != NSNotFound,
              selection.location >= 0, selection.length > 0, selection.length <= Int(UInt32.max),
              selection.location <= Int.max - selection.length else { throw CollaborativeInsertError.unsupportedSelection }
        let snapshot = try await session.plainEditorSnapshot()
        let current = try RichTextDocument(json: snapshot.json)
        guard current == displayed else { throw CollaborativeInsertError.staleProjection }
        guard case .object(let root) = current.source, case .array(let blocks)? = root["content"] else { throw CollaborativeInsertError.unsupportedContent }
        let spans = current.project().spans.filter { $0.path.indices.count == 2 }
        guard let first = spans.first(where: { selection.location >= $0.range.location && selection.location < NSMaxRange($0.range) }),
              let last = spans.first(where: { selection.location + selection.length > $0.range.location && selection.location + selection.length <= NSMaxRange($0.range) }),
              first.path.indices[0] == last.path.indices[0] else { throw CollaborativeInsertError.unsupportedSelection }
        let index = first.path.indices[0]
        guard index >= 0, index < blocks.count, index <= Int(UInt32.max),
              case .object(let paragraph) = blocks[index], paragraph["type"] == .string("paragraph"),
              case .object(let attrs)? = paragraph["attrs"], case .string(let id)? = attrs["bid"], !id.isEmpty,
              case .array(let children)? = paragraph["content"], !children.isEmpty else { throw CollaborativeInsertError.unsupportedContent }
        var text = ""
        for child in children {
            guard case .object(let node) = child, node["type"] == .string("text"), case .string(let value)? = node["text"] else { throw CollaborativeInsertError.unsupportedContent }
            text += value
        }
        let start = spans.filter { $0.path.indices[0] == index }.map(\.range.location).min() ?? selection.location
        let offset = selection.location - start, end = offset + selection.length
        guard offset >= 0, offset <= Int(UInt32.max), end <= text.utf16.count,
              let a = text.utf16.index(text.utf16.startIndex, offsetBy: offset, limitedBy: text.utf16.endIndex),
              let b = text.utf16.index(text.utf16.startIndex, offsetBy: end, limitedBy: text.utf16.endIndex),
              String.Index(a, within: text) != nil, String.Index(b, within: text) != nil else { throw CollaborativeInsertError.invalidBoundary }
        return CollaborativeFormatIntent(blockIndex: UInt32(index), blockID: id, expectedText: text, offsetUTF16: UInt32(offset), lengthUTF16: UInt32(selection.length), mark: mark, enabled: enabled, state: snapshot.state)
    }
    public static func prepareDeletion(session: CollaborationSession, displayed: RichTextDocument, selection: NSRange, markedTextPending: Bool) async throws -> CollaborativeDeleteIntent {
        guard selection.location != NSNotFound, selection.length > 0, selection.length <= Int(UInt32.max) else { throw CollaborativeInsertError.unsupportedSelection }
        let snapshot = try await session.plainEditorSnapshot()
        let current = try RichTextDocument(json: snapshot.json)
        guard current == displayed else { throw CollaborativeInsertError.staleProjection }
        let insertion = try prepare(document: current, selection: NSRange(location: selection.location, length: 0), insertion: "x", markedTextPending: markedTextPending)
        let length = Int(insertion.offsetUTF16) + selection.length
        guard selection.length < insertion.expectedText.utf16.count, length <= insertion.expectedText.utf16.count,
              let end = insertion.expectedText.utf16.index(insertion.expectedText.utf16.startIndex, offsetBy: length, limitedBy: insertion.expectedText.utf16.endIndex),
              String.Index(end, within: insertion.expectedText) != nil else { throw CollaborativeInsertError.invalidBoundary }
        return CollaborativeDeleteIntent(blockIndex: insertion.blockIndex, blockID: insertion.blockID, expectedText: insertion.expectedText,
            offsetUTF16: insertion.offsetUTF16, lengthUTF16: UInt32(selection.length), state: snapshot.state)
    }
    /// Refuses a selection from an editor that has not rendered the latest
    /// authenticated, durably stored Yjs projection.
    public static func prepare(session: CollaborationSession, displayed: RichTextDocument, selection: NSRange, insertion: String, markedTextPending: Bool) async throws -> CollaborativeInsertIntent {
        let snapshot = try await session.plainEditorSnapshot()
        let current = try RichTextDocument(json: snapshot.json)
        guard current == displayed else { throw CollaborativeInsertError.staleProjection }
        let intent = try prepare(document: current, selection: selection, insertion: insertion, markedTextPending: markedTextPending)
        return CollaborativeInsertIntent(blockIndex: intent.blockIndex, blockID: intent.blockID, expectedText: intent.expectedText, offsetUTF16: intent.offsetUTF16, text: intent.text, state: snapshot.state)
    }
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
        return CollaborativeInsertIntent(blockIndex: UInt32(index), blockID: id, expectedText: expected, offsetUTF16: UInt32(offset), text: insertion, state: nil)
    }
}
