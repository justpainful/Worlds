import Foundation
import ZIPFoundation
import WorldsModels

public enum DrawingPackageExportError: Error, LocalizedError, Equatable {
    case archiveCreationFailed
    case sceneEncodingFailed
    case assetWriteFailed(String)
    case destinationUnavailable
    case invalidPackageFormat

    public var errorDescription: String? {
        switch self {
        case .archiveCreationFailed: return "Could not initialize the .worldsdraw ZIP archive."
        case .sceneEncodingFailed: return "Could not encode the drawing scene JSON."
        case .assetWriteFailed(let name): return "Could not package drawing asset: \(name)."
        case .destinationUnavailable: return "The target file path is unavailable."
        case .invalidPackageFormat: return "The drawing package format is invalid or unsupported."
        }
    }
}

/// Packages a Schema 1 drawing scene, manifest, assets and optional preview into a
/// standard .worldsdraw ZIP container compatible with Desktop and Cross-Platform Worlds.
public enum DrawingPackageExporter {
    public static func exportPackage(
        scene: DrawingScene,
        assets: [String: Data] = [:],
        preview: Data? = nil
    ) throws -> Data {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("export-\(UUID().uuidString).worldsdraw")
        defer { try? FileManager.default.removeItem(at: tempURL) }
        try exportPackage(scene: scene, assets: assets, preview: preview, to: tempURL)
        return try Data(contentsOf: tempURL)
    }

    public static func exportPackage(
        scene: DrawingScene,
        assets: [String: Data] = [:],
        preview: Data? = nil,
        to destinationURL: URL
    ) throws {
        guard let archive = Archive(url: destinationURL, accessMode: .create) else {
            throw DrawingPackageExportError.archiveCreationFailed
        }

        // 1. Manifest
        let manifest: [String: Any] = [
            "format": "worldsdraw",
            "version": 1,
            "schemaVersion": 1,
            "generator": "Worlds Native Apple",
            "createdAt": Int64(Date().timeIntervalSince1970 * 1000)
        ]
        let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys, .prettyPrinted])
        try addFile(archive: archive, path: "manifest.json", data: manifestData)

        // 2. Scene JSON
        guard let sceneData = try? scene.json() else {
            throw DrawingPackageExportError.sceneEncodingFailed
        }
        try addFile(archive: archive, path: "scene.json", data: sceneData)

        // 3. Assets directory
        for (assetPath, assetData) in assets {
            let relativePath = assetPath.hasPrefix("assets/") ? assetPath : "assets/\(assetPath)"
            do {
                try addFile(archive: archive, path: relativePath, data: assetData)
            } catch {
                throw DrawingPackageExportError.assetWriteFailed(assetPath)
            }
        }

        // 4. Preview image
        if let preview {
            try addFile(archive: archive, path: "preview.png", data: preview)
        }
    }

    /// Universal importer accepting both standard PKZIP (.worldsdraw) and Desktop/Android WORLDSDRAW1\n containers.
    public static func importPackageSceneJSON(from data: Data) throws -> Data {
        let pkHeader = Data([0x50, 0x4B, 0x03, 0x04])
        let legacyHeader = Data("WORLDSDRAW1\n".utf8)
        if data.prefix(4) == pkHeader {
            guard let archive = Archive(data: data, accessMode: .read),
                  let entry = archive["scene.json"] else {
                throw DrawingPackageExportError.invalidPackageFormat
            }
            var extracted = Data()
            _ = try archive.extract(entry) { chunk in
                extracted.append(chunk)
            }
            return extracted
        } else if data.prefix(legacyHeader.count) == legacyHeader {
            let compressed = data.dropFirst(legacyHeader.count)
            let decompressed = try (compressed as NSData).decompressed(using: .zlib) as Data
            return decompressed
        }
        throw DrawingPackageExportError.invalidPackageFormat
    }

    private static func addFile(archive: Archive, path: String, data: Data) throws {
        try archive.addEntry(
            with: path,
            type: .file,
            uncompressedSize: Int64(data.count),
            modificationDate: Date(),
            permissions: 0o644,
            compressionMethod: .deflate
        ) { position, size -> Data in
            let start = Int(position)
            let end = min(start + size, data.count)
            return data.subdata(in: start..<end)
        }
    }
}
