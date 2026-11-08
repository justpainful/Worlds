import SwiftUI
import WorldsRichText

enum NativePastePolicy {
    private static let unsupported: Set<String> = ["public.html", "public.rtf", "com.apple.flat-rtfd", "com.apple.rtfd", "com.apple.webarchive", "public.png", "public.jpeg", "public.tiff", "public.image", "public.file-url"]
    static func rejects(_ types: [String]) -> Bool { !unsupported.isDisjoint(with: types) }
}

/// TextKit-backed editing of supported text nodes only. The host decides when
/// and whether to save using its own authorized persistence implementation.
public struct NativeEditorView: View {
    @ObservedObject private var model: NativeEditorModel
    @State private var confirmDiscard = false
    public init(model: NativeEditorModel) { self.model = model }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Button("Undo") { model.undo() }.keyboardShortcut("z", modifiers: .command).disabled(!model.undoManager.canUndo)
                    Button("Redo") { model.redo() }.keyboardShortcut("z", modifiers: [.command, .shift]).disabled(!model.undoManager.canRedo)
                    Button("Bold") { format("bold") }.keyboardShortcut("b", modifiers: .command)
                    Button("Italic") { format("italic") }.keyboardShortcut("i", modifiers: .command)
                    Button("Underline") { format("underline") }.keyboardShortcut("u", modifiers: .command)
                }
                .buttonStyle(.borderless)
                .disabled(model.nativeEditPending || model.saving)
                NativeTextSurface(model: model)
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
    }
    private func format(_ mark: String) {
        do { try model.toggleMark(mark, selection: model.selection) }
        catch { model.report(error) }
    }
}

#if canImport(UIKit)
import UIKit

private final class EditorTextView: UITextView {
    weak var editorModel: NativeEditorModel?
    override var undoManager: UndoManager? { nil }
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

private final class EditorTextView: NSTextView {
    weak var editorModel: NativeEditorModel?
    override var undoManager: UndoManager? { nil }
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
        view.isRichText = false
        view.allowsUndo = false
        view.textContainer?.widthTracksTextView = true
        scroll.documentView = view
        scroll.hasVerticalScroller = true
        return scroll
    }
    func updateNSView(_ scroll: NSScrollView, context: Context) {
        guard let view = scroll.documentView as? EditorTextView else { return }
        context.coordinator.updating = true
        defer { context.coordinator.updating = false }
        guard !view.hasMarkedText(), !context.coordinator.pendingNativeChange else { return }
        let value = model.attributedText
        if !view.attributedString().isEqual(to: value) { view.textStorage?.setAttributedString(value) }
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
