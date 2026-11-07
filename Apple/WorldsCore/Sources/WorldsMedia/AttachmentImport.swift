import Foundation
import Darwin

/// An isolated, bounded copy of a selected file. This is not an attachment
/// until an authorized database and attachment-store operation commits it.
public final class StagedAttachment {
    public let url: URL
    public let fileName: String
    public let size: Int64
    private let directory: URL

    fileprivate init(url: URL, fileName: String, size: Int64, directory: URL) {
        self.url = url; self.fileName = fileName; self.size = size; self.directory = directory
    }
    deinit { try? FileManager.default.removeItem(at: directory) }
}

public enum AttachmentImport {
    public static let maximumBytes: Int64 = 1024 * 1024 * 1024

    /// Matches the original Rust display-name sanitization for Unicode scalars.
    public static func cleanFileName(_ raw: String) -> String {
        let base = raw.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? raw
        let reserved = CharacterSet(charactersIn: "<>:\"|?*")
        let clean = String(String.UnicodeScalarView(base.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) && !reserved.contains($0) }))
        let whitespace = CharacterSet.whitespacesAndNewlines
        let trimmed = clean.trimmingCharacters(in: whitespace).trimmingCharacters(in: CharacterSet(charactersIn: ".")).trimmingCharacters(in: whitespace)
        let result = String(String.UnicodeScalarView(trimmed.unicodeScalars.prefix(180)))
        return result.isEmpty ? "file" : result
    }

    /// Stages bytes into a private temporary directory while holding the source
    /// security scope. No symlinks, directories, oversized streams or overwrite.
    public static func stage(source: URL, maxBytes: Int64 = maximumBytes) throws -> StagedAttachment {
        guard source.isFileURL else { throw MediaError.invalidPath }
        guard maxBytes >= 0 && maxBytes <= maximumBytes else { throw MediaError.tooLarge }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let fd = Darwin.open(source.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw MediaError.inaccessible }
        let input = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        defer { try? input.close() }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw MediaError.notAFile }
        guard info.st_size >= 0 && info.st_size <= maxBytes else { throw MediaError.tooLarge }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let destination = directory.appendingPathComponent("attachment")
        do {
            let outfd = Darwin.open(destination.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard outfd >= 0 else { throw MediaError.inaccessible }
            let output = FileHandle(fileDescriptor: outfd, closeOnDealloc: true)
            defer { try? output.close() }
            var copied: Int64 = 0
            while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
                guard Int64(chunk.count) <= maxBytes - copied else { throw MediaError.tooLarge }
                copied += Int64(chunk.count)
                try output.write(contentsOf: chunk)
            }
            return StagedAttachment(url: destination, fileName: cleanFileName(source.lastPathComponent), size: copied, directory: directory)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }
}
