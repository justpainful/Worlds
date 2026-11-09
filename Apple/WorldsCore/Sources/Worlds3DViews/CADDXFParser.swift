import Foundation
@preconcurrency import SceneKit

/// Genuine AutoCAD DXF ASCII parser converting 2D/3D CAD entities to SceneKit geometry.
public final class CADDXFParser {
    public struct ParsedCADScene {
        public let scene: SCNScene
        public let stats: Model3DStats
    }

    public static func parse(data: Data) throws -> ParsedCADScene {
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .ascii) else {
            throw Worlds3DError.invalidData("DXF data is not valid UTF-8 or ASCII text")
        }
        return try parse(text: text)
    }

    public static func parse(text: String) throws -> ParsedCADScene {
        var lines: [Vector3D] = []
        var triangles: [(Vector3D, Vector3D, Vector3D)] = []

        let rawLines = text.components(separatedBy: .newlines)
        var i = 0

        func nextPair() -> (code: Int, value: String)? {
            while i < rawLines.count {
                let codeStr = rawLines[i].trimmingCharacters(in: .whitespacesAndNewlines)
                i += 1
                if codeStr.isEmpty { continue }
                guard let code = Int(codeStr), i < rawLines.count else { return nil }
                let val = rawLines[i].trimmingCharacters(in: .whitespacesAndNewlines)
                i += 1
                return (code, val)
            }
            return nil
        }

        var inEntitiesSection = false

        while let pair = nextPair() {
            if pair.code == 0 && pair.value == "SECTION" {
                if let secName = nextPair(), secName.code == 2 && secName.value == "ENTITIES" {
                    inEntitiesSection = true
                }
            } else if pair.code == 0 && pair.value == "ENDSEC" {
                if inEntitiesSection { break }
            } else if inEntitiesSection && pair.code == 0 {
                let entityType = pair.value
                switch entityType {
                case "LINE":
                    var start = Vector3D.zero
                    var end = Vector3D.zero
                    while let field = nextPair() {
                        if field.code == 0 {
                            // Back up one pair so outer loop reads next entity
                            i -= 2
                            break
                        }
                        switch field.code {
                        case 10: start.x = Float(field.value) ?? 0
                        case 20: start.y = Float(field.value) ?? 0
                        case 30: start.z = Float(field.value) ?? 0
                        case 11: end.x = Float(field.value) ?? 0
                        case 21: end.y = Float(field.value) ?? 0
                        case 31: end.z = Float(field.value) ?? 0
                        default: break
                        }
                    }
                    lines.append(start)
                    lines.append(end)

                case "3DFACE", "SOLID", "TRACE":
                    var p1 = Vector3D.zero, p2 = Vector3D.zero, p3 = Vector3D.zero, p4 = Vector3D.zero
                    var hasP4 = false
                    while let field = nextPair() {
                        if field.code == 0 {
                            i -= 2
                            break
                        }
                        switch field.code {
                        case 10: p1.x = Float(field.value) ?? 0
                        case 20: p1.y = Float(field.value) ?? 0
                        case 30: p1.z = Float(field.value) ?? 0
                        case 11: p2.x = Float(field.value) ?? 0
                        case 21: p2.y = Float(field.value) ?? 0
                        case 31: p2.z = Float(field.value) ?? 0
                        case 12: p3.x = Float(field.value) ?? 0
                        case 22: p3.y = Float(field.value) ?? 0
                        case 32: p3.z = Float(field.value) ?? 0
                        case 13: p4.x = Float(field.value) ?? 0; hasP4 = true
                        case 23: p4.y = Float(field.value) ?? 0
                        case 33: p4.z = Float(field.value) ?? 0
                        default: break
                        }
                    }
                    triangles.append((p1, p2, p3))
                    if hasP4 && p4 != p3 {
                        triangles.append((p1, p3, p4))
                    }

                case "CIRCLE":
                    var center = Vector3D.zero
                    var radius: Float = 0
                    while let field = nextPair() {
                        if field.code == 0 {
                            i -= 2
                            break
                        }
                        switch field.code {
                        case 10: center.x = Float(field.value) ?? 0
                        case 20: center.y = Float(field.value) ?? 0
                        case 30: center.z = Float(field.value) ?? 0
                        case 40: radius = Float(field.value) ?? 0
                        default: break
                        }
                    }
                    if radius > 0 {
                        let segments = 36
                        var circlePoints: [Vector3D] = []
                        for s in 0...segments {
                            let angle = (Float(s) / Float(segments)) * Float.pi * 2.0
                            let x = center.x + radius * cos(angle)
                            let y = center.y + radius * sin(angle)
                            circlePoints.append(Vector3D(x, y, center.z))
                        }
                        for s in 0..<segments {
                            lines.append(circlePoints[s])
                            lines.append(circlePoints[s + 1])
                        }
                    }

                case "ARC":
                    var center = Vector3D.zero
                    var radius: Float = 0
                    var startAngleDeg: Float = 0
                    var endAngleDeg: Float = 360
                    while let field = nextPair() {
                        if field.code == 0 {
                            i -= 2
                            break
                        }
                        switch field.code {
                        case 10: center.x = Float(field.value) ?? 0
                        case 20: center.y = Float(field.value) ?? 0
                        case 30: center.z = Float(field.value) ?? 0
                        case 40: radius = Float(field.value) ?? 0
                        case 50: startAngleDeg = Float(field.value) ?? 0
                        case 51: endAngleDeg = Float(field.value) ?? 360
                        default: break
                        }
                    }
                    if radius > 0 {
                        let startAngle = startAngleDeg * Float.pi / 180.0
                        var endAngle = endAngleDeg * Float.pi / 180.0
                        if endAngle < startAngle { endAngle += Float.pi * 2.0 }
                        let segments = max(8, Int((endAngle - startAngle) / (Float.pi * 2.0) * 36.0))
                        var arcPoints: [Vector3D] = []
                        for s in 0...segments {
                            let t = Float(s) / Float(segments)
                            let angle = startAngle + t * (endAngle - startAngle)
                            let x = center.x + radius * cos(angle)
                            let y = center.y + radius * sin(angle)
                            arcPoints.append(Vector3D(x, y, center.z))
                        }
                        for s in 0..<segments {
                            lines.append(arcPoints[s])
                            lines.append(arcPoints[s + 1])
                        }
                    }

                case "LWPOLYLINE":
                    var elevation: Float = 0
                    var isClosed = false
                    var polyPoints: [Vector3D] = []
                    var currentPt = Vector3D.zero
                    var readingX = false
                    while let field = nextPair() {
                        if field.code == 0 {
                            i -= 2
                            break
                        }
                        switch field.code {
                        case 38: elevation = Float(field.value) ?? 0
                        case 70:
                            if let flag = Int(field.value) { isClosed = (flag & 1) != 0 }
                        case 10:
                            currentPt.x = Float(field.value) ?? 0
                            currentPt.z = elevation
                            readingX = true
                        case 20:
                            if readingX {
                                currentPt.y = Float(field.value) ?? 0
                                polyPoints.append(currentPt)
                                readingX = false
                            }
                        default: break
                        }
                    }
                    if polyPoints.count >= 2 {
                        for p in 0..<(polyPoints.count - 1) {
                            lines.append(polyPoints[p])
                            lines.append(polyPoints[p + 1])
                        }
                        if isClosed, let first = polyPoints.first, let last = polyPoints.last {
                            lines.append(last)
                            lines.append(first)
                        }
                    }

                case "POLYLINE":
                    var polyPoints: [Vector3D] = []
                    var isClosed = false
                    while let field = nextPair() {
                        if field.code == 70, let flag = Int(field.value) {
                            isClosed = (flag & 1) != 0
                        }
                        if field.code == 0 {
                            if field.value == "VERTEX" {
                                var v = Vector3D.zero
                                while let vfield = nextPair() {
                                    if vfield.code == 0 {
                                        i -= 2
                                        break
                                    }
                                    switch vfield.code {
                                    case 10: v.x = Float(vfield.value) ?? 0
                                    case 20: v.y = Float(vfield.value) ?? 0
                                    case 30: v.z = Float(vfield.value) ?? 0
                                    default: break
                                    }
                                }
                                polyPoints.append(v)
                            } else if field.value == "SEQEND" {
                                break
                            }
                        }
                    }
                    if polyPoints.count >= 2 {
                        for p in 0..<(polyPoints.count - 1) {
                            lines.append(polyPoints[p])
                            lines.append(polyPoints[p + 1])
                        }
                        if isClosed, let first = polyPoints.first, let last = polyPoints.last {
                            lines.append(last)
                            lines.append(first)
                        }
                    }

                default:
                    break
                }
            }
        }

        guard !lines.isEmpty || !triangles.isEmpty else {
            throw Worlds3DError.emptyScene
        }

        let scene = SCNScene()
        let rootNode = scene.rootNode

        var minX: Float = .greatestFiniteMagnitude
        var minY: Float = .greatestFiniteMagnitude
        var minZ: Float = .greatestFiniteMagnitude
        var maxX: Float = -.greatestFiniteMagnitude
        var maxY: Float = -.greatestFiniteMagnitude
        var maxZ: Float = -.greatestFiniteMagnitude

        func updateBounds(_ v: Vector3D) {
            minX = min(minX, v.x); maxX = max(maxX, v.x)
            minY = min(minY, v.y); maxY = max(maxY, v.y)
            minZ = min(minZ, v.z); maxZ = max(maxZ, v.z)
        }

        // Build line geometry if lines exist
        if !lines.isEmpty {
            for pt in lines { updateBounds(pt) }
            let scnLines = lines.map(\.scnVector)
            let lineSource = SCNGeometrySource(vertices: scnLines)
            var indices = Array<Int32>(0..<Int32(lines.count))
            let elementData = Data(bytes: &indices, count: indices.count * MemoryLayout<Int32>.size)
            let lineElement = SCNGeometryElement(
                data: elementData,
                primitiveType: .line,
                primitiveCount: lines.count / 2,
                bytesPerIndex: MemoryLayout<Int32>.size
            )
            let geom = SCNGeometry(sources: [lineSource], elements: [lineElement])
            let mat = SCNMaterial()
            mat.diffuse.contents = SCNColor(red: 0.85, green: 0.65, blue: 0.40, alpha: 1.0) // warm accent
            mat.isDoubleSided = true
            geom.materials = [mat]

            let lineNode = SCNNode(geometry: geom)
            lineNode.name = "cad-lines"
            rootNode.addChildNode(lineNode)
        }

        // Build triangle geometry if 3D faces exist
        if !triangles.isEmpty {
            var triVertices: [SCNVector3] = []
            var triNormals: [SCNVector3] = []
            for (p1, p2, p3) in triangles {
                updateBounds(p1)
                updateBounds(p2)
                updateBounds(p3)
                triVertices.append(p1.scnVector)
                triVertices.append(p2.scnVector)
                triVertices.append(p3.scnVector)

                let u = Vector3D(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z)
                let v = Vector3D(p3.x - p1.x, p3.y - p1.y, p3.z - p1.z)
                var normal = Vector3D(
                    u.y * v.z - u.z * v.y,
                    u.z * v.x - u.x * v.z,
                    u.x * v.y - u.y * v.x
                )
                let len = sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z)
                if len > 0.0001 {
                    normal.x /= len; normal.y /= len; normal.z /= len
                } else {
                    normal = Vector3D(0, 0, 1)
                }
                let scnNormal = normal.scnVector
                triNormals.append(scnNormal)
                triNormals.append(scnNormal)
                triNormals.append(scnNormal)
            }
            let vertexSource = SCNGeometrySource(vertices: triVertices)
            let normalSource = SCNGeometrySource(normals: triNormals)
            var indices = Array<Int32>(0..<Int32(triVertices.count))
            let elementData = Data(bytes: &indices, count: indices.count * MemoryLayout<Int32>.size)
            let triElement = SCNGeometryElement(
                data: elementData,
                primitiveType: .triangles,
                primitiveCount: triangles.count,
                bytesPerIndex: MemoryLayout<Int32>.size
            )
            let geom = SCNGeometry(sources: [vertexSource, normalSource], elements: [triElement])
            let mat = SCNMaterial()
            mat.diffuse.contents = SCNColor(white: 0.75, alpha: 0.9)
            mat.isDoubleSided = true
            geom.materials = [mat]

            let meshNode = SCNNode(geometry: geom)
            meshNode.name = "cad-faces"
            rootNode.addChildNode(meshNode)
        }

        let stats = Model3DStats(
            vertexCount: lines.count + triangles.count * 3,
            faceCount: triangles.count,
            lineCount: lines.count / 2,
            nodeCount: rootNode.childNodes.count,
            boundingBoxMin: SCNVector3(minX, minY, minZ),
            boundingBoxMax: SCNVector3(maxX, maxY, maxZ)
        )

        return ParsedCADScene(scene: scene, stats: stats)
    }
}
