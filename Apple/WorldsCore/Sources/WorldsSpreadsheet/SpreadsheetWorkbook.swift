import Foundation
import WorldsModels

/// Cell addresses as the desktop writes them: column letters then a one based row, like `B12`.
public enum SpreadsheetAddress {
    public static func columnName(_ column: Int) -> String {
        var n = column + 1
        var name: [Unicode.Scalar] = []
        while n > 0 {
            let remainder = (n - 1) % 26
            name.insert(Unicode.Scalar(UInt8(65 + remainder)), at: 0)
            n = (n - 1) / 26
        }
        return String(String.UnicodeScalarView(name))
    }

    /// Letters only, case insensitive; other characters are ignored like the desktop.
    public static func columnIndex(_ name: String) -> Int {
        var column = 0
        for scalar in name.uppercased().unicodeScalars where scalar.value >= 65 && scalar.value <= 90 {
            column = column * 26 + Int(scalar.value - 64)
        }
        return column - 1
    }

    public static func key(row: Int, column: Int) -> String { columnName(column) + String(row + 1) }

    /// Parses a plain key such as `C7` (no sheet, no `$`) into zero based coordinates.
    public static func coordinates(of key: String) -> (row: Int, column: Int)? {
        guard let reference = SpreadsheetReference.parse(key), reference.sheet == nil else { return nil }
        return (reference.row, reference.column)
    }
}

/// A parsed reference such as `'Data sheet'!$B$2`, matching the desktop `parseCellRef`.
public struct SpreadsheetReference: Sendable, Equatable {
    public var sheet: String?
    public var row: Int
    public var column: Int
    public var absoluteRow: Bool
    public var absoluteColumn: Bool

    private static func isLetter(_ unit: UInt16) -> Bool { (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) }
    private static func isDigit(_ unit: UInt16) -> Bool { unit >= 48 && unit <= 57 }
    private static func isBareSheetUnit(_ unit: UInt16) -> Bool {
        isLetter(unit) || isDigit(unit) || unit == 95 || (unit >= 0x0600 && unit <= 0x06FF)
    }

    public static func parse(_ token: String) -> SpreadsheetReference? {
        let units = Array(JSNumbers.trim(token).utf16)
        guard !units.isEmpty else { return nil }
        var sheet: String?
        var index = 0
        if units[0] == 39 {
            guard let close = units[1...].firstIndex(of: 39), close > 1, close + 1 < units.count, units[close + 1] == 33 else { return nil }
            sheet = String(decoding: units[1..<close], as: UTF16.self)
            index = close + 2
        } else if let bang = units.firstIndex(of: 33) {
            guard bang > 0, units[0..<bang].allSatisfy(isBareSheetUnit) else { return nil }
            sheet = String(decoding: units[0..<bang], as: UTF16.self)
            index = bang + 1
        }
        var absoluteColumn = false
        if index < units.count && units[index] == 36 { absoluteColumn = true; index += 1 }
        let letterStart = index
        while index < units.count && isLetter(units[index]) && index - letterStart < 3 { index += 1 }
        let letters = index - letterStart
        guard letters >= 1 else { return nil }
        var absoluteRow = false
        if index < units.count && units[index] == 36 { absoluteRow = true; index += 1 }
        let digitStart = index
        while index < units.count && isDigit(units[index]) && index - digitStart < 5 { index += 1 }
        let digitCount = index - digitStart
        guard digitCount >= 1, index == units.count else { return nil }
        let column = SpreadsheetAddress.columnIndex(String(decoding: units[letterStart..<letterStart + letters], as: UTF16.self))
        var rowNumber = 0
        for unit in units[digitStart..<index] { rowNumber = rowNumber * 10 + Int(unit - 48) }
        let row = rowNumber - 1
        guard row >= 0, column >= 0, row <= 99_999, column <= 16_384 else { return nil }
        return SpreadsheetReference(sheet: sheet, row: row, column: column, absoluteRow: absoluteRow, absoluteColumn: absoluteColumn)
    }
}

/// The cell styles the desktop stores in `cells[key].s`. Unknown style keys stay in the cell's JSON.
public struct SpreadsheetCellStyle: Sendable, Equatable {
    public var bold = false
    public var italic = false
    public var underline = false
    public var strike = false
    public var wrap = false
    public var color: String?
    public var background: String?
    /// `left`, `center` or `right`; nil follows the value (numbers right, text left).
    public var align: String?
    /// `auto`, `number`, `integer`, `currency_sar`, `currency_usd`, `accounting`, `percent`, `scientific`, `date` or `text`.
    public var format = "auto"
    public var decimals = 2

    public init() {}

    init(_ value: JSONValue?) {
        guard case .object(let object)? = value else { return }
        bold = object["bold"].flag
        italic = object["italic"].flag
        underline = object["underline"].flag
        strike = object["strike"].flag
        wrap = object["wrap"].flag
        if case .string(let text)? = object["color"], !text.isEmpty { color = text }
        if case .string(let text)? = object["bg"], !text.isEmpty { background = text }
        if case .string(let text)? = object["align"], ["left", "center", "right"].contains(text) { align = text }
        if case .string(let text)? = object["format"] { format = text }
        if let number = object["decimals"].number, number.isFinite {
            decimals = Int(Swift.min(20, Swift.max(0, number.rounded(.down))))
        }
    }
}

public struct SpreadsheetCellData: Sendable, Equatable {
    /// The cell's complete JSON object: `v`, `s`, `note` and anything else the desktop wrote.
    public internal(set) var object: [String: JSONValue]

    init(object: [String: JSONValue]) { self.object = object }

    /// The raw input, for example `=SUM(A1:A5)`, `42.5` or `Hello`.
    public var input: String {
        switch object["v"] {
        case .string(let text)?: return text
        case .integer(let value)?: return String(value)
        case .number(let value)?: return JSNumbers.toString(value)
        case .bool(let value)?: return value ? "true" : "false"
        default: return ""
        }
    }

    public var style: SpreadsheetCellStyle? {
        guard let value = object["s"], case .object = value else { return nil }
        return SpreadsheetCellStyle(value)
    }

    public var note: String? {
        if case .string(let text)? = object["note"] { return text }
        return nil
    }
}

/// A merged range, zero based and inclusive, as stored in `sheet.merges`.
public struct SpreadsheetMerge: Sendable, Equatable, Hashable {
    public var firstRow: Int
    public var firstColumn: Int
    public var lastRow: Int
    public var lastColumn: Int

    public init(firstRow: Int, firstColumn: Int, lastRow: Int, lastColumn: Int) {
        self.firstRow = firstRow
        self.firstColumn = firstColumn
        self.lastRow = lastRow
        self.lastColumn = lastColumn
    }

    public func contains(row: Int, column: Int) -> Bool {
        row >= firstRow && row <= lastRow && column >= firstColumn && column <= lastColumn
    }
}

public struct SpreadsheetSheet: Sendable, Equatable, Identifiable {
    public static let defaultRows = 60
    public static let defaultColumns = 26
    public static let minimumRows = 10
    public static let minimumColumns = 5
    public static let maximumRows = 500
    public static let maximumColumns = 100

    public var id: String
    public var name: String
    public internal(set) var rows: Int
    public internal(set) var cols: Int
    public internal(set) var frozenRows: Int
    public internal(set) var frozenCols: Int
    public internal(set) var cells: [String: SpreadsheetCellData]
    /// Every other key of the sheet, kept exactly as read: `color`, `colWidths`,
    /// `rowHeights`, `merges`, `conditionalRules`, `filter` and future fields.
    public internal(set) var object: [String: JSONValue]

    /// A new empty sheet with the desktop defaults.
    public init(name: String) {
        let suffix = UUID().uuidString.lowercased().unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }
        id = "sh_" + String(String.UnicodeScalarView(suffix.prefix(8)))
        self.name = name
        rows = Self.defaultRows
        cols = Self.defaultColumns
        frozenRows = 0
        frozenCols = 0
        cells = [:]
        object = ["colWidths": .object([:]), "rowHeights": .object([:]), "merges": .array([]), "conditionalRules": .array([])]
    }

    /// Reads one sheet with the desktop's `normalizeWorkbook` defaults and limits.
    init(_ value: JSONValue, index: Int) {
        var source: [String: JSONValue] = [:]
        if case .object(let object) = value { source = object }
        if case .string(let text)? = source["id"], !text.isEmpty { id = text } else { id = "sh_\(index + 1)" }
        if case .string(let text)? = source["name"], !JSNumbers.trim(text).isEmpty { name = text } else { name = "Sheet \(index + 1)" }
        if let value = source["rows"].number, value >= Double(Self.minimumRows) {
            rows = Swift.min(Self.maximumRows, Int(Swift.min(value, Double(Self.maximumRows)).rounded(.down)))
        } else { rows = Self.defaultRows }
        if let value = source["cols"].number, value >= Double(Self.minimumColumns) {
            cols = Swift.min(Self.maximumColumns, Int(Swift.min(value, Double(Self.maximumColumns)).rounded(.down)))
        } else { cols = Self.defaultColumns }
        frozenRows = Self.count(source["frozenRows"])
        frozenCols = Self.count(source["frozenCols"])
        var cells: [String: SpreadsheetCellData] = [:]
        if case .object(let stored)? = source["cells"] {
            for (key, cell) in stored {
                if case .object(let cellObject) = cell { cells[key] = SpreadsheetCellData(object: cellObject) }
                else { cells[key] = SpreadsheetCellData(object: ["v": cell]) }
            }
        }
        self.cells = cells
        for key in ["id", "name", "rows", "cols", "cells", "frozenRows", "frozenCols"] { source[key] = nil }
        for key in ["colWidths", "rowHeights"] where !Self.isObject(source[key]) { source[key] = .object([:]) }
        for key in ["merges", "conditionalRules"] where !Self.isArray(source[key]) { source[key] = .array([]) }
        object = source
    }

    private static func count(_ value: JSONValue?) -> Int {
        guard let number = value.number, number.isFinite, number > 0 else { return 0 }
        return Int(Swift.min(number, 1_000_000).rounded(.down))
    }
    private static func isObject(_ value: JSONValue?) -> Bool { if case .object? = value { return true }; return false }
    private static func isArray(_ value: JSONValue?) -> Bool { if case .array? = value { return true }; return false }

    public var jsonValue: JSONValue {
        var out = object
        out["id"] = .string(id)
        out["name"] = .string(name)
        out["rows"] = .integer(Int64(rows))
        out["cols"] = .integer(Int64(cols))
        out["frozenRows"] = .integer(Int64(frozenRows))
        out["frozenCols"] = .integer(Int64(frozenCols))
        out["cells"] = .object(cells.mapValues { .object($0.object) })
        return .object(out)
    }

    public func input(at key: String) -> String { cells[key]?.input ?? "" }

    public var merges: [SpreadsheetMerge] {
        guard case .array(let list)? = object["merges"] else { return [] }
        return list.compactMap { entry in
            guard case .object(let range) = entry,
                  let r1 = range["r1"].number, let c1 = range["c1"].number,
                  let r2 = range["r2"].number, let c2 = range["c2"].number,
                  [r1, c1, r2, c2].allSatisfy({ $0.isFinite && $0 >= 0 && $0 < 100_000 }) else { return nil }
            let merge = SpreadsheetMerge(firstRow: Int(Swift.min(r1, r2)), firstColumn: Int(Swift.min(c1, c2)),
                                         lastRow: Int(Swift.max(r1, r2)), lastColumn: Int(Swift.max(c1, c2)))
            return merge.firstRow == merge.lastRow && merge.firstColumn == merge.lastColumn ? nil : merge
        }
    }

    /// The stored width of a column in points, when the desktop saved one.
    public func columnWidth(_ column: Int) -> Double? { Self.size(object["colWidths"], column) }
    public func rowHeight(_ row: Int) -> Double? { Self.size(object["rowHeights"], row) }

    private static func size(_ value: JSONValue?, _ index: Int) -> Double? {
        guard case .object(let sizes)? = value, let number = sizes[String(index)].number, number.isFinite, number > 0 else { return nil }
        return number
    }

    /// Sets a cell's input. An emptied cell without a style or note is removed, as on the desktop.
    mutating func setInput(_ raw: String, at key: String) {
        if raw.isEmpty {
            guard var cell = cells[key] else { return }
            if cell.object["s"] == nil && cell.object["note"] == nil { cells[key] = nil; return }
            cell.object["v"] = .string("")
            cells[key] = cell
            return
        }
        var cell = cells[key] ?? SpreadsheetCellData(object: [:])
        cell.object["v"] = .string(raw)
        cells[key] = cell
    }
}

/// The workbook a spreadsheet resource keeps in `metadata.sheet`, in the
/// desktop's shape (`src/spreadsheet/engine.ts`). Fields this client does not
/// understand are kept, so saving never loses what the desktop wrote.
public struct SpreadsheetWorkbook: Sendable, Equatable {
    public internal(set) var sheets: [SpreadsheetSheet]
    public var activeSheetID: String
    /// Other keys of the `sheet` object, kept as read.
    public internal(set) var object: [String: JSONValue]

    /// A new workbook with one empty sheet named `Sheet 1`.
    public init() {
        let first = SpreadsheetSheet(name: "Sheet 1")
        sheets = [first]
        activeSheetID = first.id
        object = [:]
    }

    /// Reads `metadata.sheet`; anything missing or malformed gives a new workbook, as on the desktop.
    public init(metadata: JSONValue) {
        guard case .object(let metadataObject) = metadata, case .object(var raw)? = metadataObject["sheet"],
              case .array(let list)? = raw["sheets"], !list.isEmpty else { self = SpreadsheetWorkbook(); return }
        let loaded = list.enumerated().map { SpreadsheetSheet($0.element, index: $0.offset) }
        if case .string(let active)? = raw["activeSheetId"], loaded.contains(where: { $0.id == active }) { activeSheetID = active }
        else { activeSheetID = loaded[0].id }
        sheets = loaded
        raw["sheets"] = nil
        raw["activeSheetId"] = nil
        object = raw
    }

    /// Reads a resource's metadata JSON text.
    public init(metadataJSON: String) {
        let value = (try? JSONDecoder().decode(JSONValue.self, from: Data(metadataJSON.utf8))) ?? .object([:])
        self.init(metadata: value)
    }

    /// The `sheet` object to store.
    public var jsonValue: JSONValue {
        var out = object
        out["sheets"] = .array(sheets.map(\.jsonValue))
        out["activeSheetId"] = .string(activeSheetID)
        return .object(out)
    }

    /// The resource metadata with only `sheet` replaced; every other key stays as it was.
    public func metadata(replacingSheetIn base: JSONValue) -> JSONValue {
        var out: [String: JSONValue] = [:]
        if case .object(let object) = base { out = object }
        out["sheet"] = jsonValue
        return .object(out)
    }

    public var activeSheetIndex: Int { sheets.firstIndex(where: { $0.id == activeSheetID }) ?? 0 }

    public mutating func setInput(_ raw: String, at key: String, sheetIndex: Int) {
        guard sheets.indices.contains(sheetIndex) else { return }
        sheets[sheetIndex].setInput(raw, at: key)
    }

    /// Adds `Sheet N` with the first unused number and makes it active. Returns its index.
    @discardableResult
    public mutating func addSheet() -> Int {
        let existing = Set(sheets.map { $0.name.lowercased() })
        var number = sheets.count + 1
        while existing.contains("sheet \(number)") { number += 1 }
        sheets.append(SpreadsheetSheet(name: "Sheet \(number)"))
        activeSheetID = sheets[sheets.count - 1].id
        return sheets.count - 1
    }

    /// Adds a row at the end, up to the desktop's limit of 500. Returns false at the limit.
    @discardableResult
    public mutating func appendRow(sheetIndex: Int) -> Bool {
        guard sheets.indices.contains(sheetIndex), sheets[sheetIndex].rows < SpreadsheetSheet.maximumRows else { return false }
        sheets[sheetIndex].rows += 1
        return true
    }

    /// Adds a column at the end, up to the desktop's limit of 100. Returns false at the limit.
    @discardableResult
    public mutating func appendColumn(sheetIndex: Int) -> Bool {
        guard sheets.indices.contains(sheetIndex), sheets[sheetIndex].cols < SpreadsheetSheet.maximumColumns else { return false }
        sheets[sheetIndex].cols += 1
        return true
    }
}

extension Optional where Wrapped == JSONValue {
    var number: Double? {
        switch self {
        case .integer(let value)?: return Double(value)
        case .number(let value)?: return value
        default: return nil
        }
    }
    var flag: Bool { if case .bool(true)? = self { return true }; return false }
}
