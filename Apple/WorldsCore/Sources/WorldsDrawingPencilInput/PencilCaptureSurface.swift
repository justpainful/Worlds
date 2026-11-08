#if canImport(UIKit)
import SwiftUI
import UIKit

/// Transparent input surface. A host must place it over an independently
/// verified renderer; it intentionally does not draw approximated content.
public struct PencilCaptureSurface: UIViewRepresentable {
    public let viewToDocument: CGAffineTransform
    public let onStroke: @MainActor (PencilStrokeBuffer) -> Void
    public let onCancelled: @MainActor (PencilStrokeBuffer) -> Void
    public let onBegan: @MainActor () -> Void
    public let onProgress: @MainActor (PencilRawSample) -> Void
    public let onCancellationReason: @MainActor (PencilCancellationReason) -> Void
    public let onDiagnostics: @MainActor (String) -> Void
    public init(viewToDocument: CGAffineTransform, onStroke: @escaping @MainActor (PencilStrokeBuffer) -> Void,
                onCancelled: @escaping @MainActor (PencilStrokeBuffer) -> Void,
                onBegan: @escaping @MainActor () -> Void = {},
                onProgress: @escaping @MainActor (PencilRawSample) -> Void = { _ in },
                onCancellationReason: @escaping @MainActor (PencilCancellationReason) -> Void = { _ in },
                onDiagnostics: @escaping @MainActor (String) -> Void = { _ in }) {
        self.viewToDocument = viewToDocument; self.onStroke = onStroke; self.onCancelled = onCancelled
        self.onBegan = onBegan; self.onProgress = onProgress
        self.onCancellationReason = onCancellationReason; self.onDiagnostics = onDiagnostics
    }
    public func makeUIView(context: Context) -> CaptureView { CaptureView(frame: .zero) }
    public func updateUIView(_ view: CaptureView, context: Context) {
        view.viewToDocument = viewToDocument; view.onStroke = onStroke; view.onCancelled = onCancelled
        view.onBegan = onBegan; view.onProgress = onProgress
        view.onCancellationReason = onCancellationReason; view.onDiagnostics = onDiagnostics
    }
}

@MainActor public final class CaptureView: UIView {
    fileprivate var viewToDocument = CGAffineTransform.identity
    fileprivate var onStroke: (PencilStrokeBuffer) -> Void = { _ in }
    fileprivate var onCancelled: (PencilStrokeBuffer) -> Void = { _ in }
    fileprivate var onBegan: () -> Void = {}
    fileprivate var onProgress: (PencilRawSample) -> Void = { _ in }
    fileprivate var onCancellationReason: (PencilCancellationReason) -> Void = { _ in }
    fileprivate var onDiagnostics: (String) -> Void = { _ in }
    private var active: UITouch?
    private var buffer = PencilStrokeBuffer()
    private var failed = false
    public override init(frame: CGRect) {
        super.init(frame: frame); backgroundColor = .clear; isMultipleTouchEnabled = true
        isAccessibilityElement = false
    }
    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    public override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard active == nil, let touch = touches.first(where: { $0.type == .pencil || $0.type == .direct }) else { return }
        active = touch; buffer = PencilStrokeBuffer(); failed = false
        onBegan(); append(touch, release: false)
    }
    public override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let active, touches.contains(active) else { return }
        for touch in event?.coalescedTouches(for: active) ?? [active] { append(touch, release: false) }
    }
    public override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let active, touches.contains(active) else { return }
        append(active, release: true)
        self.active = nil
        if failed { onCancellationReason(.invalidInput); onCancelled(buffer) } else { onStroke(buffer) }
    }
    public override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let active, touches.contains(active) else { return }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-local-copy-fixture") {
            var views: [String] = []
            var current: UIView? = self
            while let view = current {
                let gestures = (view.gestureRecognizers ?? []).map { "\(type(of: $0)):state=\($0.state.rawValue),cancel=\($0.cancelsTouchesInView),enabled=\($0.isEnabled)" }.joined(separator: ";")
                views.append("\(type(of: view))[\(gestures)]")
                current = view.superview
            }
            let touches = (active.gestureRecognizers ?? []).map { "\(type(of: $0)):state=\($0.state.rawValue)" }.joined(separator: ";")
            onDiagnostics("touch=\(active.type.rawValue) touchGestures=\(touches) ancestors=\(views.joined(separator: " > "))")
        }
        #endif
        self.active = nil; onCancellationReason(.systemCancelled); onCancelled(buffer)
    }
    private func append(_ touch: UITouch, release: Bool) {
        let location = touch.location(in: self).applying(viewToDocument)
        let raw = PencilRawSample(x: Double(location.x), y: Double(location.y), force: Double(touch.force),
            maximumForce: Double(touch.maximumPossibleForce), altitude: Double(touch.altitudeAngle),
            azimuth: Double(touch.azimuthAngle(in: self)), timeMilliseconds: touch.timestamp * 1000,
            isPencil: touch.type == .pencil, hasPendingEstimates: !touch.estimatedPropertiesExpectingUpdates.isEmpty,
            isRelease: release)
        do { try buffer.append(raw); onProgress(raw) } catch { failed = true }
    }
}
#endif
