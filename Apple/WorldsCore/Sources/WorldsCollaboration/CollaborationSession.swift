import Foundation
import WorldsSyncWire
import WorldsAwareness

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

/// Stores that can atomically check a full base and persist an editor operation.
public protocol CheckedPlainEditorStore: CollaborationStore {
    func insertPlainChecked(base: Data, blockIndex: UInt32, blockID: String,
                            expected: String, offset: UInt32, insertion: String) async throws -> Data
}
public protocol CheckedPlainDeleteStore: CollaborationStore {
    func deletePlainChecked(base: Data, blockIndex: UInt32, blockID: String, expected: String, offset: UInt32, length: UInt32) async throws -> Data
}
public protocol CheckedBasicFormatStore: CollaborationStore {
    func formatPlainChecked(base: Data, blockIndex: UInt32, blockID: String, expected: String, offset: UInt32, length: UInt32, mark: String, enabled: Bool) async throws -> Data
}

public protocol CollaborationSocket: Sendable {
    func send(_ data: Data) async throws
    func receive() async throws -> Data?
    func close() async
    func closeCode() async -> Int
}

final class RejectCollaborationRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

public struct URLSessionCollaborationSocket: CollaborationSocket {
    private let task: URLSessionWebSocketTask
    // A caller-supplied session must independently reject redirects. The
    // default session never forwards bearer credentials to a redirected URL.
    private let session: URLSession
    public init(url: URL, token: String, session: URLSession? = nil) {
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(WorldsSyncWire.subprotocolName, forHTTPHeaderField: "Sec-WebSocket-Protocol")
        let selected = session ?? URLSession(configuration: .ephemeral, delegate: RejectCollaborationRedirects(), delegateQueue: nil)
        self.session = selected
        task = selected.webSocketTask(with: request)
        task.resume()
    }
    public func send(_ data: Data) async throws { try await task.send(.data(data)) }
    public func receive() async throws -> Data? {
        // Desktop ignores text control messages such as the Worker's pong.
        // They are not a closed socket and must not trigger reconnect.
        while true {
            switch try await task.receive() {
            case .data(let data): return data
            case .string: continue
            @unknown default: return nil
            }
        }
    }
    public func close() async { task.cancel(with: .goingAway, reason: nil) }
    public func closeCode() async -> Int { task.closeCode.rawValue }
    #if DEBUG
    func sendFixturePing() async throws { try await task.send(.string("ping")) }
    #endif
}

public enum CollaborationError: Error {
    case invalidEndpoint, invalidChannel, invalidFrame, accessRevoked, rejected(String), notStarted, staleProjection
}

/// Transport observation, not a guarantee that pending changes have synced.
public enum CollaborationConnectionStatus: Sendable, Equatable {
    case stopped, connecting, authenticated(level: String), accessRevoked, failed
}

public struct PlainEditorProjection: Sendable {
    public let json: Data
    public let state: Data
}

/// What a viewer shows of a shared page: every block as Tiptap JSON, the pack
/// item's kind and fields (`{"kind": ..., "fields": {...}}`) and the access
/// level the server reported for this connection.
public struct SharedPageReading: Sendable {
    public let blocks: Data
    public let packFields: Data
    public let accessLevel: String
}

/// A token provider must serialize refresh and return the current access token.
public actor CollaborationSession {
    public typealias TokenProvider = @Sendable (_ forceRefresh: Bool) async throws -> String
    public typealias SocketFactory = @Sendable (_ url: URL, _ token: String) async throws -> any CollaborationSocket
    private struct Pending { let channel: UInt64; let through: Int64? }
    private let pageID: String
    private let expectedUserID: String
    private let endpoint: URL
    private let store: any CollaborationStore
    private let tokenProvider: TokenProvider
    private let acknowledgementTimeout: Duration
    // Keep the built-in transport out of an async default-argument closure.
    // Explicit injected factories remain available for diagnostics and tests.
    private let socketFactory: SocketFactory?
    private var documents: [UInt64: NativeCRDTDocument] = [:]
    private var awareness: WorldsAwareness?
    private var presenceJSON: String?
    private var socket: (any CollaborationSocket)?
    private var socketID = UUID()
    private var presenceVersion: UInt64 = 0
    private var presenceSending = false
    private var presenceWaiters: [CheckedContinuation<Void, Never>] = []
    private var pending: [UInt64: Pending] = [:]
    private var acknowledgementTimers: [UInt64: Task<Void, Never>] = [:]
    private var batch: UInt64 = 0
    private var stopped = true
    private var running = false
    private var revoked = false
    private var failed = false
    private var generation: UInt64 = 0
    private var retryTask: Task<Void, Error>?
    private var localWriteInFlight = false
    // Set when this session closes its own socket after a durable local write,
    // so the reconnect that resends it is immediate instead of backing off.
    private var reconnectNow = false
    private var remoteWriteInFlight = false
    private var localWriteWaiters: [CheckedContinuation<Void, Never>] = []
    private var verifiedIdentity = false
    private var synchronizedChannels: Set<UInt64> = []
    private var editorObservers: [UUID: AsyncStream<Void>.Continuation] = [:]
    private let diagnosticID = String(UUID().uuidString.prefix(8))
    public private(set) var accessLevel: String?
    public private(set) var lastNotice: String?

    private func diagnostic(_ event: String) {
        guard ProcessInfo.processInfo.environment["WORLDS_COLLAB_DIAGNOSTICS"] == "1" else { return }
        FileHandle.standardError.write(Data("collab-diagnostic \(diagnosticID): \(event)\n".utf8))
    }

    public init(pageID: String, workspaceID: String, documentID: String, expectedUserID: String, serverURL: URL,
                store: any CollaborationStore, tokenProvider: @escaping TokenProvider,
                socketFactory: SocketFactory? = nil, acknowledgementTimeout: Duration = .seconds(30)) throws {
        guard let scheme = serverURL.scheme?.lowercased(), ["https", "http"].contains(scheme),
              let host = serverURL.host, serverURL.query == nil, serverURL.fragment == nil,
              serverURL.user == nil, serverURL.password == nil,
              scheme == "https" || ["localhost", "127.0.0.1", "::1"].contains(host),
              !workspaceID.isEmpty, !documentID.isEmpty, !expectedUserID.isEmpty, acknowledgementTimeout > .zero,
              workspaceID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }),
              documentID.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }) else { throw CollaborationError.invalidEndpoint }
        guard var parts = URLComponents(url: serverURL, resolvingAgainstBaseURL: false),
              !parts.percentEncodedPath.contains("%"), !parts.path.contains("\\"),
              !parts.path.contains("//"), !parts.path.split(separator: "/").contains("."),
              !parts.path.split(separator: "/").contains("..") else { throw CollaborationError.invalidEndpoint }
        parts.scheme = scheme == "https" ? "wss" : "ws"
        parts.path = parts.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        parts.path = "/" + ([parts.path, "v1", "workspaces", workspaceID, "docs", documentID, "sync"].filter { !$0.isEmpty }.joined(separator: "/"))
        guard let endpoint = parts.url else { throw CollaborationError.invalidEndpoint }
        self.endpoint = endpoint; self.pageID = pageID; self.expectedUserID = expectedUserID; self.store = store
        self.tokenProvider = tokenProvider; self.socketFactory = socketFactory; self.acknowledgementTimeout = acknowledgementTimeout
    }

    /// The owner must start this on one task and call stop on teardown.
    public func run() async throws {
        diagnostic("run begin")
        guard stopped, !running, !localWriteInFlight else { throw CollaborationError.notStarted }
        running = true
        defer { running = false; stopped = true; publishEditorChange() }
        stopped = false; revoked = false; failed = false; reconnectNow = false; generation &+= 1
        publishEditorChange()
        let runID = generation
        do {
        for channel: UInt64 in [0, 1] {
            diagnostic("allocate document \(channel)")
            let doc = try NativeCRDTDocument()
            diagnostic("load store \(channel)")
            let updates = try await store.load(pageID: pageID, channel: channel)
            diagnostic("loaded store \(channel)")
            guard !stopped, generation == runID else { return }
            for update in updates { try doc.apply(update) }
            diagnostic("applied store \(channel)")
            documents[channel] = doc
        }
        guard let content = documents[0] else { throw CollaborationError.notStarted }
        diagnostic("create awareness")
        awareness = WorldsAwareness(clientID: try content.clientID())
        _ = try awareness?.setLocal("{}", at: Date().timeIntervalSince1970)
        if let presenceJSON { _ = try awareness?.setLocal(presenceJSON, at: Date().timeIntervalSince1970) }
        diagnostic("awareness ready")
        } catch {
            if !stopped && generation == runID { failed = true }
            throw error
        }
        let heartbeat = Task {
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(3)); try await self.pulseAwareness() }
                catch { if Task.isCancelled { break } }
            }
        }
        defer { heartbeat.cancel() }
        var attempt = 0
        var forceRefresh = false
        while !stopped && !revoked && !failed && generation == runID {
            var connection: (any CollaborationSocket)?
            do {
                diagnostic("acquire token")
                let token = try await tokenProvider(forceRefresh)
                diagnostic("token acquired")
                guard !stopped, generation == runID else { return }
                forceRefresh = false
                diagnostic("create socket")
                let opened: any CollaborationSocket
                if let socketFactory {
                    opened = try await socketFactory(endpoint, token)
                } else {
                    opened = URLSessionCollaborationSocket(url: endpoint, token: token)
                }
                diagnostic("socket created")
                guard !stopped, generation == runID else { await opened.close(); return }
                connection = opened; socket = opened; socketID = UUID(); clearPending(); verifiedIdentity = false; synchronizedChannels.removeAll()
                let activeConnectionID = socketID
                for channel: UInt64 in [0, 1] {
                    guard let doc = documents[channel] else { throw CollaborationError.notStarted }
                    diagnostic("send vector \(channel)")
                    try await opened.send(WorldsSyncWire.encode(.sync(channel: channel, kind: 0, payload: doc.vector())))
                }
                diagnostic("vectors sent")
                while !stopped && !failed && generation == runID {
                    guard let data = try await opened.receive() else { throw CollaborationError.invalidFrame }
                    diagnostic("frame received")
                    guard !stopped, generation == runID else { break }
                    guard socketID == activeConnectionID else { throw CollaborationError.invalidFrame }
                    try await handle(data, via: opened)
                }
            } catch {
                // A changed local account, workspace or cached permission is
                // not a transient network error. Do not reconnect with an old
                // session after the store has rejected its identity.
                if let storage = error as? CollaborationStorageError, storage == .denied { failed = true }
                // Only an authenticated connection resets backoff. Opening a
                // socket that immediately fails is not a successful session.
                if verifiedIdentity { attempt = 0 }
                // Revoke local use of the connection before the first await.
                // closeCode/close can suspend while other actor calls arrive.
                socket = nil; socketID = UUID(); clearPending(); verifiedIdentity = false; synchronizedChannels.removeAll(); accessLevel = nil; awareness?.disconnected()
                publishEditorChange()
                if let connection {
                    let closeCode = await connection.closeCode()
                    if closeCode == WorldsSyncWire.closeRevoked { revoked = true }
                    if closeCode == WorldsSyncWire.closeUnauthorized { forceRefresh = true }
                    await connection.close()
                }
                if stopped || generation != runID { return }
                if revoked { throw CollaborationError.accessRevoked }
                if failed { throw error }
                if reconnectNow { reconnectNow = false; attempt = 0; continue }
                attempt = min(attempt + 1, 6)
                let delay = UInt64(min(30.0, 0.5 * pow(2.0, Double(attempt))))
                let waiting = Task { try await Task.sleep(for: .seconds(delay)) }
                retryTask = waiting
                do { try await waiting.value }
                catch {
                    retryTask = nil
                    if stopped || generation != runID { return }
                    throw error
                }
                retryTask = nil
            }
        }
    }

    public func stop() async {
        stopped = true; generation &+= 1
        retryTask?.cancel()
        let closing = socket
        presenceVersion &+= 1
        _ = try? awareness?.setLocal(nil, at: Date().timeIntervalSince1970)
        socket = nil; socketID = UUID(); clearPending(); verifiedIdentity = false; synchronizedChannels.removeAll(); accessLevel = nil; awareness?.disconnected()
        publishEditorChange()
        // The service removes this socket's awareness on close. Waiting for a
        // queued awareness frame here can otherwise prevent closing forever.
        if let closing { await closing.close() }
    }

    /// Observation is instantaneous and does not imply durable synchronization.
    public func connectionStatus() -> CollaborationConnectionStatus {
        if revoked { return .accessRevoked }
        if failed { return .failed }
        guard running, !stopped else { return .stopped }
        guard socket != nil, verifiedIdentity, let accessLevel else { return .connecting }
        return .authenticated(level: accessLevel)
    }

    /// Coalesced invalidation signals only. Each consumer must call
    /// plainEditorSnapshot again, which rechecks authentication and state.
    public func editorChanges() -> AsyncStream<Void> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        editorObservers[id] = continuation
        continuation.onTermination = { @Sendable [weak self] _ in Task { await self?.removeEditorObserver(id) } }
        continuation.yield(())
        return stream
    }
    private func removeEditorObserver(_ id: UUID) { editorObservers.removeValue(forKey: id) }
    private func publishEditorChange() { for continuation in editorObservers.values { continuation.yield(()) } }

    private func clearPending() {
        for timer in acknowledgementTimers.values { timer.cancel() }
        acknowledgementTimers.removeAll(); pending.removeAll()
    }
    // Revoke local authority before suspending for a potentially stalled close.
    // A delayed failure from an older connection must not revoke a new one.
    private func closeConnection(_ target: any CollaborationSocket, connection: UUID) async {
        if socketID == connection {
            socketID = UUID()
            verifiedIdentity = false; accessLevel = nil; synchronizedChannels.removeAll()
            awareness?.disconnected()
            publishEditorChange()
        }
        await target.close()
    }

    private func expireAcknowledgement(_ batchID: UInt64, connection: UUID) async {
        guard !stopped, socketID == connection, pending[batchID] != nil, let socket else { return }
        // Do not acknowledge or remove durable data. A new connection will
        // negotiate state vectors and resend whatever the server lacks.
        await closeConnection(socket, connection: connection)
    }

    private func sendPresence(_ update: Data, via target: any CollaborationSocket, connection: UUID, version: UInt64) async throws {
        if presenceSending { await withCheckedContinuation { presenceWaiters.append($0) } }
        else { presenceSending = true }
        defer {
            if presenceWaiters.isEmpty { presenceSending = false }
            else { presenceWaiters.removeFirst().resume() }
        }
        guard socketID == connection, verifiedIdentity, !stopped, version == presenceVersion else { return }
        try await target.send(WorldsSyncWire.encode(.awareness(update)))
    }

    /// Presence names and colors are ephemeral. The service enforces authenticated user identity.
    public func setPresence(name: String, color: String) async throws {
        let object: [String: Any] = ["user": ["id": expectedUserID, "name": name, "color": color]]
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard let json = String(data: data, encoding: .utf8), data.count <= 32_000 else { throw CollaborationError.invalidFrame }
        presenceJSON = json
        presenceVersion &+= 1
        guard awareness != nil else { return }
        let update = try awareness!.setLocal(json, at: Date().timeIntervalSince1970)
        if verifiedIdentity, let socket { try await sendPresence(update, via: socket, connection: socketID, version: presenceVersion) }
    }

    /// Clear local presence and prevent automatic republishing on reconnect.
    /// If sending the removal fails, close the connection so peers can observe
    /// its departure. A server or peer may retain data already received.
    public func clearPresence() async throws {
        presenceJSON = nil
        presenceVersion &+= 1
        guard awareness != nil else { return }
        let update = try awareness!.setLocal(nil, at: Date().timeIntervalSince1970)
        if verifiedIdentity, let socket {
            let connection = socketID
            // A queued removal cannot overtake an in-flight send. Closing the
            // connection allows the service to remove its awareness without
            // waiting indefinitely for that send to finish.
            if presenceSending { await closeConnection(socket, connection: connection); return }
            do { try await sendPresence(update, via: socket, connection: connection, version: presenceVersion) }
            catch { await closeConnection(socket, connection: connection); throw error }
        }
    }

    public func presenceSnapshot() -> [UInt64: WorldsAwareness.Peer] { awareness?.peers ?? [:] }

    func pulseAwareness(at now: TimeInterval = Date().timeIntervalSince1970) async throws {
        guard !stopped, verifiedIdentity, let socket, let update = try awareness?.tick(at: now), presenceJSON != nil else { return }
        let connection = socketID
        do { try await sendPresence(update, via: socket, connection: connection, version: presenceVersion) }
        catch { await closeConnection(socket, connection: connection); throw error }
    }

    /// Persist first. If application fails afterward, stop and rebuild from the log.
    public func appendLocal(channel: UInt64, update: Data) async throws {
        guard !stopped, !failed, let doc = documents[channel] else { throw CollaborationError.notStarted }
        // Cached local permissions do not authorize a new update when this
        // connection has not authenticated or has lost the channel's rights.
        // Existing durable outbox entries are retained for later recovery.
        guard verifiedIdentity, let level = accessLevel,
              let access = WorldsSyncWire.AccessLevel(rawValue: level), WorldsSyncWire.canWrite(access, channel: channel) else {
            throw CollaborationError.accessRevoked
        }
        guard !localWriteInFlight, !remoteWriteInFlight else { throw CollaborationError.notStarted }
        guard update.count <= 64 * 1024 * 1024 else { throw CollaborationError.invalidFrame }
        // Refuse malformed wire updates before they can poison the durable
        // replica log and prevent subsequent sessions from opening it. This
        // only validates the update format, not its semantic authorization.
        let validation = try NativeCRDTDocument()
        try validation.apply(update)
        localWriteInFlight = true
        defer { finishLocalWrite() }
        try await store.appendLocal(pageID: pageID, channel: channel, update: update)
        do { try doc.apply(update) } catch { failed = true; if let socket { await closeConnection(socket, connection: socketID) }; throw error }
        // Reconnect triggers a full state-vector handshake, covering the persisted edit.
        if let socket { reconnectNow = true; await closeConnection(socket, connection: socketID) }
    }

    /// Set and remove a shared pack item's fields (docs/PACKS.md, Design 1).
    /// Request: `{"set": {...}, "remove": [...]}`. Requires an authenticated
    /// connection with edit access that has finished its initial sync, so the
    /// change is prepared on the server's current state. The update then takes
    /// the same path as any local update: validated, persisted to the store's
    /// outbox, applied, and sent on the immediate reconnect.
    public func setPackFields(request: Data) async throws {
        guard !stopped, !failed, verifiedIdentity, synchronizedChannels.contains(0), let level = accessLevel,
              let access = WorldsSyncWire.AccessLevel(rawValue: level), WorldsSyncWire.canWrite(access, channel: 0),
              let doc = documents[0] else { throw CollaborationError.accessRevoked }
        guard !localWriteInFlight, !remoteWriteInFlight else { throw CollaborationError.notStarted }
        let update = try NativeCRDTDocument.preparePackFields(base: doc.diff(Data([0])), request: request)
        try await appendLocal(channel: 0, update: update)
    }

    /// Experimental plain-text operation. Persist first, then apply to the live CRDT.
    /// This API is not connected to the editor and does not cover IME or rich text.
    public func insertPlain(blockIndex: UInt32, blockID: String, expected: String,
                            offset: UInt32, insertion: String, expectedState: Data? = nil) async throws {
        guard !stopped, !failed, verifiedIdentity, synchronizedChannels.contains(0), let level = accessLevel,
              let access = WorldsSyncWire.AccessLevel(rawValue: level), WorldsSyncWire.canWrite(access, channel: 0),
              let doc = documents[0], let editorStore = store as? any CheckedPlainEditorStore else { throw CollaborationError.accessRevoked }
        guard !localWriteInFlight, !remoteWriteInFlight else { throw CollaborationError.notStarted }
        localWriteInFlight = true
        defer { finishLocalWrite() }
        let base = try doc.diff(Data([0]))
        if let expectedState, expectedState != base { throw CollaborationError.staleProjection }
        // SQLite checks identity, cached rights, stable block ID and full base within
        // the same transaction that appends both the log and the outbox.
        let update = try await editorStore.insertPlainChecked(base: base, blockIndex: blockIndex, blockID: blockID,
                                                               expected: expected, offset: offset, insertion: insertion)
        do { try doc.apply(update) }
        catch { failed = true; if let socket { await closeConnection(socket, connection: socketID) }; throw error }
        // The durable update remains queued if offline or if the server rejects it.
        if let socket { await closeConnection(socket, connection: socketID) }
    }

    /// Only exposes a supported projection after authentication and after all
    /// currently applying remote or local updates have reached durable storage.
    public func plainEditorProjection() throws -> Data {
        try plainEditorSnapshot().json
    }
    public func deletePlain(blockIndex: UInt32, blockID: String, expected: String, offset: UInt32, length: UInt32, expectedState: Data) async throws {
        guard !stopped, !failed, verifiedIdentity, synchronizedChannels.contains(0), let level = accessLevel,
              let access = WorldsSyncWire.AccessLevel(rawValue: level), WorldsSyncWire.canWrite(access, channel: 0),
              let doc = documents[0], let editorStore = store as? any CheckedPlainDeleteStore else { throw CollaborationError.accessRevoked }
        guard !localWriteInFlight, !remoteWriteInFlight else { throw CollaborationError.notStarted }
        localWriteInFlight = true; defer { finishLocalWrite() }
        let base = try doc.diff(Data([0]))
        guard base == expectedState else { throw CollaborationError.staleProjection }
        let update = try await editorStore.deletePlainChecked(base: base, blockIndex: blockIndex, blockID: blockID, expected: expected, offset: offset, length: length)
        do { try doc.apply(update) } catch { failed = true; if let socket { await closeConnection(socket, connection: socketID) }; throw error }
        if let socket { await closeConnection(socket, connection: socketID) }
    }
    public func formatPlain(blockIndex: UInt32, blockID: String, expected: String, offset: UInt32, length: UInt32, mark: String, enabled: Bool, expectedState: Data) async throws {
        guard !stopped, !failed, verifiedIdentity, synchronizedChannels.contains(0), let level = accessLevel,
              let access = WorldsSyncWire.AccessLevel(rawValue: level), WorldsSyncWire.canWrite(access, channel: 0),
              let doc = documents[0], let editorStore = store as? any CheckedBasicFormatStore else { throw CollaborationError.accessRevoked }
        guard !localWriteInFlight, !remoteWriteInFlight else { throw CollaborationError.notStarted }
        localWriteInFlight = true; defer { finishLocalWrite() }
        let base = try doc.diff(Data([0]))
        guard base == expectedState else { throw CollaborationError.staleProjection }
        let update = try await editorStore.formatPlainChecked(base: base, blockIndex: blockIndex, blockID: blockID, expected: expected, offset: offset, length: length, mark: mark, enabled: enabled)
        do { try doc.apply(update) } catch { failed = true; if let socket { await closeConnection(socket, connection: socketID) }; throw error }
        if let socket { await closeConnection(socket, connection: socketID) }
    }
    public func plainEditorSnapshot() throws -> PlainEditorProjection {
        guard !stopped, !failed, verifiedIdentity, synchronizedChannels.contains(0), !localWriteInFlight, !remoteWriteInFlight,
              let doc = documents[0] else { throw CollaborationError.notStarted }
        return try PlainEditorProjection(json: doc.plainProjection(), state: doc.diff(Data([0])))
    }

    /// The page as the server last sent it, once this connection has
    /// authenticated as the expected account and finished the initial sync.
    /// Reading grants nothing: writes keep their own checks above.
    public func readOnlySnapshot() throws -> SharedPageReading {
        guard !stopped, !failed, verifiedIdentity, synchronizedChannels.contains(0), !localWriteInFlight, !remoteWriteInFlight,
              let level = accessLevel, let doc = documents[0] else { throw CollaborationError.notStarted }
        return try SharedPageReading(blocks: doc.readProjection(), packFields: doc.packFields(), accessLevel: level)
    }

    /// Called by the owner before JWT expiry. Expiration scheduling remains external.
    public func refreshAuthentication() async throws {
        guard !stopped, verifiedIdentity, let socket else { throw CollaborationError.notStarted }
        let connection = socketID
        let token = try await tokenProvider(true)
        guard !stopped, verifiedIdentity, socketID == connection else { throw CollaborationError.notStarted }
        try await socket.send(WorldsSyncWire.encode(.authRefresh(token: token)))
    }

    private func handle(_ data: Data, via socket: any CollaborationSocket) async throws {
        switch try WorldsSyncWire.decode(data) {
        case let .sync(channel, kind, payload):
            diagnostic("sync \(channel) kind \(kind)")
            guard verifiedIdentity else { failed = true; throw CollaborationError.accessRevoked }
            guard let doc = documents[channel] else { throw CollaborationError.invalidChannel }
            if kind == 0 {
                guard verifiedIdentity else { failed = true; throw CollaborationError.accessRevoked }
                guard !localWriteInFlight else { throw CollaborationError.notStarted }
                let connection = socketID
                diagnostic("pending watermark \(channel)")
                let through = try await store.maximumPendingID(pageID: pageID, channel: channel)
                guard !stopped, verifiedIdentity, socketID == connection, !localWriteInFlight, !remoteWriteInFlight else { throw CollaborationError.notStarted }
                // Another session can append to the same durable outbox. Never
                // acknowledge its watermark using an older in-memory replica.
                let persisted = try await store.load(pageID: pageID, channel: channel)
                guard !stopped, verifiedIdentity, socketID == connection, !localWriteInFlight, !remoteWriteInFlight else { throw CollaborationError.notStarted }
                let durable = try NativeCRDTDocument()
                for update in persisted { try durable.apply(update) }
                guard try durable.diff(Data([0])) == doc.diff(Data([0])) else {
                    failed = true
                    throw CollaborationError.staleProjection
                }
                diagnostic("calculate diff \(channel)")
                let diff = try doc.diff(payload)
                batch += 1
                pending[batch] = Pending(channel: channel, through: through)
                diagnostic("send update \(channel)")
                let batchID = batch, delay = acknowledgementTimeout
                acknowledgementTimers[batchID] = Task { [weak self] in
                    do { try await Task.sleep(for: delay) } catch { return }
                    await self?.expireAcknowledgement(batchID, connection: connection)
                }
                // Include a stalled send in the deadline: otherwise no timer
                // exists to close the socket and retry the durable outbox.
                try await socket.send(WorldsSyncWire.encode(.update(batchID: batchID, channel: channel, update: diff)))
            } else if kind == 1 || kind == 2 {
                diagnostic("apply remote \(channel)")
                guard !remoteWriteInFlight, !localWriteInFlight else { throw CollaborationError.notStarted }
                remoteWriteInFlight = true
                defer { remoteWriteInFlight = false }
                try doc.apply(payload)
                diagnostic("persist remote \(channel)")
                do { try await store.appendRemote(pageID: pageID, channel: channel, update: payload) }
                catch { failed = true; throw error }
                if kind == 1 { synchronizedChannels.insert(channel) }
                if channel == 0 { publishEditorChange() }
            } else { throw CollaborationError.invalidFrame }
        case let .acknowledgement(id, status, reason):
            diagnostic("acknowledgement")
            guard verifiedIdentity else { failed = true; throw CollaborationError.accessRevoked }
            guard let item = pending.removeValue(forKey: id) else { return }
            acknowledgementTimers.removeValue(forKey: id)?.cancel()
            if status == 0 {
                if let through = item.through { try await store.acknowledge(pageID: pageID, channel: item.channel, through: through) }
            } else {
                failed = true
                // The store may have persisted a local edit whose continuation
                // has not yet applied it to the in-memory document. Wait for it
                // before capturing the rejected state; no new local write can
                // start once failed is set.
                if localWriteInFlight {
                    await withCheckedContinuation { localWriteWaiters.append($0) }
                }
                guard let doc = documents[item.channel] else { throw CollaborationError.invalidChannel }
                let full = try doc.diff(Data([0]))
                try await store.archiveRejection(pageID: pageID, channel: item.channel, state: full, reason: reason)
                throw CollaborationError.rejected(reason)
            }
        case let .authState(level, userID):
            diagnostic("auth state")
            guard userID == expectedUserID, ["full", "edit", "comment", "view"].contains(level) else { failed = true; throw CollaborationError.accessRevoked }
            verifiedIdentity = true
            accessLevel = level
            publishEditorChange()
            diagnostic("send awareness query")
            try await socket.send(WorldsSyncWire.encode(.queryAwareness))
            guard !stopped, verifiedIdentity else { return }
            if let presenceJSON, let update = try awareness?.setLocal(presenceJSON, at: Date().timeIntervalSince1970) {
                diagnostic("send local awareness")
                try await sendPresence(update, via: socket, connection: socketID, version: presenceVersion)
            }
        case let .notice(code, message): lastNotice = "\(code): \(message)"
        case let .awareness(payload):
            diagnostic("awareness frame")
            guard verifiedIdentity else { failed = true; throw CollaborationError.accessRevoked }
            do {
                if let response = try awareness?.apply(payload, at: Date().timeIntervalSince1970), presenceJSON != nil {
                    try await sendPresence(response, via: socket, connection: socketID, version: presenceVersion)
                }
            } catch WorldsAwareness.AwarenessError.clientIDCollision {
                failed = true
                throw WorldsAwareness.AwarenessError.clientIDCollision
            }
        case .queryAwareness: break
        default: throw CollaborationError.invalidFrame
        }
    }

    private func finishLocalWrite() {
        localWriteInFlight = false
        publishEditorChange()
        let waiters = localWriteWaiters
        localWriteWaiters.removeAll()
        waiters.forEach { $0.resume() }
    }
}


