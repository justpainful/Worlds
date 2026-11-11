import Foundation

/// A provider ready to call: the preset with the person's own address and key.
/// The key is hidden from `print`, `dump` and the debugger.
public struct AIProviderConfiguration: Sendable, Equatable {
    public let preset: AIProviderPreset
    public let baseURL: String
    public let apiKey: String?

    public init(preset: AIProviderPreset, baseURL: String, apiKey: String?) {
        self.preset = preset
        self.baseURL = baseURL
        self.apiKey = apiKey
    }

    var hasKey: Bool { !(apiKey?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }
}

extension AIProviderConfiguration: CustomStringConvertible, CustomDebugStringConvertible, CustomReflectable {
    public var description: String { "AIProviderConfiguration(id: \(preset.id), baseURL: \(baseURL), key: \(hasKey ? "set" : "none"))" }
    public var debugDescription: String { description }
    public var customMirror: Mirror {
        Mirror(self, children: ["id": preset.id, "baseURL": baseURL, "key": hasKey ? "set" : "none"])
    }
}

/// Talks to one provider over HTTPS (or HTTP for local servers). Replies stream
/// as text deltas. The key only travels in request headers; it is never logged
/// or put into error messages.
public struct AIProviderClient: Sendable {
    public let configuration: AIProviderConfiguration
    private let session: URLSession

    public init(configuration: AIProviderConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
    }

    private var providerName: String { configuration.preset.name }

    public func checkReady(model: String?) throws {
        guard AIRequests.isValidBase(configuration.baseURL) else { throw AIProviderError.badURL(provider: providerName) }
        if configuration.preset.requiresKey && !configuration.hasKey { throw AIProviderError.noKey(provider: providerName) }
        if let model, model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw AIProviderError.noModel(provider: providerName)
        }
    }

    /// The models this provider offers to this key, from its own list endpoint.
    public func listModels() async throws -> [AIModelOption] {
        do {
            try checkReady(model: nil)
            let request = try AIRequests.modelsRequest(configuration)
            let (data, response) = try await session.data(for: request.urlRequest(timeout: 30))
            guard let http = response as? HTTPURLResponse else { throw AIProviderError.malformed(provider: providerName) }
            guard (200..<300).contains(http.statusCode) else {
                throw AIRequests.httpError(provider: providerName, status: http.statusCode, body: data, model: nil, secret: configuration.apiKey)
            }
            return try AIRequests.parseModels(data, provider: providerName)
        } catch {
            throw translate(error)
        }
    }

    /// Streams the reply as text deltas. Cancelling the consumer cancels the request.
    public func streamChat(model: String, system: String, turns: [AITurn]) -> AsyncThrowingStream<String, Error> {
        let client = self
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    try await client.runChat(model: model, system: system, turns: turns) { text in
                        continuation.yield(text)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: client.translate(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func runChat(model: String, system: String, turns: [AITurn], emit: (String) -> Void) async throws {
        try checkReady(model: model)
        let request = try AIRequests.chatRequest(configuration, model: model, system: system, turns: turns)
        let (bytes, response) = try await session.bytes(for: request.urlRequest(timeout: 120))
        guard let http = response as? HTTPURLResponse else { throw AIProviderError.malformed(provider: providerName) }
        if !(200..<300).contains(http.statusCode) {
            var body = Data()
            for try await byte in bytes {
                body.append(byte)
                if body.count >= 65_536 { break }
            }
            throw AIRequests.httpError(provider: providerName, status: http.statusCode, body: body, model: model, secret: configuration.apiKey)
        }

        let decoder = AIStreamDecoder(dialect: configuration.preset.api)
        var received = false
        let contentType = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        if contentType.contains("application/json") {
            // The server ignored `"stream": true` and sent the whole reply at once.
            var body = Data()
            for try await byte in bytes { body.append(byte) }
            _ = try apply(decoder.decodeWhole(body), received: &received, emit: emit)
        } else {
            var parser = AISSEParser()
            var done = false
            streaming: for try await byte in bytes {
                let events = parser.push(byte: byte)
                if events.isEmpty { continue }
                for event in events {
                    if try apply(decoder.decode(event), received: &received, emit: emit) {
                        done = true
                        break streaming
                    }
                }
                try Task.checkCancellation()
            }
            if !done {
                for event in parser.finish() {
                    if try apply(decoder.decode(event), received: &received, emit: emit) { break }
                }
            }
        }
        try Task.checkCancellation()
        if !received { throw AIProviderError.malformed(provider: providerName) }
    }

    /// Returns true when the stream says it is done.
    private func apply(_ events: [AIStreamEvent], received: inout Bool, emit: (String) -> Void) throws -> Bool {
        for event in events {
            switch event {
            case .delta(let text):
                received = true
                emit(text)
            case .done:
                return true
            case .failure(let message):
                let clean = configuration.apiKey.map { message.replacingOccurrences(of: $0, with: "[key]") } ?? message
                throw AIProviderError.stream(provider: providerName, detail: clean)
            }
        }
        return false
    }

    func translate(_ error: Error) -> Error {
        if error is AIProviderError || error is CancellationError { return error }
        let offline = AIProviderError.offline(provider: providerName, host: AIRequests.host(configuration.baseURL),
                                              local: AIRequests.isLocal(configuration.baseURL))
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cancelled:
                return CancellationError()
            case .badURL, .unsupportedURL:
                return AIProviderError.badURL(provider: providerName)
            case .appTransportSecurityRequiresSecureConnection:
                return AIProviderError.insecureAddress(provider: providerName)
            case .userAuthenticationRequired:
                return AIProviderError.badKey(provider: providerName)
            case .cannotDecodeContentData, .cannotDecodeRawData, .cannotParseResponse, .badServerResponse:
                return AIProviderError.malformed(provider: providerName)
            default:
                return offline
            }
        }
        if Task.isCancelled { return CancellationError() }
        if error is DecodingError { return AIProviderError.malformed(provider: providerName) }
        return error
    }
}
