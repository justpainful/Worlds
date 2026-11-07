import Foundation

/// Binary framing for worlds-sync.v1. Yjs payloads remain opaque byte sequences.
public enum WorldsSyncWire {
    public static let subprotocolName = "worlds-sync.v1"
    public static let bearerPrefix = "bearer."
    public static let closeUnauthorized = 4401
    public static let closeRevoked = 4403
    public static let closeTooLarge = 4413
    public static let closeRetry = 4503
    public static let maxSafeInteger: UInt64 = 9_007_199_254_740_991

    public enum AccessLevel: String, Sendable {
        case full, edit, comment, view, none
    }

    public static func canWrite(_ level: AccessLevel, channel: UInt64) -> Bool {
        switch level {
        case .full, .edit: return channel == 0 || channel == 1
        case .comment: return channel == 1
        case .view, .none: return false
        }
    }

    /// Numeric channels, sync kinds and acknowledgement statuses are left open
    /// to preserve unknown values across future protocol revisions.
    public enum Frame: Equatable, Sendable {
        case sync(channel: UInt64, kind: UInt64, payload: Data)
        case awareness(Data)
        case queryAwareness
        case authState(level: String, userID: String)
        case update(batchID: UInt64, channel: UInt64, update: Data)
        case acknowledgement(batchID: UInt64, status: UInt64, reason: String)
        case notice(code: String, message: String)
        case authRefresh(token: String)
    }

    public struct AwarenessEntry: Equatable, Sendable {
        public var clientID: UInt64
        public var clock: UInt64
        public var state: String
        public init(clientID: UInt64, clock: UInt64, state: String) {
            self.clientID = clientID
            self.clock = clock
            self.state = state
        }
    }

    public enum CodecError: Error, Equatable {
        case truncated
        case integerOutOfRange
        case invalidUTF8
        case unknownMessage(UInt64)
        case trailingBytes
        case tooManyEntries
    }

    public static func encode(_ frame: Frame) throws -> Data {
        var writer = Writer()
        switch frame {
        case let .sync(channel, kind, payload):
            try writer.uint(0); try writer.uint(channel); try writer.uint(kind); try writer.bytes(payload)
        case let .awareness(payload):
            try writer.uint(1); try writer.bytes(payload)
        case .queryAwareness:
            try writer.uint(2)
        case let .authState(level, userID):
            try writer.uint(3); try writer.string(level); try writer.string(userID)
        case let .update(batchID, channel, update):
            try writer.uint(4); try writer.uint(batchID); try writer.uint(channel); try writer.bytes(update)
        case let .acknowledgement(batchID, status, reason):
            try writer.uint(5); try writer.uint(batchID); try writer.uint(status); try writer.string(reason)
        case let .notice(code, message):
            try writer.uint(6); try writer.string(code); try writer.string(message)
        case let .authRefresh(token):
            try writer.uint(7); try writer.string(token)
        }
        return writer.data
    }

    public static func decode(_ data: Data) throws -> Frame {
        var reader = Reader(data)
        let type = try reader.uint()
        let frame: Frame
        switch type {
        case 0: frame = .sync(channel: try reader.uint(), kind: try reader.uint(), payload: try reader.bytes())
        case 1: frame = .awareness(try reader.bytes())
        case 2: frame = .queryAwareness
        case 3: frame = .authState(level: try reader.string(), userID: try reader.string())
        case 4: frame = .update(batchID: try reader.uint(), channel: try reader.uint(), update: try reader.bytes())
        case 5: frame = .acknowledgement(batchID: try reader.uint(), status: try reader.uint(), reason: try reader.string())
        case 6: frame = .notice(code: try reader.string(), message: try reader.string())
        case 7: frame = .authRefresh(token: try reader.string())
        default: throw CodecError.unknownMessage(type)
        }
        try reader.finish()
        return frame
    }

    public static func encodeAwarenessUpdate(_ entries: [AwarenessEntry]) throws -> Data {
        var writer = Writer()
        try writer.uint(UInt64(entries.count))
        for entry in entries {
            try writer.uint(entry.clientID); try writer.uint(entry.clock); try writer.string(entry.state)
        }
        return writer.data
    }

    public static func decodeAwarenessUpdate(_ data: Data) throws -> [AwarenessEntry] {
        var reader = Reader(data)
        let count = try reader.uint()
        // Each entry requires at least three bytes, even for an empty state.
        guard count <= UInt64(reader.remaining / 3) else { throw CodecError.tooManyEntries }
        var entries: [AwarenessEntry] = []
        entries.reserveCapacity(Int(count))
        for _ in 0..<Int(count) {
            entries.append(AwarenessEntry(clientID: try reader.uint(), clock: try reader.uint(), state: try reader.string()))
        }
        try reader.finish()
        return entries
    }

    private struct Writer {
        var data = Data()
        mutating func uint(_ value: UInt64) throws {
            guard value <= WorldsSyncWire.maxSafeInteger else { throw CodecError.integerOutOfRange }
            var value = value
            while value >= 128 {
                data.append(UInt8(value & 127) | 128)
                value >>= 7
            }
            data.append(UInt8(value))
        }
        mutating func bytes(_ value: Data) throws {
            try uint(UInt64(value.count)); data.append(value)
        }
        mutating func string(_ value: String) throws { try bytes(Data(value.utf8)) }
    }

    private struct Reader {
        let data: [UInt8]
        var offset = 0
        init(_ data: Data) { self.data = Array(data) }
        var remaining: Int { data.count - offset }
        mutating func uint() throws -> UInt64 {
            var value: UInt64 = 0
            var shift: UInt64 = 0
            while true {
                guard offset < data.count else { throw CodecError.truncated }
                let byte = data[offset]; offset += 1
                guard shift <= 49 else { throw CodecError.integerOutOfRange }
                value |= UInt64(byte & 127) << shift
                guard value <= WorldsSyncWire.maxSafeInteger else { throw CodecError.integerOutOfRange }
                if byte & 128 == 0 { return value }
                shift += 7
            }
        }
        mutating func bytes() throws -> Data {
            let length = try uint()
            guard length <= UInt64(remaining) else { throw CodecError.truncated }
            let end = offset + Int(length)
            let value = Data(data[offset..<end]); offset = end
            return value
        }
        mutating func string() throws -> String {
            guard let value = String(data: try bytes(), encoding: .utf8) else { throw CodecError.invalidUTF8 }
            return value
        }
        func finish() throws {
            guard remaining == 0 else { throw CodecError.trailingBytes }
        }
    }
}
