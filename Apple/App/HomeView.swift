import SwiftUI
import WorldsPersistence

struct HomeView: View {
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

    private var activePages: [StoredPage] {
        pages.filter { !$0.archived && $0.kind != "template" }
    }

    private var sortedRecentPages: [StoredPage] {
        activePages.sorted { $0.updatedAt > $1.updatedAt }
    }

    private var continueWorkingPages: [StoredPage] {
        Array(sortedRecentPages.prefix(2))
    }

    private var frequentListPages: [StoredPage] {
        Array(sortedRecentPages.dropFirst(2))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                continueWorkingSection
                recentResourcesSection
                compactCreationSection
                activitySummaryFooter
            }
            .padding(.horizontal, horizontalSizeClass == .compact ? 16 : 28)
            .padding(.top, 20)
            .padding(.bottom, horizontalSizeClass == .compact ? 36 : 24)
            .frame(maxWidth: 1120, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.groupedCanvas(for: colorScheme))
        .navigationTitle("Home")
        .accessibilityIdentifier("home-view")
    }

    // MARK: - 1. Continue Working

    private var continueWorkingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Continue Working")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                if let onOpenAutomations {
                    Button(action: onOpenAutomations) {
                        Label("Automations", systemImage: "clock.arrow.circlepath")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("home-open-automations")
                }
            }

            if continueWorkingPages.isEmpty {
                emptyWorkspacePrompt
            } else {
                let columns = horizontalSizeClass == .compact
                    ? [GridItem(.flexible())]
                    : [GridItem(.adaptive(minimum: 320, maximum: 560), spacing: 14)]

                LazyVGrid(columns: columns, spacing: 14) {
                    ForEach(continueWorkingPages) { page in
                        continueCard(page)
                    }
                }
            }
        }
    }

    private func continueCard(_ page: StoredPage) -> some View {
        Button {
            openPage(page.id)
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: iconForKind(page.kind))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(colorForKind(page.kind))
                        .frame(width: 30, height: 30)
                        .background(colorForKind(page.kind).opacity(0.14), in: RoundedRectangle(cornerRadius: 8))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(page.title.isEmpty ? "Untitled" : page.title)
                            .font(.headline)
                            .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                            .lineLimit(1)
                        Text("\(displayKind(page.kind)) · \(relativeTime(page.updatedAt))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }

                if !page.preview.isEmpty {
                    Text(page.preview)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .worldsContentCard(cornerRadius: 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Open") { openPage(page.id) }
            if let onOpenInspectorForPage {
                Button("Show Inspector") { onOpenInspectorForPage(page.id) }
            }
        }
        .accessibilityIdentifier("home-continue-\(page.id)")
    }

    // MARK: - 2. Recent & Frequent Resources

    private var recentResourcesSection: some View {
        let displayList = frequentListPages.isEmpty ? sortedRecentPages : frequentListPages
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Recent Resources")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                Spacer()
                if let onOpenLibrary {
                    Button {
                        onOpenLibrary(.all)
                    } label: {
                        Text("See All in Library")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                    }
                    .buttonStyle(.plain)
                }
            }

            if displayList.isEmpty {
                Text("No recent resources available yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .worldsContentCard(cornerRadius: 12)
            } else if horizontalSizeClass == .compact {
                VStack(spacing: 1) {
                    ForEach(displayList) { page in
                        compactResourceRow(page)
                        if page.id != displayList.last?.id {
                            Divider().padding(.leading, 50)
                        }
                    }
                }
                .padding(.vertical, 4)
                .worldsContentCard(cornerRadius: 12)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 270, maximum: 420), spacing: 12)], spacing: 12) {
                    ForEach(displayList) { page in
                        desktopResourceCard(page)
                    }
                }
            }
        }
    }

    private func compactResourceRow(_ page: StoredPage) -> some View {
        Button {
            openPage(page.id)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: iconForKind(page.kind))
                    .font(.subheadline)
                    .foregroundStyle(colorForKind(page.kind))
                    .frame(width: 28, height: 28)
                    .background(colorForKind(page.kind).opacity(0.14), in: RoundedRectangle(cornerRadius: 7))

                VStack(alignment: .leading, spacing: 2) {
                    Text(page.title.isEmpty ? "Untitled" : page.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        .lineLimit(1)
                    Text("\(displayKind(page.kind)) · \(relativeTime(page.updatedAt))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home-recent-\(page.id)")
    }

    private func desktopResourceCard(_ page: StoredPage) -> some View {
        Button {
            openPage(page.id)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: iconForKind(page.kind))
                    .font(.body)
                    .foregroundStyle(colorForKind(page.kind))
                    .frame(width: 34, height: 34)
                    .background(colorForKind(page.kind).opacity(0.14), in: RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 3) {
                    Text(page.title.isEmpty ? "Untitled" : page.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        .lineLimit(1)
                    Text(page.preview.isEmpty ? displayKind(page.kind) : page.preview)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .worldsContentCard(cornerRadius: 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Open") { openPage(page.id) }
            if let onOpenInspectorForPage {
                Button("Show Inspector") { onOpenInspectorForPage(page.id) }
            }
        }
        .accessibilityIdentifier("home-recent-\(page.id)")
    }

    // MARK: - 3. Compact Creation Bar (No Duplicated App Grid)

    private var compactCreationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Start Something New")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    createIntentChip(title: "Note Page", icon: "doc.badge.plus", color: .blue, format: "page")
                    createIntentChip(title: "Excel Sheet", icon: "tablecells.fill", color: .green, format: "spreadsheet")
                    createIntentChip(title: "Mind Map", icon: "point.3.connected.trianglepath.dotted", color: .purple, format: "mindmap")
                    createIntentChip(title: "Planning Space", icon: "checklist.checked", color: .teal, format: "project")
                    if let onOpenCreateSheet {
                        Button(action: onOpenCreateSheet) {
                            Label("All Formats…", systemImage: "plus.circle")
                                .font(.caption.weight(.semibold))
                                .lineLimit(1)
                                .fixedSize(horizontal: true, vertical: false)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .worldsContentCard(cornerRadius: 9)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("home-all-formats-button")
                    }
                }
            }
        }
    }

    private func createIntentChip(title: String, icon: String, color: Color, format: String) -> some View {
        Button {
            onCreateFormat?(format)
        } label: {
            Label(title, systemImage: icon)
                .font(.caption.weight(.semibold))
                .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .worldsContentCard(cornerRadius: 9)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home-create-\(format)")
    }

    // MARK: - 4. Subtle Workspace Activity Summary

    private var activitySummaryFooter: some View {
        let docs = activePages.filter { $0.kind == "page" || $0.kind == "document" }.count
        let sheets = activePages.filter { $0.kind == "spreadsheet" }.count
        let visual = activePages.filter { $0.kind == "drawing" || $0.kind == "presentation" || $0.kind == "file" }.count
        let projects = activePages.filter { $0.kind == "project" }.count

        return HStack(spacing: 14) {
            Label("\(activePages.count) Active Items", systemImage: "tray.full")
            Text("·")
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
            Image(systemName: "tray")
                .font(.title2)
                .foregroundStyle(.secondary)
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
                    .buttonStyle(.borderedProminent)
                    .tint(WorldsPalette.accent(for: colorScheme))
            }
        }
        .padding(16)
        .worldsContentCard(cornerRadius: 12)
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
        default: return .blue
        }
    }

    private func displayKind(_ kind: String) -> String {
        switch kind {
        case "spreadsheet": return "Spreadsheet"
        case "drawing": return "Mind Map / Canvas"
        case "presentation": return "Slides Deck"
        case "file": return "3D / CAD File"
        case "project": return "Project Space"
        case "document": return "Document"
        default: return "Page"
        }
    }

    private func relativeTime(_ timestampMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(timestampMs) / 1000.0)
        let diff = max(0, Date().timeIntervalSince(date))
        if diff < 60 { return "Just now" }
        if diff < 3600 { return "\(Int(diff / 60))m ago" }
        if diff < 86400 { return "\(Int(diff / 3600))h ago" }
        return "\(Int(diff / 86400))d ago"
    }
}
