#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
import SwiftUI
import WorldsLocalImport
import WorldsWorkspaceAccess
import WorldsModels
import WorldsNativeWrites
import WorldsResourceRepositories
import WorldsPersistence

/// Edits a pack item's fields (docs/PACKS.md, Design 4) from the person's
/// workspace or an independent local copy, saving only its `metadata.item`
/// with the same baseline check as a spreadsheet. Fields follow the shipped
/// definition: text, numbers, money, dates as YYYY-MM-DD, choices and ticks.
@MainActor private final class LocalPackItemState: ObservableObject {
    enum Problem { case open, conflict, save, invalid }
    @Published var kind: PackKind?
    @Published var texts: [String: String] = [:]
    @Published var ticks: [String: Bool] = [:]
    @Published var loading = true
    @Published var saving = false
    @Published var problem: Problem?
    private var baseline: PackItemRecord?
    private var repository: NativeResourceRepository?
    let copy: WorkspaceWriteTarget
    private let pageID: String

    init(copy: WorkspaceWriteTarget, pageID: String) { self.copy = copy; self.pageID = pageID }

    private var item: [String: JSONValue] {
        if case .object(let root)? = baseline?.metadata, case .object(let item)? = root["item"] { return item }
        return [:]
    }

    func load() async {
        loading = true; problem = nil
        defer { loading = false }
        do {
            let repository = NativeResourceRepository(store: try NativePersonalStore(url: copy.databaseURL))
            let record = try await repository.readPackItem(id: pageID)
            self.repository = repository
            baseline = record
            kind = PackCatalog.shipped?.kind(of: record.kind)?.kind
            for field in kind?.fields ?? [] {
                if field.type == "checkbox" {
                    if case .bool(let b)? = item[field.id] { ticks[field.id] = b } else { ticks[field.id] = false }
                } else {
                    texts[field.id] = Self.text(item[field.id])
                }
            }
        } catch { problem = .open }
    }

    static func text(_ value: JSONValue?) -> String {
        switch value {
        case .string(let s)?: return s
        case .integer(let i)?: return String(i)
        case .number(let d)?: return d == d.rounded() && abs(d) < 1e15 ? String(Int64(d)) : String(d)
        case .bool(let b)?: return b ? "true" : "false"
        default: return ""
        }
    }

    /// A typed number, with Arabic digits and a decimal comma accepted.
    static func number(_ text: String) -> JSONValue? {
        let western = String(text.trimmingCharacters(in: .whitespaces).map { ch -> Character in
            if let v = ch.wholeNumberValue, !ch.isASCII { return Character(String(v)) }
            return ch == "\u{066B}" || ch == "," ? "." : ch
        })
        guard let d = Double(western) else { return nil }
        return d == d.rounded() && abs(d) < 1e15 ? .integer(Int64(d)) : .number(d)
    }

    var valid: Bool {
        guard let kind else { return false }
        return kind.fields.allSatisfy { f in
            let t = (texts[f.id] ?? "").trimmingCharacters(in: .whitespaces)
            switch f.type {
            case "number", "money": return t.isEmpty || Self.number(t) != nil
            case "date": return t.isEmpty || t.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
            default: return true
            }
        }
    }

    func save(onSaved: @escaping @MainActor () -> Void) async {
        guard !saving, let kind, let repository, let baseline, case .object(var root) = baseline.metadata else { return }
        guard valid else { problem = .invalid; return }
        var next = item
        for f in kind.fields {
            switch f.type {
            case "checkbox": next[f.id] = .bool(ticks[f.id] ?? false)
            default:
                let t = (texts[f.id] ?? "").trimmingCharacters(in: .whitespaces)
                if t.isEmpty { next.removeValue(forKey: f.id); continue }
                next[f.id] = (f.type == "number" || f.type == "money") ? Self.number(t) ?? .string(t) : .string(t)
            }
        }
        root["item"] = .object(next)
        saving = true; problem = nil
        defer { saving = false }
        do {
            self.baseline = try await repository.savePackItem(id: pageID, baseline: baseline, metadata: .object(root))
            onSaved()
        } catch NativeWriteError.conflict {
            problem = .conflict
        } catch {
            problem = .save
        }
    }
}

struct LocalPackItemEditor: View {
    @StateObject private var state: LocalPackItemState
    @Environment(\.dismiss) private var dismiss
    private let title: String
    private let pages: [StoredPage]
    private let pageID: String
    private let onSaved: @MainActor () -> Void
    @State private var messaging: PackMessageDef?

    init(copy: WorkspaceWriteTarget, pageID: String, title: String, pages: [StoredPage] = [], onSaved: @escaping @MainActor () -> Void) {
        _state = StateObject(wrappedValue: LocalPackItemState(copy: copy, pageID: pageID))
        self.title = title
        self.pages = pages
        self.pageID = pageID
        self.onSaved = onSaved
    }

    private func row(_ id: String) -> (pack: PackDefinition, kind: PackKind, row: PackRow)? {
        guard let page = pages.first(where: { $0.id == id }), let found = PackCatalog.shipped?.kind(of: page.kind),
              let row = PackRow(page: page, kind: found.kind) else { return nil }
        return (found.pack, found.kind, row)
    }

    /// Messages to someone outside Worlds this item calls for now (a note to a parent).
    private var offeredMessages: [PackMessageDef] {
        guard let current = row(pageID) else { return [] }
        return (current.kind.messages ?? []).filter { PackMessages.offered($0, data: current.row.data) }
    }

    private func draft(_ m: PackMessageDef) -> MessageDraft? {
        guard let current = row(pageID) else { return nil }
        return PackMessages.draft(m, pack: current.pack, kind: current.kind, item: current.row) { id in row(id)?.row }
    }

    /// Items a link field can point to: the other items of the kind it names, in the same pack.
    private func linkTargets(_ field: PackField) -> [StoredPage] {
        guard let to = field.to, let catalog = PackCatalog.shipped,
              let pack = catalog.packs.first(where: { $0.kinds.contains(where: { $0.fields.contains(field) }) }),
              let target = pack.kinds.first(where: { $0.id == to }) else { return [] }
        return pages.filter { $0.kind == target.kind && !$0.archived }.sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let kind = state.kind {
                    Form {
                        ForEach(kind.fields, id: \.id) { field in
                            fieldRow(field)
                        }
                        if !offeredMessages.isEmpty {
                            Section {
                                ForEach(offeredMessages) { m in
                                    Button(m.label.text, systemImage: "paperplane") { messaging = m }
                                }
                            }
                        }
                        if let problem = state.problem {
                            Text(message(problem)).foregroundStyle(.red)
                        }
                    }
                } else if state.loading {
                    ProgressView()
                } else {
                    Text("This item belongs to a pack this version of Worlds does not have.").foregroundStyle(.secondary).padding()
                }
            }
            .navigationTitle(title.isEmpty ? String(localized: "Untitled") : title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await state.save { onSaved(); dismiss() } } }
                        .disabled(state.saving || state.kind == nil || !state.valid)
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 480, idealWidth: 560, minHeight: 420, idealHeight: 620)
        #endif
        .task { await state.load() }
        .sheet(item: $messaging) { m in
            PackMessageSheet(message: m, draft: draft(m), subject: title) { done in
                // Record it on the item ("Parent told"), saved like any other change.
                for (key, value) in done {
                    switch value {
                    case .bool(let b): state.ticks[key] = b
                    case .string(let s): state.texts[key] = s
                    case .number(let d): state.texts[key] = PackRules.text(d)
                    case .null: state.texts[key] = ""
                    }
                }
                Task { await state.save { onSaved() } }
            }
        }
    }

    @ViewBuilder private func fieldRow(_ field: PackField) -> some View {
        switch field.type {
        case "checkbox":
            Toggle(field.label.text, isOn: Binding(get: { state.ticks[field.id] ?? false }, set: { state.ticks[field.id] = $0 }))
        case "choice", "stage":
            Picker(field.label.text, selection: Binding(get: { state.texts[field.id] ?? "" }, set: { state.texts[field.id] = $0 })) {
                if field.type == "choice" { Text("None").tag("") }
                ForEach(field.options ?? [], id: \.id) { o in Text(o.label.text).tag(o.id) }
            }
        case "link":
            Picker(field.label.text, selection: Binding(get: { state.texts[field.id] ?? "" }, set: { state.texts[field.id] = $0 })) {
                Text("None").tag("")
                ForEach(linkTargets(field), id: \.id) { page in Text(page.title.isEmpty ? String(localized: "Untitled") : page.title).tag(page.id) }
            }
        case "longText":
            VStack(alignment: .leading) {
                Text(field.label.text).font(.caption).foregroundStyle(.secondary)
                TextEditor(text: Binding(get: { state.texts[field.id] ?? "" }, set: { state.texts[field.id] = $0 })).frame(minHeight: 80)
            }
        default:
            TextField(placeholder(field), text: Binding(get: { state.texts[field.id] ?? "" }, set: { state.texts[field.id] = $0 }))
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

    private func message(_ problem: LocalPackItemState.Problem) -> String {
        switch problem {
        case .open: return String(localized: "This item could not be opened.")
        case .conflict: return String(localized: "This item changed elsewhere. Close and open it again.")
        case .save: return String(localized: "This item could not be saved.")
        case .invalid: return String(localized: "Check the numbers and dates.")
        }
    }
}
#endif
