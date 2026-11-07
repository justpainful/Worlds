import Foundation
import Darwin

/// Matches the camelCase attachment fields returned by the Rust store.
public struct WorldsAttachment: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public let pageId: String?
    public let kind: String
    public let fileName: String
    public let mime: String
    public let size: Int64
    public let relPath: String
    public let width: Int64?
    public let height: Int64?
    public let createdAt: Int64
    public init(id: String, pageId: String?, kind: String, fileName: String, mime: String, size: Int64, relPath: String, width: Int64?, height: Int64?, createdAt: Int64) {
        self.id = id; self.pageId = pageId; self.kind = kind; self.fileName = fileName; self.mime = mime; self.size = size
        self.relPath = relPath; self.width = width; self.height = height; self.createdAt = createdAt
    }
}

public enum MediaError: Error, LocalizedError {
    case invalidRoot, invalidPath, inaccessible, notAFile, tooLarge, invalidContent, unsupported
    public var errorDescription: String? {
        switch self {
        case .invalidRoot: return "The attachment folder is unavailable."
        case .invalidPath: return "The attachment path is invalid."
        case .inaccessible: return "The attachment cannot be opened."
        case .notAFile: return "The attachment is not a regular file."
        case .tooLarge: return "The attachment is too large to preview."
        case .invalidContent: return "The attachment is damaged or its content is unsupported."
        case .unsupported: return "This file type is not supported by this preview."
        }
    }
}

/// Holds the security scope and an already verified file descriptor.
/// It must remain alive for the entire read. Do not share across threads.
public final class AttachmentFile {
    private let root: URL
    private let scoped: Bool
    private let file: FileHandle
    public let size: Int64
    fileprivate init(root: URL, scoped: Bool, descriptor: Int32, size: Int64) {
        self.root = root; self.scoped = scoped; self.file = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true); self.size = size
    }
    deinit { try? file.close(); if scoped { root.stopAccessingSecurityScopedResource() } }

    /// Copies verified bytes to a private temporary directory for AVFoundation.
    /// The returned lease must outlive playback.
    public func playbackCopy(fileExtension: String) throws -> TemporaryMediaFile {
        guard size >= 0, size <= 512 * 1024 * 1024 else { throw MediaError.tooLarge }
        let safeExtension = fileExtension.lowercased()
        guard safeExtension.count <= 10, safeExtension.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789").contains($0) }) else { throw MediaError.invalidPath }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let destination = directory.appendingPathComponent(safeExtension.isEmpty ? "media" : "media.\(safeExtension)")
        do {
            guard FileManager.default.createFile(atPath: destination.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MediaError.inaccessible }
            let output = try FileHandle(forWritingTo: destination)
            defer { try? output.close() }
            try file.seek(toOffset: 0)
            var written: Int64 = 0
            while let chunk = try file.read(upToCount: 65536), !chunk.isEmpty {
                written += Int64(chunk.count)
                guard written <= 512 * 1024 * 1024 else { throw MediaError.tooLarge }
                try output.write(contentsOf: chunk)
            }
            return TemporaryMediaFile(url: destination, directory: directory)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }
    public func read(maxBytes: Int = 64 * 1024 * 1024) throws -> Data {
        guard maxBytes >= 0, maxBytes <= 1024 * 1024 * 1024, size >= 0, size <= Int64(maxBytes) else { throw MediaError.tooLarge }
        try file.seek(toOffset: 0)
        var data = Data()
        while true {
            let remaining = maxBytes - data.count
            let chunk = try file.read(upToCount: min(65536, remaining + 1)) ?? Data()
            if chunk.isEmpty { return data }
            guard chunk.count <= remaining else { throw MediaError.tooLarge }
            data.append(chunk)
        }
    }
}

public struct AttachmentVault {
    public let root: URL
    public init(root: URL) throws {
        guard root.isFileURL, !root.path.isEmpty else { throw MediaError.invalidRoot }
        self.root = root
    }
    public func open(_ attachment: WorldsAttachment, maxSize: Int64 = 1024 * 1024 * 1024) throws -> AttachmentFile {
        guard maxSize >= 0, maxSize <= 1024 * 1024 * 1024 else { throw MediaError.tooLarge }
        let path = attachment.relPath
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains(":"), !path.utf8.contains(0) else { throw MediaError.invalidPath }
        let components = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw MediaError.invalidPath }
        let scoped = root.startAccessingSecurityScopedResource()
        var fd = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { if scoped { root.stopAccessingSecurityScopedResource() }; throw MediaError.invalidRoot }
        do {
            for (index, component) in components.enumerated() {
                let flags = O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC | (index < components.count - 1 ? O_DIRECTORY : 0)
                let next = component.withCString { Darwin.openat(fd, $0, flags) }
                guard next >= 0 else { throw MediaError.inaccessible }
                Darwin.close(fd); fd = next
            }
            var statInfo = stat()
            guard fstat(fd, &statInfo) == 0, (statInfo.st_mode & S_IFMT) == S_IFREG else { throw MediaError.notAFile }
            guard statInfo.st_size >= 0, statInfo.st_size <= maxSize else { throw MediaError.tooLarge }
            return AttachmentFile(root: root, scoped: scoped, descriptor: fd, size: statInfo.st_size)
        } catch {
            Darwin.close(fd)
            if scoped { root.stopAccessingSecurityScopedResource() }
            throw error
        }
    }
}


/// Owns a private playback copy and deletes it when released.
public final class TemporaryMediaFile {
    public let url: URL
    private let directory: URL
    fileprivate init(url: URL, directory: URL) { self.url = url; self.directory = directory }
    deinit { try? FileManager.default.removeItem(at: directory) }
}

