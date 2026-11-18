import SwiftUI

/// A concept map as a small world, as on the desktop (src/editor/views/ConceptWorld.tsx):
/// concepts are points you move between, each link carries its phrase. Drag to move
/// around, pinch to zoom, drag a concept to place it, tap one to light up its links.
/// With `layered` the same map is drawn as boxes in rows, for flowcharts of steps.
@MainActor
final class ConceptWorldModel: ObservableObject {
    struct Body { var x: Double; var y: Double; var vx = 0.0; var vy = 0.0; var held = false; var depth = 0; var degree = 0 }
    @Published var tick = 0
    private(set) var bodies: [String: Body] = [:]
    private(set) var alpha = 1.0
    var cameraX = 0.0
    var cameraY = 0.0
    var zoom = 1.0
    var width = 0.0
    var height = 0.0
    private var fitted = false
    let graph: ConceptMapGraph
    let layered: Bool
    private static let link = 170.0

    init(graph: ConceptMapGraph, layered: Bool) {
        self.graph = graph
        self.layered = layered
        var incoming: [String: Int] = [:]
        for edge in graph.edges { incoming[edge.to, default: 0] += 1 }
        var depth: [String: Int] = [:]
        var queue = graph.nodes.map(\.id).filter { incoming[$0, default: 0] == 0 }
        if queue.isEmpty, let first = graph.nodes.first { queue.append(first.id) }
        for id in queue { depth[id] = 0 }
        var index = 0
        while index < queue.count {
            let id = queue[index]
            index += 1
            for edge in graph.edges where edge.from == id && depth[edge.to] == nil {
                depth[edge.to] = depth[id, default: 0] + 1
                queue.append(edge.to)
            }
        }
        let vertical = ["TD", "TB", "BT"].contains(graph.direction)
        var counts: [Int: Int] = [:]
        for node in graph.nodes { counts[depth[node.id, default: 0], default: 0] += 1 }
        var slots: [Int: Int] = [:]
        var placed: [String: Body] = [:]
        for node in graph.nodes {
            let d = depth[node.id, default: 0]
            let slot = slots[d, default: 0]
            slots[d] = slot + 1
            let across = (Double(slot) - Double(counts[d, default: 1] - 1) / 2) * (layered ? 220.0 : 150.0)
            let along = Double(d) * (layered ? (vertical ? 140.0 : 240.0) : Self.link * (vertical ? 1.0 : 1.3))
            let stored: ConceptMapPoint? = layered ? nil : graph.positions[node.id]
            var body = Body(x: stored?.x ?? (vertical ? across : along), y: stored?.y ?? (vertical ? along : across))
            body.depth = d
            body.degree = graph.edges.filter { $0.from == node.id || $0.to == node.id }.count
            placed[node.id] = body
        }
        bodies = placed
        let settled = layered || graph.nodes.allSatisfy { graph.positions[$0.id] != nil }
        alpha = settled ? 0 : 1
        var spread = 0
        while alpha > 0.05 && spread < 160 { step(); spread += 1 }
    }

    var moving: Bool { alpha >= 0.003 || bodies.values.contains(where: { $0.held }) }

    func step() {
        guard alpha >= 0.003 else { return }
        let ids = Array(bodies.keys)
        if ids.count > 1 {
            for i in 0..<(ids.count - 1) {
                for j in (i + 1)..<ids.count {
                    guard var p = bodies[ids[i]], var q = bodies[ids[j]] else { continue }
                    var dx = q.x - p.x
                    var dy = q.y - p.y
                    var d2 = dx * dx + dy * dy
                    if d2 < 1 { dx = 0.5; dy = 0.3; d2 = 1 }
                    let d = d2.squareRoot()
                    let f = 26000.0 / d2 * alpha
                    p.vx -= dx / d * f; p.vy -= dy / d * f
                    q.vx += dx / d * f; q.vy += dy / d * f
                    bodies[ids[i]] = p
                    bodies[ids[j]] = q
                }
            }
        }
        for edge in graph.edges where edge.from != edge.to {
            guard var p = bodies[edge.from], var q = bodies[edge.to] else { continue }
            let dx = q.x - p.x, dy = q.y - p.y
            let d = max(1.0, (dx * dx + dy * dy).squareRoot())
            let f = (d - Self.link) * 0.05 * alpha
            p.vx += dx / d * f; p.vy += dy / d * f
            q.vx -= dx / d * f; q.vy -= dy / d * f
            bodies[edge.from] = p
            bodies[edge.to] = q
        }
        let count = Double(max(1, bodies.count))
        let cx = bodies.values.reduce(0.0) { $0 + $1.x } / count
        let cy = bodies.values.reduce(0.0) { $0 + $1.y } / count
        for id in ids {
            guard var b = bodies[id] else { continue }
            if b.held {
                b.vx = 0; b.vy = 0
            } else {
                b.vx = (b.vx - cx * 0.004 * alpha) * 0.55
                b.vy = (b.vy - cy * 0.004 * alpha) * 0.55
                b.x += min(40.0, max(-40.0, b.vx))
                b.y += min(40.0, max(-40.0, b.vy))
            }
            bodies[id] = b
        }
        alpha *= 0.975
    }

    func radius(_ b: Body) -> Double { 7.0 + Double(b.degree).squareRoot() * 3.2 + (b.depth == 0 ? 4.0 : 0.0) }

    func resize(_ size: CGSize) {
        width = Double(size.width)
        height = Double(size.height)
        fit(force: fitted)
    }

    func fit(force: Bool = false) {
        guard width > 0, height > 0, !bodies.isEmpty, force || !fitted else { return }
        place()
        tick &+= 1
    }

    /// Learns the size while the view is drawn and frames the map the first time,
    /// without announcing a change (drawing must not publish one).
    func prepare(_ size: CGSize) {
        let w = Double(size.width), h = Double(size.height)
        guard w > 0, h > 0 else { return }
        if w != width || h != height { width = w; height = h }
        if !fitted && !bodies.isEmpty { place() }
    }

    private func place() {
        fitted = true
        let xs = bodies.values.map { $0.x }, ys = bodies.values.map { $0.y }
        let minX = (xs.min() ?? 0) - 120, maxX = (xs.max() ?? 0) + 120
        let minY = (ys.min() ?? 0) - 70, maxY = (ys.max() ?? 0) + 100
        zoom = max(0.2, min(1.6, min(width / (maxX - minX), height / (maxY - minY))))
        cameraX = (minX + maxX) / 2
        cameraY = (minY + maxY) / 2
    }

    func screenX(_ x: Double) -> Double { (x - cameraX) * zoom + width / 2 }
    func screenY(_ y: Double) -> Double { (y - cameraY) * zoom + height / 2 }

    func hit(_ point: CGPoint) -> String? {
        var best: String?
        var bestDistance = Double.infinity
        for (id, b) in bodies {
            let d = hypot(screenX(b.x) - Double(point.x), screenY(b.y) - Double(point.y))
            let reach = layered ? 80.0 * zoom : max(22.0, radius(b) * zoom + 8.0)
            if d <= reach && d < bestDistance { best = id; bestDistance = d }
        }
        return best
    }

    func hold(_ id: String, _ held: Bool) { bodies[id]?.held = held; tick &+= 1 }
    func move(_ id: String, dx: Double, dy: Double) {
        guard !layered, var b = bodies[id] else { return }
        b.x += dx / zoom
        b.y += dy / zoom
        bodies[id] = b
        alpha = max(alpha, 0.3)
        tick &+= 1
    }
    func pan(dx: Double, dy: Double) {
        cameraX -= dx / zoom
        cameraY -= dy / zoom
        tick &+= 1
    }
    func setZoom(_ value: Double) { zoom = max(0.15, min(3.0, value)); tick &+= 1 }
}

/// What one frame of the world draws: plain values, so drawing needs nothing else.
struct ConceptWorldPicture: Sendable {
    struct Dot: Sendable { var x: Double; var y: Double; var radius: Double; var depth: Int }
    var dots: [String: Dot] = [:]
    var zoom = 1.0
    var width = 0.0
    var height = 0.0
    var originX = 0.0
    var originY = 0.0
    var focus: String?
    var near: Set<String> = []
    var layered = false
}

@MainActor
public struct ConceptWorldView: View {
    private let graph: ConceptMapGraph
    private let layered: Bool
    @StateObject private var model: ConceptWorldModel
    @State private var dragTarget: String?
    @State private var dragLast: CGPoint?
    @State private var zoomStart: Double?
    @State private var focus: String?

    public init(graph: ConceptMapGraph, layered: Bool = false) {
        self.graph = graph
        self.layered = layered
        _model = StateObject(wrappedValue: ConceptWorldModel(graph: graph, layered: layered))
    }

    public var body: some View {
        GeometryReader { geometry in
            let picture = snapshot(geometry.size)
            let graph = self.graph
            Canvas { context, _ in ConceptWorldView.draw(picture, graph: graph, in: &context) }
                .contentShape(Rectangle())
                .gesture(dragGesture)
                .simultaneousGesture(
                    MagnifyGesture()
                        .onChanged { value in
                            if zoomStart == nil { zoomStart = model.zoom }
                            model.setZoom((zoomStart ?? 1) * Double(value.magnification))
                        }
                        .onEnded { _ in zoomStart = nil }
                )
                .onAppear { model.resize(geometry.size) }
                .onChange(of: geometry.size) { _, size in model.resize(size) }
        }
        .task {
            while !Task.isCancelled {
                let moving = model.moving
                if moving { model.step(); model.tick &+= 1 }
                try? await Task.sleep(nanoseconds: moving ? 16_000_000 : 150_000_000)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Concept map"))
        .accessibilityIdentifier("concept-world")
        .accessibilityValue(Text(graph.nodes.map { $0.label }.joined(separator: ", ")))
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if dragLast == nil {
                    dragLast = value.startLocation
                    dragTarget = model.hit(value.startLocation)
                    if let target = dragTarget, !layered { model.hold(target, true) }
                }
                let last = dragLast ?? value.startLocation
                let dx = Double(value.location.x - last.x), dy = Double(value.location.y - last.y)
                dragLast = value.location
                if let target = dragTarget, !layered { model.move(target, dx: dx, dy: dy) } else { model.pan(dx: dx, dy: dy) }
            }
            .onEnded { value in
                if let target = dragTarget { model.hold(target, false) }
                if hypot(Double(value.translation.width), Double(value.translation.height)) < 4 {
                    focus = dragTarget == focus ? nil : dragTarget
                }
                dragTarget = nil
                dragLast = nil
            }
    }

    private func snapshot(_ size: CGSize) -> ConceptWorldPicture {
        _ = model.tick
        model.prepare(size)
        var picture = ConceptWorldPicture(zoom: model.zoom, width: model.width, height: model.height,
                                          originX: model.screenX(0), originY: model.screenY(0), focus: focus, layered: layered)
        for (id, b) in model.bodies {
            picture.dots[id] = ConceptWorldPicture.Dot(x: model.screenX(b.x), y: model.screenY(b.y), radius: model.radius(b) * model.zoom, depth: b.depth)
        }
        if let focus {
            picture.near.insert(focus)
            for edge in graph.edges {
                if edge.from == focus { picture.near.insert(edge.to) }
                if edge.to == focus { picture.near.insert(edge.from) }
            }
        }
        return picture
    }

    nonisolated private static let depthColors: [Color] = [
        .blue, Color(red: 0.28, green: 0.64, blue: 0.40), Color(red: 0.88, green: 0.47, blue: 0.29),
        Color(red: 0.64, green: 0.42, blue: 0.84), Color(red: 0.85, green: 0.65, blue: 0.18), Color(red: 0.22, green: 0.71, blue: 0.72),
    ]

    nonisolated private static func draw(_ picture: ConceptWorldPicture, graph: ConceptMapGraph, in context: inout GraphicsContext) {
        let zoom = picture.zoom
        let boxW = 150.0 * zoom, boxH = 44.0 * zoom
        let gap = 32.0 * zoom
        if !picture.layered && gap > 9 {
            var x = picture.originX.truncatingRemainder(dividingBy: gap)
            if x < 0 { x += gap }
            while x < picture.width {
                var y = picture.originY.truncatingRemainder(dividingBy: gap)
                if y < 0 { y += gap }
                while y < picture.height {
                    context.fill(Path(ellipseIn: CGRect(x: x - 0.8, y: y - 0.8, width: 1.6, height: 1.6)), with: .color(Color.secondary.opacity(0.25)))
                    y += gap
                }
                x += gap
            }
        }
        // Link phrases slide along their link until they stop covering one another.
        var placed: [CGRect] = []
        for edge in graph.edges {
            guard let a = picture.dots[edge.from], let b = picture.dots[edge.to] else { continue }
            let dx = b.x - a.x, dy = b.y - a.y
            let d = max(1.0, hypot(dx, dy))
            let boxInset = min(boxW / 2 / max(0.01, abs(dx / d)), boxH / 2 / max(0.01, abs(dy / d)))
            let startInset = picture.layered ? boxInset : a.radius + 2
            let endInset = picture.layered ? boxInset + 3 : b.radius + 3
            let s = CGPoint(x: a.x + dx / d * startInset, y: a.y + dy / d * startInset)
            let t = CGPoint(x: b.x - dx / d * endInset, y: b.y - dy / d * endInset)
            let lit = picture.focus != nil && (edge.from == picture.focus || edge.to == picture.focus)
            let dim = picture.focus != nil && !lit
            let color: Color = lit ? Color.accentColor : Color.secondary
            var line = Path()
            line.move(to: s)
            line.addLine(to: t)
            context.stroke(line, with: .color(color.opacity(dim ? 0.18 : (lit ? 0.95 : 0.6))),
                           style: StrokeStyle(lineWidth: edge.style == "thick" ? 2.6 : 1.4, dash: edge.style == "dotted" ? [5, 5] : []))
            if edge.style != "line" {
                let angle = atan2(dy, dx), k = 7.0
                var head = Path()
                head.move(to: t)
                head.addLine(to: CGPoint(x: Double(t.x) - k * cos(angle - 0.42), y: Double(t.y) - k * sin(angle - 0.42)))
                head.addLine(to: CGPoint(x: Double(t.x) - k * cos(angle + 0.42), y: Double(t.y) - k * sin(angle + 0.42)))
                head.closeSubpath()
                context.fill(head, with: .color(color.opacity(dim ? 0.18 : 0.9)))
            }
            let phrase = edge.label.trimmingCharacters(in: .whitespaces)
            if !phrase.isEmpty && (zoom >= 0.5 || lit) {
                let text = context.resolve(Text(verbatim: phrase).font(.system(size: 11, weight: .medium)).foregroundColor(lit ? Color.primary : Color.secondary))
                let measured = text.measure(in: CGSize(width: 320, height: 60))
                func phraseSpot(at f: Double) -> CGRect {
                    let x = Double(s.x) + Double(t.x - s.x) * f, y = Double(s.y) + Double(t.y - s.y) * f
                    return CGRect(x: x - Double(measured.width) / 2 - 7, y: y - Double(measured.height) / 2 - 3, width: Double(measured.width) + 14, height: Double(measured.height) + 6)
                }
                // Along the link first, then stepped above or below the middle when links run close.
                let middle: CGRect = phraseSpot(at: 0.5)
                let step: Double = Double(middle.height) + 3
                var spots: [CGRect] = []
                for f: Double in [0.5, 0.36, 0.64, 0.26, 0.74] { spots.append(phraseSpot(at: f)) }
                for k: Double in [1, -1, 2, -2] { spots.append(middle.offsetBy(dx: 0, dy: k * step)) }
                func covered(_ spot: CGRect) -> Double {
                    var total: Double = 0
                    for other in placed {
                        let shared: CGRect = other.insetBy(dx: -2, dy: -2).intersection(spot)
                        if !shared.isNull { total += Double(shared.width) * Double(shared.height) }
                    }
                    return total
                }
                var pill: CGRect = middle
                var least: Double = .infinity
                for spot in spots {
                    let cover = covered(spot)
                    if cover < least { least = cover; pill = spot }
                    if cover == 0 { break }
                }
                placed.append(pill)
                let mid = CGPoint(x: pill.midX, y: pill.midY)
                context.opacity = dim ? 0.35 : 1
                context.fill(Path(roundedRect: pill, cornerRadius: pill.height / 2), with: .color(Color.gray.opacity(0.2)))
                context.draw(text, at: mid, anchor: .center)
                context.opacity = 1
            }
        }
        for node in graph.nodes {
            guard let dot = picture.dots[node.id] else { continue }
            let dim = picture.focus != nil && !picture.near.contains(node.id)
            let color = depthColors[dot.depth % depthColors.count]
            context.opacity = dim ? 0.3 : 1
            if picture.layered {
                let box = CGRect(x: dot.x - boxW / 2, y: dot.y - boxH / 2, width: boxW, height: boxH)
                context.fill(Path(roundedRect: box, cornerRadius: 10), with: .color(color.opacity(0.18)))
                context.stroke(Path(roundedRect: box, cornerRadius: 10), with: .color(color.opacity(0.7)), lineWidth: 1.2)
                let size = max(9.0, min(16.0, 13.0 * zoom))
                let text = context.resolve(Text(verbatim: node.label).font(.system(size: size, weight: .medium)).foregroundColor(Color.primary))
                // The name sits in the middle of its box.
                let fitted = text.measure(in: box.insetBy(dx: 8, dy: 4).size)
                context.draw(text, in: CGRect(x: dot.x - fitted.width / 2, y: dot.y - fitted.height / 2, width: fitted.width, height: fitted.height))
            } else {
                let r = dot.radius
                if node.id == picture.focus {
                    context.fill(Path(ellipseIn: CGRect(x: dot.x - r - 7, y: dot.y - r - 7, width: 2 * (r + 7), height: 2 * (r + 7))), with: .color(color.opacity(0.22)))
                }
                context.fill(Path(ellipseIn: CGRect(x: dot.x - r, y: dot.y - r, width: 2 * r, height: 2 * r)), with: .color(color))
                if zoom >= 0.35 || picture.near.contains(node.id) {
                    let text = context.resolve(Text(verbatim: node.label)
                        .font(.system(size: dot.depth == 0 ? 14.5 : 13, weight: dot.depth == 0 ? .semibold : .medium))
                        .foregroundColor(Color.primary))
                    // A soft backing, so a name stays readable where a link passes under it.
                    let size = text.measure(in: CGSize(width: 400, height: 80))
                    let backing = CGRect(x: dot.x - Double(size.width) / 2 - 5, y: dot.y + r + 4, width: Double(size.width) + 10, height: Double(size.height) + 2)
                    context.fill(Path(roundedRect: backing, cornerRadius: 6), with: .style(.background))
                    context.draw(text, at: CGPoint(x: dot.x, y: dot.y + r + 5), anchor: .top)
                }
            }
            context.opacity = 1
        }
    }
}
