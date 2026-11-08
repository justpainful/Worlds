import SwiftUI
import WorldsCollaboration

/// Observes transport and access only. It does not claim that edits are synced.
@MainActor public final class CollaborationConnectionModel: ObservableObject {
    @Published public private(set) var status: CollaborationConnectionStatus = .stopped
    private var generation = UUID()
    public init() {}
    public func observe(_ session: CollaborationSession) async {
        let token = UUID(); generation = token
        let changes = await session.editorChanges()
        for await _ in changes {
            guard !Task.isCancelled, generation == token else { break }
            let next = await session.connectionStatus()
            guard !Task.isCancelled, generation == token else { break }
            status = next
        }
        if generation == token { status = .stopped }
    }
}

/// Host owns the session and its lifecycle. No connection is started here.
public struct CollaborationConnectionView: View {
    @StateObject private var model = CollaborationConnectionModel()
    private let session: CollaborationSession
    public init(session: CollaborationSession) { self.session = session }
    public var body: some View {
        Label(label, systemImage: symbol)
            .accessibilityIdentifier("collaboration-connection-status")
            .task { await model.observe(session) }
    }
    private var label: String {
        switch model.status {
        case .stopped: return "Connection stopped"
        case .connecting: return "Connecting or offline"
        case .authenticated(let level):
            switch level {
            case "full": return "Connected: full access"
            case "edit": return "Connected: can edit"
            case "comment": return "Connected: can comment"
            case "view": return "Connected: can view"
            default: return "Connected: access unavailable"
            }
        case .accessRevoked: return "Access revoked"
        case .failed: return "Connection stopped: access or sync error"
        }
    }
    private var symbol: String {
        switch model.status {
        case .authenticated: return "link"
        case .connecting: return "arrow.triangle.2.circlepath"
        case .stopped: return "pause.circle"
        case .accessRevoked, .failed: return "exclamationmark.triangle"
        }
    }
}
