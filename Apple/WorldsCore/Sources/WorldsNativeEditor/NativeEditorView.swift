import SwiftUI
import WorldsRichText

/// TextKit-backed editing of supported text nodes only. The host decides when
/// and whether to save using its own authorized persistence implementation.
public struct NativeEditorView: View {
    @ObservedObject private var model: NativeEditorModel
    public init(model: NativeEditorModel) { self.model = model }
    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button("Undo") { model.undo() }.disabled(!model.undoManager.canUndo)
                Button("Redo") { model.redo() }.disabled(!model.undoManager.canRedo)
                Button("Bold") { format("bold") }
                Button("Italic") { format("italic") }
                Button("Underline") { format("underline") }
            }
            .buttonStyle(.borderless)
            NativeTextSurface(model: model)
            if let error = model.errorMessage { Text(error).font(.caption).foregroundStyle(.secondary) }
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
}
private struct NativeTextSurface: UIViewRepresentable {
    @ObservedObject var model: NativeEditorModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeUIView(context: Context) -> EditorTextView {
        let view = EditorTextView()
        view.editorModel = model
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
        let value = model.attributedText
        if !view.attributedText.isEqual(to: value) { view.attributedText = value }
        let selection = model.selection
        if NSMaxRange(selection) <= view.attributedText.length, view.selectedRange != selection { view.selectedRange = selection }
    }
    final class Coordinator: NSObject, UITextViewDelegate {
        let model: NativeEditorModel
        var updating = false
        var pendingNativeChange = false
        init(model: NativeEditorModel) { self.model = model }
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            pendingNativeChange = true
            return true
        }
        func textViewDidChange(_ textView: UITextView) {
            guard !updating, textView.markedTextRange == nil else { return }
            pendingNativeChange = false
            do { try model.commitNativeText(textView.text ?? "", selection: textView.selectedRange) }
            catch {
                updating = true
                textView.attributedText = model.attributedText
                textView.selectedRange = NSRange(location: min(model.selection.location, textView.attributedText.length), length: 0)
                updating = false
                model.report(error)
            }
        }
        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !updating, textView.markedTextRange == nil else { return }
            if pendingNativeChange && textView.text != model.projection.text { textViewDidChange(textView) }
            if !pendingNativeChange { model.selection = textView.selectedRange }
        }
    }
}
#elseif canImport(AppKit)
import AppKit

private final class EditorTextView: NSTextView {
    weak var editorModel: NativeEditorModel?
    override var undoManager: UndoManager? { nil }
}
private struct NativeTextSurface: NSViewRepresentable {
    @ObservedObject var model: NativeEditorModel
    func makeCoordinator() -> Coordinator { Coordinator(model: model) }
    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        let view = EditorTextView()
        view.editorModel = model
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
            pendingNativeChange = true
            return true
        }
        func textDidChange(_ notification: Notification) {
            guard !updating, let view = notification.object as? NSTextView, !view.hasMarkedText() else { return }
            pendingNativeChange = false
            do { try model.commitNativeText(view.string, selection: view.selectedRange()) }
            catch {
                updating = true
                view.textStorage?.setAttributedString(model.attributedText)
                view.setSelectedRange(NSRange(location: min(model.selection.location, view.string.utf16.count), length: 0))
                updating = false
                model.report(error)
            }
        }
        func textViewDidChangeSelection(_ notification: Notification) {
            guard !updating, let view = notification.object as? NSTextView, !view.hasMarkedText() else { return }
            if pendingNativeChange && view.string != model.projection.text { textDidChange(notification) }
            if !pendingNativeChange { model.selection = view.selectedRange() }
        }
    }
}
#endif


