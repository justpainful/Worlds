import Foundation
import ZIPFoundation
import WorldsMedia

public enum OfficePreviewError: Error, LocalizedError, Equatable {
    case invalidArchive, invalidPath, duplicateEntry, archiveLimit, invalidXML, missingPart(String), unsupportedFormat, invalidDocument
    public var errorDescription: String? {
        switch self {
        case .invalidArchive: return "The Office archive is damaged or unsupported."
        case .invalidPath: return "The Office archive contains an unsafe path."
        case .duplicateEntry: return "The Office archive contains duplicate entries."
        case .archiveLimit: return "The Office archive exceeds preview limits."
        case .invalidXML: return "The Office document contains unsafe or invalid XML."
        case .missingPart(let part): return "The Office document is missing \(part)."
        case .unsupportedFormat: return "The Office format is not supported."
        case .invalidDocument: return "The Office document is invalid."
        }
    }
}
public struct OfficeLimits: Sendable {
    public var archiveBytes = 64 * 1024 * 1024
    public var entryBytes = 16 * 1024 * 1024
    public var totalBytes = 64 * 1024 * 1024
    public var entryCount = 4096
    public var xmlDepth = 128
    public var xmlElements = 500_000
    public init() {}
}

/// Keeps the ZIP in memory, never extracts to the filesystem and only reads
/// explicitly selected OOXML parts. Both declared and actual output are capped.
final class OfficeArchive {
    private let archive: Archive
    private let entries: [String: Entry]
    private let limits: OfficeLimits
    private var extracted = 0
    init(data: Data, limits: OfficeLimits) throws {
        guard limits.archiveBytes > 0, limits.entryBytes > 0, limits.totalBytes > 0, limits.entryCount > 0,
              data.count <= limits.archiveBytes else { throw OfficePreviewError.archiveLimit }
        let archiveValue: Archive
        do { archiveValue = try Archive(data: data, accessMode: .read) } catch { throw OfficePreviewError.invalidArchive }
        var seen: Set<String> = [], files: [String: Entry] = [:]
        var count = 0, declared: UInt64 = 0
        for entry in archiveValue {
            count += 1
            guard count <= limits.entryCount, entry.type != .symlink else { throw OfficePreviewError.archiveLimit }
            let raw = entry.path
            let path = raw.hasSuffix("/") ? String(raw.dropLast()) : raw
            guard validArchivePath(path) else { throw OfficePreviewError.invalidPath }
            let key = path.precomposedStringWithCanonicalMapping.lowercased()
            guard seen.insert(key).inserted else { throw OfficePreviewError.duplicateEntry }
            guard entry.uncompressedSize <= UInt64(limits.entryBytes),
                  entry.uncompressedSize / max(1, entry.compressedSize) <= 2000 else { throw OfficePreviewError.archiveLimit }
            let (sum, overflow) = declared.addingReportingOverflow(entry.uncompressedSize)
            guard !overflow, sum <= UInt64(limits.totalBytes) else { throw OfficePreviewError.archiveLimit }
            declared = sum
            if entry.type == .file { files[path] = entry }
        }
        self.archive = archiveValue
        self.limits = limits
        self.entries = files
    }
    func data(for path: String) throws -> Data {
        guard validArchivePath(path) else { throw OfficePreviewError.invalidPath }
        guard let entry = entries[path] else { throw OfficePreviewError.missingPart(path) }
        var result = Data()
        let checksum: UInt32
        do {
            checksum = try archive.extract(entry, bufferSize: 16 * 1024, skipCRC32: false) { chunk in
                guard chunk.count <= self.limits.entryBytes - result.count,
                      chunk.count <= self.limits.totalBytes - self.extracted else { throw OfficePreviewError.archiveLimit }
                result.append(chunk)
                self.extracted += chunk.count
            }
        } catch let error as OfficePreviewError { throw error }
        catch { throw OfficePreviewError.invalidArchive }
        guard UInt64(result.count) == entry.uncompressedSize, checksum == entry.checksum else { throw OfficePreviewError.invalidArchive }
        return result
    }
    func has(_ path: String) -> Bool { entries[path] != nil }
}
func validArchivePath(_ path: String) -> Bool {
    guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains(":"),
          !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return false }
    return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
}


