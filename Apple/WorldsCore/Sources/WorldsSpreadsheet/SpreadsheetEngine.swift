import Foundation

/// A cell value as the desktop engine sees it: JavaScript `null`, number, string or boolean.
public enum SpreadsheetValue: Sendable, Equatable {
    case empty
    case number(Double)
    case text(String)
    case bool(Bool)
}

/// One evaluated cell, matching the desktop `EvaluatedCell`.
public struct SpreadsheetCellResult: Sendable, Equatable {
    public let raw: String
    public let value: SpreadsheetValue
    public let display: String
    /// An error code such as `#DIV/0!`, `#REF!`, `#NAME?`, `#VALUE!`, `#NUM!`, `#N/A` or `#CYCLE!`.
    public let error: String?
    public let isFormula: Bool
    /// The finite number the cell holds, used for alignment and the status summary.
    public let numeric: Double?
}

/// Every evaluated cell of a workbook. Cells that hold nothing and were not
/// referenced by a formula have no entry; treat them as empty.
public struct SpreadsheetEvaluation: Sendable {
    public let sheetIDs: [String]
    public let cells: [[String: SpreadsheetCellResult]]

    public func result(sheetIndex: Int, key: String) -> SpreadsheetCellResult? {
        guard cells.indices.contains(sheetIndex) else { return nil }
        return cells[sheetIndex][key]
    }

    /// Results for the first sheet with this id, keyed by cell address.
    public subscript(sheetID: String) -> [String: SpreadsheetCellResult] {
        guard let index = sheetIDs.firstIndex(of: sheetID) else { return [:] }
        return cells[index]
    }
}

/// A Swift port of the desktop formula engine (`src/spreadsheet/engine.ts`),
/// following the Android port (`SpreadsheetEngine.kt`): the same functions,
/// operators, error values and number formatting.
public enum SpreadsheetEngine {
    public static func evaluate(_ workbook: SpreadsheetWorkbook) -> SpreadsheetEvaluation {
        let evaluator = FormulaEvaluator(sheets: workbook.sheets, activeSheetIndex: workbook.activeSheetIndex)
        evaluator.evaluateAll()
        return SpreadsheetEvaluation(sheetIDs: workbook.sheets.map(\.id), cells: evaluator.results)
    }

    /// Typed input to a value: `TRUE`, `FALSE`, `12`, `1,200.5` and `50%` become
    /// booleans and numbers; anything else stays text exactly as typed.
    public static func parseRawScalar(_ raw: String) -> SpreadsheetValue {
        let trimmed = JSNumbers.trim(raw)
        if trimmed.isEmpty { return .empty }
        let upper = trimmed.uppercased()
        if upper == "TRUE" { return .bool(true) }
        if upper == "FALSE" { return .bool(false) }
        let units = Array(trimmed.utf16)
        if RawPatterns.plain(units[...]) { return .number(JSNumbers.number(trimmed)) }
        if RawPatterns.grouped(units) { return .number(JSNumbers.number(String(trimmed.unicodeScalars.filter { $0 != "," }))) }
        if units.last == 37, RawPatterns.plain(units.dropLast()) {
            return .number(JSNumbers.number(String(decoding: units.dropLast(), as: UTF16.self)) / 100)
        }
        return .text(raw)
    }

    /// The desktop `formatScalar`: the text a cell shows for a value and style.
    public static func format(_ value: SpreadsheetValue, style: SpreadsheetCellStyle?) -> String {
        switch value {
        case .empty: return ""
        case .text(let text): return text
        case .bool(let flag): return flag ? "TRUE" : "FALSE"
        case .number(let number):
            guard number.isFinite else { return JSNumbers.toString(number) }
            let decimals = style?.decimals ?? 2
            switch style?.format ?? "auto" {
            case "integer":
                return JSNumbers.localeString(JSNumbers.round(number), minimumFraction: 0, maximumFraction: 3)
            case "number":
                return JSNumbers.localeString(number, minimumFraction: decimals, maximumFraction: decimals)
            case "currency_sar":
                return (number < 0 ? "-" : "") + "SAR " + JSNumbers.localeString(abs(number), minimumFraction: decimals, maximumFraction: decimals)
            case "currency_usd":
                return (number < 0 ? "-" : "") + "$" + JSNumbers.localeString(abs(number), minimumFraction: decimals, maximumFraction: decimals)
            case "accounting":
                if number < 0 { return "(" + JSNumbers.localeString(abs(number), minimumFraction: decimals, maximumFraction: decimals) + ")" }
                if number == 0 { return "\u{2014}" }
                return JSNumbers.localeString(number, minimumFraction: decimals, maximumFraction: decimals)
            case "percent":
                return JSNumbers.toFixed(number * 100, decimals) + "%"
            case "scientific":
                return JSNumbers.toExponential(number, decimals)
            default:
                if number.rounded(.towardZero) == number { return JSNumbers.localeString(number, minimumFraction: 0, maximumFraction: 3) }
                let fixed = JSNumbers.number(JSNumbers.toFixed(number, 6))
                return JSNumbers.localeString(fixed, minimumFraction: 0, maximumFraction: 4)
            }
        }
    }

    /// The function names the engine understands, for completion and help.
    public static let functionNames: [String] = [
        "ABS", "AND", "AVERAGE", "AVERAGEIF", "AVG", "CEILING", "CHOOSE", "COLUMN", "COLUMNS", "CONCAT", "CONCATENATE",
        "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "DATE", "DATEDIF", "DAY", "DAYS", "EXACT", "EXP", "FLOOR", "FV",
        "HLOOKUP", "IF", "IFERROR", "IFNA", "IFS", "INDEX", "INT", "ISBLANK", "ISNUMBER", "ISTEXT", "LARGE", "LEFT",
        "LEN", "LN", "LOG", "LOG10", "LOWER", "MATCH", "MAX", "MEDIAN", "MID", "MIN", "MOD", "MODE", "MONTH", "NOT",
        "NOW", "NPV", "OR", "PERCENTILE", "PI", "PMT", "POWER", "PRODUCT", "PROPER", "PV", "RAND", "RANDBETWEEN",
        "RANK", "REPT", "RIGHT", "ROUND", "ROUNDDOWN", "ROUNDUP", "ROW", "ROWS", "SIGN", "SMALL", "SQRT", "STDEV",
        "STDEVP", "SUBSTITUTE", "SUM", "SUMIF", "SUMPRODUCT", "SWITCH", "TEXT", "TEXTJOIN", "TODAY", "TRIM", "TRUNC",
        "UPPER", "VALUE", "VAR", "VARP", "VLOOKUP", "XLOOKUP", "XOR", "YEAR",
    ]
}

/// The desktop's raw number patterns, written out so no regular expression is shared across threads.
enum RawPatterns {
    private static func isDigit(_ unit: UInt16) -> Bool { unit >= 48 && unit <= 57 }

    /// `^-?\d+(?:\.\d+)?$`
    static func plain(_ units: ArraySlice<UInt16>) -> Bool {
        var index = units.startIndex
        if index < units.endIndex && units[index] == 45 { index += 1 }
        let start = index
        while index < units.endIndex && isDigit(units[index]) { index += 1 }
        if index == start { return false }
        if index == units.endIndex { return true }
        guard units[index] == 46 else { return false }
        index += 1
        let fraction = index
        while index < units.endIndex && isDigit(units[index]) { index += 1 }
        return index > fraction && index == units.endIndex
    }

    /// `^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$`
    static func grouped(_ units: [UInt16]) -> Bool {
        var index = 0
        if index < units.count && units[index] == 45 { index += 1 }
        let start = index
        while index < units.count && isDigit(units[index]) && index - start < 3 { index += 1 }
        if index == start { return false }
        var groups = 0
        while index < units.count && units[index] == 44 {
            guard index + 3 < units.count, isDigit(units[index + 1]), isDigit(units[index + 2]), isDigit(units[index + 3]) else { return false }
            index += 4
            groups += 1
        }
        if groups == 0 { return false }
        if index == units.count { return true }
        guard units[index] == 46 else { return false }
        index += 1
        let fraction = index
        while index < units.count && isDigit(units[index]) { index += 1 }
        return index > fraction && index == units.count
    }
}

struct FormulaError: Error { let code: String }

/// Raised when the evaluation stack is deep; the named cell is evaluated on
/// its own first, then the waiting formulas continue. This keeps long chains
/// such as running totals from exhausting the thread's stack.
struct DeferredCell: Error { let cell: CellID }

struct CellID: Hashable {
    let sheet: Int
    let row: Int
    let column: Int
}

enum FormulaArg {
    case scalar(SpreadsheetValue)
    case matrix([[SpreadsheetValue]])
}

enum FormulaToken: Equatable {
    case number(Double)
    case text(String)
    case identifier(String)
    case op(String)
    case open
    case close
    case comma
}

final class FormulaEvaluator {
    let sheets: [SpreadsheetSheet]
    let activeSheetIndex: Int
    var results: [[String: SpreadsheetCellResult]]
    private var visiting = Set<CellID>()
    /// Approximate stack use: each nested cell and each nested expression adds to it.
    var stackUnits = 0
    var cellDepth = 0
    static let stackLimit = 800
    static let unitCost = 10
    /// The most cells one range may read; larger ranges give `#REF!` instead of stalling the device.
    static let rangeLimit = 250_000

    init(sheets: [SpreadsheetSheet], activeSheetIndex: Int) {
        self.sheets = sheets
        self.activeSheetIndex = activeSheetIndex
        results = Array(repeating: [:], count: sheets.count)
    }

    /// Evaluates every stored cell, sheet by sheet, in key order.
    func evaluateAll() {
        for index in sheets.indices {
            for key in sheets[index].cells.keys.sorted() {
                guard let reference = SpreadsheetReference.parse(key) else { continue }
                evaluateRoot(CellID(sheet: index, row: reference.row, column: reference.column))
            }
        }
    }

    private func cached(_ cell: CellID) -> SpreadsheetCellResult? {
        results[cell.sheet][SpreadsheetAddress.key(row: cell.row, column: cell.column)]
    }

    private func evaluateRoot(_ root: CellID) {
        var pending = [root]
        while let top = pending.last {
            if cached(top) != nil { pending.removeLast(); continue }
            do {
                _ = try evaluateCell(top)
                pending.removeLast()
            } catch let deferred as DeferredCell {
                if let index = pending.firstIndex(of: deferred.cell) {
                    // A chain that leads back to a waiting cell is a cycle.
                    for cell in pending[index...] where cached(cell) == nil { storeError("#CYCLE!", for: cell) }
                    pending.removeSubrange(index...)
                } else {
                    pending.append(deferred.cell)
                }
            } catch let error as FormulaError {
                storeError(error.code, for: top)
                pending.removeLast()
            } catch {
                storeError("#ERROR!", for: top)
                pending.removeLast()
            }
        }
    }

    private func storeError(_ code: String, for cell: CellID) {
        let key = SpreadsheetAddress.key(row: cell.row, column: cell.column)
        let raw = sheets[cell.sheet].cells[key]?.input ?? ""
        results[cell.sheet][key] = SpreadsheetCellResult(raw: raw, value: .text(code), display: code, error: code, isFormula: raw.utf16.first == 61, numeric: nil)
    }

    func findSheet(_ name: String) -> Int? {
        let lower = name.lowercased()
        return sheets.firstIndex { $0.id == name || $0.name.lowercased() == lower }
    }

    func evaluateCell(_ cell: CellID) throws -> SpreadsheetCellResult {
        let key = SpreadsheetAddress.key(row: cell.row, column: cell.column)
        if let existing = results[cell.sheet][key] { return existing }
        if visiting.contains(cell) { throw FormulaError(code: "#CYCLE!") }
        let data = sheets[cell.sheet].cells[key]
        let raw = data?.input ?? ""
        let style = data?.style
        let units = Array(raw.utf16)
        guard units.first == 61 else {
            let scalar = SpreadsheetEngine.parseRawScalar(raw)
            var numeric: Double?
            if case .number(let number) = scalar { numeric = number }
            let result = SpreadsheetCellResult(raw: raw, value: scalar, display: SpreadsheetEngine.format(scalar, style: style), error: nil, isFormula: false, numeric: numeric)
            results[cell.sheet][key] = result
            return result
        }
        if cellDepth > 0 && stackUnits + Self.unitCost > Self.stackLimit { throw DeferredCell(cell: cell) }
        stackUnits += Self.unitCost
        cellDepth += 1
        visiting.insert(cell)
        defer {
            stackUnits -= Self.unitCost
            cellDepth -= 1
            visiting.remove(cell)
        }
        let result: SpreadsheetCellResult
        do {
            let expression = JSNumbers.trim(String(decoding: units.dropFirst(), as: UTF16.self))
            let tokens = try FormulaParser.tokenize(expression)
            let parser = FormulaParser(evaluator: self, tokens: tokens, cell: cell)
            let value = try parser.run()
            let scalar: SpreadsheetValue
            switch value {
            case .scalar(let single): scalar = single
            case .matrix(let rows): scalar = rows.first?.first ?? .empty
            }
            if case .text(let text) = scalar, text.utf16.first == 35, let last = text.utf16.last, last == 33 || last == 47 || last == 63 {
                result = SpreadsheetCellResult(raw: raw, value: scalar, display: text, error: text, isFormula: true, numeric: nil)
            } else {
                var numeric: Double?
                if case .number(let number) = scalar, number.isFinite { numeric = number }
                result = SpreadsheetCellResult(raw: raw, value: scalar, display: SpreadsheetEngine.format(scalar, style: style), error: nil, isFormula: true, numeric: numeric)
            }
        } catch let error as FormulaError {
            result = SpreadsheetCellResult(raw: raw, value: .text(error.code), display: error.code, error: error.code, isFormula: true, numeric: nil)
        }
        results[cell.sheet][key] = result
        return result
    }
}

final class FormulaParser {
    private let evaluator: FormulaEvaluator
    private let tokens: [FormulaToken]
    private let cell: CellID
    private var position = 0

    init(evaluator: FormulaEvaluator, tokens: [FormulaToken], cell: CellID) {
        self.evaluator = evaluator
        self.tokens = tokens
        self.cell = cell
    }

    // MARK: Tokens

    private static func isDigit(_ unit: UInt16) -> Bool { unit >= 48 && unit <= 57 }
    private static func isLetter(_ unit: UInt16) -> Bool { (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) }
    private static func isArabic(_ unit: UInt16) -> Bool { unit >= 0x0600 && unit <= 0x06FF }
    private static func isIdentifierStart(_ unit: UInt16) -> Bool { isLetter(unit) || unit == 95 || unit == 36 || unit == 35 || isArabic(unit) }
    /// `[A-Za-z0-9_$!.?]` and Arabic letters.
    private static func isIdentifierPart(_ unit: UInt16) -> Bool {
        isLetter(unit) || isDigit(unit) || unit == 95 || unit == 36 || unit == 33 || unit == 46 || unit == 63 || isArabic(unit)
    }

    static func tokenize(_ expression: String) throws -> [FormulaToken] {
        let units = Array(expression.utf16)
        var tokens: [FormulaToken] = []
        var i = 0
        while i < units.count {
            let unit = units[i]
            if JSNumbers.isWhitespace(unit) { i += 1; continue }
            if unit == 34 {
                var text: [UInt16] = []
                i += 1
                while i < units.count {
                    if units[i] == 34 && i + 1 < units.count && units[i + 1] == 34 { text.append(34); i += 2 }
                    else if units[i] == 34 { i += 1; break }
                    else { text.append(units[i]); i += 1 }
                }
                tokens.append(.text(String(decoding: text, as: UTF16.self)))
                continue
            }
            if unit == 40 { tokens.append(.open); i += 1; continue }
            if unit == 41 { tokens.append(.close); i += 1; continue }
            if unit == 44 || unit == 59 { tokens.append(.comma); i += 1; continue }
            if i + 1 < units.count {
                let next = units[i + 1]
                if (unit == 60 && (next == 61 || next == 62)) || (unit == 62 && next == 61) || (unit == 33 && next == 61) {
                    tokens.append(.op(String(decoding: units[i...(i + 1)], as: UTF16.self)))
                    i += 2
                    continue
                }
            }
            // + - * / ^ & = < > : %
            if [43, 45, 42, 47, 94, 38, 61, 60, 62, 58, 37].contains(unit) {
                tokens.append(.op(String(decoding: [unit], as: UTF16.self)))
                i += 1
                continue
            }
            if isDigit(unit) || (unit == 46 && i + 1 < units.count && isDigit(units[i + 1])) {
                var literal: [UInt16] = []
                while i < units.count && (isDigit(units[i]) || [46, 101, 69, 43, 45].contains(units[i])) {
                    if units[i] == 43 || units[i] == 45 {
                        guard let last = literal.last, last == 101 || last == 69 else { break }
                    }
                    literal.append(units[i])
                    i += 1
                }
                let number = JSNumbers.number(String(decoding: literal, as: UTF16.self))
                if number.isNaN { throw FormulaError(code: "#VALUE!") }
                tokens.append(.number(number))
                continue
            }
            if unit == 39 || isIdentifierStart(unit) {
                var identifier: [UInt16] = []
                if unit == 39 {
                    identifier.append(units[i]); i += 1
                    while i < units.count && units[i] != 39 { identifier.append(units[i]); i += 1 }
                    if i < units.count { identifier.append(units[i]); i += 1 }
                } else if unit == 35 {
                    // An error literal such as #REF!, #N/A or #DIV/0!. The desktop loops
                    // forever on `#`, which cannot start its identifier loop; reading the
                    // whole literal here gives the error the formula names instead.
                    identifier.append(unit); i += 1
                    while i < units.count && (isIdentifierPart(units[i]) || units[i] == 47) { identifier.append(units[i]); i += 1 }
                }
                while i < units.count && isIdentifierPart(units[i]) { identifier.append(units[i]); i += 1 }
                tokens.append(.identifier(String(decoding: identifier, as: UTF16.self)))
                continue
            }
            throw FormulaError(code: "#VALUE!")
        }
        return tokens
    }

    // MARK: Grammar

    private func peek() -> FormulaToken? { position < tokens.count ? tokens[position] : nil }
    private func peek(at offset: Int) -> FormulaToken? { position + offset < tokens.count ? tokens[position + offset] : nil }
    @discardableResult
    private func consume() -> FormulaToken? {
        defer { position += 1 }
        return peek()
    }
    private func peekOperator(_ values: Set<String>) -> String? {
        if case .op(let value)? = peek(), values.contains(value) { return value }
        return nil
    }

    /// Counts one level of nesting against the stack budget.
    private func enter() throws {
        evaluator.stackUnits += FormulaEvaluator.unitCost
        if evaluator.stackUnits > FormulaEvaluator.stackLimit {
            evaluator.stackUnits -= FormulaEvaluator.unitCost
            if evaluator.cellDepth > 1 { throw DeferredCell(cell: cell) }
            throw FormulaError(code: "#ERROR!")
        }
    }
    private func leave() { evaluator.stackUnits -= FormulaEvaluator.unitCost }

    func run() throws -> FormulaArg {
        let out = try comparison()
        if position < tokens.count { throw FormulaError(code: "#VALUE!") }
        return out
    }

    private static let comparisonOperators: Set<String> = ["=", "<>", "!=", "<", "<=", ">", ">="]

    private func comparison() throws -> FormulaArg {
        try enter()
        defer { leave() }
        var left = try concat()
        while let op = peekOperator(Self.comparisonOperators) {
            consume()
            let right = try concat()
            left = .scalar(.bool(Formula.compare(Formula.unwrap(left), Formula.unwrap(right), op)))
        }
        return left
    }

    private func concat() throws -> FormulaArg {
        var left = try additive()
        while peekOperator(["&"]) != nil {
            consume()
            let right = try additive()
            left = .scalar(.text(Formula.string(Formula.unwrap(left)) + Formula.string(Formula.unwrap(right))))
        }
        return left
    }

    private func additive() throws -> FormulaArg {
        var left = try multiplicative()
        while let op = peekOperator(["+", "-"]) {
            consume()
            let right = try multiplicative()
            let a = try Formula.number(Formula.unwrap(left), strict: true)
            let b = try Formula.number(Formula.unwrap(right), strict: true)
            left = .scalar(.number(op == "+" ? a + b : a - b))
        }
        return left
    }

    private func multiplicative() throws -> FormulaArg {
        var left = try power()
        while let op = peekOperator(["*", "/"]) {
            consume()
            let right = try power()
            let a = try Formula.number(Formula.unwrap(left), strict: true)
            let b = try Formula.number(Formula.unwrap(right), strict: true)
            if op == "/" {
                if b == 0 { throw FormulaError(code: "#DIV/0!") }
                left = .scalar(.number(a / b))
            } else {
                left = .scalar(.number(a * b))
            }
        }
        return left
    }

    private func power() throws -> FormulaArg {
        var left = try unary()
        while peekOperator(["^"]) != nil {
            consume()
            let right = try unary()
            let base = try Formula.number(Formula.unwrap(left), strict: true)
            let exponent = try Formula.number(Formula.unwrap(right), strict: true)
            left = .scalar(.number(Formula.power(base, exponent)))
        }
        return left
    }

    private func unary() throws -> FormulaArg {
        if let op = peekOperator(["+", "-"]) {
            consume()
            try enter()
            defer { leave() }
            let operand = try unary()
            let value = try Formula.number(Formula.unwrap(operand), strict: true)
            return .scalar(.number(op == "-" ? -value : value))
        }
        var atom = try rangeOrPrimary()
        while peekOperator(["%"]) != nil {
            consume()
            let value = try Formula.number(Formula.unwrap(atom), strict: true)
            atom = .scalar(.number(value / 100))
        }
        return atom
    }

    private func rangeOrPrimary() throws -> FormulaArg {
        if case .identifier(let start)? = peek(), case .op(":")? = peek(at: 1) {
            consume()
            consume()
            guard case .identifier(let end)? = consume() else { throw FormulaError(code: "#REF!") }
            guard let a = SpreadsheetReference.parse(start), let b = SpreadsheetReference.parse(end) else { throw FormulaError(code: "#REF!") }
            let target: Int
            if let name = a.sheet {
                guard let found = evaluator.findSheet(name) else { throw FormulaError(code: "#REF!") }
                target = found
            } else {
                target = cell.sheet
            }
            let rows = Swift.min(a.row, b.row)...Swift.max(a.row, b.row)
            let columns = Swift.min(a.column, b.column)...Swift.max(a.column, b.column)
            if rows.count * columns.count > FormulaEvaluator.rangeLimit { throw FormulaError(code: "#REF!") }
            var matrix: [[SpreadsheetValue]] = []
            matrix.reserveCapacity(rows.count)
            for row in rows {
                var values: [SpreadsheetValue] = []
                values.reserveCapacity(columns.count)
                for column in columns {
                    let result = try evaluator.evaluateCell(CellID(sheet: target, row: row, column: column))
                    if let error = result.error { throw FormulaError(code: error) }
                    values.append(result.value)
                }
                matrix.append(values)
            }
            return .matrix(matrix)
        }
        return try primary()
    }

    private func primary() throws -> FormulaArg {
        guard let token = peek() else { throw FormulaError(code: "#VALUE!") }
        switch token {
        case .number(let number):
            consume()
            return .scalar(.number(number))
        case .text(let text):
            consume()
            return .scalar(.text(text))
        case .open:
            consume()
            let inner = try comparison()
            guard consume() == .close else { throw FormulaError(code: "#VALUE!") }
            return inner
        case .identifier(let raw):
            consume()
            let upper = raw.uppercased()
            if peek() == .open {
                consume()
                if upper == "IF" { return try ifCall() }
                if upper == "IFERROR" || upper == "IFNA" { return try ifErrorCall(upper) }
                var args: [FormulaArg] = []
                if peek() != .close {
                    while true {
                        args.append(try comparison())
                        if peek() == .comma { consume() } else { break }
                    }
                }
                try expectClose()
                return try Formula.call(upper, args, row: cell.row, column: cell.column)
            }
            if upper == "TRUE" { return .scalar(.bool(true)) }
            if upper == "FALSE" { return .scalar(.bool(false)) }
            if upper.hasPrefix("#") { throw FormulaError(code: upper) }
            guard let reference = SpreadsheetReference.parse(raw) else { throw FormulaError(code: "#NAME?") }
            let target: Int
            if let name = reference.sheet {
                guard let found = evaluator.findSheet(name) else { throw FormulaError(code: "#REF!") }
                target = found
            } else {
                target = cell.sheet
            }
            let result = try evaluator.evaluateCell(CellID(sheet: target, row: reference.row, column: reference.column))
            if let error = result.error { throw FormulaError(code: error) }
            return .scalar(result.value)
        default:
            throw FormulaError(code: "#VALUE!")
        }
    }

    private func ifCall() throws -> FormulaArg {
        let condition = try comparison()
        guard peek() == .comma else { throw FormulaError(code: "#VALUE!") }
        consume()
        if Formula.truthy(Formula.unwrap(condition)) {
            let value = try comparison()
            if peek() == .comma { consume(); skipExpression() }
            try expectClose()
            return value
        }
        skipExpression()
        var value = FormulaArg.scalar(.bool(false))
        if peek() == .comma {
            consume()
            value = try comparison()
        }
        try expectClose()
        return value
    }

    private func ifErrorCall(_ name: String) throws -> FormulaArg {
        var primary = FormulaArg.scalar(.empty)
        var caught: String?
        do { primary = try comparison() } catch let error as FormulaError { caught = error.code }
        guard peek() == .comma else { throw FormulaError(code: "#VALUE!") }
        consume()
        let fallback = try comparison()
        try expectClose()
        if let caught {
            if name == "IFNA" && caught != "#N/A" { throw FormulaError(code: caught) }
            return fallback
        }
        return primary
    }

    private func skipExpression() {
        var depth = 0
        while position < tokens.count {
            let token = tokens[position]
            if token == .open { depth += 1 }
            else if token == .close {
                if depth == 0 { break }
                depth -= 1
            } else if token == .comma && depth == 0 { break }
            position += 1
        }
    }

    private func expectClose() throws {
        guard consume() == .close else { throw FormulaError(code: "#VALUE!") }
    }
}
