import Foundation
import WorldsSyncWire

public protocol CollaborationStore: Sendable {
    /// All updates saved for the page, including previously acknowledged ones.
    func load(pageID: String, channel: UInt64) async throws -> [Data]
    /// Must durably append both the replica log and outbox as one transaction.
    func appendLocal(pageID: String, channel: UInt64, update: Data) async throws
    func appendRemote(pageID: String, channel: UInt64, update: Data) async throws
    func maximumPendingID(pageID: String, channel: UInt64) async throws -> Int64?
    func acknowledge(pageID: String, channel: UInt64, through: Int64) async throws
    /// Preserve the complete causal state and reject pending writes atomically.
    func archiveRejection(pageID: String, channel: UInt64, state: Data, reason: String) async throws
}

public protocol CollaborationSocket: Sendable {
    func send(_ data: Data) async throws
    func receive() async throws -> Data?
    func close() async
    func closeCode() async -> Int
}

public struct URLSessionCollaborationSocket: CollaborationSocket {
    private let task: URLSessionWebSocketTask
    public init(url: URL, token: String, session: URLSession = .shared) {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(WorldsSyncWire.subprotocolName, forHTTPHeaderField: "Sec-WebSocket-Protocol")
        task = session.webSocketTask(with: request)
        task.resume()
    }
    public func send(_ data: Data) async throws { try await task.send(.data(data)) }
    public func receive() async throws -> Data? {
        switch try await task.receive() {
        case .data(let data): return data
        case .string: return nil
        @unknown default: return nil
        }
    }
    public func close() async { task.cancel(with: .goingAway, reason: nil) }
    public func closeCode() async -> Int { task.closeCode.rawValue }
}

public enum CollaborationError: Error {
    case invalidEndpoint, invalidChannel, invalidFrame, accessRevoked, rejected(String), notStarted
}

/// A token provider must serialize refresh and return the current access token.
public actor CollaborationSession {
    public typealias TokenProvider = @Sendable (_ forceRefresh: Bool) async throws -> String
    public typealias SocketFactory = @Sendable (_ url: URL, _ token: String) async throws -> any CollaborationSocket
    private struct Pending { let channel: UInt64; let through: Int64? }
    private let pageID: String
    private let endpoint: URL
    private let store: any CollaborationStore
    private let tokenProvider: TokenProvider
    private let socketFactory: SocketFactory
    private var documents: [UInt64: NativeCRDTDocument] = [:]
    private var socket: (any CollaborationSocket)?
    private var pending: [UInt64: Pending] = [:]
    private var batch: UInt64 = 0
    private var stopped = true
    private var revoked = false
    private var failed = false
    private var generation: UInt64 = 0
    private var localWriteInFlight = false
    public private(set) var accessLevel: String?
    public private(set) var lastNotice: String?

    public init(pageID: String, workspaceID: String, documentID: String, serverURL: URL,
                store: any CollaborationStore, tokenProvider: @escaping TokenProvider,
                socketFactory: @escaping SocketFactory = { URLSessionCollaborationSocket(url: $0, token: $1) }) throws {
        guard let scheme = serverURL.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = serverURL.host, serverURL.query == nil, serverURL.fragment == nil,
              serverURL.user == nil, serverURL.password == nil,
              scheme == "https" || ["localhost", "127.0.0.1", "::1"].contains(host),
              !workspaceID.isEmpty, !documentID.isEmpty,
              workspaceID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
              documentID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { throw CollaborationError.invalidEndpoint }
        var parts = URLComponents(url: serverURL, resolvingAgainstBaseURL: false)!
        parts.scheme = scheme == "https" ? "wss" : "ws"
        parts.path = parts.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        parts.path = "/" + ([parts.path, "v1", "workspaces", workspaceID, "docs", documentID, "sync"].filter { !$0.isEmpty }.joined(separator: "/"))
        guard let endpoint = parts.url else { throw CollaborationError.invalidEndpoint }
        self.endpoint = endpoint; self.pageID = pageID; self.store = store
        self.tokenProvider = tokenProvider; self.socketFactory = socketFactory
    }

    /// The owner must start this on one task and call stop on teardown.
    public func run() async throws {
        guard stopped else { throw CollaborationError.notStarted }
        stopped = false; revoked = false; failed = false; generation &+= 1
        let runID = generation
        for channel: UInt64 in [0, 1] {
            let doc = try NativeCRDTDocument()
            for update in try await store.load(pageID: pageID, channel: channel) { try doc.apply(update) }
            documents[channel] = doc
        }
        var attempt = 0
        var forceRefresh = false
        while !stopped && !revoked && !failed && generation == runID {
            var connection: (any CollaborationSocket)?
            do {
                let token = try await tokenProvider(forceRefresh)
                forceRefresh = false
                let opened = try await socketFactory(endpoint, token)
                connection = opened; socket = opened; pending.removeAll()
                for channel: UInt64 in [0, 1] {
                    guard let doc = documents[channel] else { throw CollaborationError.notStarted }
                    try await opened.send(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: doc.vector())))
                }
                attempt = 0
                while !stopped && !failed && generation == runID {
                    if let data = try await opened.receive() { try await handle(data, via: opened) }
                }
            } catch {
                if let connection {
                    let closeCode = await connection.closeCode()
                    if closeCode == WorldsSyncWire.closeRevoked { revoked = true }
                    if closeCode == WorldsSyncWire.closeUnauthorized { forceRefresh = true }
                    await connection.close()
                }
                socket = nil; pending.removeAll()
                if stopped || generation != runID { return }
                if revoked { throw CollaborationError.accessRevoked }
                if failed { throw error }
                attempt = min(attempt + 1, 6)
                let delay = UInt64(min(30.0, 0.5 * pow(2.0, Double(attempt))))
                try await Task.sleep(for: .seconds(delay))
            }
        }
    }

    public func stop() async {
        stopped = true; generation &+= 1
        if let socket { await socket.close() }
        socket = nil; pending.removeAll()
    }

    /// Persist first. If application fails afterward, stop and rebuild from the log.
    public func appendLocal(channel: UInt64, update: Data) async throws {
        guard !stopped, !failed, let doc = documents[channel] else { throw CollaborationError.notStarted }
        guard !localWriteInFlight else { throw CollaborationError.notStarted }
        localWriteInFlight = true
        defer { localWriteInFlight = false }
        try await store.appendLocal(pageID: pageID, channel: channel, update: update)
        do { try doc.apply(update) } catch { failed = true; if let socket { await socket.close() }; throw error }
        // Reconnect triggers a full state-vector handshake, covering the persisted edit.
        if let socket { await socket.close() }
    }

    /// Called by the owner before JWT expiry. Expiration scheduling remains external.
    public func refreshAuthentication() async throws {
        guard let socket else { throw CollaborationError.notStarted }
        let token = try await tokenProvider(true)
        try await socket.send(WorldsSyncWire.encode(.authRefresh(token: token)))
    }

    private func handle(_ data: Data, via socket: any CollaborationSocket) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, payload):
            guard let doc = documents[channel] else { throw CollaborationError.invalidChannel }
            if kind == 0 {
                guard !localWriteInFlight else { throw CollaborationError.notStarted }
                let through = try await store.maximumPendingID(pageID: pageID, channel: channel)
                guard !localWriteInFlight else { throw CollaborationError.notStarted }
                let diff = try doc.diff(payload)
                batch += 1
                pending[batch] = Pending(channel: channel, through: through)
                try await socket.send(WorldsSyncWire.encode(.update(batchID: batch, channel: channel, update: diff)))
            } else if kind == 1 || kind == 2 {
                try doc.apply(payload)
                do { try await store.appendRemote(pageID: pageID, channel: channel, update: payload) }
                catch { failed = true; throw error }
            } else { throw CollaborationError.invalidFrame }
        case let .acknowledgement(id, status, reason):
            guard let item = pending.removeValue(forKey: id) else { return }
            if status == 0 {
                if let through = item.through { try await store.acknowledge(pageID: pageID, channel: item.channel, through: through) }
            } else {
                failed = true
                guard let doc = documents[item.channel] else { throw CollaborationError.invalidChannel }
                let full = try doc.diff(Data([0]))
                try await store.archiveRejection(pageID: pageID, channel: item.channel, state: full, reason: reason)
                throw CollaborationError.rejected(reason)
            }
        case let .authState(level, _): accessLevel = level
        case let .notice(code, message): lastNotice = "\(code): \(message)"
        case .awareness, .queryAwareness: break
        default: throw CollaborationError.invalidFrame
        }
    }
}

