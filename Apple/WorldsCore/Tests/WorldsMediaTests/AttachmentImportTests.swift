import Foundation
import XCTest
@testable import WorldsMedia

final class AttachmentImportTests: XCTestCase {
    func testStagesAndCleansUpAnIsolatedFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("original.txt")
        try Data("worlds".utf8).write(to: source)
        var stage: StagedAttachment? = try AttachmentImport.stage(source: source)
        let url = try XCTUnwrap(stage?.url)
        XCTAssertEqual(stage?.fileName, "original.txt")
        XCTAssertEqual(stage?.size, 6)
        XCTAssertEqual(try Data(contentsOf: url), Data("worlds".utf8))
        stage = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }
    func testBoundsAndSymlink() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("input")
        try Data("12345".utf8).write(to: source)
        XCTAssertThrowsError(try AttachmentImport.stage(source: source, maxBytes: 4))
        let link = root.appendingPathComponent("link")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: source)
        XCTAssertThrowsError(try AttachmentImport.stage(source: link))
        XCTAssertThrowsError(try AttachmentImport.stage(source: root))
    }
    func testOriginalNameCleaning() {
        XCTAssertEqual(AttachmentImport.cleanFileName("../../a:b?.txt"), "ab.txt")
        XCTAssertEqual(AttachmentImport.cleanFileName(" ... "), "file")
        XCTAssertEqual(AttachmentImport.cleanFileName(String(repeating: "a", count: 181)).count, 180)
    }
}
