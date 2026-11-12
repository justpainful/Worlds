import Foundation
import WorldsLocalImport

/// Where the native editors save. The person's own workspace database is
/// written in place through RustStore, with the same revision checks, single
/// transaction per change and history rows as an independent local copy.
public struct WorkspaceWriteTarget: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        /// The database the person opened: their real Worlds workspace.
        case ownWorkspace
        /// An independent copy in the app's private container.
        case localCopy
    }

    public let kind: Kind
    public let databaseURL: URL
    /// Identifies this editing session. For a local copy it is the copy ID,
    /// which survives a restart; for the own workspace it is new on every open.
    public let id: UUID
    /// Present only for `.localCopy`.
    public let independentCopy: LocalProjectCopy?

    private init(kind: Kind, databaseURL: URL, id: UUID, independentCopy: LocalProjectCopy?) {
        self.kind = kind
        self.databaseURL = databaseURL
        self.id = id
        self.independentCopy = independentCopy
    }

    public static func localCopy(_ copy: LocalProjectCopy) -> WorkspaceWriteTarget {
        WorkspaceWriteTarget(kind: .localCopy, databaseURL: copy.databaseURL, id: copy.id, independentCopy: copy)
    }

    /// Use only for a database that `WorkspaceWritePreflight.evaluate` found writable.
    public static func ownWorkspace(databaseURL: URL, id: UUID = UUID()) -> WorkspaceWriteTarget {
        WorkspaceWriteTarget(kind: .ownWorkspace, databaseURL: databaseURL, id: id, independentCopy: nil)
    }

    public var isLocalCopy: Bool { kind == .localCopy }

    /// Gallery file import copies files into the private copy directory; the
    /// original attachments directory has no checked import path yet.
    public var supportsGalleryFileImport: Bool { kind == .localCopy }

    /// The own workspace has no checked permanent deletion yet (see
    /// Apple/RustStore/TRASH_CONFIRMATION_DESIGN.md); it uses the store's
    /// Trash and restore instead, which the desktop can also undo.
    public var supportsPermanentDeletion: Bool { kind == .localCopy }

    /// Moving to Trash and restoring go through RustStore for the own
    /// workspace. A local copy keeps its earlier archive based Trash.
    public var usesStoreTrash: Bool { kind == .ownWorkspace }

    /// Chooses the writer for a database that was just opened for reading.
    /// - The active local copy keeps writing to itself.
    /// - Files inside the application bundle (test fixtures) stay read only.
    /// - Any other database is written in place only when the preflight found it writable.
    public static func route(openedDatabase url: URL, access: WorkspaceWriteAccess, activeCopy: LocalProjectCopy?, bundleURL: URL?) -> WorkspaceWriteTarget? {
        let opened = url.standardizedFileURL
        if let activeCopy, activeCopy.databaseURL.standardizedFileURL == opened { return .localCopy(activeCopy) }
        if let bundleURL {
            let bundle = bundleURL.standardizedFileURL.path
            let prefix = bundle.hasSuffix("/") ? bundle : bundle + "/"
            if opened.path.hasPrefix(prefix) { return nil }
        }
        guard access == .writable else { return nil }
        return .ownWorkspace(databaseURL: url)
    }

    public static func == (lhs: WorkspaceWriteTarget, rhs: WorkspaceWriteTarget) -> Bool {
        lhs.kind == rhs.kind && lhs.id == rhs.id && lhs.databaseURL.standardizedFileURL == rhs.databaseURL.standardizedFileURL
    }
}

/// Keeps security scoped access to the own workspace database while it is the
/// active write target, so every RustStore call and every refresh can reach it.
public final class WorkspaceAccessLease: Sendable {
    public let url: URL
    private let scoped: Bool
    public init(url: URL) {
        self.url = url
        scoped = url.startAccessingSecurityScopedResource()
    }
    deinit { if scoped { url.stopAccessingSecurityScopedResource() } }
}
