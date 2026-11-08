import SwiftUI
import WorldsCollaboration
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@MainActor
private final class ArchiveViewModel: ObservableObject {
    @Published var items: [RejectedArchiveInfo] = []
    @Published var selected: RejectedArchiveInfo?
    @Published var next: RejectedArchiveCursor?
    @Published var busy = false
    @Published var message: String?
    private let service: RejectedArchiveService
    init(service: RejectedArchiveService) { self.service = service }
    func load(more: Bool = false) async {
        guard !busy, !more || next != nil else { return }
        busy = true; defer { busy = false }
        do {
            let page = try await service.list(before: more ? next : nil)
            if more { items.append(contentsOf: page.items) } else { items = page.items; selected = nil }
            next = page.next; message = nil
        } catch { clear(); message = "The archive is unavailable. Check your current access and try again." }
    }
    func select(_ item: RejectedArchiveInfo) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            _ = try await service.snapshot(id: item.id)
            selected = item; message = nil
        } catch { clear(); message = "This archive is unavailable or access has changed." }
    }
    func copy() async {
        guard !busy, let item = selected else { return }
        busy = true; defer { busy = false }
        do {
            let data = try await service.snapshot(id: item.id)
            try Task.checkCancellation()
            #if canImport(UIKit)
            UIPasteboard.general.string = data.base64EncodedString()
            #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            guard NSPasteboard.general.setString(data.base64EncodedString(), forType: .string) else { throw RejectedArchiveError.invalidSelection }
            #endif
            message = "Technical snapshot copied."
        } catch { clear(); message = "The snapshot could not be copied. Check your current access." }
    }
    private func clear() { items = []; selected = nil; next = nil }
}

/// An isolated review view. It cannot retransmit or modify an archive.
public struct RejectedArchivesView: View {
    @StateObject private var model: ArchiveViewModel
    @Environment(\.scenePhase) private var scenePhase
    public init(service: RejectedArchiveService) { _model = StateObject(wrappedValue: ArchiveViewModel(service: service)) }
    public var body: some View {
        List {
            Section {
                Text("These local snapshots may include earlier shared content. Copying exports technical Yjs data, not readable text.")
                    .font(.footnote).foregroundStyle(.secondary)
                if let message = model.message { Text(message).accessibilityIdentifier("archive.message") }
            }
            Section("Rejected edits") {
                if model.items.isEmpty && !model.busy && model.message == nil { Text("No snapshots available.").foregroundStyle(.secondary) }
                ForEach(model.items, id: \.id) { item in
                    Button { Task { await model.select(item) } } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(Date(timeIntervalSince1970: Double(item.createdAt) / 1000), style: .date)
                            Text(item.reason).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                        }
                    }.disabled(model.busy).accessibilityIdentifier("archive.row.\(item.id)")
                }
                if model.next != nil { Button("Load more") { Task { await model.load(more: true) } }.disabled(model.busy) }
            }
            if let item = model.selected {
                Section("Snapshot details") {
                    Text("Snapshot details").accessibilityIdentifier("archive.details")
                    LabeledContent("Channel", value: item.channel == 0 ? "Content" : "Comments")
                    LabeledContent("Size", value: ByteCountFormatter.string(fromByteCount: item.size, countStyle: .file))
                    Text(item.reason).textSelection(.enabled)
                    Button("Copy technical snapshot") { Task { await model.copy() } }.disabled(model.busy)
                }
            }
        }
        .navigationTitle("Rejected edits")
        .toolbar { Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.load() } }.disabled(model.busy).accessibilityIdentifier("archive.refresh") }
        .overlay { if model.busy { ProgressView() } }
        .task { await model.load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await model.load() } }
        }
    }
}
