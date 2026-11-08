import Foundation
import Combine
import WorldsModels
import WorldsRichText

public enum NativeEditorError: Error, LocalizedError, Equatable {
    case crossesUnsupportedBoundary, unsupportedFormatting, unsupportedRichPaste, invalidSelection, saveInProgress, nativeEditPending, unrecoveredNativeText
    public var errorDescription: String? {
        switch self {
        case .crossesUnsupportedBoundary: return "This edit crosses a block or unsupported element."
        case .unsupportedFormatting: return "This selection cannot be formatted without changing unsupported content."
        case .unsupportedRichPaste: return "Rich text or attachments cannot be pasted without losing formatting. Paste plain text instead."
        case .invalidSelection: return "The selected text is unavailable."
        case .saveInProgress: return "A save is already in progress."
        case .nativeEditPending: return "Finish the current text composition before saving."
        case .unrecoveredNativeText: return "Copy or discard the unapplied text before editing or saving."
        }
    }
}

/// The app supplies authorization, durable storage and conflict handling.
/// Implementations must reject a stale base rather than overwrite newer data.
public protocol EditorPersistence: Sendable {
    func save(documentJSON: Data, basedOn: Int64) async throws -> Int64
}
struct NativeListMarker: Identifiable, Equatable {
    let id: String
    let location: Int
    let label: String
    let checked: Bool?
    let text: String
    let rightToLeft: Bool
    let path: [Int]
    let depth: Int
    let empty: Bool
}

@MainActor
public final class NativeEditorModel: ObservableObject {
    @Published public private(set) var document: RichTextDocument
    @Published public var selection: NSRange = NSRange(location: 0, length: 0)
    @Published public private(set) var dirty = false
    @Published public private(set) var saving = false
    @Published public private(set) var nativeEditPending = false
    @Published public private(set) var errorMessage: String?
    /// The text surface's rejected value, retained until the user explicitly discards it.
    @Published public private(set) var recoverableNativeText: String?
    public let undoManager = UndoManager()
    public private(set) var baseRevision: Int64
    public let supportsDocumentFormatting: Bool
    private var generation: UInt64 = 0
    private var savedSource: JSONValue

    public init(document: RichTextDocument, baseRevision: Int64, supportsDocumentFormatting: Bool = false) {
        self.document = document; self.baseRevision = baseRevision; self.savedSource = document.source
        self.supportsDocumentFormatting = supportsDocumentFormatting
        self.undoManager.groupsByEvent = false
    }
    public var projection: RichTextProjection { document.project() }
    public var attributedText: NSAttributedString { document.attributedString() }
    var listMarkers: [NativeListMarker] {
        let projected = projection
        let ns = projected.text as NSString
        var offset = 0, result: [NativeListMarker] = []
        func walk(_ value: JSONValue, path: [Int], direction: String?, depth: Int) {
            guard case .object(let node) = value, case .string(let type)? = node["type"] else { return }
            var dir = direction
            if case .object(let attrs)? = node["attrs"] {
                if case .string(let value)? = attrs["dir"] { dir = value }
                else if case .string(let value)? = attrs["direction"] { dir = value }
            }
            if type == "text", case .string(let text)? = node["text"] { offset += text.utf16.count; return }
            if type == "hardBreak" { offset += 1; return }
            if case .array(let children)? = node["content"] {
                for (index, child) in children.enumerated() {
                    if index > 0 && ["tableRow", "doc", "bulletList", "orderedList", "taskList", "table", "listItem", "taskItem", "blockquote", "tableCell", "tableHeader"].contains(type) { offset += 1 }
                    let childPath = path + [index]
                    if ["bulletList", "orderedList", "taskList"].contains(type), case .object(let item) = child,
                       item["type"] == .string(type == "taskList" ? "taskItem" : "listItem") {
                        var checked: Bool?
                        if type == "taskList", case .object(let attrs)? = item["attrs"], case .bool(let value)? = attrs["checked"] { checked = value }
                        var start: Int64 = 1
                        if case .object(let attrs)? = node["attrs"], case .integer(let value)? = attrs["start"] { start = value }
                        let (number, overflow) = start.addingReportingOverflow(Int64(index))
                        if (type != "taskList" || checked != nil) && (type != "orderedList" || !overflow) {
                            let paragraphPath = childPath + [0]
                            let span = projected.spans.first { $0.path.indices.starts(with: paragraphPath) }
                            var itemDirection = dir
                            if case .array(let contents)? = item["content"], let first = contents.first,
                               case .object(let paragraph) = first, case .object(let attrs)? = paragraph["attrs"] {
                                if case .string(let value)? = attrs["dir"] { itemDirection = value }
                                else if case .string(let value)? = attrs["direction"] { itemDirection = value }
                            }
                            let label = type == "bulletList" ? "•" : (type == "orderedList" ? "\(number)." : (checked == true ? "☑" : "☐"))
                            let text = span.map { NSMaxRange($0.range) <= ns.length ? ns.substring(with: $0.range) : "" } ?? ""
                            result.append(NativeListMarker(id: childPath.map { String($0) }.joined(separator: "."), location: offset, label: label, checked: checked,
                                text: text.isEmpty ? "Empty task" : text, rightToLeft: (span?.direction ?? itemDirection) == "rtl", path: childPath, depth: depth, empty: text.isEmpty))
                        }
                    }
                    walk(child, path: childPath, direction: dir, depth: depth + (["bulletList", "orderedList", "taskList"].contains(type) ? 1 : 0))
                }
            } else if !["doc", "paragraph", "heading", "table", "tableRow", "tableCell", "tableHeader"].contains(type) { offset += 1 }
        }
        walk(document.source, path: [], direction: nil, depth: 0)
        return result
    }
    public var currentListDescription: String? {
        guard selection.location != NSNotFound, let span = projection.spans.first(where: { selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }) else { return nil }
        if let marker = listMarkers.filter({ span.path.indices.starts(with: $0.path) }).max(by: { $0.path.count < $1.path.count }) {
            if let checked = marker.checked { return checked ? "Task complete" : "Task incomplete" }
            return marker.label == "•" ? "Bulleted list" : "Numbered list"
        }
        guard
              let index = span.path.indices.first, case .object(let root) = document.source,
              case .array(let blocks)? = root["content"], blocks.indices.contains(index), case .object(let block) = blocks[index],
              case .string(let kind)? = block["type"] else { return nil }
        switch kind {
        case "bulletList": return "Bulleted list"
        case "orderedList": return "Numbered list"
        case "taskList":
            guard span.path.indices.count >= 2, case .array(let items)? = block["content"], items.indices.contains(span.path.indices[1]),
                  case .object(let item) = items[span.path.indices[1]], case .object(let attrs)? = item["attrs"],
                  case .bool(let checked)? = attrs["checked"] else { return "Checklist" }
            return checked ? "Task complete" : "Task incomplete"
        default: return nil
        }
    }
    /// Hosts must use this when deciding whether it is safe to close the editor.
    public var hasUnresolvedInput: Bool { dirty || saving || nativeEditPending || recoverableNativeText != nil }

    /// Use the native delegate's exact range for list boundaries. Inferring a
    /// range from the final string is ambiguous when adjacent lines are equal.
    func isListKeyboardEdit(range: NSRange, replacement: String) -> Bool {
        guard range.location != NSNotFound, range.location >= 0, range.length >= 0,
              range.location <= Int.max - range.length else { return false }
        if replacement == "\n", range.length == 0 {
            return listMarkers.contains { $0.empty && $0.location == range.location } || projection.spans.contains { span in
                range.location >= span.range.location && range.location <= NSMaxRange(span.range)
                    && listMarkers.contains { span.path.indices.starts(with: $0.path) }
            }
        }
        return replacement.isEmpty && range.length == 1 && NSMaxRange(range) <= projection.text.utf16.count
            && (projection.text as NSString).substring(with: range) == "\n"
            && listMarkers.contains { $0.location == NSMaxRange(range) }
    }

    /// Structural edits and line insertion are rejected until block editing is supported.
    @discardableResult
    public func replace(range: NSRange, with replacement: String) throws -> NSRange {
        guard recoverableNativeText == nil else { throw NativeEditorError.unrecoveredNativeText }
        guard !replacement.contains("\u{fffc}") else { throw NativeEditorError.crossesUnsupportedBoundary }
        guard range.location != NSNotFound, range.location >= 0, range.length >= 0,
              range.location <= Int.max - range.length else { throw NativeEditorError.invalidSelection }
        let before = document
        if range.length == 0, replacement == "\n",
           let marker = listMarkers.filter({ $0.empty && $0.depth > 0 && $0.location == range.location }).max(by: { $0.depth < $1.depth }) {
            try liftListItem(marker: marker)
            return selection
        }
        if range.length == 0, replacement == "\n", let marker = listMarkers.first(where: { $0.empty && $0.depth == 0 && $0.location == range.location }) {
            let target: RichTextPath
            do { target = try document.exitLastEmptyRootListItem(at: RichTextPath(marker.path)) }
            catch { throw NativeEditorError.unsupportedFormatting }
            registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
            if let span = projection.spans.first(where: { $0.path.indices == target.indices }) { selection = NSRange(location: span.range.location, length: 0) }
            return selection
        }
        if range.length == 0, replacement == "\n",
           let span = projection.spans.first(where: { range.location >= $0.range.location && range.location <= NSMaxRange($0.range) }),
           listMarkers.contains(where: { span.path.indices.starts(with: $0.path) }) {
            do { try document.splitListItem(at: span.path, offset: range.location - span.range.location) }
            catch { throw NativeEditorError.crossesUnsupportedBoundary }
            registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
            let caret = NSRange(location: range.location + 1, length: 0); selection = caret; return caret
        }
        if range.length == 1, replacement.isEmpty, range.location < projection.text.utf16.count,
           (projection.text as NSString).substring(with: range) == "\n",
           let marker = listMarkers.first(where: { $0.location == range.location + 1 }) {
            do { try document.mergeListItem(at: RichTextPath(marker.path)) }
            catch { throw NativeEditorError.crossesUnsupportedBoundary }
            registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
            let caret = NSRange(location: range.location, length: 0); selection = caret; return caret
        }
        if range.length == 0, !replacement.isEmpty, !replacement.contains("\n"),
           let marker = listMarkers.first(where: { $0.location == range.location && $0.empty }) {
            do { try document.insertIntoEmptyListItem(at: RichTextPath(marker.path), text: replacement) }
            catch { throw NativeEditorError.crossesUnsupportedBoundary }
            registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
            let caret = NSRange(location: range.location + replacement.utf16.count, length: 0); selection = caret; return caret
        }
        if range.length == 0, !replacement.isEmpty, !replacement.contains("\n") {
            let empty = projection.spans.filter { $0.range.length == 0 && $0.range.location == range.location }
            if empty.count == 1 {
                do { try document.insertIntoEmptyParagraph(at: empty[0].path, text: replacement) }
                catch { throw NativeEditorError.crossesUnsupportedBoundary }
                registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
                let caret = NSRange(location: range.location + replacement.utf16.count, length: 0); selection = caret; return caret
            }
        }
        let matches = projection.spans.filter { span in
            range.location >= span.range.location && NSMaxRange(range) <= NSMaxRange(span.range)
        }
        if matches.count == 1, let span = matches.first, !replacement.contains("\n"), !replacement.contains("\r") {
            let local = NSRange(location: range.location - span.range.location, length: range.length)
            try document.replaceText(at: span.path, range: local, with: replacement)
        } else {
            try document.replaceParagraphSelection(range, with: replacement)
        }
        registerRestore(before)
        generation &+= 1
        dirty = document.source != savedSource
        let caret = NSRange(location: range.location + replacement.utf16.count, length: 0)
        selection = caret; errorMessage = nil
        return caret
    }

    /// Applies the committed text from a native input method as a single diff.
    /// No source data is changed until the native marked-text session ends.
    public func commitNativeText(_ text: String, selection: NSRange) throws {
        let old = projection.text
        if old == text { self.selection = selection; return }
        let lhs = Array(old.utf16), rhs = Array(text.utf16)
        var prefix = 0
        while prefix < lhs.count, prefix < rhs.count, lhs[prefix] == rhs[prefix] { prefix += 1 }
        func boundary(_ value: String, _ offset: Int) -> String.Index? {
            guard let utf = value.utf16.index(value.utf16.startIndex, offsetBy: offset, limitedBy: value.utf16.endIndex) else { return nil }
            return String.Index(utf, within: value)
        }
        while prefix > 0 && (boundary(old, prefix) == nil || boundary(text, prefix) == nil) { prefix -= 1 }
        var suffix = 0
        while suffix < lhs.count - prefix, suffix < rhs.count - prefix, lhs[lhs.count - 1 - suffix] == rhs[rhs.count - 1 - suffix] { suffix += 1 }
        while suffix > 0 && (boundary(old, lhs.count - suffix) == nil || boundary(text, rhs.count - suffix) == nil) { suffix -= 1 }
        guard let start = boundary(text, prefix), let end = boundary(text, rhs.count - suffix) else { throw NativeEditorError.invalidSelection }
        _ = try replace(range: NSRange(location: prefix, length: lhs.count - prefix - suffix), with: String(text[start..<end]))
        if selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
           selection.location <= text.utf16.count, selection.length <= text.utf16.count - selection.location { self.selection = selection }
    }
    /// Partial formatting is supported only where splitting cannot move opaque
    /// siblings or unknown marks. Full-node formatting preserves those marks.
    public func toggleMark(_ name: String, selection range: NSRange) throws {
        guard recoverableNativeText == nil else { throw NativeEditorError.unrecoveredNativeText }
        guard ["bold", "italic", "underline", "strike"].contains(name) else { throw NativeEditorError.unsupportedFormatting }
        guard range.location != NSNotFound, range.location >= 0, range.length > 0,
              range.location <= Int.max - range.length else { throw NativeEditorError.unsupportedFormatting }
        let hits = projection.spans.filter { NSIntersectionRange($0.range, range).length > 0 }
        guard let span = hits.first else { throw NativeEditorError.unsupportedFormatting }
        if hits.count > 1 {
            var cursor = range.location
            var pieces: [(path: RichTextPath, range: NSRange)] = []
            for hit in hits {
                let overlap = NSIntersectionRange(hit.range, range)
                guard overlap.location == cursor else { throw NativeEditorError.unsupportedFormatting }
                pieces.append((path: hit.path, range: NSRange(location: overlap.location - hit.range.location, length: overlap.length)))
                cursor = NSMaxRange(overlap)
            }
            guard cursor == NSMaxRange(range) else { throw NativeEditorError.unsupportedFormatting }
            let before = document
            do { try document.toggleMarkAcrossRuns(pieces, mark: name) } catch { throw NativeEditorError.unsupportedFormatting }
            registerRestore(before)
            generation &+= 1; dirty = document.source != savedSource; errorMessage = nil; selection = range
            return
        }
        guard range.location >= span.range.location, NSMaxRange(range) <= NSMaxRange(span.range) else { throw NativeEditorError.unsupportedFormatting }
        if span.range != range {
            let before = document
            do { try document.togglePartialMark(at: span.path, range: NSRange(location: range.location - span.range.location, length: range.length), mark: name) }
            catch { throw NativeEditorError.unsupportedFormatting }
            registerRestore(before)
            generation &+= 1; dirty = document.source != savedSource; errorMessage = nil; selection = range
            return
        }
        var marks = span.marks
        func markType(_ value: JSONValue) -> String? {
            guard case .object(let object) = value, case .string(let type)? = object["type"] else { return nil }
            return type
        }
        if marks.contains(where: { markType($0) == name }) { marks.removeAll { markType($0) == name } }
        else { marks.append(.object(["type": .string(name)])) }
        let before = document
        try document.setMarks(at: span.path, marks: marks)
        registerRestore(before)
        generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    /// Keep opaque marks on whole nodes. Splitting or spanning nodes is only
    /// permitted when every affected sibling has fully understood marks.
    public func setLink(_ url: URL?, selection range: NSRange) throws {
        guard recoverableNativeText == nil else { throw NativeEditorError.unrecoveredNativeText }
        guard !nativeEditPending, !saving, range.location != NSNotFound, range.location >= 0, range.length > 0,
              range.location <= Int.max - range.length, url.map({ RichLinkSafety.isAllowed($0.absoluteString) }) ?? true else { throw NativeEditorError.unsupportedFormatting }
        let hits = projection.spans.filter { NSIntersectionRange($0.range, range).length > 0 }
        guard let span = hits.first else { throw NativeEditorError.unsupportedFormatting }
        if hits.count > 1 || span.range != range {
            var cursor = range.location, pieces: [(path: RichTextPath, range: NSRange)] = []
            for hit in hits {
                let overlap = NSIntersectionRange(hit.range, range)
                guard overlap.location == cursor else { throw NativeEditorError.unsupportedFormatting }
                pieces.append((hit.path, NSRange(location: overlap.location - hit.range.location, length: overlap.length)))
                cursor = NSMaxRange(overlap)
            }
            guard cursor == NSMaxRange(range) else { throw NativeEditorError.unsupportedFormatting }
            let before = document
            do { try document.setLinkAcrossRuns(pieces, href: url?.absoluteString) } catch { throw NativeEditorError.unsupportedFormatting }
            registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil; selection = range
            return
        }
        var marks = span.marks
        let links = marks.indices.filter { index in
            guard case .object(let mark) = marks[index], case .string("link")? = mark["type"] else { return false }
            return true
        }
        guard links.count <= 1 else { throw NativeEditorError.unsupportedFormatting }
        if let index = links.first, case .object(let link) = marks[index] {
            guard case .object(let attrs)? = link["attrs"], case .string(let existing)? = attrs["href"],
                  RichLinkSafety.isAllowed(existing) else { throw NativeEditorError.unsupportedFormatting }
            guard Set(link.keys) == Set(["type", "attrs"]), Set(attrs.keys) == Set(["href"]) else { throw NativeEditorError.unsupportedFormatting }
        }
        if let url {
            var link: [String: JSONValue] = ["type": .string("link")]
            if let index = links.first, case .object(let existing) = marks[index] { link = existing }
            if let raw = link["attrs"], case .object = raw {} else if link["attrs"] != nil { throw NativeEditorError.unsupportedFormatting }
            var attrs: [String: JSONValue] = [:]
            if case .object(let existing)? = link["attrs"] { attrs = existing }
            attrs["href"] = .string(url.absoluteString)
            link["attrs"] = .object(attrs)
            if let index = links.first { marks[index] = .object(link) } else { marks.append(.object(link)) }
        } else if let index = links.first { marks.remove(at: index) }
        let before = document
        try document.setMarks(at: span.path, marks: marks)
        registerRestore(before)
        generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func undo() { if recoverableNativeText == nil { undoManager.undo() } }
    public func redo() { if recoverableNativeText == nil { undoManager.redo() } }
    public func setHeading(_ level: Int?) throws {
        guard recoverableNativeText == nil, !nativeEditPending, !saving,
              selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= Int.max - selection.length else { throw NativeEditorError.unsupportedFormatting }
        let hits = projection.spans.filter {
            selection.length == 0
                ? selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range)
                : NSIntersectionRange($0.range, selection).length > 0
        }
        guard let first = hits.first, !first.path.indices.isEmpty else { throw NativeEditorError.unsupportedFormatting }
        let parent = Array(first.path.indices.dropLast())
        guard hits.allSatisfy({ Array($0.path.indices.dropLast()) == parent }),
              selection.length == 0 || (selection.location >= first.range.location && NSMaxRange(selection) <= NSMaxRange(hits.last!.range)) else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.setHeading(at: RichTextPath(parent), level: level) }
        catch { throw NativeEditorError.unsupportedFormatting }
        guard document != before else { return }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func setTextAlignment(_ alignment: String?) throws {
        guard supportsDocumentFormatting, recoverableNativeText == nil, !nativeEditPending, !saving,
              selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= Int.max - selection.length else { throw NativeEditorError.unsupportedFormatting }
        let hits = projection.spans.filter {
            selection.length == 0 ? selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) : NSIntersectionRange($0.range, selection).length > 0
        }
        guard let first = hits.first else { throw NativeEditorError.unsupportedFormatting }
        func blockPath(_ span: RichTextSpan) -> [Int] { span.range.length == 0 ? span.path.indices : Array(span.path.indices.dropLast()) }
        let parent = blockPath(first)
        guard !parent.isEmpty, hits.allSatisfy({ blockPath($0) == parent }),
              selection.length == 0 || (selection.location >= first.range.location && NSMaxRange(selection) <= NSMaxRange(hits.last!.range)) else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.setTextAlignment(at: RichTextPath(parent), alignment: alignment) } catch { throw NativeEditorError.unsupportedFormatting }
        guard before != document else { return }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func setParagraphStyle(_ style: String) throws {
        guard supportsDocumentFormatting, recoverableNativeText == nil, !nativeEditPending, !saving,
              selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= Int.max - selection.length else { throw NativeEditorError.unsupportedFormatting }
        let hits = projection.spans.filter {
            selection.length == 0 ? selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) : NSIntersectionRange($0.range, selection).length > 0
        }
        guard let first = hits.first else { throw NativeEditorError.unsupportedFormatting }
        func blockPath(_ span: RichTextSpan) -> [Int] { span.range.length == 0 ? span.path.indices : Array(span.path.indices.dropLast()) }
        let parent = blockPath(first)
        guard !parent.isEmpty, hits.allSatisfy({ blockPath($0) == parent }),
              selection.length == 0 || (selection.location >= first.range.location && NSMaxRange(selection) <= NSMaxRange(hits.last!.range)) else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.setParagraphStyle(at: RichTextPath(parent), style: style) } catch { throw NativeEditorError.unsupportedFormatting }
        guard before != document else { return }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public var selectionIsInRootTable: Bool {
        guard selection.location != NSNotFound, selection.location >= 0, selection.length == 0,
              let span = projection.spans.first(where: { selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }),
              let index = span.path.indices.first, case .object(let root) = document.source,
              case .array(let blocks)? = root["content"], blocks.indices.contains(index),
              case .object(let block) = blocks[index] else { return false }
        return block["type"] == .string("table")
    }
    public func appendTableRow() throws {
        guard supportsDocumentFormatting, selectionIsInRootTable, recoverableNativeText == nil, !nativeEditPending, !saving,
              let span = projection.spans.first(where: { selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }),
              let index = span.path.indices.first else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.appendPlainTableRow(at: RichTextPath([index])) } catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func insertTableRowBelow() throws {
        guard supportsDocumentFormatting, selectionIsInRootTable, recoverableNativeText == nil, !nativeEditPending, !saving,
              let span = projection.spans.first(where: { selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }),
              span.path.indices.count >= 4 else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.insertPlainTableRow(at: RichTextPath([span.path.indices[0]]), afterRow: span.path.indices[1]) }
        catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func appendTableColumn() throws {
        guard supportsDocumentFormatting, selectionIsInRootTable, recoverableNativeText == nil, !nativeEditPending, !saving,
              let span = projection.spans.first(where: { selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }),
              let index = span.path.indices.first else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.appendPlainTableColumn(at: RichTextPath([index])) } catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func insertTableColumnRight() throws {
        guard supportsDocumentFormatting, selectionIsInRootTable, recoverableNativeText == nil, !nativeEditPending, !saving,
              let span = projection.spans.first(where: { selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }),
              span.path.indices.count >= 4 else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.insertPlainTableColumn(at: RichTextPath([span.path.indices[0]]), afterColumn: span.path.indices[2]) }
        catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func makeList(_ kind: String) throws {
        guard recoverableNativeText == nil, !nativeEditPending, !saving,
              selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= Int.max - selection.length,
              let span = projection.spans.first(where: { selection.location >= $0.range.location && NSMaxRange(selection) <= NSMaxRange($0.range) }),
              let block = span.path.indices.first else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do {
            if let marker = listMarkers.filter({ span.path.indices.starts(with: $0.path) }).max(by: { $0.path.count < $1.path.count }), marker.depth > 0 {
                try document.convertNestedList(at: RichTextPath(Array(marker.path.dropLast())), kind: kind)
            } else { try document.toggleList(blockIndex: block, kind: kind) }
        } catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    public func toggleTask() throws {
        guard recoverableNativeText == nil, !nativeEditPending, !saving,
              selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= Int.max - selection.length,
              let span = projection.spans.first(where: { selection.location >= $0.range.location && NSMaxRange(selection) <= NSMaxRange($0.range) }) else { throw NativeEditorError.unsupportedFormatting }
        guard let marker = listMarkers.filter({ $0.checked != nil && span.path.indices.starts(with: $0.path) }).max(by: { $0.path.count < $1.path.count }) else { throw NativeEditorError.unsupportedFormatting }
        try toggleTask(marker: marker)
    }
    func toggleTask(marker: NativeListMarker) throws {
        guard marker.checked != nil, listMarkers.contains(marker), recoverableNativeText == nil, !nativeEditPending, !saving else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        do { try document.toggleTaskItemNode(at: RichTextPath(marker.path)) } catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
    }
    func liftListItem(marker: NativeListMarker) throws {
        guard marker.depth > 0, listMarkers.contains(marker), validSelectionBoundaries, recoverableNativeText == nil, !nativeEditPending, !saving else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        let caretOffset = caretOffsetInListItem(marker)
        let target: RichTextPath
        do { target = try document.liftLastNestedItem(at: RichTextPath(marker.path)) }
        catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
        restoreListCaret(path: target.indices, offset: caretOffset)
    }
    func indentListItem(marker: NativeListMarker) throws {
        guard listMarkers.contains(marker), validSelectionBoundaries, recoverableNativeText == nil, !nativeEditPending, !saving else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        let caretOffset = caretOffsetInListItem(marker)
        let target: RichTextPath
        do { target = try document.indentLastListItem(at: RichTextPath(marker.path)) }
        catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
        restoreListCaret(path: target.indices, offset: caretOffset)
    }
    private func caretOffsetInListItem(_ marker: NativeListMarker) -> Int? {
        guard selection.length == 0, selection.location >= marker.location,
              projection.spans.contains(where: { $0.path.indices.starts(with: marker.path) && selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }) || (marker.empty && selection.location == marker.location) else { return nil }
        return selection.location - marker.location
    }
    private var validSelectionBoundaries: Bool {
        let text = projection.text
        guard selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= text.utf16.count, selection.length <= text.utf16.count - selection.location,
              let start = text.utf16.index(text.utf16.startIndex, offsetBy: selection.location, limitedBy: text.utf16.endIndex),
              let end = text.utf16.index(start, offsetBy: selection.length, limitedBy: text.utf16.endIndex) else { return false }
        return String.Index(start, within: text) != nil && String.Index(end, within: text) != nil
    }
    private func restoreListCaret(path: [Int], offset: Int?) {
        guard let marker = listMarkers.first(where: { $0.path == path }) else { return }
        let spans = projection.spans.filter { $0.path.indices.starts(with: path) }
        let end = spans.map { NSMaxRange($0.range) }.max() ?? marker.location
        let delta = min(offset ?? 0, max(0, end - marker.location))
        selection = NSRange(location: marker.location + delta, length: 0)
    }
    public func changeListIndent(outdent: Bool) throws {
        guard selection.length == 0, selection.location != NSNotFound,
              let marker = listMarkers.filter({ $0.location <= selection.location }).last else { throw NativeEditorError.unsupportedFormatting }
        // Require the caret to belong to this item, not a later paragraph.
        guard marker.empty && marker.location == selection.location || projection.spans.contains(where: {
            $0.path.indices.starts(with: marker.path) && selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range)
        }) else { throw NativeEditorError.unsupportedFormatting }
        if outdent { try liftListItem(marker: marker) } else { try indentListItem(marker: marker) }
    }
    var hasListCaret: Bool {
        guard selection.length == 0, selection.location != NSNotFound else { return false }
        return listMarkers.contains { marker in
            (marker.empty && marker.location == selection.location) || projection.spans.contains {
                $0.path.indices.starts(with: marker.path) && selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range)
            }
        }
    }
    func addListItem(to marker: NativeListMarker, text: String, nested: Bool) throws {
        guard listMarkers.contains(marker), recoverableNativeText == nil, !nativeEditPending, !saving else { throw NativeEditorError.unsupportedFormatting }
        let before = document
        let newPath: RichTextPath
        do { newPath = try document.appendListItem(after: RichTextPath(marker.path), text: text, nested: nested) }
        catch { throw NativeEditorError.unsupportedFormatting }
        registerRestore(before); generation &+= 1; dirty = document.source != savedSource; errorMessage = nil
        if let span = projection.spans.first(where: { $0.path.indices.starts(with: newPath.indices) }) {
            selection = NSRange(location: NSMaxRange(span.range), length: 0)
        } else if let marker = listMarkers.first(where: { $0.path == newPath.indices && $0.empty }) {
            selection = NSRange(location: marker.location, length: 0)
        }
    }
    public func appendListItem(text: String, nested: Bool) throws {
        guard let span = projection.spans.first(where: { selection.location >= $0.range.location && selection.location <= NSMaxRange($0.range) }),
              let marker = listMarkers.filter({ span.path.indices.starts(with: $0.path) }).max(by: { $0.path.count < $1.path.count }) else { throw NativeEditorError.unsupportedFormatting }
        try addListItem(to: marker, text: text, nested: nested)
    }
    public func report(_ error: Error) { errorMessage = error.localizedDescription }
    public func setNativeEditPending(_ value: Bool) { nativeEditPending = value }
    public func retainRejectedNativeText(_ text: String) {
        if recoverableNativeText == nil { recoverableNativeText = text }
        errorMessage = NativeEditorError.unrecoveredNativeText.localizedDescription
    }
    public func discardRejectedNativeText() { recoverableNativeText = nil; errorMessage = nil }

    public func save(using persistence: any EditorPersistence) async throws {
        guard !saving else { throw NativeEditorError.saveInProgress }
        guard !nativeEditPending else { throw NativeEditorError.nativeEditPending }
        guard recoverableNativeText == nil else { throw NativeEditorError.unrecoveredNativeText }
        saving = true
        defer { saving = false }
        let source = document.source
        let encoded = try document.json()
        let revision = try await persistence.save(documentJSON: encoded, basedOn: baseRevision)
        baseRevision = revision
        savedSource = source
        dirty = document.source != savedSource
    }
    private func registerRestore(_ before: RichTextDocument) {
        let group = !undoManager.isUndoing && !undoManager.isRedoing
        if group { undoManager.beginUndoGrouping() }
        undoManager.registerUndo(withTarget: self) { target in MainActor.assumeIsolated { target.restore(before) } }
        if group { undoManager.endUndoGrouping() }
    }
    private func restore(_ prior: RichTextDocument) {
        let current = document
        registerRestore(current)
        document = prior
        generation &+= 1; dirty = document.source != savedSource
        selection = NSRange(location: min(selection.location, projection.text.utf16.count), length: 0)
    }
}
