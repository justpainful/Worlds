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
    @Published var comments: [RejectedDrawingComment] = []
    @Published var selectedComment: RejectedDrawingComment?
    @Published var canCopyComment = false
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
            if more { items.append(contentsOf: page.items) } else { items = page.items; selected = nil; comments = []; selectedComment = nil; canCopyComment = false }
            next = page.next; message = nil
        } catch { clear(); message = "The archive is unavailable. Check your current access and try again." }
    }
    func select(_ item: RejectedArchiveInfo) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do {
            if item.channel == 1 { comments = try await service.drawingComments(id: item.id); canCopyComment = try await service.canExportComments() }
            else { _ = try await service.snapshot(id: item.id); comments = []; canCopyComment = false }
            selected = item; selectedComment = nil; message = nil
        } catch { clear(); message = "This archive is unavailable or access has changed." }
    }
    func copySelectedComment() async {
        guard !busy, let archive = selected, let chosen = selectedComment else { return }
        busy = true; defer { busy = false }
        do {
            let fresh = try await service.copyableDrawingComments(id: archive.id)
            let matches = fresh.filter { $0.threadID == chosen.threadID && $0.commentID == chosen.commentID }
            guard matches.count == 1, matches[0] == chosen else { throw RejectedArchiveError.invalidSelection }
            try Task.checkCancellation()
            #if canImport(UIKit)
            UIPasteboard.general.string = chosen.body
            #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            guard NSPasteboard.general.setString(chosen.body, forType: .string) else { throw RejectedArchiveError.invalidSelection }
            #endif
            message = "Comment copied."
        } catch { clear(); message = "The comment could not be copied. Check your current access." }
    }
    private func clear() { items = []; selected = nil; comments = []; selectedComment = nil; canCopyComment = false; next = nil }
}

/// An isolated review view. It cannot retransmit or modify an archive.
public struct RejectedArchivesView: View {
    @StateObject private var model: ArchiveViewModel
    @Environment(\.scenePhase) private var scenePhase
    public init(service: RejectedArchiveService) { _model = StateObject(wrappedValue: ArchiveViewModel(service: service)) }
    public var body: some View {
        List {
            Section {
                Text("These local copies may include earlier shared comments. Only your visible drawing comments are shown here.")
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
                }
                if item.channel == 1 {
                    Section("Your drawing comments") {
                        if model.comments.isEmpty { Text("No visible comments by this account.").foregroundStyle(.secondary) }
                        ForEach(Array(model.comments.enumerated()), id: \.offset) { _, comment in
                            Button { model.selectedComment = comment } label: {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(comment.body).lineLimit(3)
                                    Text(Date(timeIntervalSince1970: comment.createdAt / 1000), style: .date).font(.caption).foregroundStyle(.secondary)
                                }
                            }.disabled(model.busy).accessibilityIdentifier("archive.comment.row.\(comment.commentID)")
                        }
                        if let comment = model.selectedComment {
                            Text(comment.body).accessibilityIdentifier("archive.comment")
                            Button("Copy selected comment") { Task { await model.copySelectedComment() } }.disabled(model.busy || !model.canCopyComment)
                            if !model.canCopyComment { Text("Current permission does not allow comment export.").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
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
