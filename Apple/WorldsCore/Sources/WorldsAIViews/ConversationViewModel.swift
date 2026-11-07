import Foundation
import Combine

@MainActor
public final class ConversationViewModel: ObservableObject {
    @Published public private(set) var messages: [ConversationMessage] = []
    @Published public private(set) var streamedText = ""
    @Published public private(set) var tools: [ConversationTool] = []
    @Published public private(set) var loading = false
    @Published public private(set) var loaded = false
    @Published public private(set) var running = false
    @Published public private(set) var stopping = false
    @Published public private(set) var error: String?
    @Published public var draft = ""
    public let conversationID: String
    private let service: any ConversationService
    private var activeRun: UUID?
    private var loadToken = UUID()

    public init(conversationID: String, service: any ConversationService) {
        self.conversationID = conversationID; self.service = service
    }
    public func load() async {
        guard !running else { return }
        let token = UUID(); loadToken = token; loading = true; error = nil
        do {
            let loaded = try await service.load(conversationID: conversationID)
            guard token == loadToken else { return }
            messages = loaded; self.loaded = true; loading = false
        } catch {
            guard token == loadToken else { return }
            self.loaded = false; self.error = error.localizedDescription; loading = false
        }
    }
    public func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, loaded, !running, !loading else { return }
        let id = UUID(); activeRun = id; loadToken = UUID()
        running = true; stopping = false; error = nil; streamedText = ""; tools = []
        // Retain the draft until the service confirms that it persisted a snapshot.
        var accepted = false
        do {
            for try await event in service.send(conversationID: conversationID, runID: id, text: text) {
                guard activeRun == id else { return }
                switch event {
                case .snapshot(let value): messages = value
                case .accepted(let value):
                    messages = value
                    if !accepted { if draft.trimmingCharacters(in: .whitespacesAndNewlines) == text { draft = "" }; accepted = true }
                case .textDelta(let value): streamedText += value
                case .tool(let value):
                    if let index = tools.firstIndex(where: { $0.id == value.id }) { tools[index] = value }
                    else { tools.append(value) }
                }
            }
            guard activeRun == id else { return }
            activeRun = nil; running = false; stopping = false
            await load()
            if error == nil { streamedText = ""; tools = [] }
        } catch {
            guard activeRun == id else { return }
            activeRun = nil; running = false; stopping = false
            self.error = error.localizedDescription
        }
    }
    public func stop() async {
        guard let id = activeRun, !stopping else { return }
        stopping = true
        do { try await service.cancel(runID: id) }
        catch { if activeRun == id { stopping = false; self.error = error.localizedDescription } }
    }
}
