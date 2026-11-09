import Foundation
import SceneKit

/// Supported 3D and CAD file formats in Worlds.
public enum Model3DFormat: String, Sendable, CaseIterable {
    case usdz
    case obj
    case stl
    case gltf
    case glb
    case dxf

    public var displayName: String {
        switch self {
        case .usdz: return "Universal Scene Description (USDZ)"
        case .obj: return "Wavefront OBJ"
        case .stl: return "Stereolithography (STL)"
        case .gltf: return "glTF 2.0"
        case .glb: return "Binary glTF (GLB)"
        case .dxf: return "AutoCAD DXF"
        }
    }

    public var isCAD: Bool {
        self == .dxf || self == .stl
    }

    public var defaultRenderMode: Model3DRenderMode {
        switch self {
        case .dxf: return .wireframe
        case .stl: return .shadedWireframe
        default: return .shaded
        }
    }
}

/// Shading and rendering mode for 3D and CAD views.
public enum Model3DRenderMode: String, Sendable, CaseIterable, Identifiable {
    case shaded = "Shaded"
    case wireframe = "Wireframe"
    case shadedWireframe = "Shaded + Wireframe"

    public var id: String { rawValue }

    public var iconName: String {
        switch self {
        case .shaded: return "cube.fill"
        case .wireframe: return "cube.transparent"
        case .shadedWireframe: return "cube.transparent.fill"
        }
    }
}

/// Camera presets for quick alignment of CAD and 3D scenes.
public enum Model3DCameraPreset: String, Sendable, CaseIterable, Identifiable {
    case isometric = "Isometric"
    case front = "Front"
    case top = "Top"
    case side = "Side"

    public var id: String { rawValue }

    public var iconName: String {
        switch self {
        case .isometric: return "view.3d"
        case .front: return "square"
        case .top: return "square.topthird.inset.filled"
        case .side: return "square.trailinghalf.filled"
        }
    }
}

/// Calculated geometry statistics for CAD and 3D inspection.
public struct Model3DStats: Sendable, Equatable {
    public let vertexCount: Int
    public let faceCount: Int
    public let lineCount: Int
    public let nodeCount: Int
    public let boundingBoxMin: SCNVector3
    public let boundingBoxMax: SCNVector3

    public var dimensions: SCNVector3 {
        SCNVector3(
            x: abs(boundingBoxMax.x - boundingBoxMin.x),
            y: abs(boundingBoxMax.y - boundingBoxMin.y),
            z: abs(boundingBoxMax.z - boundingBoxMin.z)
        )
    }

    public var formattedDimensions: String {
        String(format: "%.1f × %.1f × %.1f mm", dimensions.x, dimensions.y, dimensions.z)
    }

    public static let zero = Model3DStats(
        vertexCount: 0,
        faceCount: 0,
        lineCount: 0,
        nodeCount: 0,
        boundingBoxMin: SCNVector3Zero,
        boundingBoxMax: SCNVector3Zero
    )
}

/// Errors occurring during 3D/CAD parsing and scene generation.
public enum Worlds3DError: LocalizedError, Sendable, Equatable {
    case unsupportedFormat(String)
    case invalidData(String)
    case emptyScene
    case fileNotFound(String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedFormat(let ext):
            return "The 3D file format '.\(ext)' is not supported. Supported formats: .usdz, .obj, .stl, .gltf, .glb, .dxf."
        case .invalidData(let reason):
            return "Unable to parse 3D/CAD model: \(reason)"
        case .emptyScene:
            return "The 3D model contains no visible geometry or entities."
        case .fileNotFound(let path):
            return "The 3D model file could not be found at: \(path)"
        }
    }
}

/// Helper methods to detect and classify 3D and CAD files.
public enum Worlds3D {
    private static let supportedExtensions: Set<String> = [
        "usdz", "obj", "stl", "gltf", "glb", "dxf"
    ]

    public static func isSupported(name: String) -> Bool {
        let ext = (name as NSString).pathExtension.lowercased()
        return supportedExtensions.contains(ext)
    }

    public static func format(name: String) -> Model3DFormat? {
        let ext = (name as NSString).pathExtension.lowercased()
        return Model3DFormat(rawValue: ext)
    }
}
