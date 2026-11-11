import Foundation
import XCTest
import WorldsModels
@testable import WorldsSpreadsheet

private func decode(_ json: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(json.utf8))
}

private func object(_ value: JSONValue?) -> [String: JSONValue] {
    if case .object(let object)? = value { return object }
    return [:]
}

private func array(_ value: JSONValue?) -> [JSONValue] {
    if case .array(let array)? = value { return array }
    return []
}

final class SpreadsheetWorkbookTests: XCTestCase {
    /// A workbook as the desktop saves it, plus fields this client does not know about.
    private let desktopMetadata = """
    {
      "other": "kept",
      "properties": [{"name": "Owner", "value": "Sara"}],
      "sheet": {
        "activeSheetId": "sh_data",
        "futureWorkbookField": {"version": 3},
        "sheets": [
          {
            "id": "sh_main", "name": "Budget", "color": "#22c55e", "rows": 60, "cols": 26,
            "cells": {
              "A1": {"v": "Item", "s": {"bold": true, "border": {"top": true, "color": "#000"}}},
              "B2": {"v": "=SUM(B3:B4)", "s": {"format": "currency_sar", "decimals": 0}, "note": "Total"},
              "B3": {"v": "1200"},
              "B4": {"v": "300", "futureCellField": 7},
              "A8": {"v": "remove me"}
            },
            "colWidths": {"0": 140}, "rowHeights": {"1": 40},
            "frozenRows": 1, "frozenCols": 0,
            "merges": [{"r1": 30, "c1": 0, "r2": 31, "c2": 1}],
            "conditionalRules": [{"id": "r1", "range": "A1:A5", "op": "gt", "value": "10", "bg": "#112233", "color": "#ffffff"}],
            "filter": {"enabled": true, "colFilters": {"0": "Rent"}},
            "futureSheetField": [1, 2, 3]
          },
          {"id": "sh_data", "name": "Data sheet", "rows": 12, "cols": 6, "cells": {}}
        ]
      }
    }
    """

    func testLoadEditSaveRoundTripKeepsEverythingTheDesktopWrote() throws {
        let original = try decode(desktopMetadata)
        var book = SpreadsheetWorkbook(metadata: original)
        XCTAssertEqual(book.sheets.map(\.name), ["Budget", "Data sheet"])
        XCTAssertEqual(book.activeSheetID, "sh_data")
        XCTAssertEqual(book.activeSheetIndex, 1)

        book.setInput("1500", at: "B3", sheetIndex: 0)
        book.setInput("", at: "A8", sheetIndex: 0)
        book.setInput("", at: "B2", sheetIndex: 0)
        book.setInput("=B3*2", at: "C1", sheetIndex: 1)
        XCTAssertTrue(book.appendRow(sheetIndex: 1))
        XCTAssertTrue(book.appendColumn(sheetIndex: 1))

        // Encode and decode, as the save path does, then read the result back.
        let saved = book.metadata(replacingSheetIn: original)
        let reloaded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(saved))
        let root = object(reloaded)
        XCTAssertEqual(root["other"], .string("kept"))
        XCTAssertEqual(root["properties"], object(original)["properties"])
        let sheetObject = object(root["sheet"])
        XCTAssertEqual(object(sheetObject["futureWorkbookField"])["version"], .integer(3))
        XCTAssertEqual(sheetObject["activeSheetId"], .string("sh_data"))
        let sheets = array(sheetObject["sheets"])
        XCTAssertEqual(sheets.count, 2)
        let main = object(sheets[0])
        XCTAssertEqual(main["color"], .string("#22c55e"))
        XCTAssertEqual(main["frozenRows"], .integer(1))
        XCTAssertEqual(array(main["merges"]).count, 1)
        XCTAssertEqual(array(main["conditionalRules"]).count, 1)
        XCTAssertEqual(object(main["colWidths"])["0"], .integer(140))
        XCTAssertEqual(object(main["rowHeights"])["1"], .integer(40))
        XCTAssertEqual(object(main["filter"])["enabled"], .bool(true))
        XCTAssertEqual(main["futureSheetField"], .array([.integer(1), .integer(2), .integer(3)]))
        let cells = object(main["cells"])
        XCTAssertNil(cells["A8"], "an emptied cell without style or note is removed, as on the desktop")
        XCTAssertEqual(object(cells["B3"])["v"], .string("1500"))
        XCTAssertEqual(object(cells["B4"])["futureCellField"], .integer(7))
        XCTAssertEqual(object(object(cells["A1"])["s"])["border"], .object(["top": .bool(true), "color": .string("#000")]))
        let total = object(cells["B2"])
        XCTAssertEqual(total["v"], .string(""), "a styled cell keeps its style and note when emptied")
        XCTAssertEqual(total["note"], .string("Total"))
        XCTAssertEqual(object(total["s"])["format"], .string("currency_sar"))
        let data = object(sheets[1])
        XCTAssertEqual(data["rows"], .integer(13))
        XCTAssertEqual(data["cols"], .integer(7))
        XCTAssertEqual(object(object(data["cells"])["C1"])["v"], .string("=B3*2"))

        // The saved shape reads back to the same workbook.
        XCTAssertEqual(SpreadsheetWorkbook(metadata: reloaded), book)
    }

    func testEditingKeepsDesktopOnlyFieldsInTheSharedFixture() throws {
        let url = URL(fileURLWithPath: "\(#filePath)")
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Android/core/content/src/androidTest/assets/spreadsheet-desktop.json")
        let fixture = object(try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)))
        let metadata = JSONValue.object(["other": .string("kept"), "sheet": fixture["workbook"] ?? .null])
        var book = SpreadsheetWorkbook(metadata: metadata)
        book.setInput("42", at: "F1", sheetIndex: book.activeSheetIndex)
        book.setInput("", at: "A8", sheetIndex: book.activeSheetIndex)
        let merged = object(book.metadata(replacingSheetIn: metadata))
        XCTAssertEqual(merged["other"], .string("kept"))
        let saved = object(array(object(merged["sheet"])["sheets"]).first)
        let cells = object(saved["cells"])
        XCTAssertEqual(object(cells["F1"])["v"], .string("42"))
        XCTAssertEqual(object(object(cells["F1"])["s"])["format"], .string("integer"))
        XCTAssertNil(cells["A8"])
        XCTAssertEqual(saved["frozenRows"], .integer(1))
        XCTAssertEqual(array(saved["merges"]).count, 1)
        XCTAssertEqual(array(saved["conditionalRules"]).count, 1)
        XCTAssertEqual(object(saved["colWidths"])["0"], .integer(140))
        let evaluation = SpreadsheetEngine.evaluate(book)
        XCTAssertEqual(evaluation["sh_main"]["F1"]?.display, "42")
        XCTAssertEqual(evaluation["sh_main"]["E14"]?.display, "0", "A8 is now empty, so $A$8+A$8 is zero")
    }

    func testNewSheetsStartEmptyWithDesktopDefaults() throws {
        for json in ["{}", "not json", "{\"sheet\": {\"sheets\": []}}", "{\"sheet\": 5}"] {
            let book = SpreadsheetWorkbook(metadataJSON: json)
            XCTAssertEqual(book.sheets.count, 1)
            let sheet = book.sheets[book.activeSheetIndex]
            XCTAssertEqual(sheet.name, "Sheet 1")
            XCTAssertEqual(sheet.rows, 60)
            XCTAssertEqual(sheet.cols, 26)
            XCTAssertTrue(sheet.cells.isEmpty)
            XCTAssertTrue(sheet.id.hasPrefix("sh_"))
            XCTAssertEqual(sheet.id.count, 11)
        }
        let saved = object(SpreadsheetWorkbook().jsonValue)
        let first = object(array(saved["sheets"]).first)
        XCTAssertEqual(first["merges"], .array([]))
        XCTAssertEqual(first["conditionalRules"], .array([]))
        XCTAssertEqual(first["colWidths"], .object([:]))
        XCTAssertEqual(first["frozenCols"], .integer(0))
    }

    func testNormalizationFollowsTheDesktopLimits() throws {
        let book = SpreadsheetWorkbook(metadata: try decode("""
        {"sheet": {"activeSheetId": "missing", "sheets": [
          {"rows": 9000, "cols": 3, "frozenRows": -2, "cells": {"A1": {"v": 12}, "A2": "loose"}},
          {"id": "", "name": "   ", "rows": "20", "cols": 150.7},
          7
        ]}}
        """))
        XCTAssertEqual(book.activeSheetID, "sh_1")
        XCTAssertEqual(book.sheets.map(\.id), ["sh_1", "sh_2", "sh_3"])
        XCTAssertEqual(book.sheets.map(\.name), ["Sheet 1", "Sheet 2", "Sheet 3"])
        XCTAssertEqual(book.sheets[0].rows, 500)
        XCTAssertEqual(book.sheets[0].cols, 26)
        XCTAssertEqual(book.sheets[0].frozenRows, 0)
        XCTAssertEqual(book.sheets[0].input(at: "A1"), "12")
        XCTAssertEqual(book.sheets[0].input(at: "A2"), "loose")
        XCTAssertEqual(book.sheets[1].rows, 60)
        XCTAssertEqual(book.sheets[1].cols, 100)
    }

    func testAddedSheetsGetUnusedNames() {
        var book = SpreadsheetWorkbook()
        XCTAssertEqual(book.sheets[book.addSheet()].name, "Sheet 2")
        XCTAssertEqual(book.sheets[book.addSheet()].name, "Sheet 3")
        XCTAssertEqual(book.activeSheetID, book.sheets.last?.id)
        XCTAssertEqual(Set(book.sheets.map(\.id)).count, 3)
    }

    func testRowsAndColumnsStopAtTheDesktopLimits() {
        var book = SpreadsheetWorkbook()
        for _ in 0..<1000 { book.appendRow(sheetIndex: 0) }
        for _ in 0..<1000 { book.appendColumn(sheetIndex: 0) }
        XCTAssertEqual(book.sheets[0].rows, 500)
        XCTAssertEqual(book.sheets[0].cols, 100)
        XCTAssertFalse(book.appendRow(sheetIndex: 0))
        XCTAssertFalse(book.appendColumn(sheetIndex: 3))
    }

    func testMergesAndSizesAreReadForDisplay() throws {
        let book = SpreadsheetWorkbook(metadata: try decode(desktopMetadata))
        let main = book.sheets[0]
        XCTAssertEqual(main.merges, [SpreadsheetMerge(firstRow: 30, firstColumn: 0, lastRow: 31, lastColumn: 1)])
        XCTAssertEqual(main.columnWidth(0), 140)
        XCTAssertNil(main.columnWidth(1))
        XCTAssertEqual(main.rowHeight(1), 40)
        XCTAssertEqual(main.cells["A1"]?.style?.bold, true)
        XCTAssertEqual(main.cells["B2"]?.style?.decimals, 0)
        XCTAssertEqual(main.cells["B2"]?.note, "Total")
        XCTAssertEqual(SpreadsheetEngine.evaluate(book)["sh_main"]["B2"]?.display, "SAR 1,500")
    }

    func testReferenceParsing() {
        XCTAssertEqual(SpreadsheetReference.parse("$B$12"), SpreadsheetReference(sheet: nil, row: 11, column: 1, absoluteRow: true, absoluteColumn: true))
        XCTAssertEqual(SpreadsheetReference.parse("'My sheet'!aa3")?.sheet, "My sheet")
        XCTAssertEqual(SpreadsheetReference.parse("'My sheet'!aa3")?.column, 26)
        XCTAssertEqual(SpreadsheetReference.parse("ورقة!C1")?.sheet, "ورقة")
        XCTAssertNil(SpreadsheetReference.parse("ABCD1"))
        XCTAssertNil(SpreadsheetReference.parse("A123456"))
        XCTAssertNil(SpreadsheetReference.parse("A0"))
        XCTAssertNil(SpreadsheetReference.parse("My sheet!A1"))
        XCTAssertNil(SpreadsheetReference.parse("''!A1"))
        XCTAssertEqual(SpreadsheetAddress.key(row: 0, column: 27), "AB1")
        XCTAssertEqual(SpreadsheetAddress.coordinates(of: "C7")?.row, 6)
    }
}
