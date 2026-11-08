import SwiftUI
import SQLite3
import WorldsDrawing
import WorldsDrawingNativeWrites
import WorldsDrawingStrokeSession
import WorldsDrawingPencilInput

@main struct DrawingHarnessApp: App {
    var body: some Scene { WindowGroup { DrawingHarnessView() } }
}

@MainActor final class DrawingHarnessModel: ObservableObject {
    @Published var image: UIImage?
    @Published var message = "Preparing isolated drawing…"
    @Published var revision: Int64 = 0
    @Published var nodeCount = 0
    @Published var busy = true
    @Published var brush = "hard"
    @Published var correctShape = false
    private var writer: PersonalDrawingWriter?
    private var controller: PencilStrokeController?
    private var layerID = "", frameID = ""
    private var frameWidth: Double = 0, frameHeight: Double = 0
    var size: CGSize { CGSize(width: frameWidth, height: frameHeight) }

    func prepare() async {
        do {
            guard let fixture = Bundle.main.url(forResource: "worlds-v11", withExtension: "db") else { throw Failure.fixture }
            let root = FileManager.default.temporaryDirectory.appendingPathComponent("drawing-harness-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let copy = root.appendingPathComponent("copy.db")
            try FileManager.default.copyItem(at: fixture, to: copy)
            var connection: OpaquePointer?
            guard sqlite3_open(copy.path, &connection) == SQLITE_OK, let db = connection else { throw Failure.fixture }
            let result = sqlite3_exec(db, "UPDATE pages SET kind='drawing' WHERE id='fixture-page'; INSERT INTO profile(id,display_name,created_at,updated_at) VALUES('artist','Artist',1,1);", nil, nil, nil)
            sqlite3_close_v2(db)
            guard result == SQLITE_OK else { throw Failure.fixture }
            let file = copy.resolvingSymlinksInPath()
            let writer = try PersonalDrawingWriter(database: file)
            self.writer = writer
            controller = PencilStrokeController(session: try PersonalStrokeSession(writer: writer, pageID: "fixture-page"))
            try await reload()
        } catch { message = "Cannot open isolated drawing: \(error)"; busy = false }
    }
    func reload() async throws {
        guard let writer else { throw Failure.fixture }
        let data = try await writer.load(pageID: "fixture-page")
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
        try ExperimentalStrokeSceneRenderer.render(scene: drawing, frameID: frame, in: context, allowCorrectedRightTriangles: true)
        guard let cg = context.makeImage() else { throw Failure.fixture }
        image = UIImage(cgImage: cg); frameWidth = w; frameHeight = h
        layerID = layer; frameID = frame; self.revision = revision; nodeCount = order.count
        let nodes = scene["nodes"] as? [String: [String: Any]] ?? [:]
        let shape = order.last.flatMap { nodes[$0]?["shape"] as? String }
        message = "Saved revision \(revision), strokes \(order.count)" + (shape.map { ", shape \($0)" } ?? "")
        busy = false
    }
    func capture(_ input: PencilStrokeBuffer) {
        guard !busy, let controller else { return }
        var selected = ToolBrush(); selected.kind = brush
        if brush == "highlighter" { selected.pressureSize = false }
        var recognized: RecognizedDrawingShape?
        do {
            let samples = try input.finalized(brush: selected)
            if correctShape && brush == "hard" {
                let result = ShapeRecognition.recognize(samples.map { ToolPoint(x: $0.x, y: $0.y) })
                if result?.shape == "right-triangle" { recognized = result }
            }
            // Confine this experiment to the first raster tile and fail closed on unsupported input.
            guard samples.allSatisfy({ $0.x >= 32 && $0.y >= 32 && $0.x <= 220 && $0.y <= 220 }) else { throw Failure.outsideRegion }
        } catch { message = "Stroke not saved: \(error)"; return }
        busy = true
        Task {
            let saved = await controller.save(input, brush: selected, tool: brush == "highlighter" ? .highlighter : .brush,
                actor: "artist", revision: revision, timestamp: Int64(Date().timeIntervalSince1970 * 1000), layerID: layerID, frameID: frameID, seed: 1)
            guard saved != nil else { message = controller.error ?? "Stroke was not saved"; return }
            do {
                if let recognized, let writer {
                    // Preserve the original stroke if the follow-up correction fails.
                    let current = try await writer.load(pageID: "fixture-page")
                    guard let root = try JSONSerialization.jsonObject(with: current) as? [String: Any],
                          let document = root["value"] as? [String: Any],
                          let actualRevision = document["revision"] as? Int64, actualRevision == revision + 1,
                          let operations = document["operations"] as? [[String: Any]], let stroke = operations.last else { throw Failure.fixture }
                    let patch = try ShapeCorrectionOperationBuilder.make(strokeOperation: JSONSerialization.data(withJSONObject: stroke),
                        recognized: recognized, operationID: UUID().uuidString, actor: "artist", revision: actualRevision,
                        timestamp: Int64(Date().timeIntervalSince1970 * 1000))
                    _ = try await writer.apply(pageID: "fixture-page", changeJSON: patch)
                }
                try await reload()
            } catch { message = "Stroke saved; correction or display unconfirmed: \(error)" }
        }
    }
    func simulateTriangleForUITest() {
        guard !busy else { return }
        correctShape = true
        let points: [CGPoint] = (0...10).map { CGPoint(x: 48, y: CGFloat(48 + $0 * 8)) }
            + (1...10).map { CGPoint(x: CGFloat(48 + $0 * 8), y: 128) }
            + (1...10).map { CGPoint(x: CGFloat(128 - $0 * 8), y: CGFloat(128 - $0 * 8)) }
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
    enum Failure: Error { case fixture, outsideRegion }
}

struct DrawingHarnessView: View {
    @StateObject private var model = DrawingHarnessModel()
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Isolated drawing experiment").font(.headline)
            Text("Temporary fixture only. Draw inside the marked area. Shapes, assets and other tools are not supported.").font(.caption)
            Toggle("Correct right triangles (experimental)", isOn: $model.correctShape).disabled(model.busy || model.brush != "hard")
            Picker("Brush", selection: $model.brush) { ForEach(["hard", "ink", "pencil", "highlighter"], id: \.self) { Text($0) } }.pickerStyle(.menu).disabled(model.busy)
            Text(model.message).accessibilityIdentifier("drawing-status")
            if let image = model.image, model.size.width > 0 {
                GeometryReader { geometry in
                    let scale = min(geometry.size.width / model.size.width, geometry.size.height / model.size.height)
                    let width = model.size.width * scale, height = model.size.height * scale
                    ZStack(alignment: .topLeading) {
                        Image(uiImage: image).resizable().frame(width: width, height: height)
                        Rectangle().stroke(.blue, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            .frame(width: 188 * scale, height: 188 * scale).offset(x: 32 * scale, y: 32 * scale).allowsHitTesting(false)
                        PencilCaptureSurface(viewToDocument: CGAffineTransform(scaleX: 1 / scale, y: 1 / scale), onStroke: model.capture, onCancelled: { _ in model.message = "Input cancelled and was not saved." })
                            .frame(width: width, height: height).allowsHitTesting(!model.busy).accessibilityIdentifier("drawing-canvas")
                    }.frame(width: width, height: height).accessibilityElement(children: .contain).accessibilityIdentifier("drawing-surface")
                }
            }
            if ProcessInfo.processInfo.arguments.contains("--synthetic-triangle") {
                Button("Simulate triangle input for test") { model.simulateTriangleForUITest() }
                    .disabled(model.busy).accessibilityIdentifier("simulate-triangle")
            }
            Button("Reopen saved drawing") { model.busy = true; Task { do { try await model.reload() } catch { model.message = "Reopen failed: \(error)" } } }
                .disabled(model.busy).accessibilityIdentifier("drawing-reopen")
        }.padding().task { await model.prepare() }
    }
}
