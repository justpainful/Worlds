#if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
import SwiftUI
import WorldsGallery
import WorldsModels
import WorldsMedia
import WorldsNativeWrites
import WorldsResourceRepositories
import WorldsLocalImport

enum LocalGalleryDraftFixture {
    static let assets: [(String, String, Data)] = [
        ("asset-a", "First.png", Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAaUlEQVR4nNXOMREAIBDAsFJ1LPhXgA9E/MA1CrLuPpRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMT5OzD1AF04Adqq4CNxAAAAAElFTkSuQmCC")!),
        ("asset-b", "Second.png", Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAZklEQVR4nNXOQREAIAzAsK7+HzgGETx2jYIM51ImcRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRIncRLnduDXA1OUAe8Zs0PeAAAAAElFTkSuQmCC")!)
    ]
    static func install(in copy: LocalProjectCopy) throws {
        let root = copy.databaseURL.deletingLastPathComponent()
        for (_, name, bytes) in assets { try bytes.write(to: root.appendingPathComponent(name), options: .withoutOverwriting) }
    }
    static func verify(in copy: LocalProjectCopy) throws {
        let vault = try AttachmentVault(root: copy.databaseURL.deletingLastPathComponent())
        for (id, name, bytes) in assets {
            let attachment = WorldsAttachment(id: id, pageId: "gallery-draft-fixture", kind: "image", fileName: name, mime: "image/png", size: Int64(bytes.count), relPath: name, width: nil, height: nil, createdAt: 1)
            let opened = try vault.open(attachment, maxSize: 1024 * 1024)
            guard try opened.read() == bytes else { throw MediaError.invalidContent }
        }
    }
}

struct LocalGalleryDraftRequest: Identifiable {
    let id = UUID()
    let copy: LocalProjectCopy
    let identity: VideoDatabaseIdentity
    let generation: UUID
}

@MainActor private final class LocalGalleryDraftState: ObservableObject {
    @Published var draft: GalleryDraftSession?
    @Published var caption = ""
    @Published var selected: String?
    @Published var busy = false
    @Published var saved = false
    @Published var assetsVerified = false
    @Published var opaqueRetained = false
    @Published var blocked = false
    @Published var error: String?
    private let request: LocalGalleryDraftRequest
    private var repository: NativeResourceRepository?
    init(request: LocalGalleryDraftRequest) { self.request = request }
    var currentCaption: String? { guard let draft, let selected else { return nil }; return draft.document.editableCaption(itemID: selected) }
    var pending: Bool { guard let currentCaption else { return false }; return !caption.utf8.elementsEqual(currentCaption.utf8) }
    var dirty: Bool { pending || (draft?.dirty ?? false) }
    private func hasOpaqueFixture(_ snapshot: GallerySnapshot) -> Bool {
        snapshot.blocks.contains { block in
            guard case .object(let object) = block, object["id"] == .string("gallery-opaque"),
                  case .object(let content)? = object["content"], content["type"] == .string("future"),
                  case .object(let attrs)? = content["attrs"] else { return false }
            return attrs["bid"] == .string("gallery-opaque") && attrs["keep"] == .bool(true)
        }
    }
    func load() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.identity else { throw MediaError.inaccessible }
            try LocalGalleryDraftFixture.verify(in: request.copy)
            assetsVerified = true
            let repository = NativeResourceRepository(store: try NativePersonalStore(url: request.copy.databaseURL))
            let snapshot = try await repository.readAuthorizedGallery(id: "gallery-draft-fixture")
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.identity else { throw MediaError.inaccessible }
            let session = try GalleryDraftSession(snapshot: snapshot)
            guard hasOpaqueFixture(snapshot) else { throw GalleryError.invalidBlock }
            opaqueRetained = true
            self.repository = repository; draft = session; selected = session.document.items.first?.id
            caption = currentCaption ?? ""; error = nil
        } catch { blocked = true; self.error = "The isolated gallery or its attachments could not be opened." }
    }
    func select(_ id: String) { guard !pending, !busy, !blocked else { return }; selected = id; caption = currentCaption ?? "" }
    func apply() { guard !busy, !blocked, var next = draft, let selected else { return }; do { try next.setCaption(itemID: selected, text: caption); draft = next; saved = false } catch { self.error = "This caption cannot be edited safely." } }
    func move(_ index: Int) { guard !pending, !busy, !blocked, var next = draft, index > 0 else { return }; do { try next.move(from: index, to: index - 1); draft = next; saved = false } catch { self.error = "This order cannot be edited safely." } }
    func history(_ redo: Bool) { guard !pending, !busy, !blocked, var next = draft else { return }; if redo { next.redo() } else { next.undo() }; draft = next; caption = currentCaption ?? ""; saved = false }
    func save() async {
        guard !busy, !blocked, !pending, let draft, draft.dirty, let repository else { return }
        busy = true; assetsVerified = false; defer { busy = false }
        do {
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.identity else { throw MediaError.inaccessible }
            let result = try await draft.commit(to: repository)
            guard VideoDatabaseIdentity.read(request.copy.databaseURL) == request.identity else { throw MediaError.inaccessible }
            self.draft = try GalleryDraftSession(snapshot: result)
            opaqueRetained = hasOpaqueFixture(result)
            guard opaqueRetained else { throw GalleryError.invalidBlock }
            caption = currentCaption ?? ""; saved = false; error = nil
            do { try LocalGalleryDraftFixture.verify(in: request.copy); assetsVerified = true; saved = true }
            catch { blocked = true; self.error = "The gallery was saved, but attachment verification failed. Reopen the copy." }
        } catch {
            blocked = true; self.error = "The save could not be confirmed. The draft remains here; copy any needed text before closing."
        }
    }
}

struct LocalGalleryDraftView: View {
    let request: LocalGalleryDraftRequest
    @Environment(\.dismiss) private var dismiss
    @StateObject private var state: LocalGalleryDraftState
    @State private var discard = false
    init(request: LocalGalleryDraftRequest) { self.request = request; _state = StateObject(wrappedValue: LocalGalleryDraftState(request: request)) }
    var body: some View {
        NavigationStack {
            List {
                Text("Isolated fixture only. Attachment previews and import are not part of this editor.")
                if let draft = state.draft {
                    ForEach(Array(draft.document.items.enumerated()), id: \.element.id) { index, item in
                        HStack {
                            Button(item.name) { state.select(item.id) }.disabled(state.pending || state.blocked)
                                .accessibilityIdentifier("fixture-gallery-item.\(item.attachmentID)")
                            if index > 0 { Button("Move up") { state.move(index) }.disabled(state.pending || state.blocked).accessibilityIdentifier("fixture-gallery-move.\(item.attachmentID)") }
                        }
                    }
                    if state.currentCaption != nil {
                        TextField("Caption", text: $state.caption).disabled(state.busy || state.blocked).accessibilityIdentifier("fixture-gallery-caption")
                        Button("Apply caption") { state.apply() }.disabled(!state.pending || state.busy || state.blocked)
                    } else { Text("This caption cannot be edited safely.") }
                    Button("Undo") { state.history(false) }.disabled(state.pending || !draft.canUndo || state.busy || state.blocked)
                    Button("Redo") { state.history(true) }.disabled(state.pending || !draft.canRedo || state.busy || state.blocked)
                    Button("Save") { Task { await state.save() } }.disabled(state.pending || !draft.dirty || state.busy || state.blocked).accessibilityIdentifier("fixture-gallery-save")
                }
                if state.opaqueRetained { Text("Fixture unknown block retained").accessibilityIdentifier("fixture-gallery-opaque") }
                if state.assetsVerified { Text("Fixture attachment bytes verified").accessibilityIdentifier("fixture-gallery-assets") }
                if state.saved && !state.dirty { Text("Saved and fixture attachments verified").accessibilityIdentifier("fixture-gallery-saved") }
                if let error = state.error { Text(error).accessibilityIdentifier("fixture-gallery-error") }
                if state.busy { ProgressView() }
            }
            .navigationTitle("Edit fixture gallery")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { if state.dirty { discard = true } else { dismiss() } }.disabled(state.busy) } }
            .alert("Discard the gallery draft?", isPresented: $discard) { Button("Discard", role: .destructive) { dismiss() }; Button("Keep editing", role: .cancel) {} }
            .interactiveDismissDisabled(state.busy || state.dirty)
            .task { await state.load() }
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 420)
        #endif
    }
}
#endif
