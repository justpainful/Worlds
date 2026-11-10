#if os(macOS)
import AppKit
import CoreGraphics

private final class OverlayWindow: NSWindow {
    var onEscape: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onEscape?() } else { super.keyDown(with: event) }
    }
}

@MainActor
private final class CanvasView: NSView {
    private var image: NSImage?
    private var document = ScreenDrawingDocument()
    var tool: ScreenDrawingTool = .pen
    var ink = ScreenInk(red: 0.90, green: 0.28, blue: 0.30)
    var width: Double = 6
    var laserLifetime: Double = 3
    private var timer: Timer?
    override var isFlipped: Bool { true }
    init(image: CGImage, size: NSSize) {
        self.image = NSImage(cgImage: image, size: size)
        super.init(frame: NSRect(origin: .zero, size: size))
        autoresizingMask = [.width, .height]
        timer = Timer.scheduledTimer(timeInterval: 1.0/30.0, target: self, selector: #selector(tick), userInfo: nil, repeats: true)
    }
    required init?(coder: NSCoder) { nil }
    func releaseSensitiveContent() { timer?.invalidate(); timer = nil; image = nil; document.clear(); needsDisplay = true }
    @objc private func tick() { document.prune(at: ProcessInfo.processInfo.systemUptime); needsDisplay = true }
    func undo() { document.undo(); needsDisplay = true }
    func clear() { document.clear(); needsDisplay = true }
    override func mouseDown(with event: NSEvent) {
        let sample = sample(event)
        document.begin(tool: tool, ink: ink, width: width, lifetime: laserLifetime, sample: sample)
        needsDisplay = true
    }
    override func mouseDragged(with event: NSEvent) {
        document.move(tool: tool, sample: sample(event), eraserWidth: width); needsDisplay = true
    }
    override func mouseUp(with event: NSEvent) { document.end(at: ProcessInfo.processInfo.systemUptime); needsDisplay = true }
    private func sample(_ event: NSEvent) -> ScreenSample {
        let point = convert(event.locationInWindow, from: nil)
        let pressure = event.subtype == .tabletPoint ? max(0.01, min(1, Double(event.pressure))) : 1
        return ScreenSample(point: point, pressure: pressure)
    }
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        image?.draw(in: bounds, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: nil)
        let now = ProcessInfo.processInfo.systemUptime
        let strokes = document.strokes + (document.current.map { [$0] } ?? [])
        for stroke in strokes {
            guard !stroke.samples.isEmpty else { continue }
            let alpha = stroke.ink.alpha * stroke.opacity(at: now) * (stroke.tool == .highlighter ? 0.35 : 1)
            NSColor(srgbRed: stroke.ink.red, green: stroke.ink.green, blue: stroke.ink.blue, alpha: alpha).setStroke()
            NSColor(srgbRed: stroke.ink.red, green: stroke.ink.green, blue: stroke.ink.blue, alpha: alpha).setFill()
            if stroke.samples.count == 1 {
                let p = stroke.samples[0], size = stroke.width * max(0.1,p.pressure)
                NSBezierPath(ovalIn: NSRect(x:p.point.x-size/2,y:p.point.y-size/2,width:size,height:size)).fill()
            } else {
                for i in 1..<stroke.samples.count {
                    let a = stroke.samples[i-1], b = stroke.samples[i]
                    let path = NSBezierPath(); path.lineCapStyle = .round; path.lineJoinStyle = .round
                    path.lineWidth = stroke.width * max(0.1,(a.pressure+b.pressure)/2)
                    path.move(to:a.point); path.line(to:b.point); path.stroke()
                }
            }
        }
    }
}

/// The owner retains this object for the lifetime of the overlay.
@MainActor
public final class ScreenDrawingSession: NSObject, NSWindowDelegate {
    private var window: OverlayWindow?
    private var canvas: CanvasView?
    private var displayID: CGDirectDisplayID?
    private var starting = false
    private var generation: UInt64 = 0
    private var originalFrame: NSRect?
    public override init() { super.init() }

    /// Capture begins only when this method is explicitly called by the host.
    public func start(displayID: CGDirectDisplayID, source: any ScreenImageSource = ScreenCaptureSource()) async throws {
        guard !starting, window == nil else { throw ScreenCaptureError.displayUnavailable }
        starting = true; let startGeneration = generation; defer { starting = false }
        guard screen(for: displayID) != nil else { throw ScreenCaptureError.displayUnavailable }
        let image = try await source.capture(displayID: displayID)
        guard generation == startGeneration, let screen = screen(for: displayID) else { throw ScreenCaptureError.displayUnavailable }
        present(image: image, screen: screen, displayID: displayID)
    }

    /// Host- or test-supplied still image; this method never captures a screen.
    public func presentFixture(_ image: CGImage, screen: NSScreen) throws {
        guard !starting, window == nil, let id = screenID(screen) else { throw ScreenCaptureError.displayUnavailable }
        present(image: image, screen: screen, displayID: id)
    }
    public func close() {
        generation &+= 1; originalFrame = nil
        canvas?.releaseSensitiveContent()
        let old = window; window = nil; canvas = nil; displayID = nil
        NotificationCenter.default.removeObserver(self)
        old?.delegate = nil; old?.onEscape = nil; old?.close()
    }
    public func windowWillClose(_ notification: Notification) { close() }
    @objc private func screensChanged() {
        guard let displayID, let current = screen(for: displayID), current.frame == originalFrame else { close(); return }
    }

    private func screenID(_ screen: NSScreen) -> CGDirectDisplayID? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber).map { CGDirectDisplayID($0.uint32Value) }
    }
    private func screen(for id: CGDirectDisplayID) -> NSScreen? { NSScreen.screens.first { screenID($0) == id } }
    private func present(image: CGImage, screen: NSScreen, displayID: CGDirectDisplayID) {
        let win = OverlayWindow(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        win.isReleasedWhenClosed = false; win.isOpaque = true; win.backgroundColor = .black
        win.level = .floating; win.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
        win.delegate = self; win.onEscape = { [self] in close() }
        let view = CanvasView(image: image, size: screen.frame.size)
        let toolbar = makeToolbar()
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)
        NSLayoutConstraint.activate([
            toolbar.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            toolbar.topAnchor.constraint(equalTo: view.topAnchor, constant: 18),
            toolbar.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 8),
            toolbar.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -8)
        ])
        win.contentView = view
        self.canvas = view; self.window = win; self.displayID = displayID; self.originalFrame = screen.frame
        NotificationCenter.default.addObserver(self, selector: #selector(screensChanged), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        win.makeKeyAndOrderFront(nil)
    }
    private func makeToolbar() -> NSView {
        let panel = NSVisualEffectView()
        panel.material = .menu; panel.blendingMode = .withinWindow; panel.state = .active
        panel.wantsLayer = true; panel.layer?.cornerRadius = 10; panel.layer?.masksToBounds = true
        let tools = NSSegmentedControl(labels: ["Pen", "Highlight", "Erase", "Laser"], trackingMode: .selectOne, target: self, action: #selector(toolChanged(_:)))
        tools.selectedSegment = 0
        let colors = NSColorWell(); colors.color = NSColor(srgbRed:0.90,green:0.28,blue:0.30,alpha:1)
        colors.target = self; colors.action = #selector(colorChanged(_:)); colors.toolTip = "Ink color"
        let width = NSSlider(value: 6, minValue: 1, maxValue: 64, target: self, action: #selector(widthChanged(_:)))
        width.widthAnchor.constraint(equalToConstant: 80).isActive = true; width.toolTip = "Ink width"
        let lifetime = NSPopUpButton(); ["1 s", "3 s", "5 s", "10 s"].forEach { lifetime.addItem(withTitle: $0) }
        lifetime.selectItem(at: 1); lifetime.target = self; lifetime.action = #selector(lifetimeChanged(_:)); lifetime.toolTip = "Laser duration"
        let undo = NSButton(title: "Undo", target: self, action: #selector(undo))
        let clear = NSButton(title: "Clear", target: self, action: #selector(clear))
        let done = NSButton(title: "Close", target: self, action: #selector(closeButton)); done.keyEquivalent = "\u{1b}"
        let stack = NSStackView(views: [tools, colors, width, lifetime, undo, clear, done])
        stack.orientation = .horizontal; stack.alignment = .centerY; stack.spacing = 6; stack.edgeInsets = NSEdgeInsets(top: 8,left: 8,bottom: 8,right: 8)
        stack.translatesAutoresizingMaskIntoConstraints = false; panel.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:panel.leadingAnchor),stack.trailingAnchor.constraint(equalTo:panel.trailingAnchor),stack.topAnchor.constraint(equalTo:panel.topAnchor),stack.bottomAnchor.constraint(equalTo:panel.bottomAnchor)])
        return panel
    }
    @objc private func toolChanged(_ sender: NSSegmentedControl) {
        let tools: [ScreenDrawingTool] = [.pen, .highlighter, .eraser, .laser]
        if tools.indices.contains(sender.selectedSegment) { canvas?.tool = tools[sender.selectedSegment] }
    }
    @objc private func colorChanged(_ sender: NSColorWell) {
        guard let c = sender.color.usingColorSpace(.sRGB) else { return }
        canvas?.ink = ScreenInk(red:c.redComponent,green:c.greenComponent,blue:c.blueComponent,alpha:c.alphaComponent)
    }
    @objc private func widthChanged(_ sender: NSSlider) { canvas?.width = sender.doubleValue }
    @objc private func lifetimeChanged(_ sender: NSPopUpButton) {
        let values: [Double] = [1,3,5,10]
        if values.indices.contains(sender.indexOfSelectedItem) { canvas?.laserLifetime = values[sender.indexOfSelectedItem] }
    }
    @objc private func undo() { canvas?.undo() }
    @objc private func clear() { canvas?.clear() }
    @objc private func closeButton() { close() }
}
#endif

