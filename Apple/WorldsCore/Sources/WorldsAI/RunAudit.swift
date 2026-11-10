import Foundation
#if os(macOS)
import Darwin

/// A caller-selected private local audit file. Stores lifecycle metadata only;
/// it is not the original Worlds conversation database.
public actor JSONLineRunAudit: RunAuditSink {
    private let url: URL
    public init(url: URL) throws {
        guard url.isFileURL, !url.path.isEmpty else { throw ClaudeError.auditUnavailable }
        self.url = url
    }
    public func record(_ event: RunAuditEvent) async throws {
        let fd = Darwin.open(url.path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw ClaudeError.auditUnavailable }
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw ClaudeError.auditUnavailable }
        var data = try JSONEncoder().encode(event); data.append(10)
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        try handle.write(contentsOf: data)
        guard fsync(fd) == 0 else { throw ClaudeError.auditUnavailable }
    }
}
#endif
