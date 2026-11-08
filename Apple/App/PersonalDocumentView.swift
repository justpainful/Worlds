#if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_DOCUMENT
import SwiftUI
import UniformTypeIdentifiers
import Darwin
import WorldsPersistence
import WorldsMedia
import WorldsMediaViews

private final class DocumentFolderLease {
    let root: URL
    private let scoped: Bool
    init(_ root: URL) { self.root = root; scoped = root.startAccessingSecurityScopedResource() }
    deinit { if scoped { root.stopAccessingSecurityScopedResource() } }
}
private struct DocumentSelection {
    let lease: DocumentFolderLease
    let attachment: WorldsAttachment
    let file: AttachmentFile
}

/// Experimental read-only route for an existing personal file page. The copy
/// created by the ordinary local importer does not contain attachments.
struct PersonalDocumentView: View {
    let databaseURL: URL
    let databaseIdentity: VideoDatabaseIdentity
    let pageID: String
    @Environment(\.dismiss) private var dismiss
    @State private var selection: DocumentSelection?
    @State private var choosingFolder = false
    @State private var loading = false
    @State private var failure: String?
    @State private var generation = UUID()

    var body: some View {
        Group {
            if let selection {
                OpenedDocumentPreviewView(attachment: selection.attachment, openedFile: selection.file)
            } else {
                VStack(spacing: 16) {
                    ContentUnavailableView("Choose the Worlds folder", systemImage: "folder", description: Text("Choose the folder containing the open worlds.db and its attachments."))
                    if loading { ProgressView("Opening file") }
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
                if (error as NSError).code != NSUserCancelledError { failure = "The folder could not be opened." }
            }
        }
        .onDisappear { generation = UUID(); selection = nil }
    }
    @MainActor private func open(_ folder: URL) async {
        guard !loading else { return }
        loading = true; failure = nil
        let token = generation
        defer { if token == generation { loading = false } }
        let lease = DocumentFolderLease(folder)
        do {
            try Self.checkDatabase(folder: folder, selected: databaseURL, expected: databaseIdentity)
            let db = try WorldsDatabase(url: folder.appendingPathComponent("worlds.db"))
            guard let item = try await db.personalFileAttachment(pageID: pageID) else { throw DocumentOpenError.unavailable }
            guard token == generation else { return }
            let kind = WorldsMedia.format(name: item.fileName, mime: item.mime)
            guard kind == .image || kind == .pdf else { throw DocumentOpenError.unsupported }
            try Self.checkDatabase(folder: folder, selected: databaseURL, expected: databaseIdentity)
            let attachment = WorldsAttachment(id: item.id, pageId: item.pageID, kind: item.kind, fileName: item.fileName, mime: item.mime, size: item.size, relPath: item.relPath, width: item.width, height: item.height, createdAt: item.createdAt)
            let file = try AttachmentVault(root: folder.appendingPathComponent("attachments", isDirectory: true)).open(attachment)
            guard file.size == item.size else { throw DocumentOpenError.unavailable }
            guard try await db.personalFileAttachment(pageID: pageID) == item else { throw DocumentOpenError.unavailable }
            guard token == generation else { return }
            try Self.checkDatabase(folder: folder, selected: databaseURL, expected: databaseIdentity)
            selection = DocumentSelection(lease: lease, attachment: attachment, file: file)
        } catch {
            guard token == generation else { return }
            failure = (error as? DocumentOpenError)?.localizedDescription ?? "The file could not be opened."
        }
    }
    private static func checkDatabase(folder: URL, selected: URL, expected: VideoDatabaseIdentity) throws {
        guard folder.isFileURL, selected.isFileURL else { throw DocumentOpenError.wrongFolder }
        let directory = Darwin.open(folder.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw DocumentOpenError.wrongFolder }
        defer { Darwin.close(directory) }
        let candidate = Darwin.openat(directory, "worlds.db", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard candidate >= 0 else { throw DocumentOpenError.wrongFolder }
        defer { Darwin.close(candidate) }
        let original = Darwin.open(selected.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard original >= 0 else { throw DocumentOpenError.wrongFolder }
        defer { Darwin.close(original) }
        var a = stat(), b = stat()
        guard fstat(candidate, &a) == 0, fstat(original, &b) == 0,
              (a.st_mode & S_IFMT) == S_IFREG, (b.st_mode & S_IFMT) == S_IFREG,
              a.st_dev == b.st_dev, a.st_ino == b.st_ino,
              a.st_dev == expected.device, a.st_ino == expected.inode else { throw DocumentOpenError.wrongFolder }
    }
    private enum DocumentOpenError: LocalizedError {
        case wrongFolder, unavailable, unsupported
        var errorDescription: String? {
            switch self {
            case .wrongFolder: "This folder does not contain the open Worlds database."
            case .unavailable: "This personal attachment is unavailable or changed."
            case .unsupported: "This preview supports images and PDF files only."
            }
        }
    }
}
#endif
