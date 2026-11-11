import Foundation

/// JavaScript number and string semantics used by the desktop engine
/// (`src/spreadsheet/engine.ts`). Every function here is deterministic and
/// independent of the device locale, so a formula shows the same text on
/// every device.
enum JSNumbers {
    /// The shortest round trip decimal digits of a finite, nonzero magnitude,
    /// as `0.d1d2...dk * 10^point`. Swift and JavaScript both print the
    /// shortest digits that read back as the same double.
    static func shortestDigits(_ magnitude: Double) -> (digits: [UInt8], point: Int) {
        let text = magnitude.description
        var mantissa = Substring(text)
        var exponent = 0
        if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = text[text.startIndex..<e]
            exponent = Int(text[text.index(after: e)...]) ?? 0
        }
        var integerPart = mantissa
        var fractionPart = Substring("")
        if let dot = mantissa.firstIndex(of: ".") {
            integerPart = mantissa[mantissa.startIndex..<dot]
            fractionPart = mantissa[mantissa.index(after: dot)...]
        }
        var digits: [UInt8] = []
        for scalar in integerPart.unicodeScalars where scalar.value >= 48 && scalar.value <= 57 { digits.append(UInt8(scalar.value - 48)) }
        let integerCount = digits.count
        for scalar in fractionPart.unicodeScalars where scalar.value >= 48 && scalar.value <= 57 { digits.append(UInt8(scalar.value - 48)) }
        var point = integerCount + exponent
        var start = 0
        while start < digits.count && digits[start] == 0 { start += 1; point -= 1 }
        var end = digits.count
        while end > start && digits[end - 1] == 0 { end -= 1 }
        return (Array(digits[start..<end]), point)
    }

    private static func text(_ digits: ArraySlice<UInt8>) -> String {
        String(String.UnicodeScalarView(digits.map { Unicode.Scalar($0 + 48) }))
    }

    private static func zeros(_ count: Int) -> String { count > 0 ? String(repeating: "0", count: count) : "" }

    /// `String(number)` in JavaScript.
    static func toString(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value == 0 { return "0" }
        if value.isInfinite { return value > 0 ? "Infinity" : "-Infinity" }
        if value < 0 { return "-" + toString(-value) }
        let (digits, n) = shortestDigits(value)
        let k = digits.count
        if k <= n && n <= 21 { return text(digits[...]) + zeros(n - k) }
        if 0 < n && n <= 21 { return text(digits[0..<n]) + "." + text(digits[n...]) }
        if -6 < n && n <= 0 { return "0." + zeros(-n) + text(digits[...]) }
        let e = n - 1
        let head = text(digits[0..<1])
        let tail = k > 1 ? "." + text(digits[1...]) : ""
        return head + tail + "e" + (e >= 0 ? "+" : "-") + String(abs(e))
    }

    /// Integer and fraction digits of a magnitude, from its shortest digits.
    private static func split(_ magnitude: Double) -> (integer: [UInt8], fraction: [UInt8]) {
        if magnitude == 0 { return ([0], []) }
        let (digits, n) = shortestDigits(magnitude)
        let k = digits.count
        if n <= 0 { return ([0], Array(repeating: 0, count: -n) + digits) }
        if n >= k { return (digits + Array(repeating: 0, count: n - k), []) }
        return (Array(digits[0..<n]), Array(digits[n...]))
    }

    /// Rounds a decimal digit string to `places` fraction digits, half away from zero.
    private static func round(integer: [UInt8], fraction: [UInt8], places: Int) -> (integer: [UInt8], fraction: [UInt8]) {
        guard fraction.count > places else { return (integer, fraction) }
        var whole = integer + fraction[0..<places]
        if fraction[places] >= 5 {
            var index = whole.count - 1
            while index >= 0 {
                if whole[index] == 9 { whole[index] = 0; index -= 1 } else { whole[index] += 1; break }
            }
            if index < 0 { whole.insert(1, at: 0) }
        }
        let integerCount = whole.count - places
        return (Array(whole[0..<integerCount]), Array(whole[integerCount...]))
    }

    private static func grouped(_ integer: [UInt8]) -> String {
        var trimmed = ArraySlice(integer)
        while trimmed.count > 1 && trimmed.first == 0 { trimmed = trimmed.dropFirst() }
        let digits = text(trimmed)
        var out = ""
        for (offset, character) in digits.enumerated() {
            if offset > 0 && (digits.count - offset) % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return out
    }

    /// `value.toLocaleString("en-US", { minimumFractionDigits, maximumFractionDigits })`:
    /// grouping with commas and rounding half away from zero on the shortest digits.
    static func localeString(_ value: Double, minimumFraction: Int, maximumFraction: Int) -> String {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value > 0 ? "\u{221E}" : "-\u{221E}" }
        let maximum = Swift.max(minimumFraction, maximumFraction)
        let negative = value.sign == .minus
        let parts = split(abs(value))
        var (integer, fraction) = round(integer: parts.integer, fraction: parts.fraction, places: maximum)
        while fraction.count > minimumFraction && fraction.last == 0 { fraction.removeLast() }
        while fraction.count < minimumFraction { fraction.append(0) }
        if integer.isEmpty { integer = [0] }
        return (negative ? "-" : "") + grouped(integer) + (fraction.isEmpty ? "" : "." + text(fraction[...]))
    }

    /// Exact decimal expansion of a magnitude with `places` fraction digits,
    /// truncated (not rounded) by printing extra digits first.
    private static func exactDigits(_ magnitude: Double, places: Int) -> (integer: [UInt8], fraction: [UInt8]) {
        let printed = String(format: "%.\(places + 40)f", magnitude)
        var integer: [UInt8] = []
        var fraction: [UInt8] = []
        var afterPoint = false
        for scalar in printed.unicodeScalars {
            if scalar == "." { afterPoint = true; continue }
            guard scalar.value >= 48 && scalar.value <= 57 else { continue }
            if afterPoint { fraction.append(UInt8(scalar.value - 48)) } else { integer.append(UInt8(scalar.value - 48)) }
        }
        return (integer.isEmpty ? [0] : integer, fraction)
    }

    /// `value.toFixed(places)`: the exact binary value, ties rounded up in magnitude.
    static func toFixed(_ value: Double, _ places: Int) -> String {
        if !value.isFinite { return toString(value) }
        if abs(value) >= 1e21 { return toString(value) }
        let negative = value < 0
        let parts = exactDigits(abs(value), places: places)
        let (integer, fraction) = round(integer: parts.integer, fraction: parts.fraction, places: places)
        var trimmed = ArraySlice(integer)
        while trimmed.count > 1 && trimmed.first == 0 { trimmed = trimmed.dropFirst() }
        return (negative ? "-" : "") + text(trimmed) + (places > 0 ? "." + text(fraction[...]) : "")
    }

    /// `value.toExponential(places)`, for example `1.23e+4`.
    static func toExponential(_ value: Double, _ places: Int) -> String {
        if !value.isFinite { return toString(value) }
        let printed = String(format: "%.\(places)e", value)
        guard let e = printed.firstIndex(of: "e") else { return printed }
        let mantissa = printed[printed.startIndex..<e]
        var rest = printed[printed.index(after: e)...]
        var sign = "+"
        if let first = rest.first, first == "+" || first == "-" { sign = String(first); rest = rest.dropFirst() }
        while rest.count > 1 && rest.first == "0" { rest = rest.dropFirst() }
        return mantissa + "e" + sign + rest
    }

    /// JavaScript `Math.round`: halves go toward positive infinity, and
    /// values from -0.5 up to zero give negative zero.
    static func round(_ value: Double) -> Double {
        if !value.isFinite || value == 0 { return value }
        if value < 0 && value >= -0.5 { return -0.0 }
        let lower = value.rounded(.down)
        return value - lower >= 0.5 ? lower + 1 : lower
    }

    /// JavaScript `Math.max` and `Math.min`, which return NaN when either side is NaN.
    static func max(_ a: Double, _ b: Double) -> Double { a.isNaN || b.isNaN ? .nan : Swift.max(a, b) }
    static func min(_ a: Double, _ b: Double) -> Double { a.isNaN || b.isNaN ? .nan : Swift.min(a, b) }

    /// A JavaScript `\s` or `trim()` whitespace scalar.
    static func isWhitespace(_ unit: UInt16) -> Bool {
        switch unit {
        case 9, 10, 11, 12, 13, 32, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        case 0x2000...0x200A: return true
        default: return false
        }
    }

    /// `String.prototype.trim`.
    static func trim(_ text: String) -> String {
        let units = Array(text.utf16)
        var start = 0
        var end = units.count
        while start < end && isWhitespace(units[start]) { start += 1 }
        while end > start && isWhitespace(units[end - 1]) { end -= 1 }
        if start == 0 && end == units.count { return text }
        return String(decoding: units[start..<end], as: UTF16.self)
    }

    private static func isDigit(_ unit: UInt16) -> Bool { unit >= 48 && unit <= 57 }

    /// `Number(text)` in JavaScript: decimal literals with optional exponent,
    /// `Infinity`, and 0x, 0o and 0b integers; anything else is NaN.
    static func number(_ text: String) -> Double {
        let trimmed = trim(text)
        if trimmed.isEmpty { return 0 }
        switch trimmed {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: break
        }
        let units = Array(trimmed.utf16)
        if units.count > 2 && units[0] == 48 {
            let radix: Int?
            switch units[1] {
            case 120, 88: radix = 16
            case 111, 79: radix = 8
            case 98, 66: radix = 2
            default: radix = nil
            }
            if let radix {
                var result = 0.0
                for unit in units[2...] {
                    let digit: Int
                    switch unit {
                    case 48...57: digit = Int(unit) - 48
                    case 97...102: digit = Int(unit) - 87
                    case 65...70: digit = Int(unit) - 55
                    default: return .nan
                    }
                    if digit >= radix { return .nan }
                    result = result * Double(radix) + Double(digit)
                }
                return result
            }
        }
        var index = 0
        if units[index] == 43 || units[index] == 45 { index += 1 }
        var integerDigits = 0
        while index < units.count && isDigit(units[index]) { index += 1; integerDigits += 1 }
        var fractionDigits = 0
        if index < units.count && units[index] == 46 {
            index += 1
            while index < units.count && isDigit(units[index]) { index += 1; fractionDigits += 1 }
        }
        if integerDigits == 0 && fractionDigits == 0 { return .nan }
        if index < units.count && (units[index] == 101 || units[index] == 69) {
            index += 1
            if index < units.count && (units[index] == 43 || units[index] == 45) { index += 1 }
            var exponentDigits = 0
            while index < units.count && isDigit(units[index]) { index += 1; exponentDigits += 1 }
            if exponentDigits == 0 { return .nan }
        }
        if index != units.count { return .nan }
        var literal = trimmed
        if literal.hasSuffix(".") { literal.removeLast() }
        if literal.hasPrefix(".") { literal = "0" + literal }
        if literal.hasPrefix("+.") || literal.hasPrefix("-.") { literal.insert("0", at: literal.index(after: literal.startIndex)) }
        return Double(literal) ?? .nan
    }

    /// A finite double as a saturated Int, like Kotlin's `toInt` (NaN gives zero).
    static func int(_ value: Double) -> Int {
        if value.isNaN { return 0 }
        if value >= 2_147_483_647 { return 2_147_483_647 }
        if value <= -2_147_483_648 { return -2_147_483_648 }
        return Int(value)
    }
}
