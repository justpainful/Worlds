#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
import SwiftUI
import WorldsPersistence

struct LocalHistoryRequest: Identifiable {
    let id = UUID()
    let pageID: String
    let title: String
    let database: WorldsDatabase
}

/// Read-only history from the already-open local-copy database. It does not
/// restore versions or expose the before/after payloads.
struct LocalHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    let request: LocalHistoryRequest
    @State private var entries: [StoredHistoryEntry]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if let error {
                    ContentUnavailableView("History unavailable", systemImage: "exclamationmark.triangle", description: Text(error))
                        .accessibilityIdentifier("local-history-error")
                } else if let entries {
                    if entries.isEmpty {
                        ContentUnavailableView("No history", systemImage: "clock", description: Text("No changes are recorded for this page."))
                            .accessibilityIdentifier("local-history-empty")
                    } else {
                        List {
                            Section {
                                ForEach(entries) { entry in
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(entry.summary.isEmpty ? "Change" : entry.summary)
                                        Text(entry.actor.isEmpty ? "Unknown actor" : entry.actor).font(.caption).foregroundStyle(.secondary)
                                        if let date = historyDate(entry.createdAt) {
                                            Text(date, format: .dateTime.year().month().day().hour().minute())
                                                .font(.caption).foregroundStyle(.secondary)
                                        } else {
                                            Text("Time unavailable").font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    .accessibilityElement(children: .contain)
                                    .accessibilityIdentifier("local-history-entry.\(entry.id)")
                                    .accessibilityLabel("\(entry.summary), \(entry.actor)")
                                }
                            } header: {
                                VStack(alignment: .leading) {
                                    Text(request.title.isEmpty ? String(localized: "Untitled page") : request.title)
                                    Text("Recent changes")
                                }
                            } footer: {
                                Text("Up to 200 entries. Restoring changes is not available here.")
                            }
                        }
                        .accessibilityIdentifier("local-history-list")
                    }
                } else {
                    ProgressView("Loading history")
                }
            }
            .navigationTitle("Page history")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .task {
                do {
                    let result = try await request.database.checkedPersonalHistory(pageID: request.pageID, limit: 200)
                    guard !Task.isCancelled else { return }
                    entries = result
                } catch {
                    guard !Task.isCancelled else { return }
                    self.error = "This page is no longer available or its history could not be read."
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 300)
        #endif
    }

    private func historyDate(_ value: Int64) -> Date? {
        guard value >= 0, value <= 253_402_300_799_999 else { return nil }
        return Date(timeIntervalSince1970: Double(value) / 1000)
    }
}
#endif
