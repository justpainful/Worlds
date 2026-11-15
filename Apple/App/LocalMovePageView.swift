#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_MOVE_PAGE
import SwiftUI
import WorldsLocalImport
import WorldsWorkspaceAccess
import WorldsNativeWrites
import WorldsPersistence

struct LocalMovePageRequest: Identifiable {
    let id = UUID()
    let pageID: String
    let title: String
    let originalParent: String?
    let originalSortKey: Double
    let originalRevision: Int64
    let candidates: [StoredPage]
    let copy: WorkspaceWriteTarget
    let databaseIdentity: VideoDatabaseIdentity
    let generation: UUID
}

struct LocalPagePlacement {
    let parent: String?
    let sortKey: Double
    let revision: Int64
}

/// The picker is based on a snapshot. The transaction must validate ownership,
/// ancestry and the baseline again; this screen does not grant permission.
struct LocalMovePageView: View {
    @Environment(\.dismiss) private var dismiss
    let request: LocalMovePageRequest
    let move: @MainActor (LocalPagePlacement, String?, UUID) async throws -> LocalPagePlacement
    @State private var placement: LocalPagePlacement
    @State private var destination: String?
    @State private var busy = false
    @State private var uncertain = false
    @State private var message: String?
    @State private var confirmDiscard = false

    init(request: LocalMovePageRequest, move: @escaping @MainActor (LocalPagePlacement, String?, UUID) async throws -> LocalPagePlacement) {
        self.request = request
        self.move = move
        _placement = State(initialValue: LocalPagePlacement(parent: request.originalParent, sortKey: request.originalSortKey, revision: request.originalRevision))
        _destination = State(initialValue: request.originalParent)
    }
    private var choices: [StoredPage] {
        let byID = Dictionary(request.candidates.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        // Rust permits at most 128 nodes in the destination ancestor chain.
        // A negative cached depth denotes a cycle, missing parent or overlong path.
        var depths: [String: Int] = [:]
        for page in request.candidates where depths[page.id] == nil {
            var path: [String] = []
            var seen = Set<String>()
            var current: String? = page.id
            var depth = 0
            while let id = current {
                if let cached = depths[id] { depth = cached; break }
                guard id != request.pageID, seen.insert(id).inserted, let entry = byID[id] else {
                    depth = -1; break
                }
                path.append(id)
                current = entry.parentID
            }
            for id in path.reversed() {
                if depth >= 0 { depth += 1; if depth > 128 { depth = -1 } }
                depths[id] = depth
            }
        }
        return request.candidates.filter { page in
            !page.archived && ["page", "document"].contains(page.kind) && (depths[page.id] ?? -1) > 0
        }
    }
    private var dirty: Bool { destination != placement.parent }
    var body: some View {
        let names = Dictionary(request.candidates.map { ($0.id, $0.title) }, uniquingKeysWith: { first, _ in first })
        return NavigationStack {
            List {
                if request.copy.isLocalCopy { Text("Choose a destination in this independent local copy. The page will be placed at the end of the destination.") }
                else { Text("Choose a destination in your Worlds workspace. The page will be placed at the end of the destination.") }
                Text("Available destinations: \(choices.count)").accessibilityIdentifier("move-destination-count")
                if ProcessInfo.processInfo.arguments.contains("--ui-testing-move-fixture") {
                    let ids = Set(choices.map(\.id))
                    Text("Deep boundary: \(ids.contains("deep-127")) \(ids.contains("deep-128"))")
                        .accessibilityIdentifier("move-fixture-depth-boundary")
                }
                Button { destination = nil } label: {
                    HStack { Text("Top level"); Spacer(); if destination == nil { Image(systemName: "checkmark") } }
                }.accessibilityIdentifier("move-destination-root")
                ForEach(choices) { page in
                    Button { destination = page.id } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(page.title.isEmpty ? String(localized: "Untitled") : page.title)
                                if let parent = page.parentID, let parentName = names[parent] {
                                    Text(parentName.isEmpty ? String(localized: "Untitled") : parentName).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if destination == page.id { Image(systemName: "checkmark") }
                        }
                    }.accessibilityIdentifier("move-destination.\(page.id)")
                }
                if let message { Text(message).accessibilityIdentifier("move-status") }
                if busy { ProgressView("Moving page") }
            }
            .disabled(busy || uncertain)
            .navigationTitle("Move page")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { if dirty { confirmDiscard = true } else { dismiss() } }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Move") { Task { await commit() } }.disabled(busy || uncertain || !dirty)
                        .accessibilityIdentifier("move-confirm")
                }
            }
            .confirmationDialog("Discard the selected destination?", isPresented: $confirmDiscard) {
                Button("Discard", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .interactiveDismissDisabled(busy || dirty)
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 300)
        #endif
    }
    @MainActor private func commit() async {
        guard !busy, !uncertain, dirty else { return }
        let target = destination
        busy = true
        defer { busy = false }
        do {
            let result = try await move(placement, target, UUID())
            guard result.parent == target else {
                uncertain = true
                message = request.copy.isLocalCopy ? "The destination could not be verified. Close and reopen the copy to check." : String(localized: "The destination could not be verified. Open the workspace again to check.")
                return
            }
            placement = result
            destination = result.parent
            message = "Page moved. The previous position cannot be restored here."
        } catch NativeWriteError.conflict {
            uncertain = true
            message = request.copy.isLocalCopy ? "The page or destination changed. Close and reopen the copy to review it." : String(localized: "The page or destination changed. Open the workspace again to review it.")
        } catch {
            uncertain = true
            message = request.copy.isLocalCopy ? "The result could not be confirmed. The page may have moved. Close and reopen the copy to check." : String(localized: "The result could not be confirmed. The page may have moved. Open the workspace again to check.")
        }
    }
}
#endif
