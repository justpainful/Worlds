import Foundation

/*
 * A pack's conditions, figures and alerts, ported from the desktop's
 * src/packs/rules.ts (and Android's PackRules.kt) so every app counts the
 * same items the same way. Today's date is passed in, as on desktop. Weeks
 * start on Saturday, as in Saudi Arabia.
 */

/// A plain JSON value in a condition: a choice id, a number, a tick or null.
enum PackValue: Decodable, Hashable {
    case string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .string(try c.decode(String.self)) }
    }

    /// Whether an item's stored value is this one (numbers compare by value).
    func matches(_ value: Any?) -> Bool {
        switch self {
        case .null: return value == nil
        case .string(let s): return (value as? String) == s
        case .bool(let b):
            guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return false }
            return n.boolValue == b
        case .number(let d):
            guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return false }
            return n.doubleValue == d
        }
    }
}

struct PackCondition: Decodable, Hashable {
    let field: String
    let `in`: [PackValue]?
    let notIn: [PackValue]?
    let empty: Bool?
    let overdue: Bool?
    let within: Int?
    let period: String?
    let atMost: PackValue?
    let clashesOn: [String]?
}

struct PackStat: Decodable, Hashable {
    let label: PackText
    let kind: String
    let agg: String
    let field: String?
    let `where`: [PackCondition]
}

struct PackAlert: Decodable, Hashable {
    let label: PackText
    let kind: String
    let `where`: [PackCondition]
}

/// One pack item as the rules see it: its page id, title and fields.
struct PackRow: Identifiable {
    let id: String
    let title: String
    let kind: String
    let updatedAt: Int64
    let data: [String: Any]
}

enum PackRules {
    static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func today() -> String { isoDay.string(from: Date()) }

    static func addDays(_ day: String, _ n: Int) -> String {
        guard let date = isoDay.date(from: day), let next = Calendar(identifier: .gregorian).date(byAdding: .day, value: n, to: date) else { return day }
        return isoDay.string(from: next)
    }

    static func isIso(_ s: String) -> Bool { s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil && isoDay.date(from: s) != nil }

    /// Saturday of the week that holds `today`.
    static func weekStart(_ today: String) -> String {
        guard let date = isoDay.date(from: today) else { return today }
        // Gregorian weekday: Sunday 1 ... Saturday 7, so Saturday goes back 0 days and Friday 6.
        let weekday = Calendar(identifier: .gregorian).component(.weekday, from: date)
        return addDays(today, -(weekday % 7))
    }

    private static func value(_ data: [String: Any], _ key: String) -> Any? {
        guard let v = data[key], !(v is NSNull) else { return nil }
        return v
    }

    private static func isEmpty(_ v: Any?) -> Bool {
        guard let v else { return true }
        if let s = v as? String { return s.isEmpty }
        if let a = v as? [Any] { return a.isEmpty }
        return false
    }

    private static func number(_ v: Any?) -> Double? {
        guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        return n.doubleValue
    }

    /// Whether one item's fields pass a condition (the clash test needs the other items: see `filter`).
    static func matches(_ c: PackCondition, _ data: [String: Any], today: String) -> Bool {
        let v = value(data, c.field)
        if let empty = c.empty, isEmpty(v) != empty { return false }
        // A checkbox that was never ticked counts as false.
        let mentionsFalse = (c.in ?? []).contains(.bool(false)) || (c.notIn ?? []).contains(.bool(false))
        let checked: Any? = (v == nil && mentionsFalse) ? NSNumber(value: false) : v
        if let list = c.in, !list.contains(where: { $0.matches(checked) }) { return false }
        if let list = c.notIn, list.contains(where: { $0.matches(checked) }) { return false }
        if c.overdue != nil || c.within != nil || c.period != nil {
            guard let day = v as? String, isIso(day) else { return false }
            if let overdue = c.overdue, (day < today) != overdue { return false }
            if let within = c.within, day < today || day > addDays(today, within) { return false }
            if c.period == "month" && day.prefix(7) != today.prefix(7) { return false }
            if c.period == "week" {
                let start = weekStart(today)
                if day < start || day > addDays(start, 6) { return false }
            }
        }
        if let atMost = c.atMost {
            guard let n = number(v) else { return false }
            let limit: Double?
            switch atMost {
            case .number(let d): limit = d
            case .string(let other): limit = number(value(data, other))
            default: limit = nil
            }
            guard let limit, n <= limit else { return false }
        }
        return true
    }

    /// Rows that pass every condition, including clashes with each other (a double booking).
    static func filter(_ rows: [PackRow], _ conditions: [PackCondition], today: String) -> [PackRow] {
        var list = rows.filter { r in conditions.allSatisfy { matches($0, r.data, today: today) } }
        for c in conditions {
            guard let others = c.clashesOn else { continue }
            let fields = [c.field] + others
            func key(_ r: PackRow) -> String? {
                if fields.contains(where: { isEmpty(value(r.data, $0)) }) { return nil }
                return fields.map { "\(value(r.data, $0)!)" }.joined(separator: "|#|")
            }
            var counts: [String: Int] = [:]
            for r in rows { if let k = key(r) { counts[k, default: 0] += 1 } }
            list = list.filter { r in key(r).map { (counts[$0] ?? 0) > 1 } ?? false }
        }
        return list
    }

    static func sum(_ rows: [PackRow], _ field: String) -> Double {
        (rows.reduce(0) { $0 + (number(value($1.data, field)) ?? 0) } * 100).rounded() / 100
    }

    static func average(_ rows: [PackRow], _ field: String) -> Double? {
        let nums = rows.compactMap { number(value($0.data, field)) }
        guard !nums.isEmpty else { return nil }
        return (nums.reduce(0, +) / Double(nums.count) * 10).rounded() / 10
    }

    /// A figure's value: how many items match, or the sum or average of a field across them.
    static func stat(_ rows: [PackRow], _ stat: PackStat, today: String) -> Double? {
        let items = filter(rows, stat.where, today: today)
        switch (stat.agg, stat.field) {
        case ("sum", let f?): return sum(items, f)
        case ("average", let f?): return average(items, f)
        default: return Double(items.count)
        }
    }

    /// A number as people write it: no trailing ".0".
    static func text(_ d: Double) -> String {
        d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d)
    }
}
