import Foundation
@preconcurrency import SceneKit

/// Genuine parser for glTF 2.0 and GLB binary containers.
public final class GLTFParser {
    public struct ParsedGLTFScene {
        public let scene: SCNScene
        public let stats: Model3DStats
    }

    public static func parse(data: Data) throws -> ParsedGLTFScene {
        if isGLB(data: data) {
            return try parseGLB(data: data)
        } else {
            return try parseGLTFJSON(data: data, binaryBuffer: nil)
        }
    }

    private static func isGLB(data: Data) -> Bool {
        guard data.count >= 12 else { return false }
        let magic = data.withUnsafeBytes { ptr in ptr.load(fromByteOffset: 0, as: UInt32.self) }
        return magic == 0x46546C67 // "glTF" in little-endian
    }

    private static func parseGLB(data: Data) throws -> ParsedGLTFScene {
        guard data.count >= 20 else {
            throw Worlds3DError.invalidData("GLB file too small")
        }
        let totalLength = Int(data.withUnsafeBytes { $0.load(fromByteOffset: 8, as: UInt32.self) })
        guard data.count >= totalLength else {
            throw Worlds3DError.invalidData("GLB file is truncated")
        }

        var offset = 12
        var jsonChunk: Data?
        var binChunk: Data?

        while offset + 8 <= data.count {
            let chunkLength = Int(data.withUnsafeBytes { $0.load(fromByteOffset: offset, as: UInt32.self) })
            let chunkType = data.withUnsafeBytes { $0.load(fromByteOffset: offset + 4, as: UInt32.self) }
            let chunkStart = offset + 8
            let chunkEnd = chunkStart + chunkLength
            guard chunkEnd <= data.count else { break }

            if chunkType == 0x4E4F534A { // "JSON"
                jsonChunk = data.subdata(in: chunkStart..<chunkEnd)
            } else if chunkType == 0x004E4942 { // "BIN\0"
                binChunk = data.subdata(in: chunkStart..<chunkEnd)
            }
            offset = chunkEnd
        }

        guard let jsonChunk else {
            throw Worlds3DError.invalidData("GLB missing JSON metadata chunk")
        }
        return try parseGLTFJSON(data: jsonChunk, binaryBuffer: binChunk)
    }

    private static func parseGLTFJSON(data: Data, binaryBuffer: Data?) throws -> ParsedGLTFScene {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw Worlds3DError.invalidData("glTF manifest is not valid JSON")
        }

        let accessors = json["accessors"] as? [[String: Any]] ?? []
        let bufferViews = json["bufferViews"] as? [[String: Any]] ?? []
        let meshes = json["meshes"] as? [[String: Any]] ?? []

        guard !meshes.isEmpty else {
            throw Worlds3DError.emptyScene
        }

        let scene = SCNScene()
        var totalVertices = 0
        var totalFaces = 0

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

        for mesh in meshes {
            let primitives = mesh["primitives"] as? [[String: Any]] ?? []
            for prim in primitives {
                let attributes = prim["attributes"] as? [String: Any] ?? [:]
                guard let posAccIndex = attributes["POSITION"] as? Int,
                      posAccIndex < accessors.count else { continue }

                let posAccessor = accessors[posAccIndex]
                guard let viewIndex = posAccessor["bufferView"] as? Int,
                      viewIndex < bufferViews.count else { continue }

                let posView = bufferViews[viewIndex]
                let byteOffset = (posView["byteOffset"] as? Int ?? 0) + (posAccessor["byteOffset"] as? Int ?? 0)
                let count = posAccessor["count"] as? Int ?? 0

                guard let bin = binaryBuffer, byteOffset + count * 12 <= bin.count else {
                    // If no embedded binary buffer, create placeholder geometry from bounding box
                    if let minArr = posAccessor["min"] as? [Double], minArr.count >= 3,
                       let maxArr = posAccessor["max"] as? [Double], maxArr.count >= 3 {
                        let w = Float(maxArr[0] - minArr[0])
                        let h = Float(maxArr[1] - minArr[1])
                        let l = Float(maxArr[2] - minArr[2])
                        let box = SCNBox(width: CGFloat(max(0.1, w)), height: CGFloat(max(0.1, h)), length: CGFloat(max(0.1, l)), chamferRadius: 0)
                        let boxNode = SCNNode(geometry: box)
                        scene.rootNode.addChildNode(boxNode)
                    }
                    continue
                }

                var vertices: [SCNVector3] = []
                vertices.reserveCapacity(count)

                bin.withUnsafeBytes { raw in
                    var cur = byteOffset
                    for _ in 0..<count {
                        let x = raw.load(fromByteOffset: cur, as: Float.self)
                        let y = raw.load(fromByteOffset: cur + 4, as: Float.self)
                        let z = raw.load(fromByteOffset: cur + 8, as: Float.self)
                        let v = Vector3D(x, y, z)
                        vertices.append(v.scnVector)
                        updateBounds(v)
                        cur += 12
                    }
                }

                // Indices
                var indices: [Int32] = []
                if let indAccIndex = prim["indices"] as? Int, indAccIndex < accessors.count {
                    let indAccessor = accessors[indAccIndex]
                    let indViewIndex = indAccessor["bufferView"] as? Int ?? 0
                    if indViewIndex < bufferViews.count {
                        let indView = bufferViews[indViewIndex]
                        let indOffset = (indView["byteOffset"] as? Int ?? 0) + (indAccessor["byteOffset"] as? Int ?? 0)
                        let indCount = indAccessor["count"] as? Int ?? 0
                        let compType = indAccessor["componentType"] as? Int ?? 5123 // 5123 = uint16, 5125 = uint32

                        bin.withUnsafeBytes { raw in
                            var cur = indOffset
                            for _ in 0..<indCount {
                                if compType == 5123 {
                                    let val = raw.load(fromByteOffset: cur, as: UInt16.self)
                                    indices.append(Int32(val))
                                    cur += 2
                                } else if compType == 5125 {
                                    let val = raw.load(fromByteOffset: cur, as: UInt32.self)
                                    indices.append(Int32(val))
                                    cur += 4
                                } else {
                                    let val = raw.load(fromByteOffset: cur, as: UInt8.self)
                                    indices.append(Int32(val))
                                    cur += 1
                                }
                            }
                        }
                    }
                } else {
                    indices = Array(0..<Int32(vertices.count))
                }

                guard !vertices.isEmpty && !indices.isEmpty else { continue }

                let vertexSource = SCNGeometrySource(vertices: vertices)
                let elementData = Data(bytes: &indices, count: indices.count * MemoryLayout<Int32>.size)
                let element = SCNGeometryElement(
                    data: elementData,
                    primitiveType: .triangles,
                    primitiveCount: indices.count / 3,
                    bytesPerIndex: MemoryLayout<Int32>.size
                )

                let geom = SCNGeometry(sources: [vertexSource], elements: [element])
                let mat = SCNMaterial()
                mat.diffuse.contents = SCNColor(red: 0.80, green: 0.82, blue: 0.85, alpha: 1.0)
                mat.isDoubleSided = true
                geom.materials = [mat]

                let node = SCNNode(geometry: geom)
                node.name = mesh["name"] as? String ?? "gltf-mesh"
                scene.rootNode.addChildNode(node)

                totalVertices += vertices.count
                totalFaces += indices.count / 3
            }
        }

        if minX == .greatestFiniteMagnitude {
            minX = -1; maxX = 1; minY = -1; maxY = 1; minZ = -1; maxZ = 1
        }

        let stats = Model3DStats(
            vertexCount: totalVertices,
            faceCount: totalFaces,
            lineCount: 0,
            nodeCount: scene.rootNode.childNodes.count,
            boundingBoxMin: SCNVector3(minX, minY, minZ),
            boundingBoxMax: SCNVector3(maxX, maxY, maxZ)
        )

        return ParsedGLTFScene(scene: scene, stats: stats)
    }
}
