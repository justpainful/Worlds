import Foundation
import XCTest
import WorldsModels
import WorldsSpreadsheet
@testable import WorldsSpreadsheetViews

private let metadata = """
{"keep": true, "sheet": {"activeSheetId": "a", "sheets": [
  {"id": "a", "name": "First", "rows": 10, "cols": 5, "cells": {
    "A1": {"v": "2"}, "A2": {"v": "3"}, "A3": {"v": "=A1*A2"}, "C1": {"v": "Merged", "s": {"bold": true}}
  }, "merges": [{"r1": 0, "c1": 2, "r2": 1, "c2": 3}]},
  {"id": "b", "name": "Second", "cells": {"A1": {"v": "=First!A3+1"}}}
]}}
"""

@MainActor
final class SpreadsheetEditorModelTests: XCTestCase {
    func testEditingRecalculatesAndMarksChanges() {
        let model = SpreadsheetEditorModel(metadataJSON: metadata, editable: true)
        XCTAssertEqual(model.display(row: 2, column: 0), "6")
        XCTAssertFalse(model.hasChanges)
        model.select(row: 0, column: 0)
        XCTAssertEqual(model.draft, "2")
        model.draft = "10"
        XCTAssertTrue(model.draftIsPending)
        model.move(rows: 1, columns: 0)
        XCTAssertEqual(model.selection, SpreadsheetCellPosition(row: 1, column: 0))
        XCTAssertEqual(model.display(row: 2, column: 0), "30")
        XCTAssertTrue(model.hasChanges)
        model.selectSheet(id: "b")
        XCTAssertEqual(model.display(row: 0, column: 0), "31")
        model.markSaved()
        XCTAssertFalse(model.hasChanges)
    }

    func testCancelAndClearKeepTheStoredInput() {
        let model = SpreadsheetEditorModel(metadataJSON: metadata, editable: true)
        model.select(row: 2, column: 0)
        model.draft = "=1/0"
        model.cancelDraft()
        XCTAssertEqual(model.draft, "=A1*A2")
        XCTAssertFalse(model.hasChanges)
        model.select(row: 0, column: 2)
        model.clearSelectedCell()
        XCTAssertEqual(model.activeSheet.cells["C1"]?.input, "")
        XCTAssertEqual(model.activeSheet.cells["C1"]?.style?.bold, true)
        model.select(row: 1, column: 0)
        model.clearSelectedCell()
        XCTAssertNil(model.activeSheet.cells["A2"])
        XCTAssertEqual(model.result(row: 2, column: 0)?.display, "0")
    }

    func testSelectionStaysInsideTheSheetAndTreatsMergesAsOneCell() {
        let model = SpreadsheetEditorModel(metadataJSON: metadata, editable: false)
        model.select(row: -4, column: 99)
        XCTAssertEqual(model.selection, SpreadsheetCellPosition(row: 0, column: 4))
        XCTAssertEqual(model.mergeAnchors[SpreadsheetCellPosition(row: 0, column: 2)], SpreadsheetMerge(firstRow: 0, firstColumn: 2, lastRow: 1, lastColumn: 3))
        XCTAssertTrue(model.coveredCells.contains(SpreadsheetCellPosition(row: 1, column: 3)))
        model.select(row: 1, column: 3)
        XCTAssertEqual(model.selection, SpreadsheetCellPosition(row: 0, column: 2))
        model.move(rows: 0, columns: 1)
        XCTAssertEqual(model.selection, SpreadsheetCellPosition(row: 0, column: 4))
        model.select(row: 0, column: 2)
        model.move(rows: 1, columns: 0)
        XCTAssertEqual(model.selection, SpreadsheetCellPosition(row: 2, column: 2))
    }

    func testReadOnlyModelIgnoresEdits() {
        let model = SpreadsheetEditorModel(metadataJSON: metadata, editable: false)
        model.select(row: 0, column: 0)
        model.draft = "99"
        model.commitDraft()
        model.addRow()
        model.addColumn()
        model.addSheet()
        model.clearSelectedCell()
        XCTAssertEqual(model.activeSheet.input(at: "A1"), "2")
        XCTAssertEqual(model.activeSheet.rows, 10)
        XCTAssertEqual(model.workbook.sheets.count, 2)
        XCTAssertFalse(model.hasChanges)
    }

    func testStructureEditsAndSavingKeepUnknownMetadata() throws {
        let model = SpreadsheetEditorModel(metadataJSON: metadata, editable: true)
        model.addRow()
        model.addColumn()
        XCTAssertEqual(model.activeSheet.rows, 11)
        XCTAssertEqual(model.activeSheet.cols, 6)
        model.addSheet()
        XCTAssertEqual(model.workbook.sheets.count, 3)
        XCTAssertEqual(model.activeSheet.name, "Sheet 3")
        XCTAssertEqual(model.selection, SpreadsheetCellPosition(row: 0, column: 0))
        let base = try JSONDecoder().decode(JSONValue.self, from: Data(metadata.utf8))
        guard case .object(let saved) = model.workbook.metadata(replacingSheetIn: base) else { return XCTFail("metadata") }
        XCTAssertEqual(saved["keep"], .bool(true))
    }
}
