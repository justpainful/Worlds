import Foundation

public indirect enum AutomationJSON: Codable, Equatable, Sendable {
    case null, bool(Bool), integer(Int64), number(Double), string(String), array([AutomationJSON]), object([String: AutomationJSON])
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let value = try? c.decode(Bool.self) { self = .bool(value) }
        else if let value = try? c.decode(Int64.self) { self = .integer(value) }
        else if let value = try? c.decode(Double.self) { self = .number(value) }
        else if let value = try? c.decode(String.self) { self = .string(value) }
        else if let value = try? c.decode([AutomationJSON].self) { self = .array(value) }
        else { self = .object(try c.decode([String: AutomationJSON].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .integer(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}

/// `days` uses Sunday = 0. Timestamps use Unix milliseconds.
public enum AutomationTrigger: Codable, Equatable, Sendable {
    case once(at: Int64), daily(time: String), weekly(days: [UInt32], time: String)
    case monthly(day: UInt32, time: String), manual
    private enum Keys: String, CodingKey { case kind, at, time, days, day }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "once": self = .once(at: try c.decode(Int64.self, forKey: .at))
        case "daily": self = .daily(time: try c.decode(String.self, forKey: .time))
        case "weekly": self = .weekly(days: try c.decode([UInt32].self, forKey: .days), time: try c.decode(String.self, forKey: .time))
        case "monthly": self = .monthly(day: try c.decode(UInt32.self, forKey: .day), time: try c.decode(String.self, forKey: .time))
        case "manual": self = .manual
        default: throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "Unknown trigger")
        }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .once(let at): try c.encode("once", forKey: .kind); try c.encode(at, forKey: .at)
        case .daily(let time): try c.encode("daily", forKey: .kind); try c.encode(time, forKey: .time)
        case .weekly(let days, let time): try c.encode("weekly", forKey: .kind); try c.encode(days, forKey: .days); try c.encode(time, forKey: .time)
        case .monthly(let day, let time): try c.encode("monthly", forKey: .kind); try c.encode(day, forKey: .day); try c.encode(time, forKey: .time)
        case .manual: try c.encode("manual", forKey: .kind)
        }
    }
}

public struct AutomationPolicy: Codable, Equatable, Sendable {
    public var unattended: Bool
    public var graceMinutes: Int64?
    public init(unattended: Bool = false, graceMinutes: Int64? = nil) { self.unattended = unattended; self.graceMinutes = graceMinutes }
    private enum Keys: String, CodingKey { case unattended, graceMinutes }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        unattended = try c.decodeIfPresent(Bool.self, forKey: .unattended) ?? false
        graceMinutes = try c.decodeIfPresent(Int64.self, forKey: .graceMinutes)
    }
}

public struct AutomationDestination: Codable, Equatable, Sendable {
    public var kind: String
    public var id: String
    public var label: String?
    public var guildId: String?
    public var channelId: String?
    public var messageId: String?
    private enum Keys: String, CodingKey { case kind, id, label, guildId, channelId, messageId }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        kind = try c.decode(String.self, forKey: .kind)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        label = try c.decodeIfPresent(String.self, forKey: .label)
        guildId = try c.decodeIfPresent(String.self, forKey: .guildId)
        channelId = try c.decodeIfPresent(String.self, forKey: .channelId)
        messageId = try c.decodeIfPresent(String.self, forKey: .messageId)
    }
}

/// Preserve the original source, action and transform JSON, including unknown fields.
public struct AutomationSpec: Codable, Equatable, Sendable {
    public let trigger: AutomationTrigger
    public let source: AutomationJSON
    public let transform: AutomationJSON
    public let action: AutomationJSON
    public let destination: AutomationDestination?
    public let policy: AutomationPolicy
    private enum Keys: String, CodingKey { case trigger, source, transform, action, destination, policy }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        trigger = try c.decode(AutomationTrigger.self, forKey: .trigger)
        source = try c.decode(AutomationJSON.self, forKey: .source)
        transform = try c.decodeIfPresent(AutomationJSON.self, forKey: .transform) ?? .null
        action = try c.decodeIfPresent(AutomationJSON.self, forKey: .action) ?? .null
        destination = try c.decodeIfPresent(AutomationDestination.self, forKey: .destination)
        policy = try c.decodeIfPresent(AutomationPolicy.self, forKey: .policy) ?? AutomationPolicy()
    }
}

public struct AutomationRecord: Codable, Equatable, Sendable {
    public let id: String, name: String
    public let enabled: Bool
    public let spec: AutomationSpec
    public let nextRunAt: Int64?, lastRunAt: Int64?
    public let createdAt: Int64, updatedAt: Int64
    public let lastStatus: String?
}

public struct AutomationRun: Codable, Equatable, Sendable {
    public let id: String, automationId: String, status: String, trigger: String
    public let scheduledFor: Int64?, startedAt: Int64?, finishedAt: Int64?
    public let versionId: String?
    public let output: AutomationJSON?
    public let error: String?
}

public struct PendingApproval: Codable, Equatable, Sendable {
    public let id: String, kind: String
    public let payload: AutomationJSON
    public let requestedBy: String
    public let opId: String?
    public let status: String
    public let createdAt: Int64
}

public enum DueDisposition: Equatable, Sendable { case notDue, run, skipped }

public enum AutomationTiming {
    /// Mirrors the original grace comparison: exactly at the limit still runs.
    public static func disposition(scheduledAt: Int64?, now: Int64, graceMinutes: Int64?) -> DueDisposition {
        guard let scheduledAt, scheduledAt <= now else { return .notDue }
        let lateness = Double(now) - Double(scheduledAt)
        return lateness > Double(graceMinutes ?? 30) * 60_000 ? .skipped : .run
    }

    /// The scheduler does not run in the background merely because a date exists.
    public static func nextRun(_ trigger: AutomationTrigger, after milliseconds: Int64,
                               timeZone: TimeZone = .current) -> Int64? {
        if case .manual = trigger { return nil }
        if case let .once(at) = trigger { return at > milliseconds ? at : nil }
        let after = Date(timeIntervalSince1970: Double(milliseconds) / 1000)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let start = calendar.startOfDay(for: after)
        let time: String
        switch trigger {
        case .daily(let t), .weekly(_, let t), .monthly(_, let t): time = t
        default: return nil
        }
        let pieces = time.split(separator: ":", omittingEmptySubsequences: false)
        let hour: Int, minute: Int
        if pieces.count == 2, pieces[0].count == 2, pieces[1].count == 2,
           let h = Int(pieces[0]), let m = Int(pieces[1]), (0...23).contains(h), (0...59).contains(m) {
            hour = h; minute = m
        } else { hour = 9; minute = 0 }
        func instant(on day: Date) -> Date? {
            guard let result = calendar.nextDate(after: day.addingTimeInterval(-1), matching: DateComponents(hour: hour, minute: minute, second: 0), matchingPolicy: .strict, repeatedTimePolicy: .first, direction: .forward),
                  calendar.isDate(result, inSameDayAs: day) else { return nil }
            return result
        }
        switch trigger {
        case .daily:
            for n in 0..<3 {
                if let day = calendar.date(byAdding: .day, value: n, to: start), let at = instant(on: day), at > after { return Int64(at.timeIntervalSince1970 * 1000) }
            }
        case .weekly(let days, _):
            for n in 0..<15 {
                guard let day = calendar.date(byAdding: .day, value: n, to: start) else { continue }
                let weekday = UInt32(calendar.component(.weekday, from: day) - 1)
                if days.contains(weekday), let at = instant(on: day), at > after { return Int64(at.timeIntervalSince1970 * 1000) }
            }
        case .monthly(let wanted, _):
            let parts = calendar.dateComponents([.year, .month], from: start)
            guard let first = calendar.date(from: parts) else { return nil }
            for n in 0..<14 {
                guard let month = calendar.date(byAdding: .month, value: n, to: first),
                      let range = calendar.range(of: .day, in: .month, for: month),
                      let day = calendar.date(byAdding: .day, value: Int(min(max(wanted, 1), UInt32(range.count))) - 1, to: month),
                      let at = instant(on: day), at > after else { continue }
                return Int64(at.timeIntervalSince1970 * 1000)
            }
        default: break
        }
        return nil
    }
}

