#if (canImport(UIKit) || canImport(AppKit)) && (WORLDS_DRAWING_HARNESS || (DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_DRAWING_EDITOR))
import SwiftUI
#if canImport(UIKit)
import UIKit
typealias DrawingPlatformImage = UIImage
#else
import AppKit
typealias DrawingPlatformImage = NSImage
#endif
import WorldsDrawing
import WorldsDrawingNativeWrites
import WorldsDrawingStrokeSession
import WorldsDrawingPencilInput

@MainActor final class DrawingHarnessModel: ObservableObject {
    @Published var image: DrawingPlatformImage?
    @Published var message = "Preparing isolated drawing…"
    @Published var revision: Int64 = 0
    @Published var nodeCount = 0
    @Published var lastBrush: String?
    @Published var busy = true
    @Published var brush = "hard"
    /// Desktop "Correct hand-drawn shapes" preference: on by default and remembered.
    /// UI tests that need a plain stroke launch with `-WorldsDrawingCorrectShapes NO`.
    @Published var correctShape = true { didSet { UserDefaults.standard.set(correctShape, forKey: DrawingHarnessModel.correctShapeKey) } }
    static let correctShapeKey = "WorldsDrawingCorrectShapes"
    @Published var canUndo = false
    @Published var canRedo = false
    @Published var brushColor = "#202023"
    @Published var brushSize: Double = 12
    @Published var laserLifetime: Double = 1200
    @Published var lasers: [LaserTrace] = []
    enum Recovery: Equatable { case stroke, reload }
    @Published var recovery: Recovery?
    @Published var retryAvailable = false
    @Published var inputActive = false
    @Published var inputDiagnostics = ""
    var canClose: Bool { !busy && !inputActive && recovery != .stroke }
    var inputBlocked: Bool { busy || recovery != nil }
    private var currentLaserID: String?
    private var activeTool: String?
    private var cancellationReason: PencilCancellationReason?
    private var activeColor = "#202023"
    private var activeSize: Double = 12
    private var activeShapeCorrection = false
    private let databaseURL: URL
    private let pageID: String
    private let actorID: String
    private let validateIdentity: @MainActor () -> Bool
    init(databaseURL: URL, pageID: String, actorID: String, validateIdentity: @escaping @MainActor () -> Bool) {
        self.databaseURL = databaseURL; self.pageID = pageID; self.actorID = actorID; self.validateIdentity = validateIdentity
        UserDefaults.standard.register(defaults: [DrawingHarnessModel.correctShapeKey: true])
        correctShape = UserDefaults.standard.bool(forKey: DrawingHarnessModel.correctShapeKey)
    }
    private func requireIdentity() throws { guard validateIdentity() else { throw Failure.databaseChanged } }
    private var writer: PersonalDrawingWriter?
    private var controller: PencilStrokeController?
    private var layerID = "", frameID = ""
    private var loadedDocument: DrawingDocument?
    private var frameWidth: Double = 0, frameHeight: Double = 0
    var size: CGSize { CGSize(width: frameWidth, height: frameHeight) }

    func prepare() async {
        #if WORLDS_DRAWING_HARNESS
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-laser-long") { laserLifetime = 4000 }
        #endif
        defer { busy = false }
        do {
            try requireIdentity()
            let writer = try PersonalDrawingWriter(database: databaseURL)
            self.writer = writer
            controller = PencilStrokeController(session: try PersonalStrokeSession(writer: writer, pageID: pageID))
            try await reload()
        } catch {
            image = nil; recovery = .reload
            message = "This drawing cannot be displayed safely. It may contain unsupported content or be unavailable."
        }
    }
    func reload() async throws {
        guard let writer else { throw Failure.fixture }
        try requireIdentity()
        let data = try await writer.load(pageID: pageID)
        try requireIdentity()
        guard let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let document = envelope["value"] as? [String: Any],
              let scene = document["scene"] as? [String: Any],
              let frame = scene["defaultFrameId"] as? String,
              let layers = scene["layerOrder"] as? [String], let layer = layers.first,
              let frames = scene["frames"] as? [String: [String: Any]], let selectedFrame = frames[frame],
              let w = selectedFrame["w"] as? Double, let h = selectedFrame["h"] as? Double,
              w > 0, h > 0, w <= 4096, h <= 4096,
              let revision = document["revision"] as? Int64,
              let order = scene["nodeOrder"] as? [String],
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: Int(w), height: Int(h), bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw Failure.fixture }
        let drawing = try DrawingScene(json: JSONSerialization.data(withJSONObject: scene))
        context.translateBy(x: 0, y: CGFloat(h)); context.scaleBy(x: 1, y: -1)
        try ExperimentalStrokeSceneRenderer.render(scene: drawing, frameID: frame, in: context, allowCorrectedShapes: true)
        guard let cg = context.makeImage() else { throw Failure.fixture }
        #if canImport(UIKit)
        image = UIImage(cgImage: cg)
        #else
        image = NSImage(cgImage: cg, size: NSSize(width: w, height: h))
        #endif
        frameWidth = w; frameHeight = h
        layerID = layer; frameID = frame; self.revision = revision; nodeCount = order.count
        // Undo and redo follow the desktop: the author's latest enabled edit, so the
        // first undo after a corrected shape brings the original stroke back.
        let history = try? DrawingDocument(json: JSONSerialization.data(withJSONObject: document))
        loadedDocument = history
        canUndo = history.flatMap { try? DrawingJournal.toggle(in: $0, actor: actorID, redo: false, id: "probe", at: 0) } != nil
        canRedo = history.flatMap { try? DrawingJournal.toggle(in: $0, actor: actorID, redo: true, id: "probe", at: 0) } != nil
        let nodes = scene["nodes"] as? [String: [String: Any]] ?? [:]
        let shape = order.last.flatMap { nodes[$0]?["shape"] as? String }
        lastBrush = order.last.flatMap { id in
            guard let node = nodes[id], node["kind"] as? String == "stroke",
                  let brush = node["brush"] as? [String: Any], let kind = brush["kind"] as? String,
                  let color = brush["color"] as? String else { return nil }
            return "\(kind) \(color)"
        }
        message = "Saved revision \(revision), strokes \(order.count)" + (shape.map { ", shape \($0)" } ?? "")
    }
    func beginInput() {
        guard !inputBlocked else { return }
        cancellationReason = nil
        guard validateIdentity() else { recovery = .reload; message = "The local copy changed. Reopen it before editing."; return }
        inputActive = true
        activeTool = brush; activeColor = brushColor; activeSize = brushSize; activeShapeCorrection = correctShape
        guard activeTool == "laser" else { return }
        let id = UUID().uuidString; currentLaserID = id
        lasers.append(LaserTrace(id: id, actor: actorID, color: activeColor, width: activeSize,
            points: [], releasedAt: nil, lifetime: Int64(laserLifetime), opacity: 1))
    }
    func progressInput(_ sample: PencilRawSample) {
        guard activeTool == "laser", let id = currentLaserID,
              let index = lasers.firstIndex(where: { $0.id == id }), sample.x.isFinite, sample.y.isFinite else { return }
        lasers[index].points.append(ToolPoint(x: sample.x, y: sample.y))
        if lasers[index].points.count > 256 { lasers[index].points.removeFirst(lasers[index].points.count - 256) }
    }
    func cancelInput() {
        if let id = currentLaserID { lasers.removeAll { $0.id == id }; currentLaserID = nil }
        activeTool = nil; inputActive = false
        switch cancellationReason {
        case .systemCancelled: message = "Input cancelled by the system and was not saved."
        case .invalidInput: message = "Input samples were invalid and were not saved."
        case nil: message = "Input cancelled and was not saved."
        }
        cancellationReason = nil
    }
    func noteCancellation(_ reason: PencilCancellationReason) { cancellationReason = reason }
    private func releaseLaser() {
        guard let id = currentLaserID, let index = lasers.firstIndex(where: { $0.id == id }) else { return }
        currentLaserID = nil
        lasers[index].releasedAt = Int64(Date().timeIntervalSince1970 * 1000)
        let duration = lasers[index].lifetime
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(duration))
            self?.lasers.removeAll { $0.id == id }
        }
    }
    func capture(_ input: PencilStrokeBuffer) {
        inputActive = false
        let tool = activeTool ?? brush
        let color = activeTool == nil ? brushColor : activeColor
        let size = activeTool == nil ? brushSize : activeSize
        let correct = activeTool == nil ? correctShape : activeShapeCorrection
        activeTool = nil
        if tool == "laser" { releaseLaser(); return }
        guard !inputBlocked, let controller else { return }
        guard validateIdentity() else { recovery = .reload; message = "The local copy changed. Reopen it before editing."; return }
        var selected = ToolBrush(); selected.kind = tool; selected.color = color; selected.size = size
        if tool == "highlighter" { selected.pressureSize = false; selected.opacity = 0.35 }
        var recognized: RecognizedDrawingShape?
        do {
            let samples = try input.finalized(brush: selected)
            // The desktop corrects brush strokes only, never the highlighter or the laser.
            if correct && ["hard", "ink", "pencil"].contains(tool) { recognized = ShapeCorrection.recognize(samples) }
            // Confine this experiment to the first raster tile and fail closed on unsupported input.
            guard samples.allSatisfy({ $0.x >= 32 && $0.y >= 32 && $0.x <= 220 && $0.y <= 220 }) else { throw Failure.outsideRegion }
        } catch { message = "Stroke not saved: \(error)"; return }
        busy = true
        Task {
            defer { busy = false }
            let saved = await controller.save(input, brush: selected, tool: tool == "highlighter" ? .highlighter : .brush,
                actor: actorID, revision: revision, timestamp: Int64(Date().timeIntervalSince1970 * 1000), layerID: layerID, frameID: frameID, seed: 1)
            guard validateIdentity() else {
                recovery = controller.hasUnresolvedInput ? .stroke : .reload
                retryAvailable = controller.canRetryPending
                message = "The local copy changed; the stroke result is unconfirmed."
                return
            }
            guard saved != nil else {
                recovery = controller.hasUnresolvedInput ? .stroke : nil
                retryAvailable = controller.canRetryPending
                message = controller.error ?? "Stroke was not confirmed."
                return
            }
            do {
                if let recognized, let writer {
                    // Preserve the original stroke if the follow-up correction fails.
                    try requireIdentity()
                    let current = try await writer.load(pageID: pageID)
                    try requireIdentity()
                    guard let root = try JSONSerialization.jsonObject(with: current) as? [String: Any],
                          let document = root["value"] as? [String: Any],
                          let actualRevision = document["revision"] as? Int64, actualRevision == revision + 1,
                          let operations = document["operations"] as? [[String: Any]], let stroke = operations.last else { throw Failure.fixture }
                    let patch = try ShapeCorrectionOperationBuilder.make(strokeOperation: JSONSerialization.data(withJSONObject: stroke),
                        recognized: recognized, operationID: UUID().uuidString, actor: actorID, revision: actualRevision,
                        timestamp: Int64(Date().timeIntervalSince1970 * 1000))
                    try requireIdentity()
                    _ = try await writer.apply(pageID: pageID, changeJSON: patch)
                    try requireIdentity()
                }
                try await reload()
            } catch {
                do {
                    try await reload()
                    message = "Stroke saved. Correction status refreshed; review the drawing."
                } catch {
                    image = nil; recovery = .reload
                    message = "The stroke was saved, but the current drawing could not be displayed safely."
                }
            }
        }
    }
    func retryStroke() async {
        guard recovery == .stroke, retryAvailable, !busy, let controller else { return }
        busy = true; defer { busy = false }
        guard validateIdentity() else { message = "The local copy changed; retained stroke recovery is still required."; return }
        guard await controller.retry() != nil else { message = controller.error ?? "The stroke remains unconfirmed."; return }
        guard validateIdentity() else { recovery = .reload; message = "The local copy changed; the stroke result is unconfirmed."; return }
        recovery = .reload; retryAvailable = false
        do { try await reload(); recovery = nil; message = "Stroke saved. Shape correction was not applied." }
        catch { image = nil; message = "The stroke was saved, but the drawing could not be displayed safely." }
    }
    /// Undo or redo through the same operation path as every other edit: a toggle
    /// operation applied by the store, which replays the journal.
    func toggleHistory(redo: Bool) async {
        guard !busy, recovery == nil, !inputActive, let writer, let document = loadedDocument else { return }
        busy = true; defer { busy = false }
        do {
            try requireIdentity()
            guard let toggle = try DrawingJournal.toggle(in: document, actor: actorID, redo: redo,
                id: UUID().uuidString, at: Int64(Date().timeIntervalSince1970 * 1000)) else { try await reload(); return }
            _ = try await writer.apply(pageID: pageID, changeJSON: JSONEncoder().encode(toggle))
            try requireIdentity()
            try await reload()
        } catch {
            do { try await reload() } catch { image = nil; recovery = .reload }
            message = redo ? String(localized: "The change could not be redone. Reopen the drawing to check it.")
                : String(localized: "The change could not be undone. Reopen the drawing to check it.")
        }
    }
    func discardUnsubmitted() {
        guard recovery == .stroke, !retryAvailable, controller?.discardUnsubmitted() == true else { return }
        recovery = nil; message = "Unsubmitted input discarded."
    }
    func reopen() async {
        guard !busy, recovery != .stroke else { return }
        busy = true; defer { busy = false }
        do { try await reload(); recovery = nil }
        catch { image = nil; recovery = .reload; message = "This drawing could not be displayed safely. Unsupported content was not changed." }
    }
    func simulateTriangleForUITest() {
        guard !busy else { return }
        correctShape = true
        var points: [CGPoint] = []
        for index in 0...10 { points.append(CGPoint(x: 48, y: CGFloat(48 + index * 8))) }
        for index in 1...10 { points.append(CGPoint(x: CGFloat(48 + index * 8), y: 128)) }
        for index in 1...10 {
            let coordinate = CGFloat(128 - index * 8)
            points.append(CGPoint(x: coordinate, y: coordinate))
        }
        var input = PencilStrokeBuffer()
        do {
            for (index, point) in points.enumerated() {
                try input.append(PencilRawSample(x: Double(point.x), y: Double(point.y), force: 0, maximumForce: 0,
                    altitude: .pi / 2, azimuth: 0, timeMilliseconds: Double(index), isPencil: false,
                    hasPendingEstimates: false, isRelease: index == points.count - 1))
            }
            capture(input)
        } catch { message = "Synthetic test input rejected: \(error)" }
    }
    enum Failure: Error { case fixture, outsideRegion, databaseChanged }
}

@MainActor struct DrawingHarnessView: View {
    @StateObject private var model: DrawingHarnessModel
    @State private var confirmDiscard = false
    @State private var confirmClose = false
    let fixtureMode: Bool
    let onClose: @MainActor () -> Void
    init(databaseURL: URL, pageID: String, actorID: String, fixtureMode: Bool = false,
         validateIdentity: @escaping @MainActor () -> Bool, onClose: @escaping @MainActor () -> Void = {}) {
        _model = StateObject(wrappedValue: DrawingHarnessModel(databaseURL: databaseURL, pageID: pageID, actorID: actorID, validateIdentity: validateIdentity))
        self.fixtureMode = fixtureMode; self.onClose = onClose
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Experimental drawing").font(.headline)
            drawingCanvas
                .aspectRatio(model.size.height > 0 ? model.size.width / model.size.height : 16 / 9, contentMode: .fit)
                .frame(minHeight: 160)
            ScrollView {
              VStack(alignment: .leading, spacing: 12) {
            Text(fixtureMode ? "Temporary fixture only. Draw strokes inside the marked area. Other shapes and assets are unsupported." : "Independent local copy. Draw inside the marked area. Unsupported content cannot be edited here.").font(.caption)
            Toggle("Correct hand-drawn shapes", isOn: $model.correctShape)
                .disabled(model.inputBlocked || !["hard", "ink", "pencil"].contains(model.brush))
                .accessibilityIdentifier("drawing-correct-shapes")
            Picker("Tool", selection: $model.brush) {
                ForEach(["hard", "ink", "pencil", "highlighter", "laser"], id: \.self) { Text($0.capitalized).tag($0) }
            }.pickerStyle(.menu).disabled(model.inputBlocked).accessibilityIdentifier("drawing-tool")
            Picker("Color", selection: $model.brushColor) {
                Text("Black").tag("#202023"); Text("Red").tag("#ef3d35"); Text("Blue").tag("#007aff")
                Text("Green").tag("#30a46c"); Text("Yellow").tag("#f5d742")
            }.pickerStyle(.menu).disabled(model.inputBlocked).accessibilityIdentifier("drawing-color")
            Stepper("Width: \(Int(model.brushSize))", value: $model.brushSize, in: 1...32, step: 1).disabled(model.inputBlocked)
            if model.brush == "laser" {
                Stepper("Laser fade: \(Int(model.laserLifetime)) ms", value: $model.laserLifetime, in: 200...4000, step: 100)
                    .disabled(model.inputBlocked).accessibilityIdentifier("laser-duration")
            }
            if !model.lasers.isEmpty { Text("Laser active").font(.caption).accessibilityIdentifier("laser-active") }
            Text(model.message).accessibilityIdentifier("drawing-status")
            if let brush = model.lastBrush { Text("Last stroke: \(brush)").font(.caption).accessibilityIdentifier("drawing-last-brush") }
            #if WORLDS_DRAWING_HARNESS
            if ProcessInfo.processInfo.arguments.contains("--synthetic-triangle") {
                Button("Simulate triangle input for test") { model.simulateTriangleForUITest() }
                    .disabled(model.busy).accessibilityIdentifier("simulate-triangle")
            }
            #endif
            #if DEBUG && canImport(UIKit)
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-local-copy-fixture"), !model.inputDiagnostics.isEmpty {
                Text(model.inputDiagnostics).font(.caption2).accessibilityIdentifier("drawing-input-diagnostics")
            }
            #endif
            if model.recovery == .stroke {
                if model.retryAvailable {
                    Button("Retry unconfirmed stroke") { Task { await model.retryStroke() } }.disabled(model.busy)
                } else {
                    Button("Discard unsubmitted input", role: .destructive) { confirmDiscard = true }.disabled(model.busy)
                }
            }
            HStack(spacing: 12) {
                Button("Undo") { Task { await model.toggleHistory(redo: false) } }
                    .disabled(model.busy || model.inputActive || model.recovery != nil || !model.canUndo)
                    .accessibilityIdentifier("drawing-undo")
                Button("Redo") { Task { await model.toggleHistory(redo: true) } }
                    .disabled(model.busy || model.inputActive || model.recovery != nil || !model.canRedo)
                    .accessibilityIdentifier("drawing-redo")
            }
            Button("Reopen saved drawing") { Task { await model.reopen() } }
                .disabled(model.busy || model.recovery == .stroke).accessibilityIdentifier("drawing-reopen")
            if !fixtureMode {
                Button("Close", action: onClose).disabled(!model.canClose).accessibilityIdentifier("close-drawing-editor")
                if model.recovery == .stroke && !model.busy {
                    Button("Close and discard recovery", role: .destructive) { confirmClose = true }
                }
            }
              }.frame(maxWidth: .infinity, alignment: .leading)
            }.accessibilityIdentifier("drawing-controls")
        }.padding().task { await model.prepare() }
            .alert("Discard unsubmitted input?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { model.discardUnsubmitted() }
                Button("Cancel", role: .cancel) {}
            } message: { Text("The captured input has not been sent to storage.") }
            .alert("Close without confirming the stroke?", isPresented: $confirmClose) {
                Button("Close and discard recovery", role: .destructive, action: onClose)
                Button("Keep editing", role: .cancel) {}
            } message: { Text("The retained input will be lost. The stroke may already have been saved in the local copy.") }
    }
    private func platformImage(_ image: DrawingPlatformImage) -> Image {
        #if canImport(UIKit)
        Image(uiImage: image)
        #else
        Image(nsImage: image)
        #endif
    }
    @ViewBuilder private var drawingCanvas: some View {
        if let image = model.image, model.size.width > 0 {
            GeometryReader { geometry in
                let scale = min(geometry.size.width / model.size.width, geometry.size.height / model.size.height)
                let width = model.size.width * scale, height = model.size.height * scale
                ZStack(alignment: .topLeading) {
                    platformImage(image).resizable().frame(width: width, height: height)
                    Rectangle().stroke(.blue, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                        .frame(width: 188 * scale, height: 188 * scale).offset(x: 32 * scale, y: 32 * scale).allowsHitTesting(false)
                    if !model.lasers.isEmpty {
                        LaserOverlayView(traces: model.lasers, scale: scale)
                            .frame(width: width, height: height).allowsHitTesting(false).accessibilityHidden(true)
                    }
                    PencilCaptureSurface(viewToDocument: CGAffineTransform(scaleX: 1 / scale, y: 1 / scale), onStroke: model.capture, onCancelled: { _ in model.cancelInput() }, onBegan: model.beginInput, onProgress: model.progressInput, onCancellationReason: model.noteCancellation, onDiagnostics: { model.inputDiagnostics = $0 })
                        .frame(width: width, height: height).allowsHitTesting(!model.inputBlocked).accessibilityIdentifier("drawing-canvas")
                }.frame(width: width, height: height).accessibilityElement(children: .contain).accessibilityIdentifier("drawing-surface")
            }
        }
    }
 }

private struct LaserOverlayView: View {
    let traces: [LaserTrace]
    let scale: CGFloat
    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, _ in
                let now = Int64(timeline.date.timeIntervalSince1970 * 1000)
                for trace in traces where !trace.points.isEmpty {
                    var path = Path()
                    path.move(to: CGPoint(x: CGFloat(trace.points[0].x) * scale, y: CGFloat(trace.points[0].y) * scale))
                    for point in trace.points.dropFirst() { path.addLine(to: CGPoint(x: CGFloat(point.x) * scale, y: CGFloat(point.y) * scale)) }
                    context.opacity = trace.opacity * trace.fade(at: now)
                    let width = max(1, CGFloat(trace.width) * scale)
                    if trace.points.count == 1 {
                        let point = trace.points[0]
                        let rect = CGRect(x: CGFloat(point.x) * scale - width / 2, y: CGFloat(point.y) * scale - width / 2, width: width, height: width)
                        context.fill(Path(ellipseIn: rect), with: .color(color(trace.color)))
                    } else {
                        context.stroke(path, with: .color(color(trace.color)), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
                    }
                }
            }
        }
    }
    private func color(_ value: String) -> Color {
        guard value.count == 7, value.first == "#", let rgb = UInt32(value.dropFirst(), radix: 16) else { return .black }
        return Color(red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255, blue: Double(rgb & 255) / 255)
    }
}

#endif
