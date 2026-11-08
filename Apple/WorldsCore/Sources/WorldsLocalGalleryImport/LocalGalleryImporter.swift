import Foundation
import WorldsLocalImport
import WorldsModels
import WorldsNativeWrites

/// Experimental independent-copy import. The copy must originate from
/// LocalProjectImportCoordinator; this does not modify or sync its source.
public actor LocalGalleryImporter {
    private let store: NativePersonalStore
    public init(copy: LocalProjectCopy) throws { store = try NativePersonalStore(url: copy.databaseURL) }
    /// Keep the same operation ID and identical inputs when retrying a response
    /// whose outcome was uncertain. Reload the gallery after a successful retry.
    /// The underlying write cannot be interrupted after it has begun.
    public func importFile(source: URL, galleryID: String, base: Int64, metadata: JSONValue, expected: [NativeBlockInput], operationID: UUID) async throws -> JSONValue {
        try Task.checkCancellation()
        return try await store.importLocalGalleryFile(id: galleryID, base: base, metadata: metadata, expected: expected, source: source, operationID: operationID)
    }
}
