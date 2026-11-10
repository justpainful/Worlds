import Foundation
import XCTest
import WorldsMedia
@testable import WorldsOfficeViews

final class OfficeContentLoaderTests: XCTestCase {
    func testRejectsUnsupportedBeforeOpeningPath() {
        let attachment = WorldsAttachment(id: "test", pageId: nil, kind: "file", fileName: "test.xls", mime: "application/vnd.ms-excel", size: 0, relPath: "../secret", width: nil, height: nil, createdAt: 0)
        XCTAssertThrowsError(try OfficeContentLoader.load(attachment: attachment, root: URL(fileURLWithPath: "/"))) { error in
            XCTAssertEqual(error as? OfficeLoadError, .unsupported)
        }
    }
    func testMissingOfficeFileIsAnError() {
        let attachment = WorldsAttachment(id: "test", pageId: nil, kind: "file", fileName: "test.docx", mime: "application/octet-stream", size: 0, relPath: "missing", width: nil, height: nil, createdAt: 0)
        XCTAssertThrowsError(try OfficeContentLoader.load(attachment: attachment, root: FileManager.default.temporaryDirectory))
    }
}

extension OfficeContentLoaderTests {
    func testLoadsSyntheticWordAndWorkbookThroughVault() throws {
        let bundle = Bundle.module
        let root = try XCTUnwrap(bundle.url(forResource: "Fixtures", withExtension: nil))
        func record(_ name: String) -> WorldsAttachment {
            WorldsAttachment(id: "fixture", pageId: nil, kind: "file", fileName: name, mime: "application/octet-stream", size: 0, relPath: name, width: nil, height: nil, createdAt: 0)
        }
        guard case .word(let word) = try OfficeContentLoader.load(attachment: record("sample.docx"), root: root) else { return XCTFail("Expected Word preview") }
        XCTAssertFalse(word.paragraphs.isEmpty)
        guard case .workbook(let workbook) = try OfficeContentLoader.load(attachment: record("sample.xlsx"), root: root) else { return XCTFail("Expected workbook preview") }
        XCTAssertFalse(workbook.sheets.isEmpty)
        XCTAssertThrowsError(try OfficeContentLoader.load(attachment: record("unsafe-xml.docx"), root: root))
    }
}
