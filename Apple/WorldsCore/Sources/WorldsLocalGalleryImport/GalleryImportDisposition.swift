import Foundation
import WorldsNativeWrites

/// A confirmed commit with uncertain cleanup or identity must never trigger
/// a refresh through the old path or offer a duplicate import.
public enum GalleryImportDisposition: Equatable, Sendable {
    case saved, committedCleanupPending, cancelled, unconfirmed

    public var completed: Bool { self == .saved || self == .committedCleanupPending }
    public var retryRequired: Bool { self == .unconfirmed }
    public var message: String? {
        switch self {
        case .saved: nil
        case .committedCleanupPending: "The file was saved in the copy open during import. Cleanup or identity verification is pending. Close this view and reopen the local copy before checking it."
        case .cancelled: "Import cancelled."
        case .unconfirmed: "The import result could not be confirmed. Retry this file or close and reopen the gallery."
        }
    }
    public static func resolve(error: Error?) -> Self {
        guard let error else { return .saved }
        if error is CancellationError { return .cancelled }
        if let writeError = error as? NativeWriteError, case .galleryCommittedCleanupPending = writeError { return .committedCleanupPending }
        return .unconfirmed
    }
    @MainActor public func notifyIfSafe(_ onSaved: @MainActor () -> Void) {
        if self == .saved { onSaved() }
    }
}
