import SwiftUI
import WorldsRichText
import WorldsModels

enum NativePastePolicy {
    private static let unsupported: Set<String> = ["public.html", "public.rtf", "com.apple.flat-rtfd", "com.apple.rtfd", "com.apple.webarchive", "public.png", "public.jpeg", "public.tiff", "public.image", "public.file-url"]
    static func rejects(_ types: [String]) -> Bool { !unsupported.isDisjoint(with: types) }
}

/// TextKit-backed editing of supported text nodes only. The host decides when
/// and whether to save using its own authorized persistence implementation.
public struct NativeEditorView: View {
    @ObservedObject private var model: NativeEditorModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var confirmDiscard = false
    @State private var addItem = false
    @State private var addTarget: NativeListMarker?
    @State private var addNested = false
    @State private var itemText = ""
    @State private var showLink = false
    @State private var linkText = ""
    @State private var linkSelection = NSRange(location: 0, length: 0)
    @State private var linkSource: JSONValue?
    public init(model: NativeEditorModel) { self.model = model }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                ScrollView(.vertical) { LazyVGrid(columns: [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 160 : 100), spacing: 8)], alignment: .leading, spacing: 8) {
                    Button("Undo") { model.undo() }.keyboardShortcut("z", modifiers: .command).disabled(!model.undoManager.canUndo)
                    Button("Redo") { model.redo() }.keyboardShortcut("z", modifiers: [.command, .shift]).disabled(!model.undoManager.canRedo)
                    Button("Bold") { format("bold") }.keyboardShortcut("b", modifiers: .command)
                    Button("Italic") { format("italic") }.keyboardShortcut("i", modifiers: .command)
                    Button("Underline") { format("underline") }.keyboardShortcut("u", modifiers: .command)
                    Button("Strikethrough") { format("strike") }.accessibilityIdentifier("editor-strikethrough")
                    Menu("Text style") {
                        Button("Paragraph") { heading(nil) }
                        Button("Heading 1") { heading(1) }
                        Button("Heading 2") { heading(2) }
                        Button("Heading 3") { heading(3) }
                    }.accessibilityIdentifier("editor-text-style")
                    Button("Link") {
                        guard model.selection.length > 0 else { model.report(NativeEditorError.unsupportedFormatting); return }
                        linkSelection = model.selection; linkSource = model.document.source; linkText = ""; showLink = true
                    }.accessibilityIdentifier("editor-link")
                    Button("Remove link") { do { try model.setLink(nil, selection: model.selection) } catch { model.report(error) } }
                        .accessibilityIdentifier("editor-remove-link")
                }.buttonStyle(.bordered).controlSize(.large).fixedSize(horizontal: false, vertical: true) }
                .accessibilityIdentifier("editor-format-toolbar")
                .scrollIndicators(.visible)
                .frame(maxHeight: dynamicTypeSize.isAccessibilitySize ? 200 : 120)
                .disabled(model.nativeEditPending || model.saving)
                ScrollView(.vertical) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 160 : 100), spacing: 8)], alignment: .leading, spacing: 8) {
                        Button("Bullets") { list("bulletList") }
                        Button("Numbered") { list("orderedList") }
                        Button("Checklist") { list("taskList") }
                        Button("Toggle task") { do { try model.toggleTask() } catch { model.report(error) } }
                    }.buttonStyle(.bordered).controlSize(.large).fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityIdentifier("editor-list-toolbar")
                .scrollIndicators(.visible)
                .frame(maxHeight: dynamicTypeSize.isAccessibilitySize ? 150 : 100)
                .disabled(model.nativeEditPending || model.saving)
                if let description = model.currentListDescription { Text(description).font(.caption).accessibilityIdentifier("editor-list-status") }
                if !model.listMarkers.isEmpty { ScrollView {
                ForEach(model.listMarkers) { marker in
                    VStack(alignment: .leading) {
                        if let checked = marker.checked {
                            Button("\(checked ? "Mark incomplete" : "Mark complete"): \(marker.text)") {
                                do { try model.toggleTask(marker: marker) } catch { model.report(error) }
                            }.accessibilityIdentifier("editor-task.\(marker.id)")
                        }
                        Button("Add next item") { addTarget = marker; addNested = false; itemText = ""; addItem = true }
                            .accessibilityIdentifier("editor-add-item.\(marker.id)")
                        Button("Add nested item") { addTarget = marker; addNested = true; itemText = ""; addItem = true }
                            .accessibilityIdentifier("editor-add-nested.\(marker.id)")
                        Button("Move in one level") { do { try model.indentListItem(marker: marker) } catch { model.report(error) } }
                            .accessibilityIdentifier("editor-indent.\(marker.id)")
                        if marker.depth > 0 {
                            Button("Move out one level") { do { try model.liftListItem(marker: marker) } catch { model.report(error) } }
                                .accessibilityIdentifier("editor-outdent.\(marker.id)")
                        }
                    }
                    .disabled(model.nativeEditPending || model.saving)
                }
                }.frame(maxHeight: 160) }
                NativeTextSurface(model: model)
                    .frame(minHeight: dynamicTypeSize.isAccessibilitySize ? 240 : 160)
            }
            .disabled(model.recoverableNativeText != nil)
            if let error = model.errorMessage { Text(error).font(.caption).foregroundStyle(.secondary) }
            if let rejected = model.recoverableNativeText {
                Text("This text was not applied. Select and copy what you need before discarding it.")
                ScrollView { Text(rejected.isEmpty ? "(Empty text)" : rejected).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(minHeight: 80, maxHeight: 220)
                Button("Discard unapplied text", role: .destructive) { confirmDiscard = true }
            }
        }
        .confirmationDialog("Discard unapplied text?", isPresented: $confirmDiscard) {
            Button("Discard", role: .destructive) { model.discardRejectedNativeText() }
            Button("Cancel", role: .cancel) { }
        }
        .alert(addNested ? "Add nested item" : "Add list item", isPresented: $addItem) {
            TextField("Item text", text: $itemText)
            Button("Add") {
                guard let addTarget else { return }
                do { try model.addListItem(to: addTarget, text: itemText, nested: addNested) } catch { model.report(error) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Adding after a non-final item is unavailable when it would move protected content.") }
        .alert("Link address", isPresented: $showLink) {
            TextField("https://example.com", text: $linkText)
            Button("Apply link") {
                guard linkSource == model.document.source, RichLinkSafety.isAllowed(linkText), let url = URL(string: linkText) else {
                    model.report(NativeEditorError.unsupportedFormatting); return
                }
                do { try model.setLink(url, selection: linkSelection) } catch { model.report(error) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Select text and enter an HTTP, HTTPS, or email address.") }
    }
    private func format(_ mark: String) {
        do { try model.toggleMark(mark, selection: model.selection) }
        catch { model.report(error) }
    }
    private func list(_ kind: String) { do { try model.makeList(kind) } catch { model.report(error) } }
    private func heading(_ level: Int?) { do { try model.setHeading(level) } catch { model.report(error) } }
}

#if canImport(UIKit)
import UIKit

private final class EditorTextView: UITextView {
    weak var editorModel: NativeEditorModel?
    var markers: [NativeListMarker] = [] { didSet { if oldValue != markers { setNeedsDisplay() } } }
    override var undoManager: UndoManager? { nil }
    #if WORLDS_EXPERIMENTAL_IPAD_LIST_KEYS
    override var keyCommands: [UIKeyCommand]? {
        guard UIDevice.current.userInterfaceIdiom == .pad else { return super.keyCommands }
        let indent = UIKeyCommand(input: "\t", modifierFlags: [], action: #selector(indentListFromKeyboard))
        let outdent = UIKeyCommand(input: "\t", modifierFlags: [.shift], action: #selector(outdentListFromKeyboard))
        indent.discoverabilityTitle = "Move in one level"
        outdent.discoverabilityTitle = "Move out one level"
        indent.wantsPriorityOverSystemBehavior = true
        outdent.wantsPriorityOverSystemBehavior = true
        return (super.keyCommands ?? []) + [indent, outdent]
    }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(indentListFromKeyboard) || action == #selector(outdentListFromKeyboard) {
            return markedTextRange == nil && editorModel?.nativeEditPending == false && editorModel?.hasListCaret == true
        }
        return super.canPerformAction(action, withSender: sender)
    }
    @objc private func indentListFromKeyboard() { performListIndent(outdent: false) }
    @objc private func outdentListFromKeyboard() { performListIndent(outdent: true) }
    private func performListIndent(outdent: Bool) {
        guard markedTextRange == nil, let model = editorModel, !model.nativeEditPending, model.hasListCaret else { return }
        do { try model.changeListIndent(outdent: outdent) } catch { model.report(error) }
    }
    #endif
    override func draw(_ rect: CGRect) {
        super.draw(rect)
        let font = self.font ?? UIFont.preferredFont(forTextStyle: .body)
        for marker in markers where marker.location <= textStorage.length {
            let line: CGRect
            if marker.location == textStorage.length { line = layoutManager.extraLineFragmentRect }
            else { let glyph = layoutManager.glyphIndexForCharacter(at: marker.location); line = layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil) }
            let indent = CGFloat(min(marker.depth, 3)) * 10
            let x = marker.rightToLeft ? bounds.width - 28 - indent : 4 + indent
            (marker.label as NSString).draw(at: CGPoint(x: x, y: line.minY + textContainerInset.top), withAttributes: [.font: font, .foregroundColor: UIColor.secondaryLabel])
        }
    }
    override func paste(_ sender: Any?) {
        if NativePastePolicy.rejects(UIPasteboard.general.types) {
            editorModel?.report(NativeEditorError.unsupportedRichPaste)
            return
        }
        super.paste(sender)
    }
}
private struct NativeTextSurface: UIViewRepresentable {
    @ObservedObject var model: NativeEditorModel
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private var category: UIContentSizeCategory {
        switch dynamicTypeSize {
        case .xSmall: return .extraSmall
        case .small: return .small
        case .medium: return .medium
        case .large: return .large
        case .xLarge: return .extraLarge
        case .xxLarge: return .extraExtraLarge
        case .xxxLarge: return .extraExtraExtraLarge
        case .accessibility1: return .accessibilityMedium
        case .accessibility2: return .accessibilityLarge
        case .accessibility3: return .accessibilityExtraLarge
        case .accessibility4: return .accessibilityExtraExtraLarge
        case .accessibility5: return .accessibilityExtraExtraExtraLarge
        @unknown default: return .large
        }
    }
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeUIView(context: Context) -> EditorTextView {
        let view = EditorTextView()
        view.editorModel = model
        view.accessibilityIdentifier = "native-editor-text"
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 8, left: 48, bottom: 8, right: 48)
        view.adjustsFontForContentSizeCategory = true
        view.isEditable = true
        view.isSelectable = true
        view.textDragInteraction?.isEnabled = false
        return view
    }
    func updateUIView(_ view: EditorTextView, context: Context) {
        context.coordinator.updating = true
        defer { context.coordinator.updating = false }
        guard view.markedTextRange == nil, !context.coordinator.pendingNativeChange else { return }
        context.coordinator.category = category
        view.markers = model.listMarkers
        let value = context.coordinator.displayText()
        if !view.attributedText.isEqual(to: value) { view.attributedText = value }
        #if DEBUG
        if value.length > 0, let font = value.attribute(.font, at: 0, effectiveRange: nil) as? UIFont {
            view.accessibilityLabel = "display-font-size:\(font.pointSize);category:\(category.rawValue)"
        }
        #endif
        let selection = model.selection
        if NSMaxRange(selection) <= view.attributedText.length, view.selectedRange != selection { view.selectedRange = selection }
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        let model: NativeEditorModel
        var updating = false
        var pendingNativeChange = false
        var category: UIContentSizeCategory = .large
        init(model: NativeEditorModel) { self.model = model }
        func displayText() -> NSAttributedString {
            let result = NSMutableAttributedString(attributedString: model.attributedText)
            let full = NSRange(location: 0, length: result.length)
            let target = UITraitCollection(preferredContentSizeCategory: category)
            let baseline = UIFont.preferredFont(forTextStyle: .body).pointSize
            let scaledBody = UIFont.preferredFont(forTextStyle: .body, compatibleWith: target).pointSize
            result.enumerateAttribute(.font, in: full) { value, range, _ in
                guard let font = value as? UIFont else { return }
                let size = font.pointSize * scaledBody / baseline
                result.addAttribute(.font, value: font.withSize(size), range: range)
            }
            return result
        }
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard model.recoverableNativeText == nil else { model.report(NativeEditorError.unrecoveredNativeText); return false }
            if textView.markedTextRange == nil, !pendingNativeChange, model.isListKeyboardEdit(range: range, replacement: text) {
                do {
                    _ = try model.replace(range: range, with: text)
                    updating = true
                    textView.attributedText = displayText()
                    textView.selectedRange = model.selection
                    updating = false
                } catch { model.report(error) }
                return false
            }
            pendingNativeChange = true
            model.setNativeEditPending(true)
            return true
        }
        func textViewDidChange(_ textView: UITextView) {
            guard !updating else { return }
            if textView.markedTextRange != nil { pendingNativeChange = true; model.setNativeEditPending(true); return }
            pendingNativeChange = false
            defer { model.setNativeEditPending(false) }
            do { try model.commitNativeText(textView.text ?? "", selection: textView.selectedRange) }
            catch {
                model.retainRejectedNativeText(textView.text ?? "")
                updating = true
                textView.attributedText = displayText()
                textView.selectedRange = NSRange(location: min(model.selection.location, textView.attributedText.length), length: 0)
                updating = false
            }
        }
        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !updating else { return }
            if textView.markedTextRange != nil { pendingNativeChange = true; model.setNativeEditPending(true); return }
            if pendingNativeChange && textView.text != model.projection.text { textViewDidChange(textView) }
            if pendingNativeChange && textView.text == model.projection.text { pendingNativeChange = false; model.setNativeEditPending(false) }
            if !pendingNativeChange { model.selection = textView.selectedRange }
        }
    }
}
#elseif canImport(AppKit)
import AppKit

private final class ListMarkerOverlay: NSView {
    weak var editor: EditorTextView?
    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        guard let editor, let manager = editor.layoutManager, let storage = editor.textStorage else { return }
        let font = editor.font ?? NSFont.systemFont(ofSize: NSFont.systemFontSize)
        for marker in editor.markers where marker.location <= storage.length {
            let line: NSRect
            if marker.location == storage.length { line = manager.extraLineFragmentRect }
            else { let glyph = manager.glyphIndexForCharacter(at: marker.location); line = manager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil) }
            let indent = CGFloat(min(marker.depth, 3)) * 10
            let x: CGFloat = marker.rightToLeft ? bounds.width - 28 - indent : 4 + indent
            (marker.label as NSString).draw(at: NSPoint(x: x, y: line.minY + editor.textContainerInset.height), withAttributes: [.font: font, .foregroundColor: NSColor.secondaryLabelColor])
        }
    }
}
private final class EditorTextView: NSTextView {
    weak var editorModel: NativeEditorModel?
    private let markerOverlay = ListMarkerOverlay()
    var markers: [NativeListMarker] = [] { didSet { if oldValue != markers { markerOverlay.needsDisplay = true } } }
    override var undoManager: UndoManager? { nil }
    override func insertTab(_ sender: Any?) {
        guard !hasMarkedText(), let model = editorModel, model.hasListCaret else { super.insertTab(sender); return }
        do { try model.changeListIndent(outdent: false) } catch { model.report(error) }
    }
    override func insertBacktab(_ sender: Any?) {
        guard !hasMarkedText(), let model = editorModel, model.hasListCaret else { super.insertBacktab(sender); return }
        do { try model.changeListIndent(outdent: true) } catch { model.report(error) }
    }
    func installMarkerOverlay() {
        markerOverlay.editor = self
        markerOverlay.frame = bounds
        markerOverlay.autoresizingMask = [.width, .height]
        addSubview(markerOverlay, positioned: .above, relativeTo: nil)
    }
    func redrawMarkers() { markerOverlay.needsDisplay = true }
    override func paste(_ sender: Any?) {
        if NativePastePolicy.rejects((NSPasteboard.general.types ?? []).map(\.rawValue)) {
            editorModel?.report(NativeEditorError.unsupportedRichPaste)
            return
        }
        super.paste(sender)
    }
}
private struct NativeTextSurface: NSViewRepresentable {
    @ObservedObject var model: NativeEditorModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        let view = EditorTextView()
        view.editorModel = model
        view.setAccessibilityIdentifier("native-editor-text")
        view.delegate = context.coordinator
        view.isEditable = true; view.isSelectable = true
        view.drawsBackground = false
        view.textContainerInset = NSSize(width: 48, height: 8)
        view.isRichText = false
        view.allowsUndo = false
        view.textContainer?.widthTracksTextView = true
        view.installMarkerOverlay()
        scroll.documentView = view
        scroll.hasVerticalScroller = true
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? EditorTextView else { return }
        context.coordinator.updating = true
        defer { context.coordinator.updating = false }
        guard !view.hasMarkedText(), !context.coordinator.pendingNativeChange else { return }
        view.markers = model.listMarkers
        let value = model.attributedText
        if !view.attributedString().isEqual(to: value) { view.textStorage?.setAttributedString(value) }
        view.redrawMarkers()
        let selection = model.selection
        if NSMaxRange(selection) <= value.length, view.selectedRange() != selection { view.setSelectedRange(selection) }
    }
    final class Coordinator: NSObject, NSTextViewDelegate {
        let model: NativeEditorModel
        var updating = false
        var pendingNativeChange = false
        init(model: NativeEditorModel) { self.model = model }
        func textView(_ textView: NSTextView, shouldChangeTextIn affectedCharRange: NSRange, replacementString: String?) -> Bool {
            guard model.recoverableNativeText == nil else { model.report(NativeEditorError.unrecoveredNativeText); return false }
            if let replacementString, !textView.hasMarkedText(), !pendingNativeChange,
               model.isListKeyboardEdit(range: affectedCharRange, replacement: replacementString) {
                do {
                    _ = try model.replace(range: affectedCharRange, with: replacementString)
                    updating = true
                    textView.textStorage?.setAttributedString(model.attributedText)
                    textView.setSelectedRange(model.selection)
                    updating = false
                } catch { model.report(error) }
                return false
            }
            pendingNativeChange = true
            model.setNativeEditPending(true)
            return true
        }
        func textDidChange(_ notification: Notification) {
            guard !updating, let view = notification.object as? NSTextView else { return }
            if view.hasMarkedText() { pendingNativeChange = true; model.setNativeEditPending(true); return }
            pendingNativeChange = false
            defer { model.setNativeEditPending(false) }
            do { try model.commitNativeText(view.string, selection: view.selectedRange()) }
            catch {
                model.retainRejectedNativeText(view.string)
                updating = true
                view.textStorage?.setAttributedString(model.attributedText)
                view.setSelectedRange(NSRange(location: min(model.selection.location, view.string.utf16.count), length: 0))
                updating = false
            }
        }
        func textViewDidChangeSelection(_ notification: Notification) {
            guard !updating, let view = notification.object as? NSTextView else { return }
            if view.hasMarkedText() { pendingNativeChange = true; model.setNativeEditPending(true); return }
            if pendingNativeChange && view.string != model.projection.text { textDidChange(notification) }
            if pendingNativeChange && view.string == model.projection.text { pendingNativeChange = false; model.setNativeEditPending(false) }
            if !pendingNativeChange { model.selection = view.selectedRange() }
        }
    }
}
#endif
