import Foundation
import XCTest
import WorldsMedia
@testable import WorldsMediaViews

@MainActor
final class MediaPreviewModelTests: XCTestCase {
    private func root() throws -> URL {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: path) }
        return path
    }
    private func attachment(name: String, path: String? = nil) -> WorldsAttachment {
        WorldsAttachment(id: "test", pageId: nil, kind: "file", fileName: name, mime: "application/octet-stream", size: 0, relPath: path ?? name, width: nil, height: nil, createdAt: 1)
    }
    func testTextAndDelimitedDataLoad() async throws {
        let directory = try root()
        try Data("hello".utf8).write(to: directory.appendingPathComponent("note.txt"))
        let text = MediaPreviewModel(attachment: attachment(name: "note.txt"), attachmentsRoot: directory)
        await text.load()
        guard case .text(let value) = text.state else { return XCTFail("Expected text preview") }
        XCTAssertEqual(value, "hello")
        try Data("name,value\nrow,2".utf8).write(to: directory.appendingPathComponent("sheet.csv"))
        let table = MediaPreviewModel(attachment: attachment(name: "sheet.csv"), attachmentsRoot: directory)
        await table.load()
        guard case .table(let rows) = table.state else { return XCTFail("Expected table preview") }
        XCTAssertEqual(rows, [["name", "value"], ["row", "2"]])
    }
    func testUnsupportedAndInvalidPath() async throws {
        let directory = try root()
        try Data("content".utf8).write(to: directory.appendingPathComponent("office.docx"))
        let unsupported = MediaPreviewModel(attachment: attachment(name: "office.docx"), attachmentsRoot: directory)
        await unsupported.load()
        guard case .unsupported = unsupported.state else { return XCTFail("Expected unsupported state") }
        let invalid = MediaPreviewModel(attachment: attachment(name: "note.txt", path: "../note.txt"), attachmentsRoot: directory)
        await invalid.load()
        guard case .failure = invalid.state else { return XCTFail("Expected path failure") }
    }
    func testImageAndShareCopyHaveBoundedLifetime() async throws {
        let directory = try root()
        let bytes = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="))
        try bytes.write(to: directory.appendingPathComponent("image.png"))
        var model: MediaPreviewModel? = MediaPreviewModel(attachment: attachment(name: "image.png"), attachmentsRoot: directory)
        await model?.load()
        guard case .image(let image)? = model?.state else { return XCTFail("Expected image") }
        XCTAssertEqual(image.image.width, 1)
        await model?.prepareShare()
        let share = try XCTUnwrap(model?.shareURL)
        XCTAssertEqual(try Data(contentsOf: share), bytes)
        model?.close()
        XCTAssertTrue(FileManager.default.fileExists(atPath: share.path))
        model = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: share.path))
    }
}
