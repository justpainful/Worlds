import SwiftUI
import WorldsPersistence
import WorldsSearch

// MARK: - 2. Spaces Destination (Projects, Planning, Goals, Calendar, Inbox, Print Queue & Opt-In Study Pack)

struct SpacesDestinationView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("worlds_pack_study") private var studyPackEnabled: Bool = false

    @Binding var selectedSection: SpacesSection
    let pages: [StoredPage]
    let openPage: (String) -> Void
    var showSectionPicker: Bool = true
    /// The sector packs (docs/PACKS.md), when the host can show them.
    var packs: (() -> AnyView)? = nil

    private var availableSections: [SpacesSection] {
        var items: [SpacesSection] = [.projects, .goals, .calendar, .printQueue]
        if studyPackEnabled {
            items.append(.study)
        }
        if packs != nil { items.append(.packs) }
        return items
    }

    var body: some View {
        VStack(spacing: 0) {
            if showSectionPicker {
                ScrollView(.horizontal, showsIndicators: false) {
                    WorldsGlassFilterBar(
                        selection: $selectedSection,
                        options: availableSections,
                        title: { $0.rawValue },
                        symbol: { $0.systemImage },
                        identifier: { "spaces-section-\($0.rawValue)" }
                    )
                    .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
                    .padding(.vertical, 10)
                }
            }

            if selectedSection == .study && studyPackEnabled {
                WorldsStudyPackHubView()
            } else if selectedSection == .packs, let packs {
                packs()
            } else {
                WorldsPlanningHubView(initialTab: mappedPlanningTab(selectedSection), showSubTabs: !showSectionPicker)
            }
        }
        .worldsDestinationCanvas()
        .navigationTitle("Spaces")
        .accessibilityIdentifier("spaces-destination-view")
    }

    private func mappedPlanningTab(_ section: SpacesSection) -> String {
        switch section {
        case .goals: return "Goals & OKRs"
        case .calendar: return "Calendar"
        case .printQueue: return "Print Queue (3)"
        default: return "Tasks"
        }
    }
}

// MARK: - 3. Library Destination (Pages, Docs, Spreadsheets, Drawings, Slides, 3D Studio, Templates, Trash)

struct LibraryDestinationView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    @Binding var selectedCollection: LibraryCollection
    let pages: [StoredPage]
    let openPage: (String) -> Void
    let onSelectTemplate: (WorkspaceTemplate) -> Void
    let onRestorePage: (String) -> Void
    let onDeletePermanently: (String) -> Void
    let onEmptyTrash: () -> Void
    var onOpenCreateSheet: (() -> Void)? = nil
    var showCollectionPicker: Bool = true
    /// The desktop's Trash when the person's own workspace is open.
    var storeTrash: [StoredTrashedPage]? = nil
    var permanentDeletionAvailable: Bool = true

    private var trashCount: Int { storeTrash?.count ?? pages.filter(\.archived).count }

    private var activePages: [StoredPage] {
        pages.filter { !$0.archived && $0.kind != "template" }
    }

    var body: some View {
        VStack(spacing: 0) {
            if showCollectionPicker {
                ScrollView(.horizontal, showsIndicators: false) {
                    WorldsGlassFilterBar(
                        selection: $selectedCollection,
                        options: LibraryCollection.allCases,
                        title: { $0.rawValue },
                        symbol: { $0.systemImage },
                        identifier: { "library-filter-\($0.rawValue)" }
                    )
                    .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
                    .padding(.vertical, 10)
                }
            }

            switch selectedCollection {
            case .spreadsheets:
                WorldsSpreadsheetStudioView(metadataJSON: "{}")
            case .mindMaps:
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        VisualMindMapCanvasPreview { _ in
                            selectedCollection = .templates
                        }
                        filteredResourceList(matchingKinds: ["drawing"])
                    }
                    .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
                    .padding(.vertical, 20)
                    .frame(maxWidth: 1120, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .worldsDestinationCanvas()
            case .studio:
                WorldsCreativeStudioView()
            case .templates:
                TemplatesView(onSelectTemplate: onSelectTemplate)
            case .trash:
                TrashView(
                    pages: pages,
                    onRestore: onRestorePage,
                    onDeletePermanently: onDeletePermanently,
                    onEmptyTrash: onEmptyTrash,
                    storeTrash: storeTrash,
                    permanentDeletionAvailable: permanentDeletionAvailable
                )
            case .pages:
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        filteredResourceList(matchingKinds: ["page", "document"])
                    }
                    .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
                    .padding(.vertical, 20)
                    .frame(maxWidth: 1120, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .worldsDestinationCanvas()
            case .all:
                allResourcesBrowser
            }
        }
        .navigationTitle(selectedCollection == .all ? "Library" : selectedCollection.rawValue)
        .accessibilityIdentifier("library-destination-view")
    }

    private var allResourcesBrowser: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                // Quick Format Collections
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 185, maximum: 280), spacing: 12)], spacing: 12) {
                    collectionShortcutCard(title: "Pages & Docs", count: activePages.filter { $0.kind == "page" || $0.kind == "document" }.count, icon: "doc.richtext", color: .blue, collection: .pages)
                    collectionShortcutCard(title: "Spreadsheets", count: activePages.filter { $0.kind == "spreadsheet" }.count, icon: "tablecells.fill", color: .green, collection: .spreadsheets)
                    collectionShortcutCard(title: "Mind Maps & Canvas", count: activePages.filter { $0.kind == "drawing" }.count, icon: "point.3.connected.trianglepath.dotted", color: .purple, collection: .mindMaps)
                    collectionShortcutCard(title: "Slides & 3D CAD", count: activePages.filter { $0.kind == "presentation" || $0.kind == "file" }.count, icon: "cube.transparent.fill", color: .orange, collection: .studio)
                }

                filteredResourceList(matchingKinds: nil)

                // Contextual Utilities Row (Templates & Trash)
                HStack(spacing: 12) {
                    Button {
                        selectedCollection = .templates
                    } label: {
                        HStack(spacing: 10) {
                            WorldsIconTile("square.grid.2x2.fill", colors: [.indigo, .purple], size: 26)
                            Text("Templates Gallery")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .worldsContentCard(cornerRadius: 16)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("library-open-templates")

                    Button {
                        selectedCollection = .trash
                    } label: {
                        HStack(spacing: 10) {
                            WorldsIconTile("trash.fill", color: .gray, size: 26)
                            Text("Trash (\(trashCount))")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .worldsContentCard(cornerRadius: 16)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("library-open-trash")
                }
            }
            .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
            .padding(.vertical, 20)
            .frame(maxWidth: 1120, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .worldsDestinationCanvas()
    }

    private func collectionShortcutCard(title: String, count: Int, icon: String, color: Color, collection: LibraryCollection) -> some View {
        Button {
            selectedCollection = collection
        } label: {
            HStack(spacing: 12) {
                WorldsIconTile(icon, color: color, size: 32)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        .lineLimit(1)
                    Text("\(count) items")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(14)
            .worldsContentCard(cornerRadius: 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(HomeCardButtonStyle())
        .accessibilityIdentifier("library-card-\(collection.rawValue)")
    }

    private func filteredResourceList(matchingKinds kinds: Set<String>?) -> some View {
        let items = activePages.filter { page in
            guard let kinds else { return true }
            return kinds.contains(page.kind)
        }
        return VStack(alignment: .leading, spacing: 10) {
            Text(kinds == nil ? "All Workspace Documents" : "Matching Files")
                .font(.title3.weight(.semibold))
                .foregroundStyle(WorldsPalette.ink(for: colorScheme))

            if items.isEmpty {
                HStack {
                    Text("No files in this category yet.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let onOpenCreateSheet {
                        Button("Create New", action: onOpenCreateSheet)
                            .worldsGlassButton()
                            .controlSize(.small)
                    }
                }
                .padding(16)
                .worldsContentCard(cornerRadius: 16)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: horizontalSizeClass == .compact ? 260 : 300, maximum: 540), spacing: 12)], spacing: 12) {
                    ForEach(items) { item in
                        Button {
                            openPage(item.id)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: iconForKind(item.kind))
                                    .font(.callout.weight(.semibold))
                                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                                    .frame(width: 30, height: 30)
                                    .background(WorldsPalette.accent(for: colorScheme).opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title.isEmpty ? String(localized: "Untitled") : item.title)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                                        .lineLimit(1)
                                    Text(item.preview.isEmpty ? item.kind.capitalized : item.preview)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .worldsContentCard(cornerRadius: 16)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(HomeCardButtonStyle())
                        .accessibilityIdentifier("library-item-\(item.id)")
                    }
                }
            }
        }
    }

    private func iconForKind(_ kind: String) -> String {
        switch kind {
        case "spreadsheet": return "tablecells.fill"
        case "drawing": return "point.3.connected.trianglepath.dotted"
        case "presentation": return "rectangle.inset.filled.and.person.filled"
        case "file": return "cube.transparent.fill"
        case "project": return "folder.fill"
        case "document": return "doc.richtext"
        case "html": return "chevron.left.forwardslash.chevron.right"
        default: return "doc.text"
        }
    }
}

// MARK: - 5. Dedicated Unified Search Destination

struct SearchDestinationView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Binding var searchQuery: String
    @Binding var searchScope: WorldsSearchScope
    let pages: [StoredPage]
    let searchHits: [WorldsSearchHit]
    let openPage: (String) -> Void

    private var filteredLocalPages: [StoredPage] {
        let q = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty {
            return Array(pages.filter { !$0.archived }.prefix(6))
        }
        return pages.filter {
            !$0.archived &&
            ($0.title.lowercased().contains(q) || $0.preview.lowercased().contains(q) || $0.kind.lowercased().contains(q))
        }
    }

    var body: some View {
        List {
            if searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Section("Quick Filters") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        WorldsGlassChromeGroup(spacing: 8) {
                            HStack(spacing: 8) {
                                ForEach(["Budget", "Mind Map", "OKR", "CS-301", "CAD", "Deck"], id: \.self) { chip in
                                    Button {
                                        withAnimation(WorldsMotion.selection) { searchQuery = chip }
                                    } label: {
                                        Label(chip, systemImage: "magnifyingglass")
                                            .font(.callout)
                                            .lineLimit(1)
                                            .fixedSize()
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 6)
                                            .worldsGlassCapsule()
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }

            Section(searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Recent & Suggested" : "Matches (\(filteredLocalPages.count))") {
                if filteredLocalPages.isEmpty {
                    ContentUnavailableView.search(text: searchQuery)
                        .accessibilityIdentifier("search-empty")
                } else {
                    ForEach(filteredLocalPages) { page in
                        Button {
                            openPage(page.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(page.title.isEmpty ? String(localized: "Untitled") : page.title)
                                    .font(.body.weight(.medium))
                                if !page.preview.isEmpty {
                                    Text(page.preview)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                        }
                        .accessibilityIdentifier("search-result.\(page.id)")
                    }
                }
            }
        }
        .searchable(text: $searchQuery, prompt: "Search pages, sheets, mind maps, OKRs…")
        .navigationTitle("Search")
        .accessibilityIdentifier("search-destination-view")
    }
}

// MARK: - Shared destination chrome

/// Labelled choices on one glass track with a sliding lens (section and filter pickers).
/// The lens has no edge; the track is the only piece of glass.
struct WorldsGlassFilterBar<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [Value]
    let title: (Value) -> String
    let symbol: (Value) -> String?
    let identifier: (Value) -> String
    @Namespace private var lens
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.self) { option in
                let isSelected = option == selection
                Button {
                    withAnimation(WorldsMotion.spring) { selection = option }
                } label: {
                    HStack(spacing: 6) {
                        if let name = symbol(option) {
                            Image(systemName: name)
                        }
                        Text(LocalizedStringKey(title(option)))
                    }
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .contentShape(Capsule())
                    .background {
                        if isSelected {
                            Capsule()
                                .fill(WorldsPalette.lens(for: colorScheme))
                                .matchedGeometryEffect(id: "lens", in: lens)
                        }
                    }
                }
                .buttonStyle(.plain)
                .foregroundStyle(isSelected ? Color.primary : Color.secondary)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
                .accessibilityIdentifier(identifier(option))
            }
        }
        .padding(3)
        .worldsGlassCapsule(interactive: false)
    }
}

extension View {
    /// The canvas behind a destination: on macOS the shell's content panel shows through,
    /// on iOS a quiet grouped colour keeps cards readable.
    @ViewBuilder
    func worldsDestinationCanvas() -> some View {
        #if os(iOS)
        modifier(WorldsDestinationCanvasModifier())
        #else
        self
        #endif
    }
}

private struct WorldsDestinationCanvasModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content.background(WorldsPalette.groupedCanvas(for: colorScheme))
    }
}
