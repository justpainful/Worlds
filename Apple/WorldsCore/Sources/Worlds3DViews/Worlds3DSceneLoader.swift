import Foundation
@preconcurrency import SceneKit
import ModelIO

#if canImport(SceneKit.ModelIO)
import SceneKit.ModelIO
#endif

/// Unified loader for all 3D and CAD formats into normalized SceneKit scenes.
public final class Worlds3DSceneLoader {
    public struct LoadedScene: @unchecked Sendable {
        public let scene: SCNScene
        public let stats: Model3DStats
        public let format: Model3DFormat
    }

    public static func load(from url: URL) throws -> LoadedScene {
        let ext = url.pathExtension.lowercased()
        guard let format = Model3DFormat(rawValue: ext) else {
            throw Worlds3DError.unsupportedFormat(ext)
        }
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw Worlds3DError.fileNotFound(url.path)
        }
        let data = try Data(contentsOf: url)
        return try load(data: data, format: format, fileURL: url)
    }

    public static func load(data: Data, format: Model3DFormat, fileURL: URL? = nil) throws -> LoadedScene {
        let parsed: (scene: SCNScene, stats: Model3DStats)

        switch format {
        case .dxf:
            let result = try CADDXFParser.parse(data: data)
            parsed = (result.scene, result.stats)

        case .stl:
            let result = try STLParser.parse(data: data)
            parsed = (result.scene, result.stats)

        case .gltf, .glb:
            let result = try GLTFParser.parse(data: data)
            parsed = (result.scene, result.stats)

        case .usdz, .obj:
            if let fileURL, let nativeScene = try? SCNScene(url: fileURL, options: nil) {
                let stats = computeStats(for: nativeScene)
                parsed = (nativeScene, stats)
            } else if let fileURL, let mdlAsset = try? MDLAsset(url: fileURL) {
                #if canImport(SceneKit.ModelIO)
                let scene = SCNScene(mdlAsset: mdlAsset)
                let stats = computeStats(for: scene)
                parsed = (scene, stats)
                #else
                throw Worlds3DError.invalidData("ModelIO is unavailable to load \(format.rawValue)")
                #endif
            } else {
                // Fallback: write data to temporary file to load via SceneKit / ModelIO
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(format.rawValue)
                try data.write(to: tempURL)
                defer { try? FileManager.default.removeItem(at: tempURL) }
                if let scene = try? SCNScene(url: tempURL, options: nil) {
                    let stats = computeStats(for: scene)
                    parsed = (scene, stats)
                } else {
                    throw Worlds3DError.invalidData("Unable to load \(format.displayName)")
                }
            }
        }

        normalizeScene(parsed.scene, stats: parsed.stats)
        return LoadedScene(scene: parsed.scene, stats: parsed.stats, format: format)
    }

    /// Normalizes scene geometry: centers at origin, scales to standard viewing size, and configures studio lighting.
    public static func normalizeScene(_ scene: SCNScene, stats: Model3DStats) {
        let root = scene.rootNode

        // Find overall bounding box of content nodes
        var minVec = SCNVector3Zero
        var maxVec = SCNVector3Zero
        let hasBounds = root.getBoundingBoxMin(&minVec, max: &maxVec)
        let bMin = Vector3D(minVec)
        let bMax = Vector3D(maxVec)

        let center: Vector3D
        let maxDimension: Float
        if hasBounds && (bMax.x > bMin.x || bMax.y > bMin.y || bMax.z > bMin.z) {
            center = Vector3D(
                (bMin.x + bMax.x) / 2.0,
                (bMin.y + bMax.y) / 2.0,
                (bMin.z + bMax.z) / 2.0
            )
            maxDimension = max(max(bMax.x - bMin.x, bMax.y - bMin.y), bMax.z - bMin.z)
        } else {
            center = Vector3D(
                (stats.boundingBoxMin.x + stats.boundingBoxMax.x) / 2.0,
                (stats.boundingBoxMin.y + stats.boundingBoxMax.y) / 2.0,
                (stats.boundingBoxMin.z + stats.boundingBoxMax.z) / 2.0
            )
            let dims = stats.dimensions
            maxDimension = max(max(dims.x, dims.y), dims.z)
        }

        let targetSize: Float = 6.0
        let scaleFactor: Float = maxDimension > 0 ? (targetSize / maxDimension) : 1.0

        // Create container node for centering and scaling content
        let contentContainer = SCNNode()
        contentContainer.name = "content-container"

        let existingChildren = root.childNodes.filter { $0.light == nil && $0.camera == nil }
        for child in existingChildren {
            child.removeFromParentNode()
            contentContainer.addChildNode(child)
        }

        contentContainer.position = SCNVector3(-center.x * scaleFactor, -center.y * scaleFactor, -center.z * scaleFactor)
        contentContainer.scale = SCNVector3(scaleFactor, scaleFactor, scaleFactor)
        root.addChildNode(contentContainer)

        // Studio 3-Point Lighting Setup
        // 1. Ambient Light (fill shadows softly)
        let ambientLight = SCNLight()
        ambientLight.type = .ambient
        ambientLight.intensity = 380
        ambientLight.color = SCNColor(white: 0.95, alpha: 1.0)
        let ambientNode = SCNNode()
        ambientNode.name = "lighting-ambient"
        ambientNode.light = ambientLight
        root.addChildNode(ambientNode)

        // 2. Key Directional Light (front top right)
        let keyLight = SCNLight()
        keyLight.type = .directional
        keyLight.intensity = 950
        keyLight.color = SCNColor(red: 1.0, green: 0.98, blue: 0.94, alpha: 1.0)
        keyLight.castsShadow = true
        let keyNode = SCNNode()
        keyNode.name = "lighting-key"
        keyNode.light = keyLight
        keyNode.eulerAngles = SCNVector3(-Float.pi / 4.0, Float.pi / 5.0, 0)
        root.addChildNode(keyNode)

        // 3. Fill Directional Light (back lower left)
        let fillLight = SCNLight()
        fillLight.type = .directional
        fillLight.intensity = 420
        fillLight.color = SCNColor(red: 0.92, green: 0.95, blue: 1.0, alpha: 1.0)
        let fillNode = SCNNode()
        fillNode.name = "lighting-fill"
        fillNode.light = fillLight
        fillNode.eulerAngles = SCNVector3(Float.pi / 6.0, -Float.pi * 0.7, 0)
        root.addChildNode(fillNode)

        // Default Camera Node
        let camera = SCNCamera()
        camera.zNear = 0.1
        camera.zFar = 1000.0
        camera.fieldOfView = 50.0
        let cameraNode = SCNNode()
        cameraNode.name = "primary-camera"
        cameraNode.camera = camera
        cameraNode.position = SCNVector3(0, 0, 14)
        root.addChildNode(cameraNode)
    }

    /// Computes geometry statistics from any SCNScene.
    public static func computeStats(for scene: SCNScene) -> Model3DStats {
        var vertexCount = 0
        var faceCount = 0
        var lineCount = 0
        var nodeCount = 0

        var minX: Float = .greatestFiniteMagnitude
        var minY: Float = .greatestFiniteMagnitude
        var minZ: Float = .greatestFiniteMagnitude
        var maxX: Float = -.greatestFiniteMagnitude
        var maxY: Float = -.greatestFiniteMagnitude
        var maxZ: Float = -.greatestFiniteMagnitude

        scene.rootNode.enumerateHierarchy { node, _ in
            nodeCount += 1
            if let geom = node.geometry {
                for source in geom.sources where source.semantic == .vertex {
                    vertexCount += source.vectorCount
                }
                for element in geom.elements {
                    if element.primitiveType == .triangles {
                        faceCount += element.primitiveCount
                    } else if element.primitiveType == .line {
                        lineCount += element.primitiveCount
                    }
                }
                var nMin = SCNVector3Zero
                var nMax = SCNVector3Zero
                if node.getBoundingBoxMin(&nMin, max: &nMax) {
                    let bMin = Vector3D(nMin)
                    let bMax = Vector3D(nMax)
                    minX = min(minX, bMin.x); maxX = max(maxX, bMax.x)
                    minY = min(minY, bMin.y); maxY = max(maxY, bMax.y)
                    minZ = min(minZ, bMin.z); maxZ = max(maxZ, bMax.z)
                }
            }
        }

        if minX == .greatestFiniteMagnitude {
            minX = 0; maxX = 0; minY = 0; maxY = 0; minZ = 0; maxZ = 0
        }

        return Model3DStats(
            vertexCount: vertexCount,
            faceCount: faceCount,
            lineCount: lineCount,
            nodeCount: nodeCount,
            boundingBoxMin: SCNVector3(minX, minY, minZ),
            boundingBoxMax: SCNVector3(maxX, maxY, maxZ)
        )
    }
}
