import Foundation
import XCTest
import WorldsModels
@testable import WorldsGallery

private actor GalleryFixtureRepository: GalleryRepository {
    private var snapshot: GallerySnapshot
    private let accessible: Set<String>
    private let originals: Set<String>
    init(snapshot: GallerySnapshot, accessible: Set<String>) { self.snapshot = snapshot; self.accessible = accessible; self.originals = accessible }
    func readAuthorizedGallery(id: String) async throws -> GallerySnapshot {
        guard id == snapshot.id else { throw GalleryError.permissionDenied }; return snapshot
    }
    func commitAuthorizedGallery(id: String, expectedRevision: Int64, blocks: [JSONValue], metadata: JSONValue, attachmentIDs: [String]) async throws -> GallerySnapshot {
        guard id == snapshot.id, Set(attachmentIDs).isSubset(of: accessible) else { throw GalleryError.permissionDenied }
        guard snapshot.revision == expectedRevision else { throw GalleryError.conflict }
        snapshot = GallerySnapshot(id: id, kind: snapshot.kind, revision: snapshot.revision + 1, blocks: blocks, metadata: metadata)
        return snapshot
    }
    func originalAttachments() -> Set<String> { originals }
}

final class WorldsGalleryTests: XCTestCase {
    private func galleryBlock(_ id: String, attachment: String, name: String, mime: String) -> JSONValue {
        .object(["id": .string(id), "extra": .string("kept"), "content": .object(["type": .string("galleryItem"), "attrs": .object(["bid": .string(id), "attachmentId": .string(attachment), "name": .string(name), "mime": .string(mime), "size": .integer(123), "kind": .string("file"), "caption": .string(""), "future": .bool(true)])])])
    }
    private func fixture() throws -> GalleryDocument {
        let image = galleryBlock("a", attachment: "img", name: "one.png", mime: "image/png")
        let other = JSONValue.object(["id": .string("opaque"), "content": .object(["type": .string("futureBlock"), "attrs": .object(["keep": .integer(1)])])])
        let video = galleryBlock("b", attachment: "vid", name: "two.mp4", mime: "video/mp4")
        let audio = galleryBlock("c", attachment: "aud", name: "three.mp3", mime: "audio/mpeg")
        return try GalleryDocument(blocks: [image, other, video, audio], metadata: .object(["gallery": .object(["view": .string("grid"), "future": .bool(true)]), "other": .string("keep")]))
    }
    func testRoundTripPreservesUnknownBlocksAndFields() throws {
        let document = try fixture()
        let encoded = try JSONEncoder().encode(document.blocks)
        XCTAssertEqual(try JSONDecoder().decode([JSONValue].self, from: encoded), document.blocks)
        XCTAssertEqual(document.items.map(\.attachmentID), ["img", "vid", "aud"])
        XCTAssertEqual(document.items.filter(\.appearsInLightbox).map(\.id), ["a", "b"])
        XCTAssertEqual(try document.iconValue(itemID: "a"), "img:img")
        XCTAssertThrowsError(try document.iconValue(itemID: "b"))
    }
    func testReorderRemoveAndCaptionPreserveOpaqueBlock() throws {
        var document = try fixture()
        let opaque = document.blocks[1]
        try document.move(from: 0, to: 2)
        XCTAssertEqual(document.items.map(\.id), ["b", "c", "a"])
        XCTAssertEqual(document.blocks[1], opaque)
        try document.setCaption(itemID: "a", caption: "وصف")
        try document.remove(itemID: "b")
        XCTAssertEqual(document.items.map(\.id), ["c", "a"])
        XCTAssertTrue(document.blocks.contains(opaque))
        XCTAssertEqual(document.items.last?.caption, "وصف")
        try document.setView("list")
        XCTAssertEqual(document.view, "list")
        guard case .object(let root) = document.metadata, case .object(let attrs)? = root["gallery"] else { return XCTFail("Missing metadata") }
        XCTAssertEqual(attrs["future"], .bool(true))
    }
    func testAddValidationAndUniqueIDs() throws {
        var document = try fixture()
        try document.add(GalleryAttachment(id: "new", fileName: "photo.GIF", mime: "image/gif", size: 10, kind: "gif"))
        XCTAssertEqual(document.items.last?.attachmentID, "new")
        XCTAssertEqual(Set(document.items.map(\.id)).count, document.items.count)
        XCTAssertThrowsError(try document.add(GalleryAttachment(id: "bad", fileName: "document.pdf", mime: "application/pdf", size: 1, kind: "file")))
    }
    func testConflictPermissionsAndRemovalNeverDeleteAttachment() async throws {
        let initial = try fixture()
        let snapshot = GallerySnapshot(id: "gallery", kind: "gallery", revision: 1, blocks: initial.blocks, metadata: initial.metadata)
        let repo = GalleryFixtureRepository(snapshot: snapshot, accessible: ["img", "vid", "aud"])
        let service = GalleryService(repository: repo)
        let updated = try await service.apply(galleryID: "gallery", expectedRevision: 1, change: .remove(itemID: "a"))
        XCTAssertEqual(updated.revision, 2)
        let remainingOriginals = await repo.originalAttachments()
        XCTAssertTrue(remainingOriginals.contains("img"))
        do { _ = try await service.apply(galleryID: "gallery", expectedRevision: 1, change: .view("list")); XCTFail("Expected conflict") }
        catch GalleryError.conflict { } catch { XCTFail("Unexpected error: \(error)") }
        let forbidden = GalleryAttachment(id: "not-authorized", fileName: "hidden.png", mime: "image/png", size: 5, kind: "image")
        do { _ = try await service.apply(galleryID: "gallery", expectedRevision: 2, change: .add(forbidden)); XCTFail("Expected denial") }
        catch GalleryError.permissionDenied { } catch { XCTFail("Unexpected error: \(error)") }
        let persisted = try await repo.readAuthorizedGallery(id: "gallery")
        XCTAssertEqual(persisted, updated)
    }
}
