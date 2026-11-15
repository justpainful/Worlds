import SwiftUI
import WorldsPersistence

/*
 * Packs on Apple (docs/PACKS.md, Design 4), as on Android: every pack by
 * family to turn on, then a pack's figures and alerts, its own screens
 * (Teacher attendance), its tables and boards (a board as one section per
 * stage) and its Claude requests. Items are opened and changed through the
 * host, which owns the workspace file.
 */

/// What the hub asks the host to do. Writing is nil when the workspace is read only.
struct PackActions {
    /// Creates an item of a stored kind with a title and first fields, and opens it to edit when asked.
    var create: (@MainActor (_ kind: String, _ title: String, _ fields: [String: PackValue], _ edit: Bool) async -> Void)?
    /// Changes some fields of an existing item and keeps the rest.
    var setFields: (@MainActor (_ pageID: String, _ fields: [String: PackValue]) async -> Bool)?
    /// Opens an item.
    var open: @MainActor (String) -> Void
    /// Starts a Claude conversation with this request.
    var ask: @MainActor (String) -> Void
}

extension PackRow {
    /// A page's fields under its kind's data key, or nil when the page is not of this kind.
    init?(page: StoredPage, kind: PackKind) {
        guard page.kind == kind.kind, !page.archived else { return nil }
        let root = (try? JSONSerialization.jsonObject(with: Data(page.metadataJSON.utf8))) as? [String: Any]
        self.init(id: page.id, title: page.title, kind: page.kind, updatedAt: page.updatedAt, data: root?[kind.dataKey] as? [String: Any] ?? [:])
    }
}

enum PackPrefs {
    static let key = "worlds_packs_enabled"
    static func enabled(_ stored: String) -> Set<String> { Set(stored.split(separator: ",").map(String.init)) }
    static func toggled(_ stored: String, _ id: String, _ on: Bool) -> String {
        var set = enabled(stored)
        if on { set.insert(id) } else { set.remove(id) }
        return set.sorted().joined(separator: ",")
    }
}

struct PacksHubView: View {
    let pages: [StoredPage]
    let actions: PackActions
    @AppStorage(PackPrefs.key) private var enabledPacks = ""
    @State private var openPack: String?

    private var catalog: PackCatalog? { PackCatalog.shipped }

    var body: some View {
        if let catalog, let id = openPack, let pack = catalog.packs.first(where: { $0.id == id }) {
            PackScreenView(pack: pack, pages: pages, actions: actions) { openPack = nil }
        } else if let catalog {
            List {
                ForEach(catalog.families ?? [], id: \.id) { family in
                    let packs = catalog.packs.filter { $0.family == family.id && $0.id != "study" && !$0.mainViews.isEmpty }
                    if !packs.isEmpty {
                        Section(family.label.text) {
                            ForEach(packs, id: \.id) { pack in packRow(pack) }
                        }
                    }
                }
            }
            .navigationTitle("Packs")
            .accessibilityIdentifier("packs-hub")
        } else {
            ContentUnavailableView("Packs are missing from this build", systemImage: "square.stack.3d.up.slash")
        }
    }

    private func packRow(_ pack: PackDefinition) -> some View {
        let on = PackPrefs.enabled(enabledPacks).contains(pack.id)
        return HStack(spacing: 12) {
            Button {
                if !on { enabledPacks = PackPrefs.toggled(enabledPacks, pack.id, true) }
                openPack = pack.id
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(pack.label.text).font(.body.weight(.medium))
                    Text(pack.blurb.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Toggle(pack.label.text, isOn: Binding(get: { on }, set: { enabledPacks = PackPrefs.toggled(enabledPacks, pack.id, $0) }))
                .labelsHidden()
        }
        .accessibilityIdentifier("pack.\(pack.id)")
    }
}

/// A tab or a board lane: an id and what it shows.
struct PackLane: Identifiable, Hashable {
    let id: String
    let label: String
}

/// One pack: figures and alerts, then a tab per screen and view.
struct PackScreenView: View {
    let pack: PackDefinition
    let pages: [StoredPage]
    let actions: PackActions
    let onBack: () -> Void
    @State private var tab: String?
    @State private var busy = false

    private var tabs: [PackLane] {
        (pack.screens ?? []).map { PackLane(id: $0.id, label: $0.label.text) } + pack.mainViews.map { PackLane(id: $0.id, label: $0.label.text) }
    }
    private var current: String? { tab ?? tabs.first?.id }
    private var screen: PackScreenDef? { pack.screens?.first { $0.id == current } }
    private var view: PackViewDef? { screen != nil ? nil : (pack.mainViews.first { $0.id == current } ?? pack.mainViews.first) }

    private func rows(_ kindID: String) -> [PackRow] {
        guard let kind = pack.kind(id: kindID) else { return [] }
        return pages.compactMap { PackRow(page: $0, kind: kind) }
    }
    private func titleOf(_ id: String) -> String? { pages.first { $0.id == id }?.title }

    var body: some View {
        let today = PackRules.today()
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                figures(today: today)
                if tabs.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(tabs) { t in
                                Button(t.label) { tab = t.id }
                                    .buttonStyle(.bordered)
                                    .tint(t.id == current ? .accentColor : .secondary)
                                    .accessibilityIdentifier("pack-tab.\(t.id)")
                            }
                        }
                    }
                }
                if screen?.component == "teacher.attendance" {
                    TeacherAttendanceView(pack: pack, pages: pages, actions: actions)
                } else if let view, let kind = pack.kind(id: view.kind) {
                    items(view: view, kind: kind)
                }
            }
            .padding(16)
        }
        .navigationTitle(pack.label.text)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Packs", systemImage: "chevron.backward", action: onBack)
            }
            if let prompts = pack.prompts, !prompts.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        ForEach(prompts, id: \.self) { p in Button(p.label.text) { actions.ask(p.prompt.text) } }
                    } label: { Label("Ask Claude", systemImage: "sparkles") }
                    .accessibilityIdentifier("pack-ask-claude")
                }
            }
            if let create = actions.create, let view, let kind = pack.kind(id: view.kind) {
                ToolbarItem(placement: .primaryAction) {
                    Button("Add", systemImage: "plus") {
                        Task { busy = true; await create(kind.kind, newTitle(kind), startFields(kind), true); busy = false }
                    }
                    .disabled(busy)
                    .accessibilityIdentifier("pack-add")
                }
            }
        }
        .accessibilityIdentifier("pack-screen.\(pack.id)")
    }

    /// A new item starts from its definition: stages at their first step, checkboxes off.
    private func startFields(_ kind: PackKind) -> [String: PackValue] {
        var out: [String: PackValue] = [:]
        for f in kind.fields {
            if f.type == "checkbox" { out[f.id] = .bool(false) }
            else if f.type == "stage", let first = f.options?.first { out[f.id] = .string(first.id) }
        }
        return out
    }

    private func newTitle(_ kind: PackKind) -> String {
        "\(kind.label.text) \(rows(kind.id).count + 1)"
    }

    @ViewBuilder private func figures(today: String) -> some View {
        let stats = pack.stats ?? []
        if !stats.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(stats.enumerated()), id: \.offset) { _, st in
                        let v = PackRules.stat(rows(st.kind), st, today: today)
                        let field = st.field.flatMap { f in pack.kind(id: st.kind)?.fields.first { $0.id == f } }
                        let text = v.map { field?.type == "money" ? "\(PackRules.text($0)) \(field?.currency ?? "SAR")" : PackRules.text($0) } ?? "0"
                        VStack(alignment: .leading, spacing: 2) {
                            Text(text).font(.title3.weight(.semibold)).lineLimit(1)
                            Text(st.label.text).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .frame(minWidth: 120, alignment: .leading)
                        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
        ForEach(Array((pack.alerts ?? []).enumerated()), id: \.offset) { _, a in
            let n = PackRules.filter(rows(a.kind), a.where, today: today).count
            if n > 0 {
                Label("\(a.label.text) (\(n))", systemImage: "exclamationmark.circle").foregroundStyle(.red).font(.callout)
            }
        }
    }

    @ViewBuilder private func items(view: PackViewDef, kind: PackKind) -> some View {
        let list = rows(kind.id)
        let shown = Array((view.columns?.compactMap { c in kind.fields.first { $0.id == c } } ?? kind.listFields).prefix(3))
        if list.isEmpty {
            ContentUnavailableView(kind.plural.text, systemImage: "square.stack", description: Text("Nothing here yet."))
        } else if view.type == "board", let group = view.groupBy.flatMap({ g in kind.fields.first { $0.id == g } }) {
            // A board on a narrow screen: one section per lane, in the stage's order.
            let lanes = (group.options ?? []).map { PackLane(id: $0.id, label: $0.label.text) } + (group.type == "choice" ? [PackLane(id: "", label: String(localized: "None"))] : [])
            ForEach(lanes) { lane in
                let inLane = list.filter { ($0.data[group.id] as? String ?? (group.type == "stage" ? group.options?.first?.id ?? "" : "")) == lane.id }
                if !inLane.isEmpty {
                    Text("\(lane.label) (\(inLane.count))").font(.headline)
                    rowsGroup(inLane, kind: kind, shown: shown.filter { $0.id != group.id })
                }
            }
        } else {
            rowsGroup(list.sorted { $0.title.localizedCompare($1.title) == .orderedAscending }, kind: kind, shown: shown)
        }
    }

    private func rowsGroup(_ rows: [PackRow], kind: PackKind, shown: [PackField]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                Button { actions.open(row.id) } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        let done = kind.doneField.flatMap { row.data[$0] as? Bool } ?? false
                        Text(row.title.isEmpty ? String(localized: "Untitled") : row.title)
                            .strikethrough(done)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        let meta = shown.compactMap { f in packFieldValue(f, in: row.data, titleOf: titleOf).map { "\(f.label.text): \($0)" } }
                        if !meta.isEmpty { Text(meta.joined(separator: "  ")).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("pack-row.\(row.id)")
                if index < rows.count - 1 { Divider().padding(.leading, 14) }
            }
        }
        .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// The Teacher pack's daily attendance: one tap per student, as on desktop and Android.
struct TeacherAttendanceView: View {
    let pack: PackDefinition
    let pages: [StoredPage]
    let actions: PackActions
    @State private var classID: String?
    @State private var day = Date()
    @State private var failed = false

    var body: some View {
        if let classKind = pack.kind(id: "class"), let studentKind = pack.kind(id: "student"), let attendance = pack.kind(id: "attendance") {
            let classes = rows(classKind).sorted { $0.title.localizedCompare($1.title) == .orderedAscending }
            let current = classID ?? classes.first?.id
            let iso = PackRules.isoDay.string(from: day)
            let students = studentsOf(current, kind: studentKind)
            let marks = marksOn(iso, kind: attendance)
            let statuses = attendance.fields.first { $0.id == "status" }?.options ?? []
            VStack(alignment: .leading, spacing: 12) {
                if classes.isEmpty {
                    ContentUnavailableView(classKind.plural.text, systemImage: "person.3", description: Text("Nothing here yet."))
                } else {
                    Picker(classKind.label.text, selection: Binding(get: { current ?? "" }, set: { classID = $0 })) {
                        ForEach(classes) { c in Text(c.title.isEmpty ? String(localized: "Untitled") : c.title).tag(c.id) }
                    }
                    DatePicker("Date", selection: $day, displayedComponents: .date)
                    if failed { Text("This item could not be saved.").foregroundStyle(.red) }
                    if students.isEmpty {
                        Text(studentKind.plural.text).foregroundStyle(.secondary)
                    }
                    ForEach(students) { student in
                        let mark = marks[student.id]
                        let status = mark?.data["status"] as? String ?? ""
                        VStack(alignment: .leading, spacing: 6) {
                            Text(student.title).foregroundStyle(status == "absent" ? .red : .primary)
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(statuses, id: \.id) { o in
                                        Button(o.label.text) { Task { await set(o.id, student: student, mark: mark, day: iso, kind: attendance.kind) } }
                                            .buttonStyle(.bordered)
                                            .tint(status == o.id ? .accentColor : .secondary)
                                            .disabled(actions.setFields == nil)
                                    }
                                }
                            }
                        }
                        .accessibilityIdentifier("attendance.\(student.id)")
                        Divider()
                    }
                }
            }
        }
    }

    private func rows(_ kind: PackKind) -> [PackRow] { pages.compactMap { PackRow(page: $0, kind: kind) } }

    private static func number(_ row: PackRow) -> Double { (row.data["number"] as? NSNumber)?.doubleValue ?? 999 }

    /// A class's students, by their number and then their name.
    private func studentsOf(_ classID: String?, kind: PackKind) -> [PackRow] {
        let inClass = rows(kind).filter { ($0.data["class"] as? String) == classID }
        return inClass.sorted { a, b in
            let na = Self.number(a), nb = Self.number(b)
            return na != nb ? na < nb : a.title.localizedCompare(b.title) == .orderedAscending
        }
    }

    /// Each student's mark on a day, the latest when there are two.
    private func marksOn(_ day: String, kind: PackKind) -> [String: PackRow] {
        var out: [String: PackRow] = [:]
        for row in rows(kind) where (row.data["date"] as? String) == day {
            guard let student = row.data["student"] as? String else { continue }
            if let seen = out[student], seen.updatedAt >= row.updatedAt { continue }
            out[student] = row
        }
        return out
    }

    @MainActor private func set(_ status: String, student: PackRow, mark: PackRow?, day: String, kind: String) async {
        failed = false
        if let mark, let setFields = actions.setFields {
            failed = !(await setFields(mark.id, ["status": .string(status)]))
        } else if let create = actions.create {
            await create(kind, "\(student.title), \(day)", ["student": .string(student.id), "date": .string(day), "status": .string(status), "parentTold": .bool(false)], false)
        }
    }
}
