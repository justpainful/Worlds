import Foundation

/// Value conversions and the built in functions, ported from the desktop
/// `callFunction`. Comments name the JavaScript behaviour where Swift differs.
enum Formula {
    typealias Value = SpreadsheetValue
    typealias Arg = FormulaArg

    // MARK: Conversions

    static func unwrap(_ arg: Arg) -> Value {
        switch arg {
        case .scalar(let value): return value
        case .matrix(let rows): return rows.first?.first ?? .empty
        }
    }

    static func flatten(_ args: [Arg]) -> [Value] {
        var out: [Value] = []
        for arg in args {
            switch arg {
            case .scalar(let value): out.append(value)
            case .matrix(let rows): for row in rows { out.append(contentsOf: row) }
            }
        }
        return out
    }

    /// JavaScript `Boolean(value)`.
    static func truthy(_ value: Value) -> Bool {
        switch value {
        case .empty: return false
        case .bool(let flag): return flag
        case .number(let number): return number != 0 && !number.isNaN
        case .text(let text): return !text.isEmpty
        }
    }

    /// JavaScript `String(value ?? "")`.
    static func string(_ value: Value?) -> String {
        switch value {
        case nil, .empty?: return ""
        case .bool(let flag)?: return flag ? "true" : "false"
        case .number(let number)?: return JSNumbers.toString(number)
        case .text(let text)?: return text
        }
    }

    static func withoutCommas(_ text: String) -> String {
        guard text.utf16.contains(44) else { return text }
        return String(text.unicodeScalars.filter { $0 != "," })
    }

    /// The desktop `toNumber`. A nil value is a missing argument (JavaScript `undefined`).
    static func number(_ value: Value?, strict: Bool = false) throws -> Double {
        let text: String
        switch value {
        case .number(let number)?: return number
        case .bool(let flag)?: return flag ? 1 : 0
        case .empty?: return 0
        case .text(let stored)?:
            if stored.isEmpty { return 0 }
            text = stored
        case nil:
            text = "undefined"
        }
        let cleaned = JSNumbers.trim(withoutCommas(SpreadsheetEngine.westernDigits(text)))
        if cleaned.utf16.last == 37 {
            let number = JSNumbers.number(String(decoding: cleaned.utf16.dropLast(), as: UTF16.self))
            if !number.isNaN { return number / 100 }
        }
        let number = JSNumbers.number(cleaned)
        if number.isNaN {
            if strict { throw FormulaError(code: "#VALUE!") }
            return 0
        }
        return number
    }

    /// The desktop `numericList`: numbers, booleans given directly, and numeric text.
    static func numbers(_ args: [Arg]) -> [Double] {
        var out: [Double] = []
        func text(_ value: String) {
            guard !JSNumbers.trim(value).isEmpty else { return }
            let number = JSNumbers.number(withoutCommas(value))
            if !number.isNaN { out.append(number) }
        }
        for arg in args {
            switch arg {
            case .matrix(let rows):
                for row in rows {
                    for value in row {
                        if case .number(let number) = value, number.isFinite { out.append(number) }
                        else if case .text(let stored) = value { text(stored) }
                    }
                }
            case .scalar(.number(let number)): if number.isFinite { out.append(number) }
            case .scalar(.bool(let flag)): out.append(flag ? 1 : 0)
            case .scalar(.text(let stored)): text(stored)
            case .scalar(.empty): break
            }
        }
        return out
    }

    private static func numericOrNaN(_ value: Value) -> Double {
        switch value {
        case .number(let number): return number
        case .empty: return .nan
        default:
            let text = string(value)
            return JSNumbers.trim(text).isEmpty ? .nan : JSNumbers.number(withoutCommas(text))
        }
    }

    /// JavaScript string comparison by UTF-16 code units.
    static func compareText(_ a: String, _ b: String, _ op: String) -> Bool {
        let x = Array(a.utf16)
        let y = Array(b.utf16)
        switch op {
        case "=": return x == y
        case "<>", "!=": return x != y
        case "<": return x.lexicographicallyPrecedes(y)
        case "<=": return !y.lexicographicallyPrecedes(x)
        case ">": return y.lexicographicallyPrecedes(x)
        case ">=": return !x.lexicographicallyPrecedes(y)
        default: return false
        }
    }

    static func compareNumbers(_ a: Double, _ b: Double, _ op: String) -> Bool {
        switch op {
        case "=": return a == b
        case "<>", "!=": return a != b
        case "<": return a < b
        case "<=": return a <= b
        case ">": return a > b
        case ">=": return a >= b
        default: return false
        }
    }

    /// The desktop `compareScalars`: numerically when both sides are numbers, otherwise case insensitive text.
    static func compare(_ a: Value, _ b: Value, _ op: String) -> Bool {
        let an = numericOrNaN(a)
        let bn = numericOrNaN(b)
        if !an.isNaN && !bn.isNaN { return compareNumbers(an, bn, op) }
        return compareText(string(a).lowercased(), string(b).lowercased(), op)
    }

    private static func isLineTerminator(_ unit: UInt16) -> Bool { unit == 10 || unit == 13 || unit == 0x2028 || unit == 0x2029 }

    /// Case insensitive `*` and `?` wildcards; like JavaScript `.`, they do not match line breaks.
    static func wildcard(_ pattern: [UInt16], _ text: [UInt16]) -> Bool {
        var p = 0
        var t = 0
        var star = -1
        var mark = 0
        while t < text.count {
            if p < pattern.count && pattern[p] == 42 {
                star = p; mark = t; p += 1
            } else if p < pattern.count && (pattern[p] == text[t] || (pattern[p] == 63 && !isLineTerminator(text[t]))) {
                p += 1; t += 1
            } else if star >= 0 && !isLineTerminator(text[mark]) {
                p = star + 1; mark += 1; t = mark
            } else {
                return false
            }
        }
        while p < pattern.count && pattern[p] == 42 { p += 1 }
        return p == pattern.count
    }

    /// The desktop `toCriteriaMatcher` for SUMIF, COUNTIF and AVERAGEIF.
    static func matcher(_ criteria: Value) -> (Value) -> Bool {
        if case .number(let target) = criteria {
            return { value in
                let number: Double
                if case .number(let stored) = value { number = stored } else { number = JSNumbers.number(withoutCommas(string(value))) }
                return !number.isNaN && number == target
            }
        }
        if case .bool(let flag) = criteria { return { truthy($0) == flag } }
        let text = JSNumbers.trim(string(criteria))
        let units = Array(text.utf16)
        var operatorLength = 0
        if units.count >= 2, ["<=", ">=", "<>", "!="].contains(String(decoding: units[0..<2], as: UTF16.self)) { operatorLength = 2 }
        else if let first = units.first, first == 60 || first == 62 || first == 61 { operatorLength = 1 }
        if operatorLength > 0 && !units[operatorLength...].contains(where: isLineTerminator) {
            let op = String(decoding: units[0..<operatorLength], as: UTF16.self)
            let rhs = JSNumbers.trim(String(decoding: units[operatorLength...], as: UTF16.self))
            let rhsNumber = rhs.isEmpty ? Double.nan : JSNumbers.number(withoutCommas(rhs))
            let rhsLower = rhs.lowercased()
            return { value in
                let number = numericOrNaN(value)
                if !rhsNumber.isNaN && !number.isNaN { return compareNumbers(number, rhsNumber, op) }
                return compareText(string(value).lowercased(), rhsLower, op)
            }
        }
        if text.utf16.contains(42) || text.utf16.contains(63) {
            let pattern = Array(text.lowercased().utf16)
            return { value in wildcard(pattern, Array(string(value).lowercased().utf16)) }
        }
        let lower = Array(text.lowercased().utf16)
        let maybe = text.isEmpty ? Double.nan : JSNumbers.number(withoutCommas(text))
        if !maybe.isNaN {
            return { value in
                let number: Double
                if case .number(let stored) = value { number = stored } else { number = JSNumbers.number(withoutCommas(string(value))) }
                return (!number.isNaN && number == maybe) || Array(string(value).lowercased().utf16) == lower
            }
        }
        return { value in Array(string(value).lowercased().utf16) == lower }
    }

    /// JavaScript `Math.pow`, which gives NaN for a NaN exponent and for 1 or -1 to an infinite power.
    static func power(_ base: Double, _ exponent: Double) -> Double {
        if exponent.isNaN { return .nan }
        if abs(base) == 1 && exponent.isInfinite { return .nan }
        return pow(base, exponent)
    }

    // MARK: Arguments

    /// JavaScript `unwrapScalar(args[i])`, nil when the argument is missing.
    static func argument(_ args: [Arg], _ index: Int) -> Value? { index < args.count ? unwrap(args[index]) : nil }

    /// JavaScript `unwrapScalar(args[i] ?? fallback)`: a missing argument or an empty cell takes the fallback.
    static func argument(_ args: [Arg], _ index: Int, or fallback: Value) -> Value {
        guard index < args.count else { return fallback }
        if case .scalar(.empty) = args[index] { return fallback }
        return unwrap(args[index])
    }

    /// JavaScript `args[i] ? ... : ...`: a range is always true.
    static func present(_ args: [Arg], _ index: Int) -> Bool {
        guard index < args.count else { return false }
        if case .scalar(let value) = args[index] { return truthy(value) }
        return true
    }

    static func need(_ args: [Arg], _ count: Int) throws { if args.count < count { throw FormulaError(code: "#VALUE!") } }

    static func table(_ arg: Arg) -> [[Value]] {
        switch arg {
        case .matrix(let rows): return rows
        case .scalar(let value): return [[value]]
        }
    }

    static func text(_ args: [Arg], _ index: Int) -> String { string(argument(args, index)) }

    static func floorNumber(_ args: [Arg], _ index: Int) throws -> Double { try number(argument(args, index), strict: true).rounded(.down) }

    /// `slice` on UTF-16 code units with JavaScript's index rules.
    static func slice(_ units: [UInt16], _ start: Double, _ end: Double? = nil) -> String {
        func clamp(_ value: Double) -> Int {
            if value.isNaN { return 0 }
            let count = Double(units.count)
            if value < 0 { return Int(Swift.max(count + value.rounded(.towardZero), 0)) }
            return Int(Swift.min(value.rounded(.towardZero), count))
        }
        let from = clamp(start)
        let to = end.map(clamp) ?? units.count
        guard from < to else { return "" }
        return String(decoding: units[from..<to], as: UTF16.self)
    }

    static func replaceAll(_ text: String, _ old: String, _ new: String) -> String {
        let source = Array(text.utf16)
        let needle = Array(old.utf16)
        let replacement = Array(new.utf16)
        guard !needle.isEmpty, needle.count <= source.count else { return text }
        var out: [UInt16] = []
        var index = 0
        while index < source.count {
            if index + needle.count <= source.count && source[index..<index + needle.count].elementsEqual(needle) {
                out.append(contentsOf: replacement)
                index += needle.count
            } else {
                out.append(source[index])
                index += 1
            }
        }
        return String(decoding: out, as: UTF16.self)
    }

    private static func isWordUnit(_ unit: UInt16) -> Bool {
        (unit >= 48 && unit <= 57) || (unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122) || unit == 95
    }

    /// `replace(/\b\w/g, c => c.toUpperCase())`.
    static func proper(_ text: String) -> String {
        var units = Array(text.utf16)
        for index in units.indices where isWordUnit(units[index]) && (index == 0 || !isWordUnit(units[index - 1])) {
            if units[index] >= 97 && units[index] <= 122 { units[index] -= 32 }
        }
        return String(decoding: units, as: UTF16.self)
    }

    /// `trim().replace(/\s+/g, " ")`.
    static func collapseSpaces(_ text: String) -> String {
        var out: [UInt16] = []
        var inSpace = false
        for unit in Array(JSNumbers.trim(text).utf16) {
            if JSNumbers.isWhitespace(unit) {
                if !inSpace { out.append(32); inSpace = true }
            } else {
                out.append(unit); inSpace = false
            }
        }
        return String(decoding: out, as: UTF16.self)
    }

    // MARK: Dates

    static let millisecondsPerDay = 86_400_000.0

    /// Days since 1970-01-01 for a proleptic Gregorian date.
    static func days(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yearOfEra = y - era * 400
        let monthIndex = (month + 9) % 12
        let dayOfYear = (153 * monthIndex + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    static func civil(days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let dayOfEra = z - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let monthIndex = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * monthIndex + 2) / 5 + 1
        let month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9
        return (yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }

    static func daysInMonth(year: Int, month: Int) -> Int {
        days(year: month == 12 ? year + 1 : year, month: month == 12 ? 1 : month + 1, day: 1) - days(year: year, month: month, day: 1)
    }

    /// Calendar parts of a time in milliseconds, or nil for an invalid date.
    static func parts(_ milliseconds: Double) -> (year: Int, month: Int, day: Int)? {
        guard milliseconds.isFinite, abs(milliseconds) <= 8.64e15 else { return nil }
        return civil(days: Int((milliseconds / millisecondsPerDay).rounded(.down)))
    }

    private static func digits(_ units: ArraySlice<UInt16>) -> Int? {
        guard !units.isEmpty, units.allSatisfy({ $0 >= 48 && $0 <= 57 }) else { return nil }
        return units.reduce(0) { $0 * 10 + Int($1 - 48) }
    }

    /// `YYYY-MM-DD` or `YYYY/MM/DD`, optionally followed by `T` or a space and `HH:mm[:ss[.sss]]` and `Z`.
    static func parseDateText(_ text: String) -> Double? {
        var units = Array(JSNumbers.trim(text).utf16)
        if units.last == 90 { units.removeLast() }
        guard units.count >= 10, let year = digits(units[0..<4]), units[4] == 45 || units[4] == 47, units[7] == units[4],
              let month = digits(units[5..<7]), let day = digits(units[8..<10]),
              (1...12).contains(month), day >= 1, day <= daysInMonth(year: year, month: month) else { return nil }
        var milliseconds = Double(days(year: year, month: month, day: day)) * millisecondsPerDay
        guard units.count > 10 else { return milliseconds }
        guard units[10] == 84 || units[10] == 32, units.count >= 16, units[13] == 58,
              let hour = digits(units[11..<13]), let minute = digits(units[14..<16]), hour <= 23, minute <= 59 else { return nil }
        var seconds = 0.0
        if units.count > 16 {
            guard units.count >= 19, units[16] == 58, let whole = digits(units[17..<19]), whole <= 59 else { return nil }
            seconds = Double(whole)
            if units.count > 19 {
                guard units[19] == 46, let fraction = digits(units[20...]) else { return nil }
                seconds += Double(fraction) / pow(10, Double(units.count - 20))
            }
        }
        milliseconds += (Double(hour) * 3600 + Double(minute) * 60 + seconds) * 1000
        return milliseconds.rounded(.down)
    }

    /// The desktop `parseDateValue`, in milliseconds since 1970 (UTC wall clock).
    /// Serial numbers count days from 1899-12-30; numbers above 1e10 are milliseconds.
    static func date(_ value: Value?) throws -> Double {
        if case .number(let number)? = value {
            let milliseconds = number > 1e10 ? number : Double(days(year: 1899, month: 12, day: 30)) * millisecondsPerDay + number * millisecondsPerDay
            return milliseconds.isFinite && abs(milliseconds) <= 8.64e15 ? milliseconds.rounded(.towardZero) : .nan
        }
        guard let milliseconds = parseDateText(string(value)) else { throw FormulaError(code: "#VALUE!") }
        return milliseconds
    }

    private static func pad(_ value: Int) -> String { value < 10 && value >= 0 ? "0\(value)" : String(value) }

    static func dateText(year: Int, month: Int, day: Int) -> String { "\(year)-\(pad(month))-\(pad(day))" }

    // MARK: Functions

    private static func paymentType(_ args: [Arg]) throws -> Double {
        guard present(args, 4) else { return 0 }
        return try number(argument(args, 4), strict: true) != 0 ? 1 : 0
    }

    private static func optionalNumber(_ args: [Arg], _ index: Int) throws -> Double {
        try present(args, index) ? number(argument(args, index), strict: true) : 0
    }

    private static func roundingFactor(_ args: [Arg]) throws -> Double {
        let digits = try present(args, 1) ? floorNumber(args, 1) : 0
        return power(10, digits)
    }

    // swiftlint:disable:next cyclomatic_complexity function_body_length
    static func call(_ name: String, _ args: [Arg], row: Int, column: Int) throws -> Arg {
        switch name {
        case "SUM":
            return .scalar(.number(numbers(args).reduce(0, +)))
        case "AVERAGE", "AVG":
            let values = numbers(args)
            if values.isEmpty { throw FormulaError(code: "#DIV/0!") }
            return .scalar(.number(values.reduce(0, +) / Double(values.count)))
        case "MIN":
            let values = numbers(args)
            return .scalar(.number(values.isEmpty ? 0 : values.dropFirst().reduce(values[0]) { JSNumbers.min($0, $1) }))
        case "MAX":
            let values = numbers(args)
            return .scalar(.number(values.isEmpty ? 0 : values.dropFirst().reduce(values[0]) { JSNumbers.max($0, $1) }))
        case "COUNT":
            return .scalar(.number(Double(numbers(args).count)))
        case "COUNTA":
            return .scalar(.number(Double(flatten(args).filter { $0 != .empty && !JSNumbers.trim(string($0)).isEmpty }.count)))
        case "COUNTBLANK":
            return .scalar(.number(Double(flatten(args).filter { $0 == .empty || JSNumbers.trim(string($0)).isEmpty }.count)))
        case "PRODUCT":
            let values = numbers(args)
            return .scalar(.number(values.isEmpty ? 0 : values.reduce(1, *)))
        case "SUMPRODUCT":
            if args.isEmpty { return .scalar(.number(0)) }
            let lists = try args.map { arg in try flatten([arg]).map { try number($0) } }
            let length = lists[0].count
            if lists.contains(where: { $0.count != length }) { throw FormulaError(code: "#VALUE!") }
            var total = 0.0
            for index in 0..<length { total += lists.reduce(1) { $0 * $1[index] } }
            return .scalar(.number(total))
        case "MEDIAN":
            let values = numbers(args).sorted()
            if values.isEmpty { throw FormulaError(code: "#NUM!") }
            let middle = values.count / 2
            return .scalar(.number(values.count % 2 != 0 ? values[middle] : (values[middle - 1] + values[middle]) / 2))
        case "MODE":
            let values = numbers(args)
            if values.isEmpty { throw FormulaError(code: "#N/A") }
            var counts: [Double: Int] = [:]
            var best = values[0]
            var top = 0
            for value in values {
                let count = (counts[value] ?? 0) + 1
                counts[value] = count
                if count > top { top = count; best = value }
            }
            return .scalar(.number(best))
        case "STDEV", "STDEVP", "VAR", "VARP":
            let values = numbers(args)
            let denominator = (name == "STDEV" || name == "VAR") ? values.count - 1 : values.count
            if denominator <= 0 { throw FormulaError(code: "#DIV/0!") }
            let mean = values.reduce(0, +) / Double(values.count)
            let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(denominator)
            return .scalar(.number(name.hasPrefix("STDEV") ? variance.squareRoot() : variance))
        case "PERCENTILE":
            try need(args, 2)
            let values = numbers([args[0]]).sorted()
            let k = try number(argument(args, 1), strict: true)
            if values.isEmpty || k < 0 || k > 1 { throw FormulaError(code: "#NUM!") }
            if k.isNaN { return .scalar(.number(.nan)) }
            let position = k * Double(values.count - 1)
            let low = Int(position.rounded(.down))
            let high = Int(position.rounded(.up))
            return .scalar(.number(values[low] + (values[high] - values[low]) * (position - Double(low))))
        case "LARGE", "SMALL":
            try need(args, 2)
            let values = name == "LARGE" ? numbers([args[0]]).sorted(by: >) : numbers([args[0]]).sorted()
            let k = try floorNumber(args, 1)
            if k < 1 || k > Double(values.count) { throw FormulaError(code: "#NUM!") }
            if k.isNaN { return .scalar(.empty) }
            return .scalar(.number(values[Int(k) - 1]))
        case "RANK":
            try need(args, 2)
            let target = try number(argument(args, 0), strict: true)
            let ascending = try present(args, 2) ? number(argument(args, 2)) != 0 : false
            let values = ascending ? numbers([args[1]]).sorted() : numbers([args[1]]).sorted(by: >)
            guard let index = values.firstIndex(of: target) else { throw FormulaError(code: "#N/A") }
            return .scalar(.number(Double(index + 1)))
        case "SUMIF", "AVERAGEIF":
            try need(args, 2)
            let range = flatten([args[0]])
            let test = matcher(unwrap(args[1]))
            let values = present(args, 2) ? flatten([args[2]]) : range
            var sum = 0.0
            var count = 0
            for index in range.indices where test(range[index]) {
                sum += try number(index < values.count ? values[index] : .number(0))
                count += 1
            }
            if name == "SUMIF" { return .scalar(.number(sum)) }
            if count == 0 { throw FormulaError(code: "#DIV/0!") }
            return .scalar(.number(sum / Double(count)))
        case "COUNTIF":
            try need(args, 2)
            let test = matcher(unwrap(args[1]))
            return .scalar(.number(Double(flatten([args[0]]).filter(test).count)))
        case "IFS":
            var index = 0
            while index + 1 < args.count {
                if truthy(unwrap(args[index])) { return args[index + 1] }
                index += 2
            }
            throw FormulaError(code: "#N/A")
        case "SWITCH":
            try need(args, 3)
            let expression = unwrap(args[0])
            var index = 1
            while index + 1 < args.count {
                if compare(expression, unwrap(args[index]), "=") { return args[index + 1] }
                index += 2
            }
            if args.count % 2 == 0 { return args[args.count - 1] }
            throw FormulaError(code: "#N/A")
        case "CHOOSE":
            try need(args, 2)
            let index = try floorNumber(args, 0)
            if index < 1 || index >= Double(args.count) { throw FormulaError(code: "#VALUE!") }
            if index.isNaN { return .scalar(.empty) }
            return args[Int(index)]
        case "AND":
            return .scalar(.bool(flatten(args).allSatisfy(truthy)))
        case "OR":
            return .scalar(.bool(flatten(args).contains(where: truthy)))
        case "XOR":
            return .scalar(.bool(flatten(args).filter(truthy).count % 2 == 1))
        case "NOT":
            return .scalar(.bool(!truthy(argument(args, 0, or: .bool(false)))))
        case "ISBLANK":
            let value = argument(args, 0, or: .empty)
            return .scalar(.bool(value == .empty || value == .text("")))
        case "ISNUMBER":
            if case .number(let number) = argument(args, 0, or: .empty) { return .scalar(.bool(number.isFinite)) }
            return .scalar(.bool(false))
        case "ISTEXT":
            if case .text = argument(args, 0, or: .empty) { return .scalar(.bool(true)) }
            return .scalar(.bool(false))
        case "ABS":
            return .scalar(.number(abs(try number(argument(args, 0, or: .number(0)), strict: true))))
        case "SIGN":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            return .scalar(.number(value.isNaN ? .nan : (value > 0 ? 1 : (value < 0 ? -1 : value))))
        case "SQRT":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            if value < 0 { throw FormulaError(code: "#NUM!") }
            return .scalar(.number(value.squareRoot()))
        case "POWER":
            let base = try number(argument(args, 0, or: .number(0)), strict: true)
            let exponent = try number(argument(args, 1, or: .number(1)), strict: true)
            return .scalar(.number(power(base, exponent)))
        case "EXP":
            return .scalar(.number(exp(try number(argument(args, 0, or: .number(0)), strict: true))))
        case "LN":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            if value <= 0 { throw FormulaError(code: "#NUM!") }
            return .scalar(.number(log(value)))
        case "LOG", "LOG10":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            let base = try name == "LOG10" ? 10 : (present(args, 1) ? number(argument(args, 1), strict: true) : 10)
            if value <= 0 || base <= 0 || base == 1 { throw FormulaError(code: "#NUM!") }
            return .scalar(.number(log(value) / log(base)))
        case "MOD":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            let divisor = try number(argument(args, 1, or: .number(0)), strict: true)
            if divisor == 0 { throw FormulaError(code: "#DIV/0!") }
            return .scalar(.number(value - divisor * (value / divisor).rounded(.down)))
        case "INT", "FLOOR":
            return .scalar(.number(try number(argument(args, 0, or: .number(0)), strict: true).rounded(.down)))
        case "CEILING":
            return .scalar(.number(try number(argument(args, 0, or: .number(0)), strict: true).rounded(.up)))
        case "TRUNC":
            return .scalar(.number(try number(argument(args, 0, or: .number(0)), strict: true).rounded(.towardZero)))
        case "ROUND":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            let factor = try roundingFactor(args)
            return .scalar(.number(JSNumbers.round(value * factor) / factor))
        case "ROUNDUP":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            let factor = try roundingFactor(args)
            return .scalar(.number((value >= 0 ? (value * factor).rounded(.up) : (value * factor).rounded(.down)) / factor))
        case "ROUNDDOWN":
            let value = try number(argument(args, 0, or: .number(0)), strict: true)
            let factor = try roundingFactor(args)
            return .scalar(.number((value * factor).rounded(.towardZero) / factor))
        case "PI":
            return .scalar(.number(Double.pi))
        case "RAND":
            return .scalar(.number(Double.random(in: 0..<1)))
        case "RANDBETWEEN":
            let low = try number(argument(args, 0, or: .number(0)), strict: true).rounded(.up)
            let high = try number(argument(args, 1, or: .number(1)), strict: true).rounded(.down)
            if low > high { throw FormulaError(code: "#NUM!") }
            if !low.isFinite || !high.isFinite { return .scalar(.number(.nan)) }
            return .scalar(.number((Double.random(in: 0..<1) * (high - low + 1)).rounded(.down) + low))
        case "VLOOKUP":
            try need(args, 3)
            let needle = unwrap(args[0])
            let rows = table(args[1])
            let index = try floorNumber(args, 2) - 1
            let approximate = args.count > 3 ? truthy(unwrap(args[3])) : false
            if index < 0 || (!rows.isEmpty && index >= Double(rows[0].count)) { throw FormulaError(code: "#REF!") }
            func pick(_ row: [Value]) -> Arg {
                guard !index.isNaN, Int(index) < row.count else { return .scalar(.empty) }
                return .scalar(row[Int(index)])
            }
            if let row = rows.first(where: { compare($0.first ?? .empty, needle, "=") }) { return pick(row) }
            if approximate, let row = rows.last(where: { compare($0.first ?? .empty, needle, "<=") }) { return pick(row) }
            throw FormulaError(code: "#N/A")
        case "HLOOKUP":
            try need(args, 3)
            let needle = unwrap(args[0])
            let rows = table(args[1])
            let index = try floorNumber(args, 2) - 1
            if index < 0 || index >= Double(rows.count) { throw FormulaError(code: "#REF!") }
            let header = rows.first ?? []
            guard let column = header.firstIndex(where: { compare($0, needle, "=") }) else { throw FormulaError(code: "#N/A") }
            if index.isNaN { throw FormulaError(code: "#ERROR!") }
            let target = rows[Int(index)]
            return .scalar(column < target.count ? target[column] : .empty)
        case "XLOOKUP":
            try need(args, 3)
            let needle = unwrap(args[0])
            let keys = flatten([args[1]])
            let values = flatten([args[2]])
            if let index = keys.firstIndex(where: { compare($0, needle, "=") }) { return .scalar(index < values.count ? values[index] : .empty) }
            if args.count > 3 { return .scalar(unwrap(args[3])) }
            throw FormulaError(code: "#N/A")
        case "INDEX":
            try need(args, 2)
            let rows = table(args[0])
            let rowIndex = try floorNumber(args, 1) - 1
            let columnIndex = try args.count > 2 ? floorNumber(args, 2) - 1 : 0
            if rowIndex < 0 || columnIndex < 0 || rowIndex >= Double(rows.count) || columnIndex >= Double(rows.first?.count ?? 0) {
                throw FormulaError(code: "#REF!")
            }
            if rowIndex.isNaN { throw FormulaError(code: "#ERROR!") }
            if columnIndex.isNaN { return .scalar(.empty) }
            let target = rows[Int(rowIndex)]
            return .scalar(Int(columnIndex) < target.count ? target[Int(columnIndex)] : .empty)
        case "MATCH":
            try need(args, 2)
            let needle = unwrap(args[0])
            if let index = flatten([args[1]]).firstIndex(where: { compare($0, needle, "=") }) { return .scalar(.number(Double(index + 1))) }
            throw FormulaError(code: "#N/A")
        case "ROW":
            return .scalar(.number(Double(row + 1)))
        case "COLUMN":
            return .scalar(.number(Double(column + 1)))
        case "ROWS":
            if let first = args.first, case .matrix(let rows) = first { return .scalar(.number(Double(rows.count))) }
            return .scalar(.number(1))
        case "COLUMNS":
            if let first = args.first, case .matrix(let rows) = first { return .scalar(.number(Double(rows.first?.count ?? 1))) }
            return .scalar(.number(1))
        case "PMT":
            try need(args, 3)
            let rate = try number(argument(args, 0), strict: true)
            let periods = try number(argument(args, 1), strict: true)
            let presentValue = try number(argument(args, 2), strict: true)
            let future = try optionalNumber(args, 3)
            let type = try paymentType(args)
            if periods == 0 { throw FormulaError(code: "#DIV/0!") }
            if rate == 0 { return .scalar(.number(-(presentValue + future) / periods)) }
            let factor = power(1 + rate, periods)
            return .scalar(.number((-rate * (presentValue * factor + future)) / ((1 + rate * type) * (factor - 1))))
        case "FV":
            try need(args, 3)
            let rate = try number(argument(args, 0), strict: true)
            let periods = try number(argument(args, 1), strict: true)
            let payment = try number(argument(args, 2), strict: true)
            let presentValue = try optionalNumber(args, 3)
            let type = try paymentType(args)
            if rate == 0 { return .scalar(.number(-(presentValue + payment * periods))) }
            let factor = power(1 + rate, periods)
            return .scalar(.number(-(presentValue * factor + (payment * (1 + rate * type) * (factor - 1)) / rate)))
        case "PV":
            try need(args, 3)
            let rate = try number(argument(args, 0), strict: true)
            let periods = try number(argument(args, 1), strict: true)
            let payment = try number(argument(args, 2), strict: true)
            let future = try optionalNumber(args, 3)
            let type = try paymentType(args)
            if rate == 0 { return .scalar(.number(-(future + payment * periods))) }
            let factor = power(1 + rate, periods)
            return .scalar(.number(-(future + (payment * (1 + rate * type) * (factor - 1)) / rate) / factor))
        case "NPV":
            try need(args, 2)
            let rate = try number(argument(args, 0), strict: true)
            var total = 0.0
            for (index, flow) in numbers(Array(args.dropFirst())).enumerated() { total += flow / power(1 + rate, Double(index + 1)) }
            return .scalar(.number(total))
        case "LEN":
            return .scalar(.number(Double(text(args, 0).utf16.count)))
        case "TRIM":
            return .scalar(.text(collapseSpaces(text(args, 0))))
        case "UPPER":
            return .scalar(.text(text(args, 0).uppercased()))
        case "LOWER":
            return .scalar(.text(text(args, 0).lowercased()))
        case "PROPER":
            return .scalar(.text(proper(text(args, 0))))
        case "CONCAT", "CONCATENATE":
            return .scalar(.text(flatten(args).map { string($0) }.joined()))
        case "TEXTJOIN":
            try need(args, 3)
            let delimiter = text(args, 0)
            let items = flatten(Array(args.dropFirst(2))).map { string($0) }
            let kept = truthy(unwrap(args[1])) ? items.filter { !$0.isEmpty } : items
            return .scalar(.text(kept.joined(separator: delimiter)))
        case "LEFT":
            let units = Array(text(args, 0).utf16)
            let count = try args.count > 1 ? JSNumbers.max(0, floorNumber(args, 1)) : 1
            return .scalar(.text(slice(units, 0, count)))
        case "RIGHT":
            let units = Array(text(args, 0).utf16)
            let count = try args.count > 1 ? JSNumbers.max(0, floorNumber(args, 1)) : 1
            return .scalar(.text(count == 0 ? "" : slice(units, -count)))
        case "MID":
            try need(args, 3)
            let units = Array(text(args, 0).utf16)
            let start = JSNumbers.max(1, try floorNumber(args, 1)) - 1
            let length = JSNumbers.max(0, try floorNumber(args, 2))
            return .scalar(.text(slice(units, start, start + length)))
        case "SUBSTITUTE":
            try need(args, 3)
            return .scalar(.text(replaceAll(text(args, 0), text(args, 1), text(args, 2))))
        case "REPT":
            let count = JSNumbers.max(0, JSNumbers.min(1000, try number(argument(args, 1, or: .number(1)), strict: true).rounded(.down)))
            return .scalar(.text(count.isNaN || count < 1 ? "" : String(repeating: text(args, 0), count: Int(count))))
        case "VALUE":
            return .scalar(.number(try number(argument(args, 0, or: .number(0)), strict: true)))
        case "TEXT":
            return .scalar(.text(string(argument(args, 0, or: .text("")))))
        case "EXACT":
            return .scalar(.bool(Array(text(args, 0).utf16) == Array(text(args, 1).utf16)))
        case "TODAY", "NOW":
            let now = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: Date())
            let today = dateText(year: now.year ?? 1970, month: now.month ?? 1, day: now.day ?? 1)
            if name == "TODAY" { return .scalar(.text(today)) }
            return .scalar(.text(today + " " + pad(now.hour ?? 0) + ":" + pad(now.minute ?? 0)))
        case "DATE":
            let year = try number(argument(args, 0, or: .number(2026)), strict: true).rounded(.down)
            let month = try number(argument(args, 1, or: .number(1)), strict: true).rounded(.down)
            let day = try number(argument(args, 2, or: .number(1)), strict: true).rounded(.down)
            guard year.isFinite, month.isFinite, day.isFinite, abs(year) < 300_000, abs(month) < 4_000_000, abs(day) < 110_000_000 else {
                return .scalar(.text("NaN-NaN-NaN"))
            }
            var fullYear = Int(year)
            if (0...99).contains(fullYear) { fullYear += 1900 }
            let totalMonths = fullYear * 12 + Int(month) - 1
            let normalizedYear = totalMonths >= 0 ? totalMonths / 12 : (totalMonths - 11) / 12
            let normalizedMonth = totalMonths - normalizedYear * 12 + 1
            let serial = days(year: normalizedYear, month: normalizedMonth, day: 1) + Int(day) - 1
            guard abs(Double(serial)) <= 100_000_000 else { return .scalar(.text("NaN-NaN-NaN")) }
            let result = civil(days: serial)
            return .scalar(.text(dateText(year: result.year, month: result.month, day: result.day)))
        case "YEAR", "MONTH", "DAY":
            let milliseconds = try date(argument(args, 0))
            guard let calendarDate = parts(milliseconds) else { return .scalar(.number(.nan)) }
            return .scalar(.number(Double(name == "YEAR" ? calendarDate.year : (name == "MONTH" ? calendarDate.month : calendarDate.day))))
        case "DAYS":
            let end = try date(argument(args, 0))
            let start = try date(argument(args, 1))
            return .scalar(.number(JSNumbers.round((end - start) / millisecondsPerDay)))
        case "DATEDIF":
            let start = try date(argument(args, 0))
            let end = try date(argument(args, 1))
            let unit = string(argument(args, 2, or: .text("D"))).uppercased()
            let difference = JSNumbers.round((end - start) / millisecondsPerDay)
            if unit == "Y" { return .scalar(.number((difference / 365.25).rounded(.down))) }
            if unit == "M" {
                guard let a = parts(start), let b = parts(end) else { return .scalar(.number(.nan)) }
                return .scalar(.number(Double((b.year - a.year) * 12 + (b.month - a.month))))
            }
            return .scalar(.number(difference))
        default:
            throw FormulaError(code: "#NAME?")
        }
    }
}
