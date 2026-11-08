import Foundation
import SQLite3
import XCTest
import WorldsPresentations
@testable import WorldsPresentationPersistence

final class PresentationPersistenceTests: XCTestCase {
    private func execute(_ path: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(path.path, &db) == SQLITE_OK, let db else { throw PresentationPersistenceError.invalidResponse }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw PresentationPersistenceError.invalidResponse }
    }
    private func database() throws -> URL {
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("worlds.db")
        try FileManager.default.copyItem(at: fixture, to: path)
        try execute(path, #"INSERT INTO pages(id,title,kind,metadata,created_at,updated_at) VALUES('deck','Deck','presentation','{}',1,100); INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('slide','deck','slide',0,'{"type":"slide","attrs":{"bid":"slide","notes":"old","elements":[]}}',1,1),('opaque','deck','future',1,'{"type":"future","attrs":{"bid":"opaque","keep":true}}',1,1);"#)
        return path
    }
    func testSaveKeepsOpaqueAndConflictingSessionFails() async throws {
        let path = try database()
        let first = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        let stale = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        var slide = try XCTUnwrap(first.initialSlides.first)
        try slide.setNotes("changed")
        try await first.save(slides: [slide])
        do { try await stale.save(slides: stale.initialSlides); XCTFail("Expected conflict") } catch { }
        let reloaded = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        XCTAssertEqual(reloaded.initialSlides.first?.notes, "changed")
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(path.path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        let handle = try XCTUnwrap(db); defer { sqlite3_close(handle) }
        var stmt: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(handle, "SELECT count(*) FROM blocks WHERE id='opaque' AND json_extract(content,'$.attrs.keep')=1", -1, &stmt, nil), SQLITE_OK)
        let query = try XCTUnwrap(stmt); defer { sqlite3_finalize(query) }
        XCTAssertEqual(sqlite3_step(query), SQLITE_ROW)
        XCTAssertEqual(sqlite3_column_int(query, 0), 1)
    }
    func testSaveAndReopenPreservesMissingMediaAndUnknownSlideFields() async throws {
        let path = try database()
        try execute(path, #"INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('image','deck','image','a.png','image/png',4,'missing/a.png',1); UPDATE blocks SET content='{"type":"slide","attrs":{"bid":"slide","notes":"old","background":{"attachmentId":"image","extra":true},"elements":[{"id":"title","type":"text","x":20,"y":30,"text":"قبل 🌍","future":{"keep":true}},{"id":"opaque","type":"future","data":{"keep":true}}]}}' WHERE id='slide';"#)
        let store = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        var slide = try XCTUnwrap(store.initialSlides.first)
        try slide.setText(elementID: "title", text: "بعد 🌍")
        try slide.setNotes("Speaker notes")
        try slide.setTextStyle(elementID: "title", key: "align", value: .string("center"))
        try slide.setTextStyle(elementID: "title", key: "fontWeight", value: .integer(700))
        try slide.setTextStyle(elementID: "title", key: "italic", value: .bool(true))
        try slide.setTextStyle(elementID: "title", key: "fontSize", value: .integer(40))
        try slide.setTextStyle(elementID: "title", key: "color", value: .string("#e5484d"))
        try slide.moveText(elementID: "title", dx: 1, dy: 0)
        try await store.save(slides: [slide])
        let reopened = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        let restored = try XCTUnwrap(reopened.initialSlides.first)
        XCTAssertEqual(restored.elements.first?.text, "بعد 🌍")
        XCTAssertEqual(restored.editableNotes, "Speaker notes")
        XCTAssertEqual(restored.elements.first?.editableTextAlignment, "center")
        XCTAssertEqual(restored.elements.first?.editableFontWeight, 700)
        XCTAssertEqual(restored.elements.first?.editableItalic, true)
        XCTAssertEqual(restored.elements.first?.editableFontSize, 40)
        XCTAssertEqual(restored.elements.first?.editableTextColor, "#e5484d")
        XCTAssertEqual(restored.elements.first?.editablePosition?.x, 21)
        XCTAssertEqual(restored.elements.first?.editablePosition?.y, 30)
        XCTAssertEqual(restored.attributes["background"], slide.attributes["background"])
        XCTAssertEqual(restored.elements.last?.source, slide.elements.last?.source)
        XCTAssertEqual(restored.elements.first?.source, slide.elements.first?.source)
    }
    func testInsertDuplicateAndReorderRoundTripsWithoutDroppingOpaqueBlocks() async throws {
        let path = try database()
        let store = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        let original = try XCTUnwrap(store.initialSlides.first)
        let blank = try SlideBlock.blank(id: "new-slide")
        let duplicate = try blank.duplicated(id: "copy-slide")
        try await store.save(slides: [duplicate, original, blank])
        let reopened = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        XCTAssertEqual(reopened.initialSlides.map(\.id), ["copy-slide", "slide", "new-slide"])
        XCTAssertEqual(reopened.initialSlides[1], original)
        var db: OpaquePointer?; XCTAssertEqual(sqlite3_open_v2(path.path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        let handle = try XCTUnwrap(db); defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(handle, "SELECT count(*) FROM blocks WHERE id='opaque' AND json_extract(content,'$.attrs.keep')=1", -1, &statement, nil), SQLITE_OK)
        let query = try XCTUnwrap(statement); defer { sqlite3_finalize(query) }
        XCTAssertEqual(sqlite3_step(query), SQLITE_ROW); XCTAssertEqual(sqlite3_column_int(query, 0), 1)
    }
    func testExplicitSlideDeletionKeepsMediaAndReopens() async throws {
        let path = try database()
        try execute(path, #"INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('image','deck','image','a.png','image/png',4,'missing/a.png',1); UPDATE blocks SET content='{"type":"slide","attrs":{"bid":"slide","elements":[{"id":"i","type":"image","attachmentId":"image"}]}}' WHERE id='slide'; INSERT INTO blocks(id,page_id,type,sort_key,content,created_at,updated_at) VALUES('slide2','deck','slide',2,'{"type":"slide","attrs":{"bid":"slide2","elements":[{"id":"j","type":"image","attachmentId":"image"}]}}',1,1);"#)
        let store = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        let remaining = store.initialSlides.filter { $0.id == "slide2" }
        do { try await store.save(slides: remaining); XCTFail("Deletion requires an explicit ID") }
        catch PresentationPersistenceError.invalidBlock { } catch { XCTFail("Unexpected error: \(error)") }
        try await store.save(slides: remaining, deleting: ["slide"])
        let reopened = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        XCTAssertEqual(reopened.initialSlides.map(\.id), ["slide2"])
        let recoveries = try await reopened.deletedSlides()
        XCTAssertEqual(recoveries.count, 1)
        let recovery = try XCTUnwrap(recoveries.first)
        XCTAssertEqual(recovery.blockID, "slide")
        let restored = try await reopened.restoreDeletedSlide(id: recovery.id)
        XCTAssertEqual(restored.map(\.id), ["slide", "slide2"])
        let pending = try await reopened.deletedSlides()
        XCTAssertTrue(pending.isEmpty)
        let reopenedAgain = try await PresentationPersistence.open(databaseURL: path, pageID: "deck")
        XCTAssertEqual(reopenedAgain.initialSlides.map(\.id), ["slide", "slide2"])
        var db: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(path.path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        let handle = try XCTUnwrap(db); defer { sqlite3_close(handle) }
        var statement: OpaquePointer?
        XCTAssertEqual(sqlite3_prepare_v2(handle, "SELECT count(*) FROM attachments WHERE id='image'", -1, &statement, nil), SQLITE_OK)
        let query = try XCTUnwrap(statement); defer { sqlite3_finalize(query) }
        XCTAssertEqual(sqlite3_step(query), SQLITE_ROW); XCTAssertEqual(sqlite3_column_int(query, 0), 1)
    }
}
