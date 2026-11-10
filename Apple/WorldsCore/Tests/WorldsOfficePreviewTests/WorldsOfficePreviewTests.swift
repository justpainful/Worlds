import Foundation
import XCTest
@testable import WorldsOfficePreview

final class WorldsOfficePreviewTests: XCTestCase {
    private func fixture(_ name: String, _ ext: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: ext, subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }
    func testDocxExtractsActualTextWithoutPretendingFormattingParity() throws {
        let result = try OfficePreview.docx(data: fixture("sample", "docx"))
        XCTAssertEqual(result.paragraphs, ["مرحبا\tWorlds", "Second"])
        XCTAssertFalse(result.limitations.isEmpty)
    }
    func testXlsxReadsCellsAndNeverEvaluatesFormula() throws {
        let workbook = try OfficePreview.xlsx(data: fixture("sample", "xlsx"))
        XCTAssertEqual(workbook.sheets.map(\.name), ["Test"])
        XCTAssertEqual(workbook.sheets[0].rows[0].cells[0].value, "Hello")
        XCTAssertEqual(workbook.sheets[0].rows[0].cells[1].reference, "C1")
        XCTAssertEqual(workbook.sheets[0].rows[0].cells[1].value, "2")
        XCTAssertEqual(workbook.sheets[0].rows[0].cells[1].formula, "1+1")
    }
    func testRejectsDTDTraversalDuplicatesAndSymlinks() throws {
        for name in ["unsafe-xml", "unsafe-path", "duplicate", "symlink"] {
            XCTAssertThrowsError(try OfficePreview.docx(data: fixture(name, "docx")), name)
        }
    }
    func testRejectsDeclaredAndForgedOutputOverLimit() throws {
        var limits = OfficeLimits()
        limits.entryBytes = 4096
        XCTAssertThrowsError(try OfficePreview.docx(data: fixture("oversized", "docx"), limits: limits))
        XCTAssertThrowsError(try OfficePreview.docx(data: fixture("forged-size", "docx"), limits: limits))
    }
    func testRejectsInvalidArchiveAndUnsupportedMissingParts() throws {
        XCTAssertThrowsError(try OfficePreview.docx(data: Data("not a zip".utf8)))
        XCTAssertThrowsError(try OfficePreview.xlsx(data: fixture("sample", "docx")))
    }
}
