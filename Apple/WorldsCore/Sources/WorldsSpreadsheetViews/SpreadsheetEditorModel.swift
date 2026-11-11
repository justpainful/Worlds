import Foundation
import SwiftUI
import WorldsModels
import WorldsSpreadsheet

/// A zero based cell position on the active sheet.
public struct SpreadsheetCellPosition: Hashable, Sendable {
    public var row: Int
    public var column: Int
    public init(row: Int, column: Int) { self.row = row; self.column = column }
    public var key: String { SpreadsheetAddress.key(row: row, column: column) }
}

/// Editing state for one workbook. The host owns persistence: it reads
/// `workbook` (or `metadata(replacingSheetIn:)`) when the user saves and calls
/// `markSaved()` afterwards.
@MainActor
public final class SpreadsheetEditorModel: ObservableObject {
    @Published public private(set) var workbook: SpreadsheetWorkbook
    @Published public private(set) var evaluation: SpreadsheetEvaluation
    @Published public private(set) var selection = SpreadsheetCellPosition(row: 0, column: 0)
    /// The formula bar text for the selected cell. It is written to the cell by `commitDraft()`.
    @Published public var draft = ""
    /// True when the workbook differs from the last loaded or saved version.
    @Published public private(set) var hasChanges = false
    @Published public private(set) var mergeAnchors: [SpreadsheetCellPosition: SpreadsheetMerge] = [:]
    @Published public private(set) var coveredCells: Set<SpreadsheetCellPosition> = []
    public let isEditable: Bool

    public init(workbook: SpreadsheetWorkbook, editable: Bool) {
        self.workbook = workbook
        evaluation = SpreadsheetEngine.evaluate(workbook)
        isEditable = editable
        refreshSheet()
    }

    public convenience init(metadataJSON: String, editable: Bool) {
        self.init(workbook: SpreadsheetWorkbook(metadataJSON: metadataJSON), editable: editable)
    }

    public var activeSheetIndex: Int { workbook.activeSheetIndex }
    public var activeSheet: SpreadsheetSheet { workbook.sheets[workbook.activeSheetIndex] }

    /// True when the formula bar holds text that is not yet in the cell.
    public var draftIsPending: Bool { draft != activeSheet.input(at: selection.key) }

    public func result(row: Int, column: Int) -> SpreadsheetCellResult? {
        evaluation.result(sheetIndex: activeSheetIndex, key: SpreadsheetAddress.key(row: row, column: column))
    }

    /// The text a cell shows: its computed value, or its input when it was never evaluated.
    public func display(row: Int, column: Int) -> String {
        let key = SpreadsheetAddress.key(row: row, column: column)
        if let result = evaluation.result(sheetIndex: activeSheetIndex, key: key) { return result.display }
        return activeSheet.input(at: key)
    }

    /// Replaces the workbook, for example after the host reloads the resource.
    public func replace(with workbook: SpreadsheetWorkbook) {
        self.workbook = workbook
        evaluation = SpreadsheetEngine.evaluate(workbook)
        hasChanges = false
        refreshSheet()
    }

    /// Call after the host saved `workbook`.
    public func markSaved() { hasChanges = false }

    /// Writes the formula bar text into the selected cell and recalculates.
    public func commitDraft() {
        guard isEditable, draftIsPending else { return }
        workbook.setInput(draft, at: selection.key, sheetIndex: activeSheetIndex)
        changed()
    }

    /// Puts the selected cell's stored input back in the formula bar.
    public func cancelDraft() { draft = activeSheet.input(at: selection.key) }

    /// Commits the draft, then selects a cell inside the sheet.
    public func select(row: Int, column: Int) {
        commitDraft()
        let sheet = activeSheet
        var target = SpreadsheetCellPosition(row: max(0, min(sheet.rows - 1, row)), column: max(0, min(sheet.cols - 1, column)))
        // A cell hidden by a merge selects the merge's top left cell.
        if coveredCells.contains(target), let anchor = mergeAnchors.first(where: { $0.value.contains(row: target.row, column: target.column) })?.key {
            target = anchor
        }
        selection = target
        draft = sheet.input(at: target.key)
    }

    /// Moves the selection, stepping over a merged range as one cell.
    public func move(rows: Int, columns: Int) {
        var row = selection.row
        var column = selection.column
        if let merge = mergeAnchors[selection] {
            if rows > 0 { row = merge.lastRow }
            if columns > 0 { column = merge.lastColumn }
        }
        select(row: row + rows, column: column + columns)
    }

    /// Clears the selected cell's input, keeping its style and note.
    public func clearSelectedCell() {
        guard isEditable else { return }
        draft = ""
        commitDraft()
    }

    public func selectSheet(id: String) {
        guard id != workbook.activeSheetID, workbook.sheets.contains(where: { $0.id == id }) else { return }
        commitDraft()
        workbook.activeSheetID = id
        refreshSheet()
    }

    public func addSheet() {
        guard isEditable else { return }
        commitDraft()
        workbook.addSheet()
        changed()
        refreshSheet()
    }

    public func addRow() {
        guard isEditable else { return }
        commitDraft()
        if workbook.appendRow(sheetIndex: activeSheetIndex) { changed() }
    }

    public func addColumn() {
        guard isEditable else { return }
        commitDraft()
        if workbook.appendColumn(sheetIndex: activeSheetIndex) { changed() }
    }

    public var canAddRow: Bool { isEditable && activeSheet.rows < SpreadsheetSheet.maximumRows }
    public var canAddColumn: Bool { isEditable && activeSheet.cols < SpreadsheetSheet.maximumColumns }

    private func changed() {
        evaluation = SpreadsheetEngine.evaluate(workbook)
        hasChanges = true
    }

    private func refreshSheet() {
        let sheet = activeSheet
        var anchors: [SpreadsheetCellPosition: SpreadsheetMerge] = [:]
        var covered = Set<SpreadsheetCellPosition>()
        for merge in sheet.merges where merge.firstRow < sheet.rows && merge.firstColumn < sheet.cols {
            let anchor = SpreadsheetCellPosition(row: merge.firstRow, column: merge.firstColumn)
            guard anchors[anchor] == nil, !covered.contains(anchor) else { continue }
            let clipped = SpreadsheetMerge(firstRow: merge.firstRow, firstColumn: merge.firstColumn,
                                           lastRow: min(merge.lastRow, sheet.rows - 1), lastColumn: min(merge.lastColumn, sheet.cols - 1))
            let cells = (clipped.firstRow...clipped.lastRow).flatMap { row in
                (clipped.firstColumn...clipped.lastColumn).map { SpreadsheetCellPosition(row: row, column: $0) }
            }
            // Overlapping ranges are not drawn as merges.
            guard cells.allSatisfy({ !covered.contains($0) && anchors[$0] == nil }) else { continue }
            anchors[anchor] = clipped
            for cell in cells where cell != anchor { covered.insert(cell) }
        }
        mergeAnchors = anchors
        coveredCells = covered
        let row = min(selection.row, sheet.rows - 1)
        let column = min(selection.column, sheet.cols - 1)
        selection = SpreadsheetCellPosition(row: max(0, row), column: max(0, column))
        draft = sheet.input(at: selection.key)
    }
}
