#if WORLDS_EXPERIMENTAL_ACCOUNT && canImport(WorldsCollaborationHost)
import SwiftUI
import WorldsCollaboration
import WorldsCollaborationHost
import WorldsIdentityContinuity

// Shared pages on iPhone, iPad and Mac, read only for now.
//
// A person signed in to a team workspace picks the workspace, confirms the
// workspace's sync server once (it receives their sign-in, so it is never
// taken from a page or a setting a document can change), then opens a page.
// The page comes from the sync server through a memory-only session
// (CollaborationHost.makeReadOnlySession) and shows its blocks with the pack
// item's fields above them, like Android's SharedPackFields.kt. Nothing is
// edited or stored on the device.

/// Sync servers the person approved, per account and workspace, kept in
/// memory until Worlds closes. Approval is consent, not proof of identity.
@MainActor final class SharedSyncApprovals {
    static let shared = SharedSyncApprovals()
    struct Approval { let origin: URL; let trusted: TrustedSyncOrigin }
    private var approvals: [String: Approval] = [:]
    private func key(_ account: String, _ workspace: String) -> String { account + "\n" + workspace }
    func approval(account: String, workspace: String) -> Approval? { approvals[key(account, workspace)] }
    func approve(_ proposal: SyncEndpointProposal) throws {
        approvals[key(proposal.accountID, proposal.workspaceID)] = Approval(origin: proposal.origin, trusted: try proposal.approve())
    }
    func forget(account: String, workspace: String) { approvals[key(account, workspace)] = nil }
}

// MARK: - Workspaces

struct SharedWorkspacesView: View {
    let coordinator: IdentitySessionCoordinator
    @State private var snapshot: IdentityAccountSnapshot?
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        List {
            Section {
                Text("Open the pages your team shares with you. They are read only on this device for now.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            if loading && snapshot == nil {
                Section { ProgressView() }
            } else if failed {
                Section {
                    Text("Sign in to see your team workspaces.").foregroundStyle(.secondary)
                    Button { Task { await load() } } label: { Label("Try again", systemImage: "arrow.clockwise") }
                }
            } else if let snapshot {
                Section("Workspaces") {
                    if snapshot.workspaces.isEmpty { Text("No workspaces").foregroundStyle(.secondary) }
                    ForEach(snapshot.workspaces, id: \.id) { workspace in
                        NavigationLink {
                            SharedPagesListView(coordinator: coordinator, accountID: snapshot.profile.id, workspace: workspace)
                        } label: {
                            Label(workspace.name, systemImage: "person.2")
                        }
                        .accessibilityIdentifier("shared-workspace-\(workspace.id)")
                    }
                }
            }
        }
        .navigationTitle("Shared pages")
        .refreshable { await load() }
        .task { if snapshot == nil { await load() } }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 560)
        #endif
    }

    private func load() async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        do { snapshot = try await coordinator.accountSnapshot(); failed = false }
        catch { snapshot = nil; failed = true }
    }
}

// MARK: - Pages of one workspace

struct SharedPagesListView: View {
    let coordinator: IdentitySessionCoordinator
    let accountID: String
    let workspace: IdentityWorkspace
    @AppStorage("sharedPages.syncServer") private var savedServer = ""
    @State private var entry = ""
    @State private var approval: SharedSyncApprovals.Approval?
    @State private var proposal: SyncEndpointProposal?
    @State private var invalidServer = false
    @State private var pages: [IdentityWorkspacePage]?
    @State private var loading = false
    @State private var failed = false

    var body: some View {
        List {
            Section {
                if let approval {
                    LabeledContent("Sync server", value: approval.origin.host() ?? approval.origin.absoluteString)
                    Text("Trusted for this workspace until you close Worlds.").font(.caption).foregroundStyle(.secondary)
                    Button {
                        SharedSyncApprovals.shared.forget(account: accountID, workspace: workspace.id)
                        self.approval = nil
                    } label: { Label("Change server", systemImage: "server.rack") }
                } else {
                    TextField("https://sync.example", text: $entry)
                        .textContentType(.URL)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                        .environment(\.layoutDirection, .leftToRight)
                        .accessibilityIdentifier("shared-sync-server")
                    Text("Enter the HTTPS address of your team's sync server.").font(.caption).foregroundStyle(.secondary)
                    if invalidServer {
                        Label("Enter a valid HTTPS server address.", systemImage: "exclamationmark.triangle").foregroundStyle(.red)
                    }
                    Button { propose() } label: { Label("Use this server", systemImage: "checkmark.shield") }
                        .disabled(entry.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("shared-sync-server-use")
                }
            } header: { Text("Sync server") }

            Section {
                if loading && pages == nil {
                    ProgressView()
                } else if failed {
                    Text("Couldn't load the pages.").foregroundStyle(.secondary)
                    Button { Task { await load() } } label: { Label("Try again", systemImage: "arrow.clockwise") }
                } else if let pages {
                    if pages.isEmpty { Text("No pages are shared with you in this workspace.").foregroundStyle(.secondary) }
                    ForEach(pages) { page in
                        if let approval {
                            NavigationLink {
                                SharedPageView(coordinator: coordinator, accountID: accountID, workspaceID: workspace.id, pageID: page.id, title: page.title, level: page.level, approval: approval)
                            } label: { pageRow(page) }
                            .accessibilityIdentifier("shared-page-\(page.id)")
                        } else {
                            pageRow(page).foregroundStyle(.secondary)
                        }
                    }
                }
            } header: { Text("Pages") } footer: {
                if approval == nil, let pages, !pages.isEmpty { Text("Choose the sync server to open a page.") }
            }
        }
        .navigationTitle(workspace.name)
        .refreshable { await load() }
        .task {
            approval = SharedSyncApprovals.shared.approval(account: accountID, workspace: workspace.id)
            if entry.isEmpty { entry = savedServer }
            if pages == nil { await load() }
        }
        .confirmationDialog("Trust this sync server?", isPresented: Binding(get: { proposal != nil }, set: { if !$0 { proposal = nil } }), titleVisibility: .visible, presenting: proposal) { proposal in
            Button("Trust") { approve(proposal) }
            Button("Cancel", role: .cancel) { self.proposal = nil }
        } message: { proposal in
            Text("Worlds will send your sign-in to \(proposal.origin.host() ?? proposal.origin.absoluteString) to open pages in \(workspace.name). Continue only if your workspace owner gave you this address.")
        }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 560)
        #endif
    }

    private func pageRow(_ page: IdentityWorkspacePage) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                if let title = page.title {
                    Text(verbatim: title).lineLimit(2)
                } else {
                    Text("Page ID: \(page.id)").lineLimit(2).environment(\.layoutDirection, .leftToRight)
                }
                Text(accessLabel(page.level)).font(.caption).foregroundStyle(.secondary)
            }
        } icon: { Image(systemName: "doc.text") }
    }

    private func propose() {
        let text = entry.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: text), let made = try? SyncEndpointProposal(origin: url, accountID: accountID, workspaceID: workspace.id) else {
            invalidServer = true; return
        }
        invalidServer = false
        proposal = made
    }

    private func approve(_ proposal: SyncEndpointProposal) {
        do {
            try SharedSyncApprovals.shared.approve(proposal)
            approval = SharedSyncApprovals.shared.approval(account: accountID, workspace: workspace.id)
            savedServer = proposal.origin.absoluteString
        } catch { invalidServer = true }
        self.proposal = nil
    }

    private func load() async {
        guard !loading else { return }
        loading = true; defer { loading = false }
        do { pages = try await coordinator.workspacePages(workspaceID: workspace.id, expectedUserID: accountID); failed = false }
        catch { pages = nil; failed = true }
    }
}

func accessLabel(_ level: IdentityPageLevel) -> LocalizedStringKey {
    switch level {
    case .view: "Can view"
    case .comment: "Can comment"
    case .edit: "Can edit"
    case .full: "Full access"
    case .none: "No access"
    }
}

// MARK: - One page

struct SharedPageView: View {
    let coordinator: IdentitySessionCoordinator
    let accountID: String
    let workspaceID: String
    let pageID: String
    let title: String?
    /// The level the identity service listed; edit or full opens a session that can write.
    let level: IdentityPageLevel
    let approval: SharedSyncApprovals.Approval
    @StateObject private var model = SharedPageModel()
    @State private var editing = false
    @State private var confirmLeave = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                statusRow
                if let card = model.fields {
                    SharedPackFieldsCard(card: card, onEdit: model.canEdit ? { editing = true } : nil)
                }
                if model.phase == .reading && model.blocks.isEmpty {
                    Text("This page is empty.").foregroundStyle(.secondary)
                }
                ForEach(model.blocks) { block in SharedBlockRow(block: block) }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(.horizontal, 20).padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(title.map { Text(verbatim: $0) } ?? Text("Page ID: \(pageID)"))
        // A change the server has not acknowledged lives only in this page's
        // session: leaving would drop it, so ask first.
        .navigationBarBackButtonHidden(model.unsent > 0)
        .toolbar {
            if model.unsent > 0 {
                ToolbarItem(placement: .cancellationAction) {
                    Button { confirmLeave = true } label: { Label("Back", systemImage: "chevron.backward") }
                }
            }
        }
        .confirmationDialog("Leave without sending your change?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { dismiss() }
            Button("Stay", role: .cancel) {}
        } message: {
            Text("The server has not received it yet. It is sent when the page reconnects.")
        }
        .sheet(isPresented: $editing) {
            if let card = model.fields {
                SharedPackFieldsEditor(card: card) { request in await model.saveFields(request) }
            }
        }
        .task {
            await model.open(coordinator: coordinator, accountID: accountID, workspaceID: workspaceID, pageID: pageID, level: level, approval: approval)
        }
        .onDisappear { if !editing { model.close() } }
        #if os(macOS)
        .frame(minWidth: 520, minHeight: 560)
        #endif
    }

    @ViewBuilder private var statusRow: some View {
        HStack(spacing: 8) {
            Group {
                if model.canEdit {
                    Label("Can edit", systemImage: "pencil")
                } else {
                    Label("Read only", systemImage: "eye")
                }
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(.thinMaterial, in: Capsule())
            switch model.phase {
            case .opening:
                ProgressView().controlSize(.small)
                Text("Connecting").font(.caption).foregroundStyle(.secondary)
            case .reconnecting:
                ProgressView().controlSize(.small)
                Text("Reconnecting").font(.caption).foregroundStyle(.secondary)
            case .reading: EmptyView()
            case .revoked: Label("Your access to this page was removed.", systemImage: "lock").font(.caption).foregroundStyle(.red)
            case .failed: Label("The page could not be opened.", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.red)
            }
            if model.unsent > 0 {
                Label("Sending your change", systemImage: "arrow.up.circle").font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityIdentifier("shared-page-status")
    }
}

@MainActor final class SharedPageModel: ObservableObject {
    enum Phase: Equatable { case opening, reconnecting, reading, revoked, failed }
    enum SaveOutcome { case saved, waiting, failed }
    @Published private(set) var phase: Phase = .opening
    @Published private(set) var blocks: [SharedBlock] = []
    @Published private(set) var fields: SharedPackFieldsCard.Content?
    @Published private(set) var accessLevel: String?
    @Published private(set) var unsent = 0
    private var session: CollaborationSession?
    private var outbox: EphemeralSessionStore?
    private var runTask: Task<Void, Never>?
    private var watchTask: Task<Void, Never>?
    private var outboxTask: Task<Void, Never>?

    /// Editing needs a session that can write and the server's own word for this connection.
    var canEdit: Bool { outbox != nil && phase == .reading && (accessLevel == "edit" || accessLevel == "full") }

    func open(coordinator: IdentitySessionCoordinator, accountID: String, workspaceID: String, pageID: String,
              level: IdentityPageLevel, approval: SharedSyncApprovals.Approval) async {
        guard session == nil else { return }
        phase = .opening
        do {
            let session: CollaborationSession
            if level == .edit || level == .full {
                let live = try await CollaborationHost.makeLiveSession(pageID: pageID, workspaceID: workspaceID, expectedUserID: accountID,
                                                                       serverURL: approval.origin, trustedOrigin: approval.trusted, identity: coordinator)
                session = live.session
                outbox = live.outbox
            } else {
                session = try await CollaborationHost.makeReadOnlySession(pageID: pageID, workspaceID: workspaceID, expectedUserID: accountID,
                                                                          serverURL: approval.origin, trustedOrigin: approval.trusted, identity: coordinator)
            }
            self.session = session
            runTask = Task { [weak self] in
                do { try await session.run() }
                catch CollaborationError.accessRevoked { self?.phase = .revoked }
                catch { self?.phase = .failed }
            }
            watchTask = Task { [weak self] in
                let changes = await session.editorChanges()
                for await _ in changes { await self?.refresh() }
            }
            if let outbox {
                outboxTask = Task { [weak self] in
                    while !Task.isCancelled {
                        let count = await outbox.pendingCount()
                        if self?.unsent != count { self?.unsent = count }
                        try? await Task.sleep(for: .milliseconds(500))
                    }
                }
            }
        } catch CollaborationHostError.accessDenied {
            phase = .revoked
        } catch {
            phase = .failed
        }
    }

    private func refresh() async {
        guard let session, phase != .revoked, phase != .failed else { return }
        if let reading = try? await session.readOnlySnapshot() {
            blocks = SharedBlock.flatten(reading.blocks)
            fields = SharedPackFieldsCard.Content(reading.packFields)
            accessLevel = reading.accessLevel
            phase = .reading
            return
        }
        switch await session.connectionStatus() {
        case .accessRevoked: phase = .revoked
        case .failed: phase = .failed
        default: phase = blocks.isEmpty && fields == nil ? .opening : .reconnecting
        }
    }

    /// Writes the changed fields, then waits for the server to acknowledge them.
    func saveFields(_ request: Data) async -> SaveOutcome {
        guard let session, let outbox, canEdit else { return .failed }
        do { try await session.setPackFields(request: request) } catch { return .failed }
        for _ in 0..<60 {
            let count = await outbox.pendingCount()
            unsent = count
            if count == 0 { return .saved }
            try? await Task.sleep(for: .milliseconds(250))
        }
        return .waiting
    }

    func close() {
        runTask?.cancel(); watchTask?.cancel(); outboxTask?.cancel()
        if let session { Task { await session.stop() } }
        session = nil; outbox = nil; unsent = 0
    }
}

// MARK: - Pack item fields

/// The pack item's kind and fields, labelled from the shipped catalog. A page
/// that is not a pack item, or whose kind this build does not know, shows none.
struct SharedPackFieldsCard: View {
    struct Content: Equatable {
        let title: String
        let kind: PackKind
        let rows: [Row]
        /// The fields as the document holds them, for the editor.
        let values: Data
        struct Row: Equatable, Identifiable { let id: String; let label: String; let value: String }
        init?(_ json: Data) {
            guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
                  let kind = root["kind"] as? String, let data = root["fields"] as? [String: Any],
                  let found = PackCatalog.shipped?.kind(of: kind),
                  let values = try? JSONSerialization.data(withJSONObject: data) else { return nil }
            title = found.kind.label.text + " \u{00B7} " + found.pack.label.text
            self.kind = found.kind
            self.values = values
            // Links point at desktop items this device does not list, so they show nothing.
            rows = found.kind.fields.compactMap { field in
                packFieldValue(field, in: data, titleOf: { _ in nil }).map { Row(id: field.id, label: field.label.text, value: $0) }
            }
        }
    }
    let card: Content
    var onEdit: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(card.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.accentColor)
                Spacer()
                if let onEdit {
                    Button(action: onEdit) { Label("Edit", systemImage: "square.and.pencil") }
                        .font(.subheadline)
                        .accessibilityIdentifier("shared-pack-fields-edit")
                }
            }
            if card.rows.isEmpty {
                Text("No details yet").font(.callout).foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(card.rows.enumerated()), id: \.element.id) { index, row in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.label).font(.caption).foregroundStyle(.secondary)
                            Text(row.value).font(.body).textSelection(.enabled)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        if index < card.rows.count - 1 { Divider().padding(.leading, 14) }
                    }
                }
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .accessibilityIdentifier("shared-pack-fields")
    }
}

/// Edits a shared pack item's fields, built from its definition like the
/// local item editor. Links are left out: they point at desktop items this
/// device does not list. Only fields that changed are sent, so they merge
/// with other people's changes field by field.
struct SharedPackFieldsEditor: View {
    let card: SharedPackFieldsCard.Content
    let save: (Data) async -> SharedPageModel.SaveOutcome
    @Environment(\.dismiss) private var dismiss
    @State private var texts: [String: String] = [:]
    @State private var ticks: [String: Bool] = [:]
    @State private var originalJSON = Data()
    @State private var saving = false
    @State private var problem: LocalizedStringKey?
    @State private var loaded = false

    private var fields: [PackField] { card.kind.fields.filter { $0.type != "link" } }
    private var original: [String: Any] { (try? JSONSerialization.jsonObject(with: originalJSON) as? [String: Any]) ?? [:] }

    var body: some View {
        NavigationStack {
            Form {
                ForEach(fields, id: \.id) { field in row(field) }
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .navigationTitle(card.kind.label.text)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .confirmationAction) {
                    if saving {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Save") { Task { await submit() } }
                            .disabled(!valid)
                            .accessibilityIdentifier("shared-pack-fields-save")
                    }
                }
            }
        }
        .interactiveDismissDisabled(saving)
        #if os(macOS)
        .frame(minWidth: 480, idealWidth: 560, minHeight: 420, idealHeight: 620)
        #endif
        .task {
            guard !loaded else { return }
            loaded = true
            originalJSON = card.values
            let values = original
            for field in fields {
                if field.type == "checkbox" { ticks[field.id] = (values[field.id] as? Bool) ?? false }
                else { texts[field.id] = Self.text(values[field.id]) }
            }
        }
    }

    @ViewBuilder private func row(_ field: PackField) -> some View {
        switch field.type {
        case "checkbox":
            Toggle(field.label.text, isOn: Binding(get: { ticks[field.id] ?? false }, set: { ticks[field.id] = $0 }))
        case "choice", "stage":
            Picker(field.label.text, selection: Binding(get: { texts[field.id] ?? "" }, set: { texts[field.id] = $0 })) {
                if field.type == "choice" { Text("None").tag("") }
                ForEach(field.options ?? [], id: \.id) { o in Text(o.label.text).tag(o.id) }
            }
        case "longText":
            VStack(alignment: .leading) {
                Text(field.label.text).font(.caption).foregroundStyle(.secondary)
                TextEditor(text: Binding(get: { texts[field.id] ?? "" }, set: { texts[field.id] = $0 })).frame(minHeight: 80)
            }
        default:
            TextField(placeholder(field), text: Binding(get: { texts[field.id] ?? "" }, set: { texts[field.id] = $0 }))
                #if os(iOS)
                .keyboardType(field.type == "number" || field.type == "money" ? .decimalPad : .default)
                #endif
        }
    }

    private func placeholder(_ field: PackField) -> String {
        switch field.type {
        case "money": return "\(field.label.text) (\(field.currency ?? "SAR"))"
        case "date": return "\(field.label.text) (YYYY-MM-DD)"
        default: return field.label.text
        }
    }

    static func text(_ value: Any?) -> String {
        if let s = value as? String { return s }
        if let n = value as? NSNumber {
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return n.boolValue ? "true" : "false" }
            let d = n.doubleValue
            return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d)
        }
        return ""
    }

    /// A typed number, with Arabic digits and a decimal comma accepted.
    static func number(_ text: String) -> Double? {
        let western = String(text.trimmingCharacters(in: .whitespaces).map { ch -> Character in
            if let v = ch.wholeNumberValue, !ch.isASCII { return Character(String(v)) }
            return ch == "\u{066B}" || ch == "," ? "." : ch
        })
        return Double(western)
    }

    private var valid: Bool {
        fields.allSatisfy { f in
            let t = (texts[f.id] ?? "").trimmingCharacters(in: .whitespaces)
            switch f.type {
            case "number", "money": return t.isEmpty || Self.number(t) != nil
            case "date": return t.isEmpty || t.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
            default: return true
            }
        }
    }

    /// `{"set": {...}, "remove": [...]}` with only the fields that changed.
    private func request() -> Data? {
        let values = original
        var set: [String: Any] = [:]
        var remove: [String] = []
        for f in fields {
            if f.type == "checkbox" {
                let now = ticks[f.id] ?? false
                if now != ((values[f.id] as? Bool) ?? false) { set[f.id] = now }
                continue
            }
            let t = (texts[f.id] ?? "").trimmingCharacters(in: .whitespaces)
            if t == Self.text(values[f.id]).trimmingCharacters(in: .whitespaces) { continue }
            if t.isEmpty {
                if values[f.id] != nil { remove.append(f.id) }
                continue
            }
            if f.type == "number" || f.type == "money", let n = Self.number(t) {
                set[f.id] = n == n.rounded() && abs(n) < 1e15 ? NSNumber(value: Int64(n)) : NSNumber(value: n)
            } else {
                set[f.id] = t
            }
        }
        if set.isEmpty && remove.isEmpty { return nil }
        var body: [String: Any] = [:]
        if !set.isEmpty { body["set"] = set }
        if !remove.isEmpty { body["remove"] = remove }
        return try? JSONSerialization.data(withJSONObject: body)
    }

    private func submit() async {
        guard valid else { problem = "Check the numbers and dates."; return }
        guard let request = request() else { dismiss(); return }
        saving = true; problem = nil
        let outcome = await save(request)
        saving = false
        switch outcome {
        case .saved, .waiting: dismiss()
        case .failed: problem = "This change could not be saved. Check that the page is connected and you can edit it."
        }
    }
}

// MARK: - Blocks

/// One line of a shared page, flattened from the Tiptap JSON the sync core reads.
struct SharedBlock: Identifiable, Equatable {
    enum Style: Equatable { case heading(Int), paragraph, quote, code, rule, unsupported(String) }
    enum Marker: Equatable { case none, bullet, number(Int), task(Bool) }
    let id: Int
    let style: Style
    let marker: Marker
    let depth: Int
    let text: AttributedString

    static func flatten(_ json: Data) -> [SharedBlock] {
        guard let root = try? JSONSerialization.jsonObject(with: json) as? [String: Any],
              let content = root["content"] as? [[String: Any]] else { return [] }
        var out: [SharedBlock] = []
        for node in content { visit(node, depth: 0, marker: .none, quoted: false, into: &out) }
        return out
    }

    private static func visit(_ node: [String: Any], depth: Int, marker: Marker, quoted: Bool, into out: inout [SharedBlock]) {
        let type = node["type"] as? String ?? ""
        let attrs = node["attrs"] as? [String: Any] ?? [:]
        let children = node["content"] as? [[String: Any]] ?? []
        func add(_ style: Style, _ text: AttributedString, marker: Marker = marker) {
            out.append(SharedBlock(id: out.count, style: quoted && style == .paragraph ? .quote : style, marker: marker, depth: depth, text: text))
        }
        switch type {
        case "heading":
            add(.heading((attrs["level"] as? NSNumber)?.intValue ?? 1), inline(children))
        case "paragraph":
            add(.paragraph, inline(children))
        case "codeBlock":
            add(.code, AttributedString(plain(children)))
        case "horizontalRule":
            add(.rule, AttributedString())
        case "blockquote":
            for child in children { visit(child, depth: depth, marker: .none, quoted: true, into: &out) }
        case "bulletList", "orderedList", "taskList":
            let start = (attrs["start"] as? NSNumber)?.intValue ?? 1
            for (index, item) in children.enumerated() {
                let itemAttrs = item["attrs"] as? [String: Any] ?? [:]
                let mark: Marker = type == "bulletList" ? .bullet : type == "orderedList" ? .number(start + index) : .task((itemAttrs["checked"] as? Bool) ?? false)
                let parts = item["content"] as? [[String: Any]] ?? []
                for (position, part) in parts.enumerated() {
                    visit(part, depth: depth + 1, marker: position == 0 ? mark : .none, quoted: quoted, into: &out)
                }
                if parts.isEmpty { add(.paragraph, AttributedString(), marker: mark) }
            }
        default:
            let text = plain(children)
            if text.isEmpty { add(.unsupported(type), AttributedString()) }
            else { add(.paragraph, AttributedString(text)) }
        }
    }

    /// Text with bold, italic, strike and code marks.
    private static func inline(_ nodes: [[String: Any]]) -> AttributedString {
        var result = AttributedString()
        for node in nodes {
            switch node["type"] as? String {
            case "text":
                var part = AttributedString(node["text"] as? String ?? "")
                let marks = (node["marks"] as? [[String: Any]] ?? []).compactMap { $0["type"] as? String }
                var intent: InlinePresentationIntent = []
                if marks.contains("bold") { intent.insert(.stronglyEmphasized) }
                if marks.contains("italic") { intent.insert(.emphasized) }
                if marks.contains("strike") { intent.insert(.strikethrough) }
                if marks.contains("code") { intent.insert(.code) }
                if !intent.isEmpty { part.inlinePresentationIntent = intent }
                result += part
            case "hardBreak":
                result += AttributedString("\n")
            default:
                let attrs = node["attrs"] as? [String: Any] ?? [:]
                if let label = (attrs["label"] as? String) ?? (attrs["title"] as? String) { result += AttributedString(label) }
                else { result += AttributedString(plain(node["content"] as? [[String: Any]] ?? [])) }
            }
        }
        return result
    }

    private static func plain(_ nodes: [[String: Any]]) -> String {
        nodes.map { node in
            if let text = node["text"] as? String { return text }
            if node["type"] as? String == "hardBreak" { return "\n" }
            return plain(node["content"] as? [[String: Any]] ?? [])
        }.joined()
    }
}

struct SharedBlockRow: View {
    let block: SharedBlock

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            marker
            content.frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, CGFloat(max(0, block.depth - 1)) * 18)
    }

    @ViewBuilder private var marker: some View {
        switch block.marker {
        case .none: EmptyView()
        case .bullet: Image(systemName: "circle.fill").font(.system(size: 6)).foregroundStyle(.secondary)
        case .number(let n): Text(verbatim: "\(n).").monospacedDigit().foregroundStyle(.secondary)
        case .task(let done): Image(systemName: done ? "checkmark.square.fill" : "square").foregroundStyle(done ? Color.accentColor : .secondary)
        }
    }

    @ViewBuilder private var content: some View {
        switch block.style {
        case .heading(let level):
            Text(block.text).font(level <= 1 ? .title2.weight(.bold) : level == 2 ? .title3.weight(.semibold) : .headline)
                .padding(.top, 6).textSelection(.enabled)
        case .paragraph:
            Text(block.text).font(.body).textSelection(.enabled)
        case .quote:
            Text(block.text).font(.body).foregroundStyle(.secondary).textSelection(.enabled)
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Capsule().fill(.tertiary).frame(width: 3) }
        case .code:
            Text(block.text).font(.system(.callout, design: .monospaced)).textSelection(.enabled)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(.background.secondary, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .environment(\.layoutDirection, .leftToRight)
        case .rule:
            Divider().padding(.vertical, 6)
        case .unsupported:
            Label("This block is not shown on this device yet.", systemImage: "square.dashed").font(.caption).foregroundStyle(.secondary)
        }
    }
}
#endif
