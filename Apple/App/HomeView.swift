import SwiftUI
import WorldsPersistence

/// Home, as in the Windows app: a large time-of-day greeting with the search capsule,
/// the grid or list choice and the New button on glass, then calm content cards.
struct HomeView: View {
    enum Layout: String, Hashable {
        case grid
        case list
    }

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    let pages: [StoredPage]
    let openPage: (String) -> Void
    var onOpenSpaces: (() -> Void)? = nil
    var onOpenLibrary: ((LibraryCollection) -> Void)? = nil
    var onOpenCreateSheet: (() -> Void)? = nil
    var onCreateFormat: ((String) -> Void)? = nil
    var onOpenInspectorForPage: ((String) -> Void)? = nil
    var onOpenAutomations: (() -> Void)? = nil
    var onRequestLocalCopy: (() -> Void)? = nil

    @State private var query = ""
    @AppStorage("worlds.home.layout") private var layoutRaw = Layout.grid.rawValue

    private var layout: Binding<Layout> {
        Binding(
            get: { Layout(rawValue: layoutRaw) ?? .grid },
            set: { layoutRaw = $0.rawValue }
        )
    }

    private var isCompact: Bool { horizontalSizeClass == .compact }

    private var activePages: [StoredPage] {
        pages.filter { !$0.archived && $0.kind != "template" }
    }

    private var sortedRecentPages: [StoredPage] {
        let sorted = activePages.sorted { $0.updatedAt > $1.updatedAt }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return sorted }
        return sorted.filter {
            $0.title.localizedCaseInsensitiveContains(trimmed) || $0.preview.localizedCaseInsensitiveContains(trimmed)
        }
    }

    private var pinnedPages: [StoredPage] {
        sortedRecentPages.filter { HomePageMetadata.isPinned($0) }
    }

    private var continueWorkingPages: [StoredPage] {
        Array(sortedRecentPages.prefix(2))
    }

    private var frequentListPages: [StoredPage] {
        Array(sortedRecentPages.dropFirst(2))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                header
                if !pinnedPages.isEmpty {
                    pinnedSection
                }
                continueWorkingSection
                recentResourcesSection
                compactCreationSection
                activitySummaryFooter
            }
            .padding(.horizontal, isCompact ? 16 : 36)
            .padding(.top, isCompact ? 8 : 28)
            .padding(.bottom, isCompact ? 36 : 28)
            .frame(maxWidth: 1180, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        #if os(iOS)
        .background(WorldsPalette.groupedCanvas(for: colorScheme))
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationTitle("Home")
        .accessibilityIdentifier("home-view")
    }

    // MARK: - Header

    private var greeting: some View {
        Text(WorldsGreeting.text())
            .font(isCompact ? .system(.largeTitle, design: .rounded, weight: .bold) : .system(size: 40, weight: .bold, design: .rounded))
            .foregroundStyle(WorldsPalette.ink(for: colorScheme))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private var header: some View {
        if isCompact || dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 14) {
                greeting
                headerControls(searchShortcut: nil, newShowsLabel: false)
            }
        } else {
            HStack(alignment: .center, spacing: 16) {
                greeting
                Spacer(minLength: 16)
                headerControls(searchShortcut: searchShortcut, newShowsLabel: true)
                    .frame(maxWidth: 560)
            }
        }
    }

    private var searchShortcut: String? {
        #if os(macOS)
        return "\u{2318}K"
        #else
        return nil
        #endif
    }

    private func headerControls(searchShortcut: String?, newShowsLabel: Bool) -> some View {
        WorldsGlassChromeGroup(spacing: 10) {
            HStack(spacing: 10) {
                WorldsGlassSearchField(text: $query, prompt: String(localized: "Search"), shortcut: searchShortcut)
                    .frame(minWidth: 120, maxWidth: isCompact ? .infinity : 320)
                    .accessibilityIdentifier("home-search-field")

                WorldsGlassChoice(
                    selection: layout,
                    options: [
                        .init(.grid, symbol: "square.grid.2x2", label: String(localized: "Grid")),
                        .init(.list, symbol: "list.bullet", label: String(localized: "List"))
                    ]
                )
                .fixedSize()
                .accessibilityIdentifier("home-layout-choice")

                // On iPhone the glass capsule at the top already has New; one is enough.
                if !isCompact {
                    newButton(showsLabel: newShowsLabel)
                }
            }
        }
    }

    private func newButton(showsLabel: Bool) -> some View {
        Button {
            if let onOpenCreateSheet {
                onOpenCreateSheet()
            } else {
                onCreateFormat?("page")
            }
        } label: {
            if showsLabel {
                Label("New", systemImage: "plus")
                    .font(.callout.weight(.semibold))
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
            } else {
                Image(systemName: "plus")
                    .font(.callout.weight(.semibold))
                    .padding(.vertical, 2)
                    .accessibilityLabel(Text("New"))
            }
        }
        .worldsGlassButton(prominent: true)
        .fixedSize()
        .accessibilityIdentifier("home-new-button")
    }

    // MARK: - Sections

    private func sectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.title3.weight(.semibold))
            .foregroundStyle(WorldsPalette.ink(for: colorScheme).opacity(0.86))
            .accessibilityAddTraits(.isHeader)
    }

    private var gridColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: 12)]
            : [GridItem(.adaptive(minimum: 220), spacing: 16)]
    }

    @ViewBuilder
    private func pageCollection(_ list: [StoredPage], idPrefix: String) -> some View {
        if layout.wrappedValue == .grid {
            LazyVGrid(columns: gridColumns, alignment: .leading, spacing: 16) {
                ForEach(list) { page in
                    pageCard(page, idPrefix: idPrefix)
                }
            }
            .transition(.opacity)
        } else {
            VStack(spacing: 0) {
                ForEach(list) { page in
                    pageRow(page, idPrefix: idPrefix)
                    if page.id != list.last?.id {
                        Divider().padding(.leading, 56)
                    }
                }
            }
            .padding(.vertical, 4)
            .worldsContentCard(cornerRadius: 16)
            .transition(.opacity)
        }
    }

    private var pinnedSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader("Pinned")
            pageCollection(pinnedPages, idPrefix: "home-pinned")
        }
        .animation(WorldsMotion.selection, value: layoutRaw)
    }

    // MARK: - 1. Continue Working

    private var continueWorkingSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                sectionHeader("Continue Working")
                Spacer()
                if let onOpenAutomations {
                    Button(action: onOpenAutomations) {
                        Label("Automations", systemImage: "clock.arrow.circlepath")
                            .font(.callout)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("home-open-automations")
                }
            }

            if continueWorkingPages.isEmpty {
                emptyWorkspacePrompt
            } else {
                pageCollection(continueWorkingPages, idPrefix: "home-continue")
            }
        }
        .animation(WorldsMotion.selection, value: layoutRaw)
    }

    // MARK: - 2. Recent

    private var recentResourcesSection: some View {
        let displayList = frequentListPages
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                sectionHeader("Recent")
                Spacer()
                if let onOpenLibrary {
                    Button {
                        onOpenLibrary(.all)
                    } label: {
                        Text("See All in Library")
                            .font(.callout)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }

            if displayList.isEmpty {
                Text(query.isEmpty ? LocalizedStringKey("No recent resources available yet.") : LocalizedStringKey("No results"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .worldsContentCard(cornerRadius: 16)
            } else {
                pageCollection(displayList, idPrefix: "home-recent")
            }
        }
        .animation(WorldsMotion.selection, value: layoutRaw)
    }

    // MARK: - Cards and rows

    private func pageCard(_ page: StoredPage, idPrefix: String) -> some View {
        Button {
            openPage(page.id)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    pageIcon(page, size: 30)
                    Spacer()
                    if HomePageMetadata.isPinned(page) {
                        Image(systemName: "pin")
                            .font(.footnote)
                            .foregroundStyle(.tertiary)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.bottom, 4)

                Text(pageTitle(page))
                    .font(.headline)
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    .lineLimit(1)

                Text(page.preview.isEmpty ? displayKind(page.kind) : page.preview)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2, reservesSpace: true)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)

                Text(relativeTime(page.updatedAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(18)
            .frame(maxWidth: .infinity, minHeight: isCompact ? 150 : 176, alignment: .topLeading)
            .worldsContentCard(cornerRadius: 18)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(HomeCardButtonStyle())
        .contextMenu { pageMenu(page) }
        .accessibilityIdentifier("\(idPrefix)-\(page.id)")
    }

    private func pageRow(_ page: StoredPage, idPrefix: String) -> some View {
        Button {
            openPage(page.id)
        } label: {
            HStack(spacing: 12) {
                pageIcon(page, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(pageTitle(page))
                        .font(.body.weight(.medium))
                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        .lineLimit(1)
                    Text(page.preview.isEmpty ? displayKind(page.kind) : page.preview)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if HomePageMetadata.isPinned(page) {
                    Image(systemName: "pin")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
                Text(relativeTime(page.updatedAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu { pageMenu(page) }
        .accessibilityIdentifier("\(idPrefix)-\(page.id)")
    }

    @ViewBuilder
    private func pageMenu(_ page: StoredPage) -> some View {
        Button("Open") { openPage(page.id) }
        if let onOpenInspectorForPage {
            Button("Show Inspector") { onOpenInspectorForPage(page.id) }
        }
    }

    @ViewBuilder
    private func pageIcon(_ page: StoredPage, size: CGFloat) -> some View {
        if let emoji = HomePageMetadata.emoji(page) {
            Text(emoji)
                .font(.system(size: size * 0.82))
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        } else {
            Image(systemName: iconForKind(page.kind))
                .font(.system(size: size * 0.5, weight: .semibold))
                .foregroundStyle(colorForKind(page.kind))
                .frame(width: size, height: size)
                .background(colorForKind(page.kind).opacity(0.14), in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
                .accessibilityHidden(true)
        }
    }

    private func pageTitle(_ page: StoredPage) -> String {
        page.title.isEmpty ? String(localized: "Untitled") : page.title
    }

    // MARK: - 3. Start Something New

    private var compactCreationSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            sectionHeader("Start Something New")

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    createIntentChip(title: "Note Page", icon: "doc.badge.plus", color: .blue, format: "page")
                    createIntentChip(title: "Excel Sheet", icon: "tablecells.fill", color: .green, format: "spreadsheet")
                    createIntentChip(title: "Mind Map", icon: "point.3.connected.trianglepath.dotted", color: .purple, format: "mindmap")
                    createIntentChip(title: "Planning Space", icon: "checklist.checked", color: .teal, format: "project")
                    if let onOpenCreateSheet {
                        Button(action: onOpenCreateSheet) {
                            HStack(spacing: 10) {
                                WorldsIconTile("plus", color: .gray, size: 26)
                                Text("All Formats\u{2026}")
                                    .font(.callout.weight(.medium))
                                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                                    .lineLimit(1)
                                    .fixedSize(horizontal: true, vertical: false)
                            }
                            .padding(.leading, 10)
                            .padding(.trailing, 14)
                            .padding(.vertical, 9)
                            .worldsContentCard(cornerRadius: 14)
                        }
                        .buttonStyle(HomeCardButtonStyle())
                        .accessibilityIdentifier("home-all-formats-button")
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func createIntentChip(title: LocalizedStringKey, icon: String, color: Color, format: String) -> some View {
        Button {
            onCreateFormat?(format)
        } label: {
            HStack(spacing: 10) {
                WorldsIconTile(icon, color: color, size: 26)
                Text(title)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .padding(.leading, 10)
            .padding(.trailing, 14)
            .padding(.vertical, 9)
            .worldsContentCard(cornerRadius: 14)
        }
        .buttonStyle(HomeCardButtonStyle())
        .accessibilityIdentifier("home-create-\(format)")
    }

    // MARK: - 4. Workspace Activity Summary

    private var activitySummaryFooter: some View {
        let docs = activePages.filter { $0.kind == "page" || $0.kind == "document" }.count
        let sheets = activePages.filter { $0.kind == "spreadsheet" }.count
        let visual = activePages.filter { $0.kind == "drawing" || $0.kind == "presentation" || $0.kind == "file" }.count
        let projects = activePages.filter { $0.kind == "project" }.count

        return HStack(spacing: 14) {
            Label("\(activePages.count) Active Items", systemImage: "tray.full")
            Text("\u{00B7}")
            Text("\(docs) Docs")
            Text("\(sheets) Sheets")
            Text("\(visual) Visual & 3D")
            Text("\(projects) Spaces")
            Spacer()
            if onRequestLocalCopy != nil {
                Text("Snapshot Mode")
                    .font(.caption2.weight(.medium))
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .padding(.top, 4)
    }

    private var emptyWorkspacePrompt: some View {
        HStack(spacing: 14) {
            WorldsIconTile("tray", color: .gray, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text("Your workspace is ready")
                    .font(.subheadline.weight(.semibold))
                Text("Create a new note, spreadsheet, or mind map to begin.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let onOpenCreateSheet {
                Button("Create", action: onOpenCreateSheet)
                    .worldsGlassButton(prominent: true)
            }
        }
        .padding(18)
        .worldsContentCard(cornerRadius: 18)
    }

    // MARK: - Helpers

    private func iconForKind(_ kind: String) -> String {
        switch kind {
        case "project": return "folder.fill"
        case "gallery": return "photo.on.rectangle"
        case "presentation": return "rectangle.inset.filled.and.person.filled"
        case "drawing": return "point.3.connected.trianglepath.dotted"
        case "document": return "doc.richtext"
        case "file": return "cube.transparent.fill"
        case "stream": return "play.rectangle.fill"
        case "spreadsheet": return "tablecells.fill"
        case "html": return "chevron.left.forwardslash.chevron.right"
        default: return "doc.text"
        }
    }

    private func colorForKind(_ kind: String) -> Color {
        switch kind {
        case "project": return .teal
        case "gallery": return .purple
        case "presentation": return .orange
        case "drawing": return WorldsPalette.accent(for: colorScheme)
        case "document": return .indigo
        case "spreadsheet": return .green
        case "file": return .cyan
        case "html": return .mint
        default: return .blue
        }
    }

    private func displayKind(_ kind: String) -> String {
        switch kind {
        case "spreadsheet": return String(localized: "Spreadsheet")
        case "drawing": return String(localized: "Mind Map / Canvas")
        case "presentation": return String(localized: "Slides Deck")
        case "file": return String(localized: "3D / CAD File")
        case "project": return String(localized: "Project Space")
        case "document": return String(localized: "Document")
        case "html": return String(localized: "HTML page")
        default: return String(localized: "Page")
        }
    }

    private func relativeTime(_ timestampMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(timestampMs) / 1000.0)
        if Date().timeIntervalSince(date) < 60 { return String(localized: "Just now") }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

/// Reads the pin and the emoji icon the desktop stores in a page's metadata.
enum HomePageMetadata {
    private static func root(_ page: StoredPage) -> [String: Any]? {
        guard !page.metadataJSON.isEmpty else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(page.metadataJSON.utf8))) as? [String: Any]
    }

    static func isPinned(_ page: StoredPage) -> Bool {
        guard let root = root(page) else { return false }
        if let pinned = root["pinned"] as? Bool { return pinned }
        if let pinned = root["pinned"] as? NSNumber { return pinned.boolValue }
        return false
    }

    static func emoji(_ page: StoredPage) -> String? {
        guard let root = root(page), let icon = root["icon"] as? String else { return nil }
        let trimmed = icon.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= 2,
              trimmed.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation || $0.properties.isEmoji && $0.value > 0x238C })
        else { return nil }
        return trimmed
    }
}

/// A calm press for content cards: a slight settle on the Worlds spring, no glass.
struct HomeCardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(WorldsMotion.spring, value: configuration.isPressed)
    }
}
