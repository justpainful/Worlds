#if canImport(AppKit) && !canImport(UIKit)
import SwiftUI
import AppKit

/// Mouse and tablet capture for the experimental editor. Tablet pressure is
/// retained; AppKit tilt is not translated to Pointer Events tilt yet.
public struct PencilCaptureSurface: NSViewRepresentable {
    public let viewToDocument: CGAffineTransform
    public let onStroke: @MainActor (PencilStrokeBuffer) -> Void
    public let onCancelled: @MainActor (PencilStrokeBuffer) -> Void
    public let onBegan: @MainActor () -> Void
    public let onProgress: @MainActor (PencilRawSample) -> Void
    public init(viewToDocument: CGAffineTransform, onStroke: @escaping @MainActor (PencilStrokeBuffer) -> Void,
                onCancelled: @escaping @MainActor (PencilStrokeBuffer) -> Void,
                onBegan: @escaping @MainActor () -> Void = {},
                onProgress: @escaping @MainActor (PencilRawSample) -> Void = { _ in }) {
        self.viewToDocument = viewToDocument; self.onStroke = onStroke; self.onCancelled = onCancelled
        self.onBegan = onBegan; self.onProgress = onProgress
    }
    public func makeNSView(context: Context) -> CaptureView { CaptureView(frame: .zero) }
    public func updateNSView(_ view: CaptureView, context: Context) {
        view.viewToDocument = viewToDocument; view.onStroke = onStroke; view.onCancelled = onCancelled
        view.onBegan = onBegan; view.onProgress = onProgress
    }
}

@MainActor public final class CaptureView: NSView {
    fileprivate var viewToDocument = CGAffineTransform.identity
    var onStroke: (PencilStrokeBuffer) -> Void = { _ in }
    var onCancelled: (PencilStrokeBuffer) -> Void = { _ in }
    fileprivate var onBegan: () -> Void = {}
    fileprivate var onProgress: (PencilRawSample) -> Void = { _ in }
    private var buffer = PencilStrokeBuffer()
    private var active = false
    private var failed = false
    public override var isFlipped: Bool { true }
    public override var acceptsFirstResponder: Bool { true }
    public override init(frame: NSRect) { super.init(frame: frame); setAccessibilityElement(false) }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    public override func viewWillMove(toWindow newWindow: NSWindow?) {
        if active { cancelInput() }
        NotificationCenter.default.removeObserver(self, name: NSWindow.didResignKeyNotification, object: window)
        super.viewWillMove(toWindow: newWindow)
        if let newWindow {
            NotificationCenter.default.addObserver(self, selector: #selector(windowResigned),
                name: NSWindow.didResignKeyNotification, object: newWindow)
        }
    }
    @objc private func windowResigned() { cancelInput() }
    private func cancelInput() {
        guard active else { return }
        active = false; onCancelled(buffer)
    }
    public override func cancelOperation(_ sender: Any?) { cancelInput() }
    @available(macOS 26.0, *)
    public override func mouseCancelled(with event: NSEvent) { cancelInput() }
    public override func mouseDown(with event: NSEvent) {
        guard !active else { return }
        active = true; failed = false; buffer = PencilStrokeBuffer(); onBegan(); append(event, release: false)
    }
    public override func mouseDragged(with event: NSEvent) { guard active else { return }; append(event, release: false) }
    public override func tabletPoint(with event: NSEvent) { guard active else { return }; append(event, release: false) }
    public override func mouseUp(with event: NSEvent) {
        guard active else { return }
        append(event, release: true); active = false
        if failed { onCancelled(buffer) } else { onStroke(buffer) }
    }
    private func append(_ event: NSEvent, release: Bool) {
        let location = convert(event.locationInWindow, from: nil).applying(viewToDocument)
        let tablet = event.type == .tabletPoint || event.subtype == .tabletPoint
        do {
            let raw = try MacPointerSamples.make(x: Double(location.x), y: Double(location.y),
                pressure: Double(event.pressure), timestamp: event.timestamp * 1000,
                isTablet: tablet, isRelease: release)
            try buffer.append(raw); onProgress(raw)
        } catch { failed = true }
    }
}
#endif
