import SwiftUI
import WorldsPersistence

struct HomeView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let pages: [StoredPage]
    let openPage: (String) -> Void
    var createPage: (() -> Void)? = nil
    var createDocument: (() -> Void)? = nil
    var createDrawing: (() -> Void)? = nil
    var createProject: (() -> Void)? = nil
    var createPresentation: (() -> Void)? = nil
    var openAssistant: (() -> Void)? = nil
    var openTemplates: (() -> Void)? = nil
    var openAutomations: (() -> Void)? = nil
    var openSpreadsheets: (() -> Void)? = nil
    var openPlanning: (() -> Void)? = nil
    var openStudyPack: (() -> Void)? = nil
    var openStudio: (() -> Void)? = nil
    var onRequestLocalCopy: (() -> Void)? = nil
    @AppStorage("worlds_pack_study") private var studyPackEnabled: Bool = false

    private var activePages: [StoredPage] {
        pages.filter { !$0.archived && $0.kind != "template" }
    }

    private var recentPages: [StoredPage] {
        Array(activePages.sorted(by: { $0.updatedAt > $1.updatedAt }).prefix(8))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                NativeFocusTimerBar()
                headerSection
                quickActionsSection
                metricsSection
                recentSection
            }
            .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
            .frame(maxWidth: 960, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .navigationTitle("Home")
        .accessibilityIdentifier("home-view")
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Image(systemName: "globe.americas.fill")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                Text("Welcome to Worlds")
                    .font(.system(.largeTitle, design: .default, weight: .bold))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    .accessibilityAddTraits(.isHeader)
            }

            Text("Your local-first native Apple workspace for notes, vector drawings, slide decks, 3D/CAD models, and AI workflows.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var quickActionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Quick Actions")
                    .font(.headline)
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                Spacer()
                if createPage == nil {
                    Text("Read-only snapshot · Create local copy to edit")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Writable Local Copy Active")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                }
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 12)], spacing: 12) {
                actionButton(
                    title: "New Page",
                    icon: "doc.badge.plus",
                    color: .blue,
                    identifier: "home-new-page",
                    action: createPage ?? onRequestLocalCopy ?? {}
                )
                actionButton(
                    title: "New Document",
                    icon: "doc.richtext",
                    color: .indigo,
                    identifier: "home-new-document",
                    action: createDocument ?? onRequestLocalCopy ?? {}
                )
                actionButton(
                    title: "New Drawing",
                    icon: "pencil.and.outline",
                    color: WorldsPalette.accent(for: colorScheme),
                    identifier: "home-new-drawing",
                    action: createDrawing ?? onRequestLocalCopy ?? {}
                )
                actionButton(
                    title: "New Project",
                    icon: "folder.badge.plus",
                    color: .teal,
                    identifier: "home-new-project",
                    action: createProject ?? onRequestLocalCopy ?? {}
                )
                actionButton(
                    title: "New Slides",
                    icon: "rectangle.inset.filled.and.person.filled",
                    color: .orange,
                    identifier: "home-new-slides",
                    action: createPresentation ?? onRequestLocalCopy ?? {}
                )
                if let openSpreadsheets {
                    actionButton(
                        title: "Excel Sheets",
                        icon: "tablecells.fill",
                        color: .green,
                        identifier: "home-open-spreadsheets",
                        action: openSpreadsheets
                    )
                }
                if let openPlanning {
                    actionButton(
                        title: "Planning & Tasks",
                        icon: "checklist.checked",
                        color: .cyan,
                        identifier: "home-open-planning",
                        action: openPlanning
                    )
                }
                if studyPackEnabled, let openStudyPack {
                    actionButton(
                        title: "Study Pack",
                        icon: "graduationcap.fill",
                        color: .indigo,
                        identifier: "home-open-study",
                        action: openStudyPack
                    )
                }
                if let openStudio {
                    actionButton(
                        title: "3D & Slides Studio",
                        icon: "cube.transparent.fill",
                        color: .orange,
                        identifier: "home-open-studio",
                        action: openStudio
                    )
                }
                if let openAssistant {
                    actionButton(
                        title: "AI Assistant",
                        icon: "sparkles",
                        color: .purple,
                        identifier: "home-open-assistant",
                        action: openAssistant
                    )
                }
                if let openTemplates {
                    actionButton(
                        title: "Templates",
                        icon: "square.grid.2x2",
                        color: .mint,
                        identifier: "home-open-templates",
                        action: openTemplates
                    )
                }
                if let openAutomations {
                    actionButton(
                        title: "Automations",
                        icon: "clock.arrow.circlepath",
                        color: .pink,
                        identifier: "home-open-automations",
                        action: openAutomations
                    )
                }
            }
        }
    }

    private func actionButton(title: String, icon: String, color: Color, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(color)
                    .frame(width: 28, height: 28)
                    .background(color.opacity(0.14), in: Circle())

                Text(title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .worldsGlass(cornerRadius: 12)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
    }

    private var metricsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Workspace Overview")
                .font(.headline)
                .foregroundStyle(WorldsPalette.ink(for: colorScheme))

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 12)], spacing: 12) {
                metricCard(title: "Pages & Docs", count: activePages.filter { $0.kind == "page" || $0.kind == "document" }.count, icon: "doc.text")
                metricCard(title: "Spreadsheets", count: activePages.filter { $0.kind == "spreadsheet" }.count, icon: "tablecells.fill")
                metricCard(title: "Mind Maps & Canvas", count: activePages.filter { $0.kind == "drawing" }.count, icon: "pencil.tip")
                metricCard(title: "Projects & Goals", count: activePages.filter { $0.kind == "project" }.count, icon: "folder")
                metricCard(title: "Slides & 3D", count: activePages.filter { $0.kind == "presentation" }.count, icon: "rectangle.on.rectangle")
            }
        }
    }

    private func metricCard(title: String, count: Int, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                Spacer()
                Text("\(count)")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
            }
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .worldsGlass(cornerRadius: 12)
    }

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Recent Resources")
                .font(.headline)
                .foregroundStyle(WorldsPalette.ink(for: colorScheme))

            if recentPages.isEmpty {
                Text("No recent pages found in this database.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding()
            } else {
                ForEach(recentPages) { page in
                    Button {
                        openPage(page.id)
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: kindIcon(page.kind))
                                .font(.body)
                                .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                                .frame(width: 32, height: 32)
                                .background(WorldsPalette.accent(for: colorScheme).opacity(0.12), in: RoundedRectangle(cornerRadius: 8))

                            VStack(alignment: .leading, spacing: 3) {
                                Text(page.title.isEmpty ? "Untitled" : page.title)
                                    .font(.body.weight(.medium))
                                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                                    .lineLimit(1)

                                Text("\(page.kind.capitalized) · Edited \(formattedDate(page.updatedAt))")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.forward")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .worldsGlass(cornerRadius: 12)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(page.title.isEmpty ? "Untitled" : page.title)")
                }
            }
        }
    }

    private func kindIcon(_ kind: String) -> String {
        switch kind {
        case "drawing": return "pencil.tip"
        case "document": return "doc.richtext"
        case "project": return "folder"
        case "gallery": return "photo.on.rectangle"
        case "presentation": return "rectangle.on.rectangle"
        case "stream": return "video"
        default: return "doc.text"
        }
    }

    private func formattedDate(_ epochMillis: Int64) -> String {
        guard epochMillis > 0 else { return "recently" }
        let date = Date(timeIntervalSince1970: TimeInterval(epochMillis) / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
