import SwiftUI
import UniformTypeIdentifiers
import Darwin
import WorldsPersistence
import WorldsMedia
import WorldsMediaViews

/// The user must select the Worlds directory containing the currently open
/// database and its sibling attachments directory. This is not an ACL lease.
private final class VideoFolderLease {
    let root: URL
    private let scoped: Bool
    init(_ root: URL) { self.root = root; scoped = root.startAccessingSecurityScopedResource() }
    deinit { if scoped { root.stopAccessingSecurityScopedResource() } }
}

private struct VideoSelection {
    let lease: VideoFolderLease
    let attachment: WorldsAttachment
    let file: AttachmentFile
}

struct VideoDatabaseIdentity: Equatable {
    let device: dev_t
    let inode: ino_t

    static func read(_ url: URL) -> VideoDatabaseIdentity? {
        guard url.isFileURL else { return nil }
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return nil }
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { return nil }
        return VideoDatabaseIdentity(device: info.st_dev, inode: info.st_ino)
    }
}

struct PersonalVideoView: View {
    let databaseURL: URL
    let databaseIdentity: VideoDatabaseIdentity
    let pageID: String
    @Environment(\.dismiss) private var dismiss
    @State private var selection: VideoSelection?
    @State private var choosingFolder = false
    @State private var loading = false
    @State private var failure: String?

    var body: some View {
        Group {
            if let selection {
                OpenedVideoPreviewView(attachment: selection.attachment, openedFile: selection.file)
            } else {
                VStack(spacing: 16) {
                    ContentUnavailableView("Choose the Worlds folder", systemImage: "folder", description: Text("Choose the folder containing the open worlds.db and its attachments. The original video remains in that folder."))
                    if loading { ProgressView("Opening video") }
                    else { Button("Choose folder") { choosingFolder = true }.buttonStyle(.borderedProminent) }
                    if let failure { Text(failure).foregroundStyle(.secondary).textSelection(.enabled) }
                    Button("Close") { dismiss() }
                }.padding()
            }
        }
        .fileImporter(isPresented: $choosingFolder, allowedContentTypes: [.folder]) { result in
            switch result {
            case .success(let folder): Task { await open(folder) }
            case .failure(let error):
                if (error as NSError).code != NSUserCancelledError { failure = error.localizedDescription }
            }
        }
    }

    @MainActor private func open(_ folder: URL) async {
        guard !loading else { return }
        loading = true; failure = nil
        defer { loading = false }
        let lease = VideoFolderLease(folder)
        do {
            try Self.checkDatabase(folder: folder, selected: databaseURL, expected: databaseIdentity)
            let db = try WorldsDatabase(url: folder.appendingPathComponent("worlds.db"))
            guard let item = try await db.personalFileAttachment(pageID: pageID), item.mime.lowercased().hasPrefix("video/") else {
                throw VideoOpenError.notAuthorized
            }
            // Recheck the selected database after the asynchronous read.
            try Self.checkDatabase(folder: folder, selected: databaseURL, expected: databaseIdentity)
            let attachment = WorldsAttachment(id: item.id, pageId: item.pageID, kind: item.kind, fileName: item.fileName, mime: item.mime, size: item.size, relPath: item.relPath, width: item.width, height: item.height, createdAt: item.createdAt)
            let vault = try AttachmentVault(root: folder.appendingPathComponent("attachments", isDirectory: true))
            let file = try vault.open(attachment)
            // Re-check the page before handing off the already-open descriptor.
            guard try await db.personalFileAttachment(pageID: pageID) == item else { throw VideoOpenError.notAuthorized }
            try Self.checkDatabase(folder: folder, selected: databaseURL, expected: databaseIdentity)
            selection = VideoSelection(lease: lease, attachment: attachment, file: file)
        } catch { failure = error.localizedDescription }
    }

    private static func checkDatabase(folder: URL, selected: URL, expected: VideoDatabaseIdentity) throws {
        guard folder.isFileURL, selected.isFileURL else { throw VideoOpenError.wrongFolder }
        let directory = Darwin.open(folder.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw VideoOpenError.wrongFolder }
        defer { Darwin.close(directory) }
        let candidate = Darwin.openat(directory, "worlds.db", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard candidate >= 0 else { throw VideoOpenError.wrongFolder }
        defer { Darwin.close(candidate) }
        let original = Darwin.open(selected.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard original >= 0 else { throw VideoOpenError.wrongFolder }
        defer { Darwin.close(original) }
        var left = stat(), right = stat()
        guard fstat(candidate, &left) == 0, fstat(original, &right) == 0,
              (left.st_mode & S_IFMT) == S_IFREG, (right.st_mode & S_IFMT) == S_IFREG,
              left.st_dev == right.st_dev, left.st_ino == right.st_ino,
              left.st_dev == expected.device, left.st_ino == expected.inode else { throw VideoOpenError.wrongFolder }
    }
}

private enum VideoOpenError: LocalizedError {
    case wrongFolder, notAuthorized
    var errorDescription: String? {
        switch self {
        case .wrongFolder: return "This folder does not contain the open Worlds database."
        case .notAuthorized: return "The personal video is unavailable or its attachment does not match this page."
        }
    }
}
