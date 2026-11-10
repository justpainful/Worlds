import SwiftUI
import WorldsPersistence

// MARK: - 2. Spaces Destination (Projects, Planning, Goals, Calendar, Inbox, Print Queue & Opt-In Study Pack)

struct SpacesDestinationView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("worlds_pack_study") private var studyPackEnabled: Bool = false

    @Binding var selectedSection: SpacesSection
    let pages: [StoredPage]
    let openPage: (String) -> Void
    var showSectionPicker: Bool = true

    private var availableSections: [SpacesSection] {
        var items: [SpacesSection] = [.projects, .goals, .calendar, .printQueue]
        if studyPackEnabled {
            items.append(.study)
        }
        return items
    }

    var body: some View {
        VStack(spacing: 0) {
            if showSectionPicker {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(availableSections) { sec in
                            Button {
                                selectedSection = sec
                            } label: {
                                Label(sec.rawValue, systemImage: sec.systemImage)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(1)
                                    .fixedSize(horizontal: true, vertical: false)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(
                                        selectedSection == sec
                                            ? WorldsPalette.accent(for: colorScheme).opacity(0.18)
                                            : WorldsPalette.cardBackground(for: colorScheme),
                                        in: Capsule()
                                    )
                                    .overlay(
                                        Capsule().strokeBorder(
                                            selectedSection == sec ? WorldsPalette.accent(for: colorScheme).opacity(0.45) : WorldsPalette.subtleBorder(for: colorScheme),
                                            lineWidth: 0.5
                                        )
                                    )
                                    .foregroundStyle(selectedSection == sec ? WorldsPalette.accent(for: colorScheme) : .primary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("spaces-section-\(sec.rawValue)")
                        }
                    }
                    .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
                    .padding(.vertical, 10)
                }
                .background(WorldsPalette.groupedCanvas(for: colorScheme))
                Divider()
            }

            if selectedSection == .study && studyPackEnabled {
                WorldsStudyPackHubView()
            } else {
                WorldsPlanningHubView(initialTab: mappedPlanningTab(selectedSection), showSubTabs: !showSectionPicker)
            }
        }
        .background(WorldsPalette.groupedCanvas(for: colorScheme))
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

    private var activePages: [StoredPage] {
        pages.filter { !$0.archived && $0.kind != "template" }
    }

    var body: some View {
        VStack(spacing: 0) {
            if showCollectionPicker {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(LibraryCollection.allCases) { col in
                            Button {
                                selectedCollection = col
                            } label: {
                                Label(col.rawValue, systemImage: col.systemImage)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(1)
                                    .fixedSize(horizontal: true, vertical: false)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(
                                        selectedCollection == col
                                            ? WorldsPalette.accent(for: colorScheme).opacity(0.18)
                                            : WorldsPalette.cardBackground(for: colorScheme),
                                        in: Capsule()
                                    )
                                    .overlay(
                                        Capsule().strokeBorder(
                                            selectedCollection == col ? WorldsPalette.accent(for: colorScheme).opacity(0.45) : WorldsPalette.subtleBorder(for: colorScheme),
                                            lineWidth: 0.5
                                        )
                                    )
                                    .foregroundStyle(selectedCollection == col ? WorldsPalette.accent(for: colorScheme) : .primary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("library-filter-\(col.rawValue)")
                        }
                    }
                    .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
                    .padding(.vertical, 10)
                }
                .background(WorldsPalette.groupedCanvas(for: colorScheme))
                Divider()
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
                .background(WorldsPalette.groupedCanvas(for: colorScheme))
            case .studio:
                WorldsCreativeStudioView()
            case .templates:
                TemplatesView(onSelectTemplate: onSelectTemplate)
            case .trash:
                TrashView(
                    pages: pages,
                    onRestore: onRestorePage,
                    onDeletePermanently: onDeletePermanently,
                    onEmptyTrash: onEmptyTrash
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
                .background(WorldsPalette.groupedCanvas(for: colorScheme))
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
                        Label("Templates Gallery", systemImage: "square.grid.2x2")
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .worldsContentCard(cornerRadius: 10)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("library-open-templates")

                    Button {
                        selectedCollection = .trash
                    } label: {
                        Label("Trash (\(pages.filter(\.archived).count))", systemImage: "trash")
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .worldsContentCard(cornerRadius: 10)
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
        .background(WorldsPalette.groupedCanvas(for: colorScheme))
    }

    private func collectionShortcutCard(title: String, count: Int, icon: String, color: Color, collection: LibraryCollection) -> some View {
        Button {
            selectedCollection = collection
        } label: {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(color)
                    .frame(width: 32, height: 32)
                    .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))

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
            .padding(12)
            .worldsContentCard(cornerRadius: 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func filteredResourceList(matchingKinds kinds: Set<String>?) -> some View {
        let items = activePages.filter { page in
            guard let kinds else { return true }
            return kinds.contains(page.kind)
        }
        return VStack(alignment: .leading, spacing: 10) {
            Text(kinds == nil ? "All Workspace Documents" : "Matching Files")
                .font(.headline)
                .foregroundStyle(WorldsPalette.ink(for: colorScheme))

            if items.isEmpty {
                HStack {
                    Text("No files in this category yet.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let onOpenCreateSheet {
                        Button("Create New", action: onOpenCreateSheet)
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                    }
                }
                .padding(14)
                .worldsContentCard(cornerRadius: 11)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: horizontalSizeClass == .compact ? 260 : 300, maximum: 540), spacing: 12)], spacing: 12) {
                    ForEach(items) { item in
                        Button {
                            openPage(item.id)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: iconForKind(item.kind))
                                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                                    .frame(width: 30, height: 30)
                                    .background(WorldsPalette.accent(for: colorScheme).opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.title.isEmpty ? "Untitled" : item.title)
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
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .worldsContentCard(cornerRadius: 11)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
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
                        HStack(spacing: 8) {
                            ForEach(["Budget", "Mind Map", "OKR", "CS-301", "CAD", "Deck"], id: \.self) { chip in
                                Button {
                                    searchQuery = chip
                                } label: {
                                    Text(chip)
                                        .font(.caption.weight(.medium))
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 5)
                                        .background(WorldsPalette.accent(for: colorScheme).opacity(0.14), in: Capsule())
                                        .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                                }
                                .buttonStyle(.plain)
                            }
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
                                Text(page.title.isEmpty ? "Untitled" : page.title)
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
