import SwiftUI
import WorldsCollaboration
import WorldsRejectedArchives

private actor FixtureAuthority: ArchiveAuthority {
    private var permission: ArchivePermission?
    init(_ permission: ArchivePermission) { self.permission = permission }
    func currentPermission() async throws -> ArchivePermission? { permission }
    func revoke() { permission = nil }
}

@MainActor private final class FixtureModel: ObservableObject {
    @Published var service: RejectedArchiveService?
    @Published var error: String?
    let permission = ArchivePermission(userID: "fixture-user", workspaceID: "fixture-workspace", pageID: "fixture-page", generation: "fixture")
    private var authority: FixtureAuthority?
    func prepare() async {
        guard service == nil else { return }
        do {
            guard let fixture = Bundle.main.url(forResource: "worlds-collab-v11", withExtension: "db") else { throw FixtureError.missing }
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("rejected-harness-\(UUID().uuidString).db")
            try FileManager.default.copyItem(at: fixture, to: copy)
            let store = try SQLiteCollaborationStore(databaseURL: copy, pageID: permission.pageID, userID: permission.userID, workspaceID: permission.workspaceID)
            guard let comments = Bundle.main.url(forResource: "rejected-comments-yjs", withExtension: "bin") else { throw FixtureError.missing }
            try await store.archiveRejection(pageID: permission.pageID, channel: 1, state: Data(contentsOf: comments), reason: "Fixture rejection")
            let access = FixtureAuthority(permission); authority = access
            service = RejectedArchiveService(store: store, authority: access, expected: permission)
        } catch { self.error = "Could not prepare the isolated fixture." }
    }
    func revoke() async { await authority?.revoke() }
}
private enum FixtureError: Error { case missing }

@main struct RejectedArchiveHarnessApp: App {
    @StateObject private var model = FixtureModel()
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                if let service = model.service {
                    RejectedArchivesView(service: service)
                        .toolbar { Button("Revoke fixture access") { Task { await model.revoke() } }.accessibilityIdentifier("fixture.revoke") }
                } else if let error = model.error { Text(error) }
                else { ProgressView("Preparing fixture") }
            }
            #if os(macOS)
            .frame(minWidth: 520, minHeight: 400)
            #endif
            .task { await model.prepare() }
        }
    }
}
