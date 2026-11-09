import Foundation
import SceneKit

/// Genuine parser for Stereolithography (STL) files, supporting both Binary and ASCII formats.
public final class STLParser {
    public struct ParsedSTLScene {
        public let scene: SCNScene
        public let stats: Model3DStats
    }

    public static func parse(data: Data) throws -> ParsedSTLScene {
        if isBinarySTL(data: data) {
            return try parseBinary(data: data)
        } else {
            return try parseASCII(data: data)
        }
    }

    private static func isBinarySTL(data: Data) -> Bool {
        guard data.count >= 84 else { return false }
        let triangleCount = data.withUnsafeBytes { ptr -> UInt32 in
            ptr.load(fromByteOffset: 80, as: UInt32.self)
        }
        let expectedSize = 84 + Int(triangleCount) * 50
        if expectedSize == data.count {
            return true
        }
        // If not exact match, check whether first 80 bytes are non-ASCII or missing "solid" keyword
        guard let prefix = String(data: data.prefix(80), encoding: .ascii) else { return true }
        return !prefix.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("solid")
    }

    public static func parseBinary(data: Data) throws -> ParsedSTLScene {
        guard data.count >= 84 else {
            throw Worlds3DError.invalidData("Binary STL file is too small (\(data.count) bytes, minimum 84)")
        }
        let triangleCount = Int(data.withUnsafeBytes { ptr in
            ptr.load(fromByteOffset: 80, as: UInt32.self)
        })
        guard triangleCount > 0 else {
            throw Worlds3DError.emptyScene
        }
        guard data.count >= 84 + triangleCount * 50 else {
            throw Worlds3DError.invalidData("Binary STL is truncated: expected \(84 + triangleCount * 50) bytes, found \(data.count)")
        }

        var vertices: [SCNVector3] = []
        var normals: [SCNVector3] = []
        vertices.reserveCapacity(triangleCount * 3)
        normals.reserveCapacity(triangleCount * 3)

        var minX: Float = .greatestFiniteMagnitude
        var minY: Float = .greatestFiniteMagnitude
        var minZ: Float = .greatestFiniteMagnitude
        var maxX: Float = -.greatestFiniteMagnitude
        var maxY: Float = -.greatestFiniteMagnitude
        var maxZ: Float = -.greatestFiniteMagnitude

        func updateBounds(_ v: SCNVector3) {
            minX = min(minX, v.x); maxX = max(maxX, v.x)
            minY = min(minY, v.y); maxY = max(maxY, v.y)
            minZ = min(minZ, v.z); maxZ = max(maxZ, v.z)
        }

        data.withUnsafeBytes { rawPtr in
            var offset = 84
            for _ in 0..<triangleCount {
                let nx = rawPtr.load(fromByteOffset: offset, as: Float.self)
                let ny = rawPtr.load(fromByteOffset: offset + 4, as: Float.self)
                let nz = rawPtr.load(fromByteOffset: offset + 8, as: Float.self)
                var normal = SCNVector3(nx, ny, nz)

                let v1x = rawPtr.load(fromByteOffset: offset + 12, as: Float.self)
                let v1y = rawPtr.load(fromByteOffset: offset + 16, as: Float.self)
                let v1z = rawPtr.load(fromByteOffset: offset + 20, as: Float.self)
                let p1 = SCNVector3(v1x, v1y, v1z)

                let v2x = rawPtr.load(fromByteOffset: offset + 24, as: Float.self)
                let v2y = rawPtr.load(fromByteOffset: offset + 28, as: Float.self)
                let v2z = rawPtr.load(fromByteOffset: offset + 32, as: Float.self)
                let p2 = SCNVector3(v2x, v2y, v2z)

                let v3x = rawPtr.load(fromByteOffset: offset + 36, as: Float.self)
                let v3y = rawPtr.load(fromByteOffset: offset + 40, as: Float.self)
                let v3z = rawPtr.load(fromByteOffset: offset + 44, as: Float.self)
                let p3 = SCNVector3(v3x, v3y, v3z)

                // If normal is (0,0,0), compute from vertices
                let nlen = sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z)
                if nlen < 0.0001 {
                    let u = SCNVector3(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z)
                    let v = SCNVector3(p3.x - p1.x, p3.y - p1.y, p3.z - p1.z)
                    normal = SCNVector3(
                        u.y * v.z - u.z * v.y,
                        u.z * v.x - u.x * v.z,
                        u.x * v.y - u.y * v.x
                    )
                    let clen = sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z)
                    if clen > 0.0001 {
                        normal.x /= clen; normal.y /= clen; normal.z /= clen
                    } else {
                        normal = SCNVector3(0, 0, 1)
                    }
                }

                updateBounds(p1); updateBounds(p2); updateBounds(p3)
                vertices.append(p1); vertices.append(p2); vertices.append(p3)
                normals.append(normal); normals.append(normal); normals.append(normal)

                offset += 50
            }
        }

        return makeScene(
            vertices: vertices,
            normals: normals,
            faceCount: triangleCount,
            min: SCNVector3(minX, minY, minZ),
            max: SCNVector3(maxX, maxY, maxZ)
        )
    }

    public static func parseASCII(data: Data) throws -> ParsedSTLScene {
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .ascii) else {
            throw Worlds3DError.invalidData("ASCII STL data is not valid text")
        }

        var vertices: [SCNVector3] = []
        var normals: [SCNVector3] = []

        var currentNormal = SCNVector3(0, 0, 1)
        var faceVertices: [SCNVector3] = []

        var minX: Float = .greatestFiniteMagnitude
        var minY: Float = .greatestFiniteMagnitude
        var minZ: Float = .greatestFiniteMagnitude
        var maxX: Float = -.greatestFiniteMagnitude
        var maxY: Float = -.greatestFiniteMagnitude
        var maxZ: Float = -.greatestFiniteMagnitude

        func updateBounds(_ v: SCNVector3) {
            minX = min(minX, v.x); maxX = max(maxX, v.x)
            minY = min(minY, v.y); maxY = max(maxY, v.y)
            minZ = min(minZ, v.z); maxZ = max(maxZ, v.z)
        }

        let lines = text.components(separatedBy: .newlines)
        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.isEmpty || line.hasPrefix("solid") || line.hasPrefix("endsolid") { continue }

            if line.hasPrefix("facet normal") {
                let parts = line.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                if parts.count >= 4 {
                    let nx = Float(parts[2]) ?? 0
                    let ny = Float(parts[3]) ?? 0
                    let nz = Float(parts[4]) ?? 1
                    currentNormal = SCNVector3(nx, ny, nz)
                }
                faceVertices.removeAll(keepingCapacity: true)
            } else if line.hasPrefix("vertex") {
                let parts = line.components(separatedBy: .whitespaces).filter { !$0.isEmpty }
                if parts.count >= 4 {
                    let x = Float(parts[1]) ?? 0
                    let y = Float(parts[2]) ?? 0
                    let z = Float(parts[3]) ?? 0
                    faceVertices.append(SCNVector3(x, y, z))
                }
            } else if line.hasPrefix("endfacet") {
                if faceVertices.count == 3 {
                    let p1 = faceVertices[0], p2 = faceVertices[1], p3 = faceVertices[2]
                    updateBounds(p1); updateBounds(p2); updateBounds(p3)
                    vertices.append(p1); vertices.append(p2); vertices.append(p3)
                    normals.append(currentNormal); normals.append(currentNormal); normals.append(currentNormal)
                }
            }
        }

        guard !vertices.isEmpty else {
            throw Worlds3DError.emptyScene
        }

        return makeScene(
            vertices: vertices,
            normals: normals,
            faceCount: vertices.count / 3,
            min: SCNVector3(minX, minY, minZ),
            max: SCNVector3(maxX, maxY, maxZ)
        )
    }

    private static func makeScene(
        vertices: [SCNVector3],
        normals: [SCNVector3],
        faceCount: Int,
        min: SCNVector3,
        max: SCNVector3
    ) -> ParsedSTLScene {
        let scene = SCNScene()
        let vertexSource = SCNGeometrySource(vertices: vertices)
        let normalSource = SCNGeometrySource(normals: normals)
        var indices = Array<Int32>(0..<Int32(vertices.count))
        let elementData = Data(bytes: &indices, count: indices.count * MemoryLayout<Int32>.size)
        let element = SCNGeometryElement(
            data: elementData,
            primitiveType: .triangles,
            primitiveCount: faceCount,
            bytesPerIndex: MemoryLayout<Int32>.size
        )

        let geometry = SCNGeometry(sources: [vertexSource, normalSource], elements: [element])
        let material = SCNMaterial()
        material.diffuse.contents = SCNColor(red: 0.88, green: 0.88, blue: 0.90, alpha: 1.0)
        material.specular.contents = SCNColor(white: 0.25, alpha: 1.0)
        material.roughness.contents = 0.4
        material.isDoubleSided = true
        geometry.materials = [material]

        let node = SCNNode(geometry: geometry)
        node.name = "stl-mesh"
        scene.rootNode.addChildNode(node)

        let stats = Model3DStats(
            vertexCount: vertices.count,
            faceCount: faceCount,
            lineCount: 0,
            nodeCount: 1,
            boundingBoxMin: min,
            boundingBoxMax: max
        )

        return ParsedSTLScene(scene: scene, stats: stats)
    }
}
