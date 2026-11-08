#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_AUTOMATIONS
import SwiftUI
import WorldsAutomations

/// Experimental host for an already-authorized independent local copy only.
/// The caller must keep that copy's context alive and prevent switching it.
struct LocalAutomationsView: View {
    @StateObject private var model: LocalAutomationsModel
    @State private var selectedApproval: PersonalAutomationApproval?
    @Environment(\.dismiss) private var dismiss
    init(databaseURL: URL, identity: VideoDatabaseIdentity) { _model = StateObject(wrappedValue: LocalAutomationsModel(databaseURL: databaseURL, identity: identity)) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("This independent local copy does not schedule automations or send Discord messages. Approvals cannot be delivered here.")
                        .foregroundStyle(.secondary)
                }
                if let error = model.error { Text(error).accessibilityIdentifier("automations-error") }
                if model.loading { ProgressView("Loading automations") }
                if let snapshot = model.snapshot {
                    Section("Automations") {
                        if snapshot.automations.isEmpty { Text("No personal automations in this copy.") }
                        ForEach(snapshot.automations) { automation in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(automation.name).font(.headline)
                                Text(automation.enabled ? "Enabled in this copy" : "Paused").foregroundStyle(.secondary)
                                if let next = automation.nextRunAt { Text("Next scheduled: \(date(next))").foregroundStyle(.secondary) }
                            }.accessibilityIdentifier("automation.\(automation.id)")
                        }
                    }
                    Section("Pending requests") {
                        if snapshot.pending.isEmpty { Text("No personal requests waiting for review.") }
                        ForEach(snapshot.pending) { approval in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(name(approval.automationID, in: snapshot))
                                Text("Discord delivery is unavailable. You can decline this request in the local copy.").foregroundStyle(.secondary)
                                Button("Decline request", role: .destructive) { selectedApproval = approval }
                                    .disabled(model.loading).accessibilityIdentifier("decline-automation.\(approval.id)")
                            }
                        }
                    }
                    Section("Recent runs") {
                        if snapshot.runs.isEmpty { Text("No runs in this copy.") }
                        ForEach(snapshot.runs) { run in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(name(run.automationID, in: snapshot)).font(.headline)
                                Text("Status: \(run.status)").foregroundStyle(.secondary)
                                if let at = run.startedAt ?? run.scheduledFor { Text(date(at)).foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Automations")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(model.loading) }
                ToolbarItem(placement: .primaryAction) { Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh() } }.disabled(model.loading) }
            }
            .alert("Decline this request in the local copy?", isPresented: Binding(get: { selectedApproval != nil }, set: { if !$0 { selectedApproval = nil } })) {
                Button("Decline", role: .destructive) {
                    guard let approval = selectedApproval else { return }; selectedApproval = nil
                    Task { await model.decline(approval.id) }
                }
                Button("Cancel", role: .cancel) { selectedApproval = nil }
            } message: { Text("This only changes the independent local copy. No Discord message is sent.") }
            .interactiveDismissDisabled(model.loading)
            .task { await model.refresh() }
        }
    }
    private func name(_ id: String, in snapshot: PersonalAutomationSnapshot) -> String {
        snapshot.automations.first(where: { $0.id == id })?.name ?? "Unavailable automation"
    }
    private func date(_ milliseconds: Int64) -> String {
        Date(timeIntervalSince1970: Double(milliseconds) / 1000).formatted(date: .abbreviated, time: .shortened)
    }
}

@MainActor private final class LocalAutomationsModel: ObservableObject {
    @Published var snapshot: PersonalAutomationSnapshot?
    @Published var error: String?
    @Published var loading = false
    private let databaseURL: URL
    private let identity: VideoDatabaseIdentity
    init(databaseURL: URL, identity: VideoDatabaseIdentity) {
        self.databaseURL = databaseURL; self.identity = identity
    }
    private func checkIdentity() throws {
        guard VideoDatabaseIdentity.read(databaseURL) == identity else { throw AutomationViewError.databaseChanged }
    }
    func refresh() async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        do {
            try checkIdentity()
            let repository = try AutomationRepository(url: databaseURL)
            let result = try await repository.personalSnapshot()
            try checkIdentity()
            snapshot = result; error = nil
        } catch { snapshot = nil; self.error = "Could not load personal automations from this copy." }
    }
    func decline(_ id: String) async {
        guard !loading else { return }
        loading = true
        do {
            try checkIdentity()
            let driver = try NativeAutomationStore(url: databaseURL)
            try await driver.decline(actionID: id)
            try checkIdentity()
            loading = false
            await refresh()
        } catch {
            loading = false; snapshot = nil
            self.error = "The decline could not be confirmed. Refresh to check the current state."
        }
    }
}

private enum AutomationViewError: Error { case databaseChanged }
#endif
