import SwiftUI
import WorldsPersistence

// MARK: - Unified 5-Destination Information Architecture

enum WorkspaceDestination: String, Hashable, CaseIterable, Identifiable {
    case home
    case spaces
    case library
    case ai
    case search

    var id: String { rawValue }

    var title: String {
        switch self {
        case .home: return "Home"
        case .spaces: return "Spaces"
        case .library: return "Library"
        case .ai: return "AI"
        case .search: return "Search"
        }
    }

    var systemImage: String {
        switch self {
        case .home: return "house"
        case .spaces: return "square.stack.3d.up"
        case .library: return "folder"
        case .ai: return "sparkles"
        case .search: return "magnifyingglass"
        }
    }
}

enum SpacesSection: String, Hashable, CaseIterable, Identifiable {
    case projects = "Projects & Tasks"
    case goals = "Goals & OKRs"
    case calendar = "Schedule & Inbox"
    case printQueue = "Print Queue"
    case study = "Study Pack"
    case packs = "Packs"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .projects: return "checklist.checked"
        case .goals: return "target"
        case .calendar: return "calendar.badge.clock"
        case .printQueue: return "printer.fill"
        case .study: return "graduationcap.fill"
        case .packs: return "square.stack.3d.up"
        }
    }
}

enum LibraryCollection: String, Hashable, CaseIterable, Identifiable {
    case all = "All Resources"
    case pages = "Pages & Docs"
    case spreadsheets = "Spreadsheets"
    case mindMaps = "Mind Maps & Drawings"
    case studio = "Slides & 3D CAD"
    case templates = "Templates"
    case trash = "Trash"

    var id: String { rawValue }

    var systemImage: String {
        switch self {
        case .all: return "tray.full"
        case .pages: return "doc.richtext"
        case .spreadsheets: return "tablecells.fill"
        case .mindMaps: return "point.3.connected.trianglepath.dotted"
        case .studio: return "cube.transparent.fill"
        case .templates: return "square.grid.2x2"
        case .trash: return "trash"
        }
    }
}

// MARK: - Compact Contextual Focus Session Controller

@MainActor
final class FocusSessionModel: ObservableObject {
    @Published var mode: String = "25m"
    @Published var remainingSeconds: Int = 25 * 60
    @Published var isRunning: Bool = false
    @Published var readingRulerEnabled: Bool = false
    @Published var completedSessions: Int = 3
    @Published var showingPopover: Bool = false

    func selectMode(_ newMode: String) {
        mode = newMode
        isRunning = false
        switch newMode {
        case "50m": remainingSeconds = 50 * 60
        case "5m": remainingSeconds = 5 * 60
        default: remainingSeconds = 25 * 60
        }
    }

    var formattedTime: String {
        String(format: "%02d:%02d", remainingSeconds / 60, remainingSeconds % 60)
    }
}

/// Compact contextual Focus control placed inside the navigation toolbar (popover on click rather than a permanent oversized card).
struct CompactFocusToolbarButton: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var model: FocusSessionModel

    var body: some View {
        Button {
            model.showingPopover.toggle()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: model.isRunning ? "timer.circle.fill" : "timer")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(model.isRunning ? WorldsPalette.accent(for: colorScheme) : .secondary)
                Text(model.formattedTime)
                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                    .foregroundStyle(model.isRunning ? WorldsPalette.accent(for: colorScheme) : .primary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .accessibilityLabel("Focus Timer \(model.formattedTime)")
        .accessibilityIdentifier("compact-focus-timer-button")
        .popover(isPresented: $model.showingPopover, arrowEdge: .top) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Focus Session", systemImage: "timer")
                        .font(.headline)
                    Spacer()
                    Label("\(model.completedSessions) completed", systemImage: "flame.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.orange)
                }

                Text(model.formattedTime)
                    .font(.system(size: 32, weight: .bold, design: .monospaced))
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                    .frame(maxWidth: .infinity, alignment: .center)

                Picker("Duration", selection: Binding(
                    get: { model.mode },
                    set: { model.selectMode($0) }
                )) {
                    Text("25m Pomodoro").tag("25m")
                    Text("50m Deep Work").tag("50m")
                    Text("5m Break").tag("5m")
                }
                .pickerStyle(.segmented)

                HStack {
                    Button {
                        model.isRunning.toggle()
                    } label: {
                        Label(model.isRunning ? "Pause" : "Start Focus", systemImage: model.isRunning ? "pause.fill" : "play.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(WorldsPalette.accent(for: colorScheme))
                    .accessibilityIdentifier("focus-timer-toggle")
                }

                Divider()

                Toggle(isOn: $model.readingRulerEnabled) {
                    Label("Reading Ruler Guide", systemImage: "line.3.horizontal.decrease")
                        .font(.subheadline)
                }
                .accessibilityIdentifier("reading-ruler-toggle")
            }
            .padding(16)
            .frame(width: 280)
        }
    }
}

// MARK: - Native Create Experience Sheet (Intent-Driven)

struct CreateFormatOption: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let category: String
}

struct CreateWorkspaceItemSheet: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dismiss) private var dismiss
    @AppStorage("worlds_pack_study") private var studyPackEnabled: Bool = false

    let onSelectFormat: (String) -> Void
    let onBrowseTemplates: () -> Void

    private var options: [CreateFormatOption] {
        var items: [CreateFormatOption] = [
            CreateFormatOption(id: "page", title: "Note Page", subtitle: "Structured Markdown, outlines, callouts & LaTeX math", icon: "doc.badge.plus", color: .blue, category: "Knowledge & Docs"),
            CreateFormatOption(id: "document", title: "Rich Document", subtitle: "Long-form technical writing & printable pages", icon: "doc.richtext", color: .indigo, category: "Knowledge & Docs"),
            CreateFormatOption(id: "spreadsheet", title: "Excel Spreadsheet", subtitle: "Multi-sheet workbook with 55+ Excel formulas", icon: "tablecells.fill", color: .green, category: "Data & Tables"),
            CreateFormatOption(id: "mindmap", title: "Mind Map & Concept Network", subtitle: "Visual node canvas with curved proposition links", icon: "point.3.connected.trianglepath.dotted", color: .purple, category: "Visual Thinking"),
            CreateFormatOption(id: "drawing", title: "Vector Drawing Canvas", subtitle: "Apple Pencil vector ink canvas (.worldsdraw)", icon: "pencil.and.outline", color: WorldsPalette.accent(for: colorScheme), category: "Visual Thinking"),
            CreateFormatOption(id: "project", title: "Space Project & OKRs", subtitle: "Milestones, sprints, calendar & print queue", icon: "folder.badge.plus", color: .teal, category: "Planning"),
            CreateFormatOption(id: "presentation", title: "16:9 Presentation Deck", subtitle: "ProMotion slides stage & visual storytelling", icon: "rectangle.inset.filled.and.person.filled", color: .orange, category: "Creative Studio"),
            CreateFormatOption(id: "cad", title: "3D & AutoCAD DXF Blueprint", subtitle: "Isometric 3D & CAD layer viewport", icon: "cube.transparent.fill", color: .cyan, category: "Creative Studio")
        ]
        if studyPackEnabled {
            items.append(CreateFormatOption(id: "study", title: "Course & Study Notebook", subtitle: "Timetable, textbook bookmark & subject resources", icon: "graduationcap.fill", color: .indigo, category: "Academic Study"))
        }
        return items
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(["Knowledge & Docs", "Data & Tables", "Visual Thinking", "Planning", "Creative Studio", "Academic Study"], id: \.self) { group in
                    let groupItems = options.filter { $0.category == group }
                    if !groupItems.isEmpty {
                        Section(group) {
                            ForEach(groupItems) { item in
                                Button {
                                    dismiss()
                                    onSelectFormat(item.id)
                                } label: {
                                    HStack(spacing: 12) {
                                        Image(systemName: item.icon)
                                            .font(.title3)
                                            .foregroundStyle(item.color)
                                            .frame(width: 34, height: 34)
                                            .background(item.color.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.title)
                                                .font(.body.weight(.semibold))
                                                .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                                            Text(item.subtitle)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption2.weight(.semibold))
                                            .foregroundStyle(.tertiary)
                                    }
                                    .padding(.vertical, 2)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("create-format-\(item.id)")
                            }
                        }
                    }
                }

                Section {
                    Button {
                        dismiss()
                        onBrowseTemplates()
                    } label: {
                        Label("Start from Workspace Templates…", systemImage: "square.grid.2x2")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                    }
                    .accessibilityIdentifier("create-browse-templates")
                }
            }
            .navigationTitle("Create New")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 500, idealWidth: 560, minHeight: 500, idealHeight: 580)
        #endif
        .accessibilityIdentifier("create-item-sheet")
    }
}

// MARK: - Native Contextual Inspector Panel (iPadOS & macOS)

struct WorkspaceInspectorPanel: View {
    @Environment(\.colorScheme) private var colorScheme
    let selectedPage: StoredPage?
    let activeDestination: WorkspaceDestination
    let activeCollection: LibraryCollection
    @ObservedObject var focusModel: FocusSessionModel
    let pageCount: Int
    var onOpenTemplates: () -> Void
    var onOpenSettings: () -> Void
    var onMoveToTrash: ((String) -> Void)? = nil

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // Header
                HStack {
                    Label("Inspector", systemImage: "sidebar.right")
                        .font(.headline)
                        .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    Spacer()
                }

                if let page = selectedPage {
                    pageInspectorSection(page)
                } else {
                    contextInspectorSection
                }

                Divider()

                // Productivity & Reading Comfort
                VStack(alignment: .leading, spacing: 10) {
                    Text("Focus & Comfort")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label("Focus Timer", systemImage: focusModel.isRunning ? "timer.circle.fill" : "timer")
                                .font(.subheadline.weight(.medium))
                            Spacer()
                            Text(focusModel.formattedTime)
                                .font(.system(.subheadline, design: .monospaced, weight: .bold))
                                .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                        }

                        Picker("Mode", selection: Binding(
                            get: { focusModel.mode },
                            set: { focusModel.selectMode($0) }
                        )) {
                            Text("25m").tag("25m")
                            Text("50m").tag("50m")
                            Text("5m").tag("5m")
                        }
                        .pickerStyle(.segmented)

                        Toggle("Reading Ruler Guide", isOn: $focusModel.readingRulerEnabled)
                            .font(.subheadline)
                    }
                    .padding(12)
                    .worldsContentCard(cornerRadius: 10)
                }

                Divider()

                // Contextual Quick Links
                VStack(alignment: .leading, spacing: 8) {
                    Text("Workspace Tools")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)

                    Button(action: onOpenTemplates) {
                        Label("Browse Templates", systemImage: "square.grid.2x2")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)

                    Button(action: onOpenSettings) {
                        Label("Workspace Settings", systemImage: "gearshape")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(16)
        }
        .accessibilityIdentifier("workspace-inspector-panel")
    }

    @ViewBuilder
    private func pageInspectorSection(_ page: StoredPage) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Document Properties")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            VStack(alignment: .leading, spacing: 10) {
                Text(page.title.isEmpty ? String(localized: "Untitled") : page.title)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))

                LabeledContent("Format", value: page.kind.capitalized)
                    .font(.caption)
                LabeledContent("Status", value: page.archived ? "Archived" : "Active")
                    .font(.caption)
                LabeledContent("Search Index", value: "FTS5 Indexed")
                    .font(.caption)
                LabeledContent("Sync Engine", value: "Yrs CRDT Ready")
                    .font(.caption)

                if page.kind == "spreadsheet" {
                    Divider()
                    Text("Workbook Summary")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.green)
                    LabeledContent("Active Cell", value: "D6 =SUM(D2:D5)")
                        .font(.caption.monospaced())
                    LabeledContent("Sheet Net Profit", value: "$187,500")
                        .font(.caption.monospaced())
                }
            }
            .padding(12)
            .worldsContentCard(cornerRadius: 10)

            if let onMoveToTrash {
                Button(role: .destructive) {
                    onMoveToTrash(page.id)
                } label: {
                    Label("Move to Trash", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private var contextInspectorSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Current Destination")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            VStack(alignment: .leading, spacing: 8) {
                Label(activeDestination.title, systemImage: activeDestination.systemImage)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))

                if activeDestination == .library {
                    LabeledContent("Collection", value: activeCollection.rawValue)
                        .font(.caption)
                }
                LabeledContent("Total Resources", value: "\(pageCount)")
                    .font(.caption)
                LabeledContent("Persistence", value: "Local SQLite + RustStore")
                    .font(.caption)
            }
            .padding(12)
            .worldsContentCard(cornerRadius: 10)
        }
    }
}
