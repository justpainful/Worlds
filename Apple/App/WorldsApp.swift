import SwiftUI
import UniformTypeIdentifiers
import SQLite3
import WorldsPersistence
import WorldsSearch
#if WORLDS_MAIN_APP_MODULES
import WorldsMCPApprovalCoordinator
import WorldsMCPApprovalViews
#endif
#if WORLDS_EXPERIMENTAL_LOCAL_COPY
import WorldsLocalImport
import WorldsProjectEditingViews
#if WORLDS_EXPERIMENTAL_CREATE_STREAM
import WorldsModels
#endif
import WorldsNativeWrites
import WorldsWorkspaceAccess
#endif

extension Notification.Name {
    static let worldsOpenDatabaseAction = Notification.Name("worldsOpenDatabaseAction")
    static let worldsOpenOwnWorkspaceAction = Notification.Name("worldsOpenOwnWorkspaceAction")
    static let worldsFocusSearchAction = Notification.Name("worldsFocusSearchAction")
    static let worldsNavigateHomeAction = Notification.Name("worldsNavigateHomeAction")
    static let worldsNavigateSpacesAction = Notification.Name("worldsNavigateSpacesAction")
    static let worldsNavigateLibraryAction = Notification.Name("worldsNavigateLibraryAction")
    static let worldsNavigateAIAction = Notification.Name("worldsNavigateAIAction")
    static let worldsNavigateSearchAction = Notification.Name("worldsNavigateSearchAction")
    static let worldsNavigateTemplatesAction = Notification.Name("worldsNavigateTemplatesAction")
    static let worldsNavigateTrashAction = Notification.Name("worldsNavigateTrashAction")
    static let worldsNavigateSpreadsheetsAction = Notification.Name("worldsNavigateSpreadsheetsAction")
    static let worldsNavigatePlanningAction = Notification.Name("worldsNavigatePlanningAction")
    static let worldsNavigateStudyAction = Notification.Name("worldsNavigateStudyAction")
    static let worldsNavigateStudioAction = Notification.Name("worldsNavigateStudioAction")
    static let worldsOpenAssistantAction = Notification.Name("worldsOpenAssistantAction")
    static let worldsOpenSettingsAction = Notification.Name("worldsOpenSettingsAction")
    static let worldsToggleInspectorAction = Notification.Name("worldsToggleInspectorAction")
    static let worldsOpenCreateAction = Notification.Name("worldsOpenCreateAction")
    static let worldsQuickNoteAction = Notification.Name("worldsQuickNoteAction")
}

#if canImport(UIKit)
import UIKit
@MainActor
enum WorldsHaptics {
    static func light() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred()
    }
    static func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }
    static func success() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
    }
}
#else
@MainActor
enum WorldsHaptics {
    static func light() {}
    static func selection() {}
    static func success() {}
}
#endif

#if DEBUG && os(macOS)
@MainActor enum WorldsShowcaseWindowHelper {
    static func configureWindows(args: [String]) {
        let dark = args.contains("--ui-testing-dark") || args.contains("--ui-testing-complete-showcase")
        if dark {
            NSApp.appearance = NSAppearance(named: .darkAqua)
        }
        if args.contains("--ui-testing-complete-showcase") {
            for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix("NSWindow Frame") {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
        for window in NSApp.windows where window.canBecomeMain || window.canBecomeKey {
            if dark {
                window.appearance = NSAppearance(named: .darkAqua)
                window.backgroundColor = NSColor(red: 12 / 255, green: 12 / 255, blue: 14 / 255, alpha: 1)
            }
            if args.contains("--ui-testing-complete-showcase") {
                window.minSize = NSSize(width: 1280, height: 800)
                let screenFrame = window.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1920, height: 1050)
                let targetW = min(screenFrame.width, 1440)
                let targetH = min(screenFrame.height, 900)
                let originX = screenFrame.origin.x + max(0, (screenFrame.width - targetW) / 2)
                let originY = screenFrame.origin.y + max(0, (screenFrame.height - targetH) / 2)
                let targetRect = NSRect(x: originX, y: originY, width: targetW, height: targetH)
                if window.frame.width < 1200 || window.frame.height < 780 {
                    window.setFrame(targetRect, display: true, animate: false)
                }
            }
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
        }
    }
}

@MainActor final class WorldsAppTestingDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing-dark") || args.contains("--ui-testing-complete-showcase") {
            UserDefaults.standard.set("dark", forKey: "worlds_theme_preference")
        }
        if args.contains("--ui-testing-complete-showcase") {
            UserDefaults.standard.set(true, forKey: "worlds_pack_study")
        }
        WorldsShowcaseWindowHelper.configureWindows(args: args)
        var ticks = 0
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { timer in
            ticks += 1
            Task { @MainActor in
                WorldsShowcaseWindowHelper.configureWindows(args: args)
            }
            if ticks >= 10 {
                timer.invalidate()
            }
        }
    }
}
#endif

@main
struct WorldsApp: App {
    #if DEBUG && os(macOS) && WORLDS_UI_WINDOW_DIAGNOSTICS
    @NSApplicationDelegateAdaptor(WindowLifecycleDiagnostics.self) private var windowLifecycleDiagnostics
    #elseif DEBUG && os(macOS)
    @NSApplicationDelegateAdaptor(WorldsAppTestingDelegate.self) private var appTestingDelegate
    #endif

    init() {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        let wantsDark = args.contains("--ui-testing-dark") || args.contains("--ui-testing-complete-showcase")
        if wantsDark {
            UserDefaults.standard.set("dark", forKey: "worlds_theme_preference")
        }
        if args.contains("--ui-testing-complete-showcase") {
            UserDefaults.standard.set(true, forKey: "worlds_pack_study")
        }
        #if os(macOS)
        if wantsDark {
            NSApp.appearance = NSAppearance(named: .darkAqua)
        }
        #elseif canImport(UIKit)
        if wantsDark {
            UIView.appearance().overrideUserInterfaceStyle = .dark
        }
        #endif
        #endif
    }

    var body: some Scene {
        #if os(macOS) && DEBUG
        WindowGroup {
            rootView
                .frame(
                    minWidth: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 1380 : nil,
                    idealWidth: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 1440 : nil,
                    minHeight: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 860 : nil,
                    idealHeight: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 900 : nil
                )
        }
            .windowResizability(.contentMinSize)
            .windowToolbarStyle(.unified)
            .defaultSize(width: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 1440 : (ProcessInfo.processInfo.arguments.contains("--ui-testing-large-window") ? 1100 : 800),
                         height: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 900 : (ProcessInfo.processInfo.arguments.contains("--ui-testing-large-window") ? 780 : 600))
            .commands { appCommands }
        #elseif os(macOS)
        WindowGroup { rootView }
            .windowToolbarStyle(.unified)
            .commands { appCommands }
        #else
        WindowGroup {
            rootView
                .preferredColorScheme((ProcessInfo.processInfo.arguments.contains("--ui-testing-dark") || ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase")) ? .dark : nil)
        }
        #endif
    }

    #if os(macOS)
    @CommandsBuilder
    private var appCommands: some Commands {
        SidebarCommands()
        CommandGroup(replacing: .newItem) {
            Button("New Resource…") {
                NotificationCenter.default.post(name: .worldsOpenCreateAction, object: nil)
            }
            .keyboardShortcut("n", modifiers: .command)

            Button("Quick Note HUD") {
                NotificationCenter.default.post(name: .worldsQuickNoteAction, object: nil)
            }
            .keyboardShortcut(.space, modifiers: .option)

            Divider()

            Button("Open Database…") {
                NotificationCenter.default.post(name: .worldsOpenDatabaseAction, object: nil)
            }
            .keyboardShortcut("o", modifiers: .command)

            Button("Open Desktop Workspace") {
                NotificationCenter.default.post(name: .worldsOpenOwnWorkspaceAction, object: nil)
            }
            .keyboardShortcut("o", modifiers: [.command, .shift])
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Find in Workspace…") {
                NotificationCenter.default.post(name: .worldsFocusSearchAction, object: nil)
            }
            .keyboardShortcut("f", modifiers: .command)
        }
        CommandMenu("View") {
            Button("Toggle Inspector") {
                NotificationCenter.default.post(name: .worldsToggleInspectorAction, object: nil)
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
        }
        CommandMenu("Navigate") {
            Group {
                Button("Home") {
                    NotificationCenter.default.post(name: .worldsNavigateHomeAction, object: nil)
                }
                .keyboardShortcut("1", modifiers: [.command, .option])

                Button("Spaces") {
                    NotificationCenter.default.post(name: .worldsNavigateSpacesAction, object: nil)
                }
                .keyboardShortcut("2", modifiers: [.command, .option])

                Button("Library") {
                    NotificationCenter.default.post(name: .worldsNavigateLibraryAction, object: nil)
                }
                .keyboardShortcut("3", modifiers: [.command, .option])

                Button("AI Assistant") {
                    NotificationCenter.default.post(name: .worldsNavigateAIAction, object: nil)
                }
                .keyboardShortcut("a", modifiers: [.command, .option])

                Button("Search") {
                    NotificationCenter.default.post(name: .worldsNavigateSearchAction, object: nil)
                }
                .keyboardShortcut("s", modifiers: [.command, .option])
            }
            Divider()
            Group {
                Button("Spreadsheets") {
                    NotificationCenter.default.post(name: .worldsNavigateSpreadsheetsAction, object: nil)
                }
                .keyboardShortcut("4", modifiers: [.command, .option])

                Button("Planning") {
                    NotificationCenter.default.post(name: .worldsNavigatePlanningAction, object: nil)
                }
                .keyboardShortcut("5", modifiers: [.command, .option])

                Button("Study") {
                    NotificationCenter.default.post(name: .worldsNavigateStudyAction, object: nil)
                }
                .keyboardShortcut("6", modifiers: [.command, .option])

                Button("Creative Studio") {
                    NotificationCenter.default.post(name: .worldsNavigateStudioAction, object: nil)
                }
                .keyboardShortcut("7", modifiers: [.command, .option])

                Button("Templates") {
                    NotificationCenter.default.post(name: .worldsNavigateTemplatesAction, object: nil)
                }
                .keyboardShortcut("t", modifiers: [.command, .option])

                Button("Trash") {
                    NotificationCenter.default.post(name: .worldsNavigateTrashAction, object: nil)
                }
                .keyboardShortcut("8", modifiers: [.command, .option])

                Divider()

                Button("Settings…") {
                    NotificationCenter.default.post(name: .worldsOpenSettingsAction, object: nil)
                }
                .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
    #endif

    @ViewBuilder private var rootView: some View {
        #if DEBUG
        WorldsLibraryView().modifier(UITestingAppearance())
        #else
        WorldsLibraryView()
        #endif
    }
}

#if DEBUG
private struct UITestingAppearance: ViewModifier {
    @Environment(\.layoutDirection) private var direction
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.colorScheme) private var systemScheme
    @AppStorage("worlds_theme_preference") private var themePreference: String = "system"

    private var forcedColorScheme: ColorScheme? {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing-dark") || args.contains("--ui-testing-complete-showcase") || themePreference == "dark" {
            return .dark
        }
        if args.contains("--ui-testing-light") || themePreference == "light" {
            return .light
        }
        return nil
    }

    func body(content: Content) -> some View {
        let args = ProcessInfo.processInfo.arguments
        let activeScheme = forcedColorScheme ?? systemScheme
        content
            .environment(\.layoutDirection, args.contains("--ui-testing-rtl") ? .rightToLeft : direction)
            .environment(\.dynamicTypeSize, args.contains("--ui-testing-large-text") ? .accessibility3 : textSize)
            .environment(\.colorScheme, activeScheme)
            .preferredColorScheme(forcedColorScheme)
            #if os(macOS)
            .onAppear {
                NSApp.setActivationPolicy(.regular)
                NSApp.activate(ignoringOtherApps: true)
                WorldsShowcaseWindowHelper.configureWindows(args: args)
                DispatchQueue.main.async {
                    WorldsShowcaseWindowHelper.configureWindows(args: args)
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    WorldsShowcaseWindowHelper.configureWindows(args: args)
                }
            }
            #elseif canImport(UIKit)
            .onAppear {
                let applyDark: @Sendable () -> Void = {
                    Task { @MainActor in
                        if forcedColorScheme == .dark {
                            UIView.appearance().overrideUserInterfaceStyle = .dark
                            for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
                                for win in scene.windows {
                                    win.overrideUserInterfaceStyle = .dark
                                }
                            }
                        }
                    }
                }
                applyDark()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { applyDark() }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { applyDark() }
            }
            #endif
    }
}
#endif

private extension View {
    func registerNavigationReceivers(
        onHome: @escaping () -> Void,
        onSpaces: @escaping () -> Void,
        onLibrary: @escaping () -> Void,
        onAI: @escaping () -> Void,
        onSearch: @escaping () -> Void,
        onTemplates: @escaping () -> Void,
        onTrash: @escaping () -> Void,
        onSpreadsheets: @escaping () -> Void,
        onPlanning: @escaping () -> Void,
        onStudy: @escaping () -> Void,
        onStudio: @escaping () -> Void,
        onAssistant: @escaping () -> Void,
        onSettings: @escaping () -> Void,
        onToggleInspector: @escaping () -> Void,
        onOpenCreate: @escaping () -> Void,
        onQuickNote: @escaping () -> Void
    ) -> some View {
        self
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateHomeAction)) { _ in onHome() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateSpacesAction)) { _ in onSpaces() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateLibraryAction)) { _ in onLibrary() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateAIAction)) { _ in onAI() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateSearchAction)) { _ in onSearch() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateTemplatesAction)) { _ in onTemplates() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateTrashAction)) { _ in onTrash() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateSpreadsheetsAction)) { _ in onSpreadsheets() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigatePlanningAction)) { _ in onPlanning() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateStudyAction)) { _ in onStudy() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateStudioAction)) { _ in onStudio() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsOpenAssistantAction)) { _ in onAssistant() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsOpenSettingsAction)) { _ in onSettings() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsToggleInspectorAction)) { _ in onToggleInspector() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsOpenCreateAction)) { _ in onOpenCreate() }
            .onReceive(NotificationCenter.default.publisher(for: .worldsQuickNoteAction)) { _ in onQuickNote() }
    }
}

private struct WorldsLibraryView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @AppStorage("worlds_pack_study") private var studyPackEnabled: Bool = false
    @State private var pages: [StoredPage] = ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? WorldsLibraryView.makeShowcasePages() : []
    @State private var selectedID: String?
    @State private var phoneDetailPageID: String?
    @State private var returnStack: [String] = []
    @State private var showPageHierarchy = false
    @State private var expandedPageIDs: Set<String> = []
    #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
    @State private var personalTabs = PersonalTabSession(eligibleIDs: [])
    @State private var tabCopyID: UUID?
    private let tabPreferences = PersonalTabPreferences()
    #endif
    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    @State private var hierarchyCopyID: UUID?
    private let hierarchyPreferences = PersonalHierarchyPreferences()
    #endif
    @State private var showImporter = false
    @State private var loaded = ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase")
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var searchEngine: WorldsSearch?
    @State private var databaseGeneration = UUID()
    #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
    @State private var localHistoryDatabase: WorldsDatabase?
    @State private var historyRequest: LocalHistoryRequest?
    @State private var fixtureHistoryCopyID: UUID?
    #endif
    @State private var openedVideoDatabase: VideoDatabaseSource?
    #if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
    @State private var videoRequest: PersonalVideoRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_DOCUMENT
    @State private var documentRequest: PersonalDocumentRequest?
    #endif
    @State private var openRequest = UUID()
    @State private var searchQuery = ""
    @State private var searchScope: WorldsSearchScope = .all
    @State private var searchHits: [WorldsSearchHit] = []
    @State private var searchError: String?
    @State private var searching = false
    @State private var searchedQuery: String?
    @State private var searchedScope: WorldsSearchScope?
    @State private var searchRequest = UUID()
    #if WORLDS_EXPERIMENTAL_ACCOUNT
    @State private var showAccount = false
    #endif
    enum SidebarSection: Hashable { case home, spreadsheets, planning, study, studio, templates, trash }
    @State private var selectedSidebarSection: SidebarSection? = ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? .home : nil
    @State private var destination: WorkspaceDestination = .home
    @State private var spacesSection: SpacesSection = .projects
    @State private var libraryCollection: LibraryCollection = .all
    #if os(macOS)
    @State private var showInspector: Bool = true
    @StateObject private var hotCorners = WorldsHotCornersCoordinator()
    #else
    @State private var showInspector: Bool = false
    #endif
    @State private var showCreateSheet = false
    @StateObject private var focusModel = FocusSessionModel()
    @State private var showSettings = false
    @State private var showAssistant = false
    #if WORLDS_MAIN_APP_MODULES
    @State private var pendingMCPApproval: MCPRenameApproval?
    private let mcpRunner = DualMCPToolRunner()
    #endif
    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    /// The write target: the opened workspace itself when it can be written in
    /// place, or an independent local copy. Nil means read only.
    @State private var copyContext: LocalCopyContext?
    /// Why the opened workspace stays read only, shown to the person.
    @State private var readOnlyReason: WorkspaceWriteAccess.Reason?
    /// The desktop's Trash for the opened workspace.
    @State private var storeTrash: [StoredTrashedPage] = []
    @State private var trashFailure: String?
    @State private var copyCoordinator: LocalProjectImportCoordinator?
    @State private var copyImportSelected = false
    @State private var showCopyExplanation = false
    @State private var showLocalCopies = false
    @State private var editingProject: ProjectEditorRequest?
    #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
    @State private var fixtureGalleryCopyID: UUID?
    @State private var galleryDraftRequest: LocalGalleryDraftRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
    @State private var creatingDrawing: LocalCreateDrawingRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_STREAM
    @State private var creatingStream: LocalCreateStreamRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_GALLERY
    @State private var creatingGallery: LocalCreateGalleryRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
    @State private var creatingPresentation: LocalCreatePresentationRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_PROJECT
    @State private var creatingProject: LocalCreateProjectRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
    @State private var creatingDocument: LocalCreateDocumentRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_MOVE_PAGE
    @State private var movingPage: LocalMovePageRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_RENAME_PAGE
    @State private var renamingPage: LocalRenamePageRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_PAGE
    @State private var creatingPage: LocalCreatePageRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_DRAWING_EDITOR
    @State private var editingDrawing: LocalDrawingEditorRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
    @State private var automationsRequest: LocalAutomationsRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_STREAM_EDITOR
    @State private var editingStream: LocalStreamEditorRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
    @State private var editingSpreadsheet: LocalSpreadsheetEditorRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
    @State private var importingGallery: LocalGalleryImportRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
    @State private var editingPresentation: LocalPresentationEditorRequest?
    #endif
    #if WORLDS_EXPERIMENTAL_PAGE_EDITOR
    @State private var editingPage: LocalPageEditorRequest?
    #endif
    #endif

    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    private var isLegacyFixtureRun: Bool {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("--ui-testing-complete-showcase") { return false }
        return args.contains("--ui-testing-fixture")
            || args.contains("--ui-testing-search-fixture")
            || args.contains("--ui-testing-reader-fixture")
            || args.contains("--ui-testing-local-copy-fixture")
            || args.contains("--ui-testing-missing-fixture")
            || args.contains("--ui-testing-large-text")
            || args.contains("--ui-testing-gallery-draft-fixture")
    }

    var body: some View {
        applyWorkspaceModifiers(to: activeWorkspaceContent)
    }

    @ViewBuilder
    private var activeWorkspaceContent: some View {
        if isLegacyFixtureRun {
            legacyFixtureSplitView
                .searchable(text: $searchQuery, placement: .sidebar, prompt: "Search personal pages")
        } else {
            #if os(iOS)
            if horizontalSizeClass == .compact {
                phoneTabShell
            } else {
                desktopAndTabletSplitShell
            }
            #else
            desktopAndTabletSplitShell
            #endif
        }
    }

    private var legacyFixtureSplitView: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            VStack(spacing: 0) {
                if loaded && !ProcessInfo.processInfo.arguments.contains("--ui-testing-large-text") {
                    workspaceNavigationBar
                    Divider()
                }
                Group {
                    if loading {
                        ProgressView("Opening database")
                    } else if !loaded {
                        ContentUnavailableView {
                            Label("Open your Worlds database", systemImage: "externaldrive")
                        } description: {
                            Text("Choose a local Worlds database to view its personal pages.")
                        } actions: {
                            Button("Open Database") {
                                #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                                copyImportSelected = false
                                #endif
                                showImporter = true
                            }
                                .buttonStyle(.borderedProminent)
                                .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
                                .accessibilityIdentifier("open-database")
                        }
                    } else if !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        searchResults
                    } else if horizontalSizeClass == .compact, let section = selectedSidebarSection, selectedID == nil {
                        sectionContentView(section)
                    } else if pages.isEmpty {
                        ContentUnavailableView(
                            "No personal pages",
                            systemImage: "doc.text",
                            description: Text("This database has no personal pages available to show.")
                        )
                    } else {
                        pageList
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationSplitViewColumnWidth(min: dynamicTypeSize.isAccessibilitySize ? 320 : 230,
                                            ideal: dynamicTypeSize.isAccessibilitySize ? 360 : 255,
                                            max: dynamicTypeSize.isAccessibilitySize ? 440 : 285)
            .navigationTitle("Pages")
            .toolbar {
                if loaded {
                    ToolbarItem {
                        Button {
                            showPageHierarchy.toggle()
                            if showPageHierarchy, let selectedID {
                                expandedPageIDs.formUnion(PersonalPageHierarchy.expandedAncestors(of: selectedID, pages: pages))
                            }
                        } label: {
                            Label(showPageHierarchy ? "Show all pages" : "Show page hierarchy", systemImage: showPageHierarchy ? "list.bullet" : "list.bullet.indent")
                        }
                        .accessibilityIdentifier("toggle-page-hierarchy")
                        .disabled(databaseActionsDisabled)
                    }
                }
                #if WORLDS_EXPERIMENTAL_ACCOUNT
                ToolbarItem {
                    Button { showAccount = true } label: { Label("Account", systemImage: "person.crop.circle") }
                        .disabled(databaseActionsDisabled)
                }
                #endif
                ToolbarItem {
                    Button {
                        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                        copyImportSelected = false
                        #endif
                        showImporter = true
                    } label: {
                        Label("Open Database", systemImage: "folder")
                    }
                    .disabled(databaseActionsDisabled)
                }
                #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                #if WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New presentation", systemImage: "rectangle.on.rectangle") {
                            creatingPresentation = LocalCreatePresentationRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-presentation").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New drawing", systemImage: "pencil.tip.crop.circle") {
                            creatingDrawing = LocalCreateDrawingRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-drawing").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if WORLDS_EXPERIMENTAL_CREATE_STREAM
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New stream", systemImage: "play.rectangle") {
                            creatingStream = LocalCreateStreamRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-stream").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if WORLDS_EXPERIMENTAL_CREATE_GALLERY
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New gallery", systemImage: "photo.on.rectangle") {
                            creatingGallery = LocalCreateGalleryRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-gallery").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if WORLDS_EXPERIMENTAL_CREATE_PROJECT
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New project", systemImage: "folder.badge.plus") {
                            creatingProject = LocalCreateProjectRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-project").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New document", systemImage: "doc.badge.plus") {
                            creatingDocument = LocalCreateDocumentRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-document").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if WORLDS_EXPERIMENTAL_CREATE_PAGE
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New page", systemImage: "plus") {
                            creatingPage = LocalCreatePageRequest(copy: context.copy, databaseIdentity: source.identity, parentID: nil, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-page").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
                if let context = copyContext, context.copy.isLocalCopy, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("Automations", systemImage: "clock.arrow.circlepath") {
                            automationsRequest = LocalAutomationsRequest(context: context, identity: source.identity)
                        }.accessibilityIdentifier("open-local-automations").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                ToolbarItem {
                    Menu {
                        Button("Create local copy") { showCopyExplanation = true }
                        Button("Open local copy") { openCopyPicker() }
                    } label: { Label("Local copies", systemImage: "doc.on.doc") }
                    .disabled(databaseActionsDisabled)
                }
                #endif
            }
        } detail: {
            Group {
                if let section = selectedSidebarSection, selectedID == nil {
                    sectionContentView(section)
                } else if let selectedPageID = selectedID, let page = pages.first(where: { $0.id == selectedPageID }) {
                    if ["project", "gallery", "presentation", "file", "stream", "spreadsheet"].contains(page.kind) {
                        ResourceContentView(page: page, pages: pages, projectEditingAvailable: projectEditingAvailable(for: page), otherEditingAvailable: otherResourceEditingAvailable(for: page), editsOwnWorkspace: editsOwnWorkspace, openVideo: videoAction(for: page), openDocument: documentAction(for: page)) { target in
                            guard target != page.id else { return }
                            returnStack.append(page.id)
                            selectedID = target
                        }
                    } else {
                        PageContentView(
                            page: page,
                            openInlineImage: inlineImageAction(for: page),
                            subpages: pages.filter { $0.parentID == page.id && $0.id != page.id && !$0.archived && $0.kind != "template" && !returnStack.contains($0.id) },
                            openSubpage: { target in
                                guard !returnStack.contains(target),
                                      pages.contains(where: { $0.id == target && $0.parentID == page.id && !$0.archived && $0.kind != "template" && $0.id != page.id }) else { return }
                                returnStack.append(page.id)
                                selectedID = target
                            },
                            editsOwnWorkspace: editsOwnWorkspace
                        )
                    }
                } else if loaded {
                    sectionContentView(.home)
                } else {
                    Color.clear
                }
            }
            #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
            .safeAreaInset(edge: .top) {
                if tabCopyID != nil, !personalTabs.pageIDs.isEmpty {
                    PersonalTabBar(session: personalTabs, pages: pages, select: selectPersonalTab, close: closePersonalTab)
                        .disabled(databaseActionsDisabled)
                }
            }
            #endif
            .toolbar {
                #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
                if let id = selectedID, let context = copyContext, let fixtureID = fixtureHistoryCopyID, context.copy.id == fixtureID,
                   let database = localHistoryDatabase,
                   let page = pages.first(where: { $0.id == id }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Page history", systemImage: "clock.arrow.circlepath") {
                            historyRequest = LocalHistoryRequest(pageID: id, title: page.title, database: database)
                        }
                        .accessibilityIdentifier("open-local-history")
                        .disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                resourceEditToolbar(for: selectedID)
                #endif
                if let previous = returnStack.last, let page = pages.first(where: { $0.id == previous }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            _ = returnStack.popLast()
                            selectedID = previous
                        } label: {
                            Label("Return to \(page.title.isEmpty ? "Untitled" : page.title)", systemImage: "arrow.backward")
                        }
                        .accessibilityIdentifier("return-to-linked-page")
                    }
                }
            }
        }
    }

    // MARK: - Modern Platform-Specific Shells (iPhone / iPad / macOS)

    private enum SidebarSelectionTag: Hashable {
        case destination(WorkspaceDestination)
        case spaces(SpacesSection)
        case library(LibraryCollection)
        case page(String)
    }

    private var sidebarTagBinding: Binding<SidebarSelectionTag?> {
        Binding(
            get: {
                if let id = selectedID { return .page(id) }
                if destination == .library && libraryCollection != .all { return .library(libraryCollection) }
                if destination == .spaces && spacesSection != .projects { return .spaces(spacesSection) }
                return .destination(destination)
            },
            set: { newTag in
                guard let newTag else { return }
                returnStack.removeAll()
                switch newTag {
                case .destination(let dest):
                    selectedID = nil
                    destination = dest
                case .spaces(let sec):
                    selectedID = nil
                    destination = .spaces
                    spacesSection = sec
                case .library(let col):
                    selectedID = nil
                    destination = .library
                    libraryCollection = col
                case .page(let id):
                    selectedID = id
                }
            }
        )
    }

    private var activeNonTemplatePages: [StoredPage] {
        pages.filter { !$0.archived && $0.kind != "template" }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    private func phoneDetailBinding(for tab: WorkspaceDestination) -> Binding<String?> {
        Binding(
            get: { destination == tab ? phoneDetailPageID : nil },
            set: { newValue in
                if destination == tab {
                    phoneDetailPageID = newValue
                }
            }
        )
    }

    @ViewBuilder
    private var phoneTabShell: some View {
        if #available(iOS 18.0, macOS 15.0, *) {
            TabView(selection: $destination) {
                Tab("Home", systemImage: "house", value: WorkspaceDestination.home) {
                    phoneTabStack(for: .home) {
                        HomeView(
                            pages: pages,
                            openPage: { openResourceOnPhone($0) },
                            onOpenSpaces: { destination = .spaces },
                            onOpenLibrary: { col in libraryCollection = col; destination = .library },
                            onOpenCreateSheet: { showCreateSheet = true },
                            onCreateFormat: { openCreateFormat($0) },
                            onOpenAutomations: openAutomationsAction,
                            onRequestLocalCopy: requestLocalCopyAction
                        )
                    }
                }
                Tab("Spaces", systemImage: "square.stack.3d.up", value: WorkspaceDestination.spaces) {
                    phoneTabStack(for: .spaces) {
                        SpacesDestinationView(
                            selectedSection: $spacesSection,
                            pages: pages,
                            openPage: { openResourceOnPhone($0) },
                            showSectionPicker: true
                        )
                    }
                }
                Tab("Library", systemImage: "folder", value: WorkspaceDestination.library) {
                    phoneTabStack(for: .library) {
                        LibraryDestinationView(
                            selectedCollection: $libraryCollection,
                            pages: pages,
                            openPage: { openResourceOnPhone($0) },
                            onSelectTemplate: createPageFromTemplate,
                            onRestorePage: restorePage,
                            onDeletePermanently: deletePermanently,
                            onEmptyTrash: emptyTrash,
                            onOpenCreateSheet: { showCreateSheet = true },
                            showCollectionPicker: true,
                            storeTrash: storeTrashListing,
                            permanentDeletionAvailable: permanentDeletionAvailable
                        )
                    }
                }
                Tab("AI", systemImage: "sparkles", value: WorkspaceDestination.ai) {
                    phoneTabStack(for: .ai) {
                        AssistantHostView(pages: pages, embeddedInNavigation: true)
                    }
                }
                Tab("Search", systemImage: "magnifyingglass", value: WorkspaceDestination.search, role: .search) {
                    phoneTabStack(for: .search) {
                        SearchDestinationView(
                            searchQuery: $searchQuery,
                            searchScope: $searchScope,
                            pages: pages,
                            searchHits: searchHits,
                            openPage: { openResourceOnPhone($0) }
                        )
                    }
                }
            }
            .accessibilityIdentifier("phone-liquid-glass-tabbar")
        } else {
            TabView(selection: $destination) {
                phoneTabStack(for: .home) {
                    HomeView(
                        pages: pages,
                        openPage: { openResourceOnPhone($0) },
                        onOpenSpaces: { destination = .spaces },
                        onOpenLibrary: { col in libraryCollection = col; destination = .library },
                        onOpenCreateSheet: { showCreateSheet = true },
                        onCreateFormat: { openCreateFormat($0) },
                        onOpenAutomations: openAutomationsAction,
                        onRequestLocalCopy: requestLocalCopyAction
                    )
                }
                .tabItem { Label("Home", systemImage: "house") }
                .tag(WorkspaceDestination.home)

                phoneTabStack(for: .spaces) {
                    SpacesDestinationView(selectedSection: $spacesSection, pages: pages, openPage: { openResourceOnPhone($0) }, showSectionPicker: true)
                }
                .tabItem { Label("Spaces", systemImage: "square.stack.3d.up") }
                .tag(WorkspaceDestination.spaces)

                phoneTabStack(for: .library) {
                    LibraryDestinationView(
                        selectedCollection: $libraryCollection,
                        pages: pages,
                        openPage: { openResourceOnPhone($0) },
                        onSelectTemplate: createPageFromTemplate,
                        onRestorePage: restorePage,
                        onDeletePermanently: deletePermanently,
                        onEmptyTrash: emptyTrash,
                        onOpenCreateSheet: { showCreateSheet = true },
                        showCollectionPicker: true,
                        storeTrash: storeTrashListing,
                        permanentDeletionAvailable: permanentDeletionAvailable
                    )
                }
                .tabItem { Label("Library", systemImage: "folder") }
                .tag(WorkspaceDestination.library)

                phoneTabStack(for: .ai) {
                    AssistantHostView(pages: pages, embeddedInNavigation: true)
                }
                .tabItem { Label("AI", systemImage: "sparkles") }
                .tag(WorkspaceDestination.ai)

                phoneTabStack(for: .search) {
                    SearchDestinationView(searchQuery: $searchQuery, searchScope: $searchScope, pages: pages, searchHits: searchHits, openPage: { openResourceOnPhone($0) })
                }
                .tabItem { Label("Search", systemImage: "magnifyingglass") }
                .tag(WorkspaceDestination.search)
            }
            .accessibilityIdentifier("phone-liquid-glass-tabbar")
        }
    }

    @ViewBuilder
    private func phoneTabStack<Content: View>(for tab: WorkspaceDestination, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            content()
                .overlay { readingRulerOverlay }
                .navigationDestination(item: phoneDetailBinding(for: tab)) { pageID in
                    selectedResourceDetail(for: pageID)
                        .overlay { readingRulerOverlay }
                        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                        .toolbar { resourceEditToolbar(for: pageID) }
                        #endif
                }
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        CompactFocusToolbarButton(model: focusModel)
                        Button {
                            showCreateSheet = true
                        } label: {
                            Label("New", systemImage: "plus")
                        }
                        .accessibilityIdentifier("open-create-sheet-button")

                        Menu {
                            Button {
                                destination = .library
                                libraryCollection = .templates
                            } label: {
                                Label("Templates", systemImage: "square.grid.2x2")
                            }
                            Button {
                                destination = .library
                                libraryCollection = .trash
                            } label: {
                                Label("Trash", systemImage: "trash")
                            }
                            Divider()
                            #if WORLDS_EXPERIMENTAL_ACCOUNT
                            Button { showAccount = true } label: {
                                Label("Account", systemImage: "person.crop.circle")
                            }
                            #endif
                            Button {
                                #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                                copyImportSelected = false
                                #endif
                                showImporter = true
                            } label: {
                                Label("Open Database…", systemImage: "folder")
                            }
                            Button { showSettings = true } label: {
                                Label("Settings…", systemImage: "gearshape")
                            }
                        } label: {
                            Label("More", systemImage: "ellipsis.circle")
                        }
                        .accessibilityIdentifier("phone-more-menu")
                    }
                }
        }
    }

    @ViewBuilder
    private var desktopAndTabletSplitShell: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            modernSidebarView
                .navigationSplitViewColumnWidth(
                    min: dynamicTypeSize.isAccessibilitySize ? 280 : 210,
                    ideal: dynamicTypeSize.isAccessibilitySize ? 320 : 242,
                    max: dynamicTypeSize.isAccessibilitySize ? 380 : 288
                )
        } detail: {
            modernDetailCanvas
                .overlay { readingRulerOverlay }
                .toolbar {
                    desktopToolbarItems
                    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                    resourceEditToolbar(for: selectedID)
                    #endif
                }
                .inspector(isPresented: $showInspector) {
                    WorkspaceInspectorPanel(
                        selectedPage: selectedID.flatMap { id in pages.first(where: { $0.id == id }) },
                        activeDestination: destination,
                        activeCollection: libraryCollection,
                        focusModel: focusModel,
                        pageCount: pages.count,
                        onOpenTemplates: {
                            selectedID = nil
                            destination = .library
                            libraryCollection = .templates
                        },
                        onOpenSettings: { showSettings = true },
                        onMoveToTrash: { id in moveToTrash(id) }
                    )
                    #if os(macOS)
                    .background(WorldsVibrancyView(material: .sidebar, blendingMode: .withinWindow))
                    #endif
                    .inspectorColumnWidth(min: 250, ideal: 290, max: 340)
                }
        }
        .navigationSplitViewStyle(.balanced)
        .searchable(text: $searchQuery, placement: .sidebar, prompt: "Search workspace")
        .onChange(of: searchQuery) { _, newValue in
            let trimmed = newValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty && !isLegacyFixtureRun {
                selectedID = nil
                destination = .search
            }
        }
    }

    private var modernSidebarView: some View {
        List(selection: sidebarTagBinding) {
            Section("Workspace") {
                ForEach(WorkspaceDestination.allCases) { item in
                    Label(item.title, systemImage: item.systemImage)
                        .tag(SidebarSelectionTag.destination(item))
                        .accessibilityIdentifier("sidebar-dest-\(item.rawValue)")
                }
            }

            Section("Collections") {
                ForEach(LibraryCollection.allCases.filter { $0 != .all }) { col in
                    Label(col.rawValue, systemImage: col.systemImage)
                        .tag(SidebarSelectionTag.library(col))
                        .accessibilityIdentifier("sidebar-lib-\(col.rawValue)")
                }
            }

            if !activeNonTemplatePages.isEmpty {
                Section("Recent Files") {
                    ForEach(activeNonTemplatePages.prefix(4)) { page in
                        Label(page.title.isEmpty ? "Untitled" : page.title, systemImage: sidebarIcon(for: page.kind))
                            .lineLimit(1)
                            .tag(SidebarSelectionTag.page(page.id))
                            .accessibilityIdentifier("page.\(page.id)")
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .navigationTitle("Worlds")
        #if os(macOS)
        .scrollContentBackground(.hidden)
        .background(WorldsVibrancyView(material: .sidebar, blendingMode: .behindWindow).ignoresSafeArea())
        #endif
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                Divider()
                HStack(spacing: 10) {
                    Button {
                        showSettings = true
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("open-settings-button")

                    Spacer()

                    Button {
                        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                        copyImportSelected = false
                        #endif
                        showImporter = true
                    } label: {
                        Image(systemName: "externaldrive.badge.plus")
                            .font(.caption)
                    }
                    .buttonStyle(.borderless)
                    .help("Open local database…")
                    .accessibilityIdentifier("sidebar-open-database")
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            #if os(macOS)
            .background(.ultraThinMaterial)
            #else
            .background(.bar)
            #endif
        }
    }

    @ViewBuilder
    private var modernDetailCanvas: some View {
        if let selectedPageID = selectedID {
            selectedResourceDetail(for: selectedPageID)
        } else {
            switch destination {
            case .home:
                HomeView(
                    pages: pages,
                    openPage: { openResourceInModernShell($0) },
                    onOpenSpaces: { destination = .spaces },
                    onOpenLibrary: { col in libraryCollection = col; destination = .library },
                    onOpenCreateSheet: { showCreateSheet = true },
                    onCreateFormat: { openCreateFormat($0) },
                    onOpenInspectorForPage: { id in
                        selectedID = id
                        showInspector = true
                    },
                    onOpenAutomations: openAutomationsAction,
                    onRequestLocalCopy: requestLocalCopyAction
                )
            case .spaces:
                SpacesDestinationView(
                    selectedSection: $spacesSection,
                    pages: pages,
                    openPage: { openResourceInModernShell($0) },
                    showSectionPicker: true
                )
            case .library:
                LibraryDestinationView(
                    selectedCollection: $libraryCollection,
                    pages: pages,
                    openPage: { openResourceInModernShell($0) },
                    onSelectTemplate: createPageFromTemplate,
                    onRestorePage: restorePage,
                    onDeletePermanently: deletePermanently,
                    onEmptyTrash: emptyTrash,
                    onOpenCreateSheet: { showCreateSheet = true },
                    showCollectionPicker: true,
                    storeTrash: storeTrashListing,
                    permanentDeletionAvailable: permanentDeletionAvailable
                )
            case .ai:
                AssistantHostView(pages: pages, embeddedInNavigation: true)
            case .search:
                SearchDestinationView(
                    searchQuery: $searchQuery,
                    searchScope: $searchScope,
                    pages: pages,
                    searchHits: searchHits,
                    openPage: { openResourceInModernShell($0) }
                )
            }
        }
    }

    @ViewBuilder
    private func selectedResourceDetail(for pageID: String) -> some View {
        if pageID == "showcase-sheet-q4" {
            WorldsSpreadsheetStudioView(metadataJSON: "{}")
        } else if pageID == "showcase-mindmap-arch" {
            ScrollView {
                VisualMindMapCanvasPreview(onCreateCanvas: { _ in openCreateFormat("mindmap") })
                    .padding(24)
            }
            .background(WorldsPalette.groupedCanvas(for: colorScheme))
            .navigationTitle("Concept & Mind Map")
        } else if pageID == "showcase-okr-roadmap" {
            SpacesDestinationView(selectedSection: $spacesSection, pages: pages, openPage: { openResourceInModernShell($0) }, showSectionPicker: true)
        } else if pageID == "showcase-study-cs301" {
            WorldsStudyPackHubView()
        } else if pageID == "showcase-cad-turbine" || pageID == "showcase-slides-deck" {
            WorldsCreativeStudioView()
        } else if let page = pages.first(where: { $0.id == pageID }) {
            if ["project", "gallery", "presentation", "file", "stream", "spreadsheet"].contains(page.kind) {
                ResourceContentView(
                    page: page,
                    pages: pages,
                    projectEditingAvailable: projectEditingAvailable(for: page),
                    otherEditingAvailable: otherResourceEditingAvailable(for: page),
                    editsOwnWorkspace: editsOwnWorkspace,
                    openVideo: videoAction(for: page),
                    openDocument: documentAction(for: page)
                ) { target in
                    guard target != page.id else { return }
                    returnStack.append(page.id)
                    selectedID = target
                }
            } else {
                PageContentView(
                    page: page,
                    openInlineImage: inlineImageAction(for: page),
                    subpages: pages.filter { $0.parentID == page.id && $0.id != page.id && !$0.archived && $0.kind != "template" && !returnStack.contains($0.id) },
                    openSubpage: { target in
                        guard !returnStack.contains(target),
                              pages.contains(where: { $0.id == target && $0.parentID == page.id && !$0.archived && $0.kind != "template" && $0.id != page.id }) else { return }
                        returnStack.append(page.id)
                        selectedID = target
                    },
                    editsOwnWorkspace: editsOwnWorkspace
                )
            }
        } else {
            ContentUnavailableView("Resource not found", systemImage: "doc.questionmark")
        }
    }

    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    /// Edit actions for the selected resource. They appear only while a write
    /// target is active: the opened workspace itself or a local copy.
    @ToolbarContentBuilder
    private func resourceEditToolbar(for selection: String?) -> some ToolbarContent {
        #if WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        if let id = selection, let context = copyContext, let source = openedVideoDatabase,
           source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL,
           pages.contains(where: { $0.id == id && $0.kind == "drawing" }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit drawing", systemImage: "pencil.tip") {
                    editingDrawing = LocalDrawingEditorRequest(id: id, context: context, identity: source.identity, generation: databaseGeneration)
                }.accessibilityIdentifier("edit-local-drawing").disabled(databaseActionsDisabled)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_STREAM_EDITOR
        if let id = selection, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "stream" }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit link", systemImage: "link") { editingStream = LocalStreamEditorRequest(id: id, context: context, generation: databaseGeneration) }
                    .disabled(loading)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
        if let id = selection, let context = copyContext, let page = pages.first(where: { $0.id == id && $0.kind == "spreadsheet" }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit spreadsheet", systemImage: "tablecells") {
                    editingSpreadsheet = LocalSpreadsheetEditorRequest(id: id, title: page.title, context: context, generation: databaseGeneration)
                }
                .accessibilityIdentifier("edit-local-spreadsheet")
                .disabled(loading)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
        if selection == "gallery-draft-fixture", let context = copyContext, let fixtureCopy = context.copy.independentCopy,
           context.copy.id == fixtureGalleryCopyID, let source = openedVideoDatabase,
           source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit fixture gallery", systemImage: "pencil") {
                    galleryDraftRequest = LocalGalleryDraftRequest(copy: fixtureCopy, identity: source.identity, generation: databaseGeneration)
                }.disabled(databaseActionsDisabled).accessibilityIdentifier("edit-fixture-gallery")
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
        if let id = selection, let context = copyContext, context.copy.supportsGalleryFileImport, pages.contains(where: { $0.id == id && $0.kind == "gallery" }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Import file", systemImage: "square.and.arrow.down") { importingGallery = LocalGalleryImportRequest(id: id, context: context, generation: databaseGeneration) }
                    .disabled(loading)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        if let id = selection, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "presentation" }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit presentation", systemImage: "pencil") { editingPresentation = LocalPresentationEditorRequest(id: id, context: context, generation: databaseGeneration) }
                    .accessibilityIdentifier("edit-local-presentation").disabled(loading)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_MOVE_PAGE
        if let id = selection, let page = pages.first(where: { $0.id == id && ($0.kind == "page" || $0.kind == "document") }),
           let context = copyContext, let source = openedVideoDatabase,
           source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
            ToolbarItem(placement: .primaryAction) {
                Button("Move page", systemImage: "folder") {
                    movingPage = LocalMovePageRequest(pageID: id, title: page.title, originalParent: page.parentID, originalSortKey: page.sortKey, originalRevision: page.updatedAt, candidates: pages, copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                }.accessibilityIdentifier("move-local-page").disabled(databaseActionsDisabled)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_RENAME_PAGE
        if let id = selection, let page = pages.first(where: { $0.id == id && ($0.kind == "page" || $0.kind == "document") }),
           let context = copyContext, let source = openedVideoDatabase,
           source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
            ToolbarItem(placement: .primaryAction) {
                Button("Rename page", systemImage: "pencil.line") {
                    renamingPage = LocalRenamePageRequest(pageID: id, originalTitle: page.title, originalRevision: page.updatedAt, copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                }.accessibilityIdentifier("rename-local-page").disabled(databaseActionsDisabled)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_PAGE_EDITOR
        if let id = selection, let context = copyContext, pages.contains(where: { $0.id == id && ($0.kind == "page" || $0.kind == "document") }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit page", systemImage: "pencil") { editingPage = LocalPageEditorRequest(id: id, context: context, generation: databaseGeneration) }
                    .accessibilityIdentifier("edit-local-page").disabled(loading)
            }
        }
        #endif
        if let id = selection, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "project" }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit project", systemImage: "pencil") { editingProject = ProjectEditorRequest(id: id, context: context, generation: databaseGeneration, candidates: projectLinkCandidates()) }
                    .accessibilityIdentifier("edit-local-project")
                    .disabled(loading)
            }
        }
        if let id = selection, let context = copyContext, context.copy.usesStoreTrash,
           pages.contains(where: { $0.id == id && $0.kind != "template" }) {
            ToolbarItem(placement: .primaryAction) {
                Button("Move to Trash", systemImage: "trash") { moveToTrash(id) }
                    .accessibilityIdentifier("trash-workspace-page")
                    .disabled(databaseActionsDisabled)
            }
        }
    }
    #endif

    @ToolbarContentBuilder
    private var desktopToolbarItems: some ToolbarContent {
        if selectedID != nil {
            ToolbarItem(placement: .navigation) {
                Button {
                    if let prev = returnStack.popLast() {
                        selectedID = prev
                    } else {
                        selectedID = nil
                    }
                } label: {
                    Label("Back", systemImage: "chevron.backward")
                }
                .accessibilityIdentifier("detail-back-button")
            }
        }

        ToolbarItemGroup(placement: .primaryAction) {
            CompactFocusToolbarButton(model: focusModel)

            Button {
                showCreateSheet = true
            } label: {
                Label("Create", systemImage: "plus")
            }
            .accessibilityIdentifier("open-create-sheet-button")

            #if os(macOS)
            Button {
                hotCorners.openQuickNote()
            } label: {
                Label("Quick Note", systemImage: "note.text")
            }
            .accessibilityIdentifier("open-quick-note-button")
            #endif

            #if WORLDS_EXPERIMENTAL_ACCOUNT
            Button { showAccount = true } label: {
                Label("Account", systemImage: "person.crop.circle")
            }
            #endif

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showInspector.toggle()
                }
            } label: {
                Label(showInspector ? "Hide Inspector" : "Show Inspector", systemImage: "sidebar.right")
            }
            .accessibilityIdentifier("toggle-inspector-button")
        }
    }

    @ViewBuilder
    private var readingRulerOverlay: some View {
        if focusModel.readingRulerEnabled {
            GeometryReader { proxy in
                VStack {
                    Spacer()
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(WorldsPalette.accent(for: colorScheme).opacity(0.09))
                        .frame(height: 54)
                        .overlay(
                            Rectangle()
                                .fill(WorldsPalette.accent(for: colorScheme).opacity(0.45))
                                .frame(height: 1.5),
                            alignment: .bottom
                        )
                        .padding(.horizontal, 12)
                    Spacer()
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
            .allowsHitTesting(false)
            .accessibilityIdentifier("reading-ruler-overlay")
        }
    }

    private func openResourceOnPhone(_ id: String) {
        if id == "showcase-okr-roadmap" {
            destination = .spaces
            spacesSection = .projects
            phoneDetailPageID = nil
            return
        }
        phoneDetailPageID = id
    }

    private func openResourceInModernShell(_ id: String) {
        selectedID = id
    }

    private var requestLocalCopyAction: (() -> Void)? {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        return { showCopyExplanation = true }
        #else
        return nil
        #endif
    }

    private func openCreateFormat(_ format: String) {
        let presentDetail: (String) -> Void = { id in
            if horizontalSizeClass == .compact {
                phoneDetailPageID = id
            } else {
                selectedID = id
            }
        }

        switch format {
        case "page":
            if let createPageAction { createPageAction(); return }
        case "document":
            if let createDocumentAction { createDocumentAction(); return }
        case "drawing":
            if let createDrawingAction { createDrawingAction(); return }
        case "project":
            if let createProjectAction { createProjectAction(); return }
            selectedID = nil
            phoneDetailPageID = nil
            destination = .spaces
            spacesSection = .projects
            return
        case "presentation":
            if let createPresentationAction { createPresentationAction(); return }
        case "spreadsheet":
            presentDetail("showcase-sheet-q4")
            return
        case "mindmap":
            presentDetail("showcase-mindmap-arch")
            return
        case "cad":
            presentDetail("showcase-cad-turbine")
            return
        case "study":
            studyPackEnabled = true
            selectedID = nil
            phoneDetailPageID = nil
            destination = .spaces
            spacesSection = .study
            return
        default:
            break
        }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let newID = "quick-\(format)-\(now)"
        let titleMap = [
            "page": "Untitled Note Page",
            "document": "Untitled Document",
            "drawing": "New Vector Canvas",
            "project": "New Workspace Project",
            "presentation": "New Presentation Deck"
        ]
        let newPage = StoredPage(
            id: newID,
            title: titleMap[format] ?? "Untitled Resource",
            kind: format,
            parentID: nil,
            archived: false,
            sortKey: 0,
            createdAt: now,
            preview: "Created in Worlds · Ready for editing",
            updatedAt: now,
            metadataJSON: "{}",
            blocks: []
        )
        pages.insert(newPage, at: 0)
        if horizontalSizeClass == .compact {
            phoneDetailPageID = newID
        } else {
            selectedID = newID
        }
    }

    /// The desktop's Trash, when the opened workspace is the write target.
    private var storeTrashListing: [StoredTrashedPage]? {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        copyContext?.copy.usesStoreTrash == true ? storeTrash : nil
        #else
        nil
        #endif
    }

    private var permanentDeletionAvailable: Bool {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        copyContext?.copy.supportsPermanentDeletion ?? true
        #else
        true
        #endif
    }

    private func moveToTrash(_ id: String) {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        if let context = copyContext, context.copy.usesStoreTrash {
            guard let page = pages.first(where: { $0.id == id }) else { return }
            let generation = databaseGeneration
            Task { await trashInWorkspace(page: page, context: context, generation: generation) }
            return
        }
        #endif
        guard let index = pages.firstIndex(where: { $0.id == id }) else { return }
        let current = pages[index]
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        pages[index] = StoredPage(
            id: current.id,
            title: current.title,
            kind: current.kind,
            parentID: current.parentID,
            archived: true,
            sortKey: current.sortKey,
            createdAt: current.createdAt,
            preview: current.preview,
            updatedAt: now,
            metadataJSON: current.metadataJSON,
            blocks: current.blocks
        )
        if selectedID == id { selectedID = nil }
        if phoneDetailPageID == id { phoneDetailPageID = nil }
    }

    private func appendQuickNote(_ text: String) {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let firstLine = text.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? "Quick Note"
        let note = StoredPage(
            id: "quick-note-\(now)",
            title: firstLine.prefix(48).description,
            kind: "page",
            parentID: nil,
            archived: false,
            sortKey: -1,
            createdAt: now,
            preview: text,
            updatedAt: now,
            metadataJSON: "{}",
            blocks: []
        )
        pages.insert(note, at: 0)
    }

    private func sidebarIcon(for kind: String) -> String {
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

    private func applyWorkspaceModifiers<Content: View>(to content: Content) -> some View {
        content
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
        .sheet(item: $historyRequest) { request in
            LocalHistoryView(request: request)
        }
        #endif
        .safeAreaInset(edge: .bottom) {
            if copyContext?.copy.isLocalCopy == true { LocalCopyNotice() }
            else if copyContext == nil, let readOnlyReason { WorkspaceReadOnlyNotice(reason: readOnlyReason) }
        }
        .alert("Could not change Trash", isPresented: Binding(get: { trashFailure != nil }, set: { if !$0 { trashFailure = nil } })) {
            Button("OK", role: .cancel) { trashFailure = nil }
        } message: { Text(trashFailure ?? "") }
        .confirmationDialog("Create an independent local copy?", isPresented: $showCopyExplanation) {
            Button("Choose database") { copyImportSelected = true; showImporter = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Changes remain in the copy and do not sync to the original. Attachments are not copied. Shared records may be present but cannot be edited here.")
        }
        .sheet(isPresented: $showLocalCopies) {
            if let copyCoordinator { LocalCopyPicker(coordinator: copyCoordinator) { copy in Task { await activateCopy(copy) } } }
        }
        #if WORLDS_EXPERIMENTAL_CREATE_PAGE
        .sheet(item: $creatingPage) { request in
            LocalCreatePageView(request: request) { id in
                await showCreatedPage(id, request: request)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_RENAME_PAGE
        .sheet(item: $renamingPage) { request in
            LocalRenamePageView(request: request) { baseline, title, operationID in
                try await savePageName(request: request, baseline: baseline, title: title, operationID: operationID)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_MOVE_PAGE
        .sheet(item: $movingPage) { request in
            LocalMovePageView(request: request) { baseline, destination, operationID in
                try await movePersonalPage(request: request, baseline: baseline, destination: destination, operationID: operationID)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
        .sheet(item: $creatingDocument) { request in
            LocalCreateDocumentView(request: request) { id in
                await showCreatedDocument(id, request: request)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_PROJECT
        .sheet(item: $creatingProject) { request in
            LocalCreateProjectView(request: request) { id in
                await showCreatedProject(id, request: request)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        .sheet(item: $creatingPresentation) { request in
            LocalCreatePresentationView(request: request) { id in
                await showCreatedPresentation(id, request: request)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_GALLERY
        .sheet(item: $creatingGallery) { request in
            LocalCreateGalleryView(request: request) { id in
                await showCreatedGallery(id, request: request)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_STREAM
        .sheet(item: $creatingStream) { request in
            LocalCreateStreamView(request: request) { id, link in
                await showCreatedStream(id, link: link, request: request)
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        .sheet(item: $creatingDrawing) { request in
            LocalCreateDrawingView(request: request) { id in
                await showCreatedDrawing(id, request: request)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
        .sheet(item: $galleryDraftRequest) { request in
            LocalGalleryDraftView(request: request)
        }
        #endif
        .sheet(item: $editingProject) { request in
            NavigationStack {
                ProjectDraftView(projectID: request.id, repository: request.context.repository, candidates: request.candidates, allowsLinkEditing: projectLinkEditingEnabled) {
                    Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
                }
            }
        }
        #if WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        .sheet(item: $editingDrawing) { request in
            LocalDrawingEditor(databaseURL: request.context.copy.databaseURL, pageID: request.id, identity: request.identity, editsLocalCopy: request.context.copy.isLocalCopy) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
        .sheet(item: $automationsRequest) { request in
            LocalAutomationsView(databaseURL: request.context.copy.databaseURL, identity: request.identity)
        }
        #endif
        #if WORLDS_EXPERIMENTAL_STREAM_EDITOR
        .sheet(item: $editingStream) { request in
            LocalStreamEditor(copy: request.context.copy, pageID: request.id) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
        .sheet(item: $editingSpreadsheet) { request in
            LocalSpreadsheetEditor(copy: request.context.copy, pageID: request.id, title: request.title) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
        .sheet(item: $importingGallery) { request in
            if let copy = request.context.copy.independentCopy {
                LocalGalleryImportView(copy: copy, pageID: request.id) {
                    Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
                }
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        .sheet(item: $editingPresentation) { request in
            LocalPresentationEditor(databaseURL: request.context.copy.databaseURL, pageID: request.id, editsLocalCopy: request.context.copy.isLocalCopy) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_PAGE_EDITOR
        .sheet(item: $editingPage) { request in
            LocalPageEditorView(databaseURL: request.context.copy.databaseURL, pageID: request.id, editsLocalCopy: request.context.copy.isLocalCopy) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #endif
        #if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
        .sheet(item: $videoRequest) { request in
            PersonalVideoView(databaseURL: request.source.url, databaseIdentity: request.source.identity, pageID: request.id)
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_DOCUMENT
        .sheet(item: $documentRequest) { request in
            PersonalDocumentView(databaseURL: request.source.url, databaseIdentity: request.source.identity, pageID: request.id, inlineImageBlockID: request.blockID)
        }
        #endif
        #if WORLDS_EXPERIMENTAL_ACCOUNT
        .sheet(isPresented: $showAccount) { AccountHostView() }
        #endif
        .sheet(isPresented: $showSettings) {
            SettingsView(databaseURL: openedVideoDatabase?.url, pageCount: pages.count, onVacuumDatabase: nil, onClearCache: nil)
                .environment(\.colorScheme, colorScheme)
                .preferredColorScheme(colorScheme)
                #if os(macOS)
                .frame(minWidth: 680, idealWidth: 740, minHeight: 580, idealHeight: 660)
                #endif
        }
        .sheet(isPresented: $showAssistant) {
            AssistantHostView(pages: pages)
                .environment(\.colorScheme, colorScheme)
                .preferredColorScheme(colorScheme)
                #if os(macOS)
                .frame(minWidth: 680, idealWidth: 740, minHeight: 580, idealHeight: 660)
                #endif
        }
        #if WORLDS_MAIN_APP_MODULES
        .sheet(item: $pendingMCPApproval) { approval in
            MCPRenameApprovalView(request: approval) { decision in
                Task {
                    _ = try? await mcpRunner.resolve(decision: decision)
                    pendingMCPApproval = nil
                }
            }
        }
        #endif
        .sheet(isPresented: $showCreateSheet) {
            CreateWorkspaceItemSheet(
                onSelectFormat: { format in openCreateFormat(format) },
                onBrowseTemplates: {
                    selectedID = nil
                    phoneDetailPageID = nil
                    destination = .library
                    libraryCollection = .templates
                }
            )
            .environment(\.colorScheme, colorScheme)
            .preferredColorScheme(colorScheme)
        }
        #if os(macOS)
        .overlay(alignment: .bottomTrailing) {
            if !isLegacyFixtureRun && hotCorners.showingQuickNote {
                HotCornerQuickNoteHUD(coordinator: hotCorners)
                    .padding(20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onAppear {
            hotCorners.onTriggerAssistant = {
                selectedID = nil
                destination = .ai
                WorldsHaptics.light()
            }
            hotCorners.onTriggerFocus = {
                focusModel.showingPopover.toggle()
                WorldsHaptics.light()
            }
            hotCorners.onSaveQuickNote = { note in
                appendQuickNote(note)
            }
            hotCorners.startMonitoring()
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
        .onChange(of: selectedID) { _, id in
            guard let id, id == selectedID, let copyID = tabCopyID,
                  copyContext?.copy.id == copyID, !loading else { return }
            personalTabs.select(id, eligibleIDs: Set(pages.map(\.id)))
        }
        .onChange(of: personalTabs) { _, _ in savePersonalTabs() }
        #endif
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        .onChange(of: expandedPageIDs) { _, _ in saveHierarchyPreferences() }
        .onChange(of: showPageHierarchy) { _, _ in saveHierarchyPreferences() }
        #endif
        .onChange(of: destination) { _, _ in
            if horizontalSizeClass == .compact {
                phoneDetailPageID = nil
            }
        }
        .tint(WorldsPalette.accent(for: colorScheme))
        #if os(macOS)
        .onReceive(NotificationCenter.default.publisher(for: .worldsOpenOwnWorkspaceAction)) { _ in
            Task { await openDesktopWorkspace() }
        }
        #endif
        .onReceive(NotificationCenter.default.publisher(for: .worldsOpenDatabaseAction)) { _ in
            #if WORLDS_EXPERIMENTAL_LOCAL_COPY
            copyImportSelected = false
            #endif
            showImporter = true
            WorldsHaptics.light()
        }
        .registerNavigationReceivers(
            onHome: {
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .home
                destination = .home
                WorldsHaptics.selection()
            },
            onSpaces: {
                selectedID = nil
                phoneDetailPageID = nil
                destination = .spaces
                WorldsHaptics.selection()
            },
            onLibrary: {
                selectedID = nil
                phoneDetailPageID = nil
                destination = .library
                libraryCollection = .all
                WorldsHaptics.selection()
            },
            onAI: {
                selectedID = nil
                phoneDetailPageID = nil
                destination = .ai
                WorldsHaptics.selection()
            },
            onSearch: {
                selectedID = nil
                phoneDetailPageID = nil
                destination = .search
                WorldsHaptics.selection()
            },
            onTemplates: {
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .templates
                destination = .library
                libraryCollection = .templates
                WorldsHaptics.selection()
            },
            onTrash: {
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .trash
                destination = .library
                libraryCollection = .trash
                WorldsHaptics.selection()
            },
            onSpreadsheets: {
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .spreadsheets
                destination = .library
                libraryCollection = .spreadsheets
                WorldsHaptics.selection()
            },
            onPlanning: {
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .planning
                destination = .spaces
                spacesSection = .projects
                WorldsHaptics.selection()
            },
            onStudy: {
                studyPackEnabled = true
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .study
                destination = .spaces
                spacesSection = .study
                WorldsHaptics.selection()
            },
            onStudio: {
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .studio
                destination = .library
                libraryCollection = .studio
                WorldsHaptics.selection()
            },
            onAssistant: {
                if isLegacyFixtureRun {
                    showAssistant = true
                } else {
                    selectedID = nil
                    phoneDetailPageID = nil
                    destination = .ai
                }
                WorldsHaptics.light()
            },
            onSettings: { showSettings = true; WorldsHaptics.light() },
            onToggleInspector: {
                withAnimation(.easeInOut(duration: 0.2)) { showInspector.toggle() }
                WorldsHaptics.light()
            },
            onOpenCreate: { showCreateSheet = true; WorldsHaptics.light() },
            onQuickNote: {
                #if os(macOS)
                hotCorners.openQuickNote()
                #else
                showCreateSheet = true
                #endif
                WorldsHaptics.light()
            }
        )
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") {
                UserDefaults.standard.set(true, forKey: "worlds_pack_study")
                studyPackEnabled = true
                seedCompleteShowcasePages()
                loaded = true
                loading = false
                errorMessage = nil
                selectedID = nil
                phoneDetailPageID = nil
                selectedSidebarSection = .home
                destination = .home
                return
            }
            #endif
            #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-local-copy-fixture") {
                do {
                    let (importer, source) = try LocalCopyUITestFixture.make()
                    copyCoordinator = importer
                    let copy = try await importer.importCopy(from: source)
                    #if WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
                    if ProcessInfo.processInfo.arguments.contains("--ui-testing-gallery-draft-fixture") {
                        try LocalGalleryDraftFixture.install(in: copy)
                    }
                    #endif
                    await activateCopy(copy)
                    #if WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
                    if ProcessInfo.processInfo.arguments.contains("--ui-testing-gallery-draft-fixture"), copyContext?.copy.id == copy.id {
                        fixtureGalleryCopyID = copy.id
                    }
                    #endif
                    #if WORLDS_EXPERIMENTAL_LOCAL_HISTORY
                    if copyContext?.copy.id == copy.id { fixtureHistoryCopyID = copy.id }
                    #endif
                    if ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") {
                        seedCompleteShowcasePages()
                        selectedID = nil
                        selectedSidebarSection = .home
                    }
                } catch { errorMessage = error.localizedDescription }
                return
            }
            #endif
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-reader-fixture"),
               let fixture = Bundle.main.url(forResource: "reader-ui-fixture", withExtension: "db") {
                await open(fixture)
            } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-search-fixture"),
               let fixture = Bundle.main.url(forResource: "search-ui-fixture", withExtension: "db") {
                await open(fixture)
            } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-fixture"),
               let fixture = Bundle.main.url(forResource: "worlds-v1-fixture", withExtension: "db") {
                await open(fixture)
            } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-missing-fixture") {
                await open(Bundle.main.bundleURL.appendingPathComponent("missing-ui-fixture.db"))
            }
            #endif
        }
        .task(id: searchQuery) { await search() }
        .onChange(of: searchScope) { _, _ in Task { await search() } }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.data]) { result in
            switch result {
            case .success(let url):
                #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                if copyImportSelected { Task { await importLocalCopy(url) } }
                else { Task { await open(url) } }
                #else
                Task { await open(url) }
                #endif
            case .failure(let error):
                errorMessage = error.localizedDescription
            }
        }
        .alert("Could not open database", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private func videoAction(for page: StoredPage) -> (() -> Void)? {
        #if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
        guard page.kind == "file", let source = openedVideoDatabase else { return nil }
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        guard copyContext?.copy.isLocalCopy != true else { return nil }
        #endif
        return { videoRequest = PersonalVideoRequest(id: page.id, source: source) }
        #else
        return nil
        #endif
    }

    private func documentAction(for page: StoredPage) -> (() -> Void)? {
        #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_DOCUMENT
        guard page.kind == "file", let source = openedVideoDatabase else { return nil }
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        guard copyContext?.copy.isLocalCopy != true else { return nil }
        #endif
        return { documentRequest = PersonalDocumentRequest(id: page.id, source: source) }
        #else
        return nil
        #endif
    }

    private func inlineImageAction(for page: StoredPage) -> ((String) -> Void)? {
        #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_DOCUMENT && WORLDS_EXPERIMENTAL_INLINE_IMAGE
        guard ["page", "document"].contains(page.kind), let source = openedVideoDatabase else { return nil }
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        guard copyContext?.copy.isLocalCopy != true else { return nil }
        #endif
        return { blockID in documentRequest = PersonalDocumentRequest(id: page.id, source: source, blockID: blockID) }
        #else
        return nil
        #endif
    }

    private var createPageAction: (() -> Void)? {
        #if WORLDS_EXPERIMENTAL_CREATE_PAGE
        guard let context = copyContext, let source = openedVideoDatabase,
              source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL else { return nil }
        return {
            creatingPage = LocalCreatePageRequest(copy: context.copy, databaseIdentity: source.identity, parentID: nil, generation: databaseGeneration)
        }
        #else
        return nil
        #endif
    }

    private var createDocumentAction: (() -> Void)? {
        #if WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
        guard let context = copyContext, let source = openedVideoDatabase,
              source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL else { return nil }
        return {
            creatingDocument = LocalCreateDocumentRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
        }
        #else
        return nil
        #endif
    }

    private var createDrawingAction: (() -> Void)? {
        #if WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        guard let context = copyContext, let source = openedVideoDatabase,
              source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL else { return nil }
        return {
            creatingDrawing = LocalCreateDrawingRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
        }
        #else
        return nil
        #endif
    }

    private var createProjectAction: (() -> Void)? {
        #if WORLDS_EXPERIMENTAL_CREATE_PROJECT
        guard let context = copyContext, let source = openedVideoDatabase,
              source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL else { return nil }
        return {
            creatingProject = LocalCreateProjectRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
        }
        #else
        return nil
        #endif
    }

    private var createPresentationAction: (() -> Void)? {
        #if WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        guard let context = copyContext, let source = openedVideoDatabase,
              source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL else { return nil }
        return {
            creatingPresentation = LocalCreatePresentationRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
        }
        #else
        return nil
        #endif
    }

    static func makeShowcasePages() -> [StoredPage] {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let showcaseItems: [(id: String, title: String, kind: String, preview: String)] = [
            ("showcase-sheet-q4", "Financial Budget & Cashflow 2026", "spreadsheet", "Multi-sheet Excel workbook · =SUM, =AVERAGE, =VLOOKUP, =PMT"),
            ("showcase-mindmap-arch", "System Architecture & Concept Graph", "drawing", "Interactive Mind Map & Concept Network · 14 connected nodes"),
            ("showcase-okr-roadmap", "Q4 Engineering OKRs & Sprint Plan", "project", "Company KPIs, Sprint Tasks, Weekly Calendar & Print Queue"),
            ("showcase-study-cs301", "CS-301 Algorithms & Graph Theory", "document", "Textbook p.148/420 · YouTube & Telegram Subject Links"),
            ("showcase-cad-turbine", "CAD Turbine Assembly Blueprint (DXF)", "file", "3D & AutoCAD DXF Engineering Viewport · Layer Inspector"),
            ("showcase-slides-deck", "Worlds Native Architecture Deck (16:9)", "presentation", "Liquid Glass Dark Obsidian · 4 Visual Slides")
        ]
        return showcaseItems.enumerated().map { idx, item in
            StoredPage(
                id: item.id,
                title: item.title,
                kind: item.kind,
                parentID: nil,
                archived: false,
                sortKey: Double(idx),
                createdAt: now - Int64(idx * 3600_000),
                preview: item.preview,
                updatedAt: now - Int64(idx * 1800_000),
                metadataJSON: "{}",
                blocks: []
            )
        }
    }

    private func seedCompleteShowcasePages() {
        if pages.isEmpty {
            pages = Self.makeShowcasePages()
        }
    }

    @ViewBuilder
    private func sectionContentView(_ section: SidebarSection) -> some View {
        switch section {
        case .home:
            HomeView(
                pages: pages,
                openPage: { id in
                    selectedSidebarSection = nil
                    selectedID = id
                },
                onOpenSpaces: {
                    selectedID = nil
                    selectedSidebarSection = .planning
                },
                onOpenLibrary: { col in
                    selectedID = nil
                    switch col {
                    case .spreadsheets: selectedSidebarSection = .spreadsheets
                    case .studio: selectedSidebarSection = .studio
                    case .templates: selectedSidebarSection = .templates
                    case .trash: selectedSidebarSection = .trash
                    default: selectedSidebarSection = nil
                    }
                },
                onOpenCreateSheet: { showCreateSheet = true },
                onCreateFormat: { format in openCreateFormat(format) },
                onOpenAutomations: openAutomationsAction,
                onRequestLocalCopy: requestLocalCopyAction
            )
        case .spreadsheets:
            WorldsSpreadsheetStudioView(metadataJSON: "{}")
        case .planning:
            WorldsPlanningHubView()
        case .study:
            WorldsStudyPackHubView()
        case .studio:
            WorldsCreativeStudioView()
        case .templates:
            TemplatesView { template in
                createPageFromTemplate(template)
            }
        case .trash:
            TrashView(
                pages: pages,
                onRestore: restorePage,
                onDeletePermanently: deletePermanently,
                onEmptyTrash: emptyTrash,
                storeTrash: storeTrashListing,
                permanentDeletionAvailable: permanentDeletionAvailable
            )
        }
    }

    private var workspaceNavigationBar: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 54), spacing: 4)], spacing: 4) {
            navPillButton(
                title: "Pages",
                icon: "doc.text",
                identifier: "open-pages-button",
                isActive: selectedSidebarSection == nil
            ) {
                selectedSidebarSection = nil
            }
            navPillButton(
                title: "Home",
                icon: "house",
                identifier: "open-home-button",
                isActive: selectedSidebarSection == .home && selectedID == nil
            ) {
                selectedID = nil
                selectedSidebarSection = .home
            }
            navPillButton(
                title: "Templates",
                icon: "square.grid.2x2",
                identifier: "open-templates-button",
                isActive: selectedSidebarSection == .templates && selectedID == nil
            ) {
                selectedID = nil
                selectedSidebarSection = .templates
            }
            navPillButton(
                title: "Trash",
                icon: "trash",
                identifier: "open-trash-button",
                isActive: selectedSidebarSection == .trash && selectedID == nil
            ) {
                selectedID = nil
                selectedSidebarSection = .trash
            }
            navPillButton(
                title: "Sheets",
                icon: "tablecells.fill",
                identifier: "open-spreadsheets-button",
                isActive: selectedSidebarSection == .spreadsheets && selectedID == nil
            ) {
                selectedID = nil
                selectedSidebarSection = .spreadsheets
            }
            navPillButton(
                title: "Planning",
                icon: "checklist.checked",
                identifier: "open-planning-button",
                isActive: selectedSidebarSection == .planning && selectedID == nil
            ) {
                selectedID = nil
                selectedSidebarSection = .planning
            }
            navPillButton(
                title: "Study",
                icon: "graduationcap.fill",
                identifier: "open-study-button",
                isActive: selectedSidebarSection == .study && selectedID == nil
            ) {
                selectedID = nil
                selectedSidebarSection = .study
            }
            navPillButton(
                title: "Studio",
                icon: "cube.transparent.fill",
                identifier: "open-studio-button",
                isActive: selectedSidebarSection == .studio && selectedID == nil
            ) {
                selectedID = nil
                selectedSidebarSection = .studio
            }
            navPillButton(
                title: "AI",
                icon: "sparkles",
                identifier: "open-assistant-button",
                isActive: showAssistant
            ) {
                showAssistant = true
            }
            #if WORLDS_EXPERIMENTAL_ACCOUNT
            navPillButton(
                title: "Account",
                icon: "person.crop.circle",
                identifier: "open-account-button",
                isActive: showAccount
            ) {
                showAccount = true
            }
            #endif
            navPillButton(
                title: "Settings",
                icon: "gearshape",
                identifier: "open-settings-button",
                isActive: showSettings
            ) {
                showSettings = true
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(colorScheme == .dark ? WorldsPalette.darkSidebar : WorldsPalette.surface(for: colorScheme))
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    private func navPillButton(title: String, icon: String, identifier: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                Text(title)
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isActive ? WorldsPalette.accent(for: colorScheme) : .primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .padding(.horizontal, 2)
            .background(
                isActive ? WorldsPalette.accent(for: colorScheme).opacity(0.18) : Color.primary.opacity(0.001),
                in: RoundedRectangle(cornerRadius: 8)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
        .disabled(databaseActionsDisabled)
    }

    private var openAutomationsAction: (() -> Void)? {
        #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_AUTOMATIONS
        // Automation runs stay in a local copy; the desktop runs the real ones.
        guard let context = copyContext, context.copy.isLocalCopy, let source = openedVideoDatabase,
              source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL else { return nil }
        return {
            automationsRequest = LocalAutomationsRequest(context: context, identity: source.identity)
        }
        #else
        return nil
        #endif
    }

    private func createPageFromTemplate(_ template: WorkspaceTemplate) {
        #if WORLDS_EXPERIMENTAL_CREATE_PAGE
        if let context = copyContext, let source = openedVideoDatabase,
           source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
            creatingPage = LocalCreatePageRequest(
                copy: context.copy,
                databaseIdentity: source.identity,
                parentID: nil,
                generation: databaseGeneration,
                initialTitle: template.title
            )
            return
        }
        #endif
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        showCopyExplanation = true
        #endif
    }

    private func restorePage(_ id: String) {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        if let context = copyContext, context.copy.usesStoreTrash {
            guard let entry = storeTrash.first(where: { $0.id == id }) else { return }
            let generation = databaseGeneration
            Task { await restoreInWorkspace(entry: entry, context: context, generation: generation) }
            return
        }
        #endif
        guard let index = pages.firstIndex(where: { $0.id == id }) else { return }
        let current = pages[index]
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        if let context = copyContext {
            persistTrashMutation(in: context.copy.databaseURL, sql: "UPDATE pages SET archived=0, updated_at=\(now) WHERE id=?;", id: id)
        }
        #endif
        pages[index] = StoredPage(
            id: current.id,
            title: current.title,
            kind: current.kind,
            parentID: current.parentID,
            archived: false,
            sortKey: current.sortKey,
            createdAt: current.createdAt,
            preview: current.preview,
            updatedAt: now,
            metadataJSON: current.metadataJSON,
            blocks: current.blocks
        )
    }

    private func deletePermanently(_ id: String) {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        // The own workspace has no checked permanent deletion; never run raw SQL on it.
        if let context = copyContext, !context.copy.supportsPermanentDeletion { return }
        if let context = copyContext {
            persistTrashMutation(in: context.copy.databaseURL, sql: "DELETE FROM pages WHERE id=?;", id: id)
        }
        #endif
        pages.removeAll(where: { $0.id == id })
    }

    private func emptyTrash() {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        if let context = copyContext, !context.copy.supportsPermanentDeletion { return }
        if let context = copyContext {
            persistTrashMutation(in: context.copy.databaseURL, sql: "DELETE FROM pages WHERE archived=1;", id: nil)
        }
        #endif
        pages.removeAll(where: { $0.archived })
    }

    private func persistTrashMutation(in databaseURL: URL, sql: String, id: String?) {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        // Raw SQL bypasses history and indexes, so it is kept to an independent copy.
        guard let context = copyContext, context.copy.isLocalCopy,
              context.copy.databaseURL.standardizedFileURL == databaseURL.standardizedFileURL else { return }
        #endif
        var db: OpaquePointer?
        guard sqlite3_open_v2(databaseURL.path, &db, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let connection = db else {
            if let db { sqlite3_close(db) }
            return
        }
        defer { sqlite3_close(connection) }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(connection, sql, -1, &stmt, nil) == SQLITE_OK, let statement = stmt else { return }
        defer { sqlite3_finalize(statement) }
        if let id {
            _ = id.withCString { cStr in
                sqlite3_bind_text(statement, 1, cStr, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
            }
        }
        _ = sqlite3_step(statement)
    }

    /// Edits save to the opened workspace itself rather than a local copy.
    private var editsOwnWorkspace: Bool {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        copyContext.map { !$0.copy.isLocalCopy } ?? false
        #else
        false
        #endif
    }

    private func projectEditingAvailable(for page: StoredPage) -> Bool {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        page.kind == "project" && copyContext != nil
        #else
        false
        #endif
    }

    private func otherResourceEditingAvailable(for page: StoredPage) -> Bool {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        guard let context = copyContext else { return false }
        #if WORLDS_EXPERIMENTAL_STREAM_EDITOR
        if page.kind == "stream" { return true }
        #endif
        #if WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
        if page.kind == "spreadsheet" { return true }
        #endif
        #if WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        if page.kind == "presentation" { return true }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
        if page.kind == "gallery" && context.copy.supportsGalleryFileImport { return true }
        #endif
        _ = context
        #endif
        return false
    }

    private var databaseActionsDisabled: Bool {
        var disabled = loading
        #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
        disabled = disabled || historyRequest != nil
        #endif
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        disabled = disabled || editingProject != nil
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
        disabled = disabled || galleryDraftRequest != nil
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        disabled = disabled || creatingDrawing != nil
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_STREAM
        disabled = disabled || creatingStream != nil
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_GALLERY
        disabled = disabled || creatingGallery != nil
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        disabled = disabled || creatingPresentation != nil
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_PROJECT
        disabled = disabled || creatingProject != nil
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
        disabled = disabled || creatingDocument != nil
        #endif
        #if WORLDS_EXPERIMENTAL_MOVE_PAGE
        disabled = disabled || movingPage != nil
        #endif
        #if WORLDS_EXPERIMENTAL_RENAME_PAGE
        disabled = disabled || renamingPage != nil
        #endif
        #if WORLDS_EXPERIMENTAL_CREATE_PAGE
        disabled = disabled || creatingPage != nil
        #endif
        #if WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        disabled = disabled || editingDrawing != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
        disabled = disabled || automationsRequest != nil
        #endif
        #if WORLDS_EXPERIMENTAL_STREAM_EDITOR
        disabled = disabled || editingStream != nil
        #endif
        #if WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
        disabled = disabled || editingSpreadsheet != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
        disabled = disabled || importingGallery != nil
        #endif
        #if WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        disabled = disabled || editingPresentation != nil
        #endif
        #if WORLDS_EXPERIMENTAL_PAGE_EDITOR
        disabled = disabled || editingPage != nil
        #endif
        #endif
        #if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
        disabled = disabled || videoRequest != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_DOCUMENT
        disabled = disabled || documentRequest != nil
        #endif
        return disabled
    }

    private var sidebarSelection: Binding<String?> {
        Binding(get: { selectedID }, set: { newSelection in
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-fixture") || ProcessInfo.processInfo.arguments.contains("--ui-testing-local-copy-fixture") {
                print("[Worlds fixture navigation] selection \(selectedID ?? "nil") -> \(newSelection ?? "nil")")
            }
            #endif
            // SwiftUI can write the current selection back while updating a
            // split view. Preserve link history unless selection really changed.
            guard selectedID != newSelection else { return }
            if newSelection != nil {
                selectedSidebarSection = nil
            }
            selectedID = newSelection
            returnStack.removeAll()
        })
    }

    private var pageList: some View {
        Group {
            if showPageHierarchy {
                let rows = PersonalPageHierarchy.rows(pages: pages, expanded: expandedPageIDs)
                if rows.isEmpty {
                    ContentUnavailableView("No pages in hierarchy", systemImage: "list.bullet.indent", description: Text("Archived pages and templates remain available in all pages."))
                } else {
                  List(selection: sidebarSelection) {
                    ForEach(rows) { row in
                        HStack(spacing: 8) {
                            if row.hasChildren {
                                Button {
                                    if row.isExpanded { expandedPageIDs.remove(row.id) }
                                    else { expandedPageIDs.insert(row.id) }
                                } label: {
                                    Image(systemName: row.isExpanded ? "chevron.down" : "chevron.forward")
                                        .frame(width: 24, height: 32)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("\(row.isExpanded ? "Collapse" : "Expand") \(row.page.title.isEmpty ? "Untitled" : row.page.title)")
                                .accessibilityIdentifier("expand-page.\(row.id)")
                            } else {
                                Color.clear.frame(width: 24, height: 1).accessibilityHidden(true)
                            }
                            NavigationLink(value: row.id) {
                                PageListRow(page: row.page, parentTitle: row.detached ? "Parent unavailable" : nil)
                            }
                            #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
                            .contextMenu {
                                if tabCopyID != nil {
                                    Button("Open in new tab") { openPersonalTab(row.id) }
                                }
                            }
                            #endif
                            .accessibilityIdentifier("page.\(row.id)")
                            .accessibilityHint("Opens page")
                        }
                        .padding(.leading, CGFloat(row.depth) * 12)
                        .tag(row.id)
                    }
                  }
                }
            } else {
                List(pages, selection: sidebarSelection) { page in
                    NavigationLink(value: page.id) {
                        PageListRow(page: page, parentTitle: parentTitle(for: page))
                    }
                    #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
                    .contextMenu {
                        if tabCopyID != nil {
                            Button("Open in new tab") { openPersonalTab(page.id) }
                        }
                    }
                    #endif
                    .accessibilityIdentifier("page.\(page.id)")
                    .accessibilityHint("Opens page")
                }
            }
        }
        .contentMargins(.bottom, dynamicTypeSize.isAccessibilitySize ? 24 : 8, for: .scrollContent)
        .accessibilityIdentifier("personal-page-list")
        .onAppear {
            if showPageHierarchy, let selectedID {
                expandedPageIDs.formUnion(PersonalPageHierarchy.expandedAncestors(of: selectedID, pages: pages))
            }
        }
        .onChange(of: selectedID) { _, selected in
            if showPageHierarchy, let selected {
                expandedPageIDs.formUnion(PersonalPageHierarchy.expandedAncestors(of: selected, pages: pages))
            }
        }
    }

    private func parentTitle(for page: StoredPage) -> String? {
        guard let parentID = page.parentID,
              let title = pages.first(where: { $0.id == parentID })?.title,
              !title.isEmpty else { return nil }
        return title
    }

    private var searchResults: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Search type", selection: $searchScope) {
                ForEach(WorldsSearchScope.allCases, id: \.self) { scope in Text(scope.label).tag(scope) }
            }.pickerStyle(.menu).accessibilityIdentifier("search-scope")
                .padding(.horizontal, 12)
            Group {
            if let searchError {
                ContentUnavailableView("Search unavailable", systemImage: "exclamationmark.magnifyingglass", description: Text(searchError))
            } else if searching || searchedScope != searchScope || searchedQuery != searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) {
                ProgressView("Searching")
            } else if searchHits.isEmpty {
                ContentUnavailableView.search(text: searchQuery)
                    .accessibilityIdentifier("search-empty")
            } else {
                List(searchHits, selection: sidebarSelection) { hit in
                    NavigationLink(value: hit.pageId) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(hit.title.isEmpty ? "Untitled" : hit.title)
                                .font(.body.weight(.medium))
                            if hit.kind == "template" {
                                Text("Template · View only").font(.caption).foregroundStyle(.secondary)
                                    .accessibilityIdentifier("search-template-kind")
                            }
                            if !hit.snippet.isEmpty {
                                Text(highlightedSnippet(hit))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }
                            if let parent = hit.parentTitle, !parent.isEmpty {
                                Text(parent).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                    .accessibilityIdentifier("search-result.\(hit.pageId)")
                    #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
                    .contextMenu {
                        if tabCopyID != nil, pages.contains(where: { $0.id == hit.pageId }) {
                            Button("Open in new tab") { openPersonalTab(hit.pageId) }
                        }
                    }
                    #endif
                    .accessibilityLabel(searchAccessibilityLabel(hit))
                    .accessibilityHint("Opens page")
                }
            }
            }
        }
    }

    private func searchAccessibilityLabel(_ hit: WorldsSearchHit) -> String {
        var parts = [hit.title.isEmpty ? "Untitled" : hit.title]
        if hit.kind == "template" { parts.append("Template · View only") }
        let snippet = hit.snippetRuns.map(\.text).joined()
        if !snippet.isEmpty { parts.append(snippet) }
        if let parent = hit.parentTitle, !parent.isEmpty { parts.append(parent) }
        return parts.joined(separator: ", ")
    }

    private func highlightedSnippet(_ hit: WorldsSearchHit) -> AttributedString {
        var result = AttributedString()
        for run in hit.snippetRuns {
            var text = AttributedString(run.text)
            if run.highlighted { text.inlinePresentationIntent = .stronglyEmphasized }
            result.append(text)
        }
        return result
    }

    @MainActor
    private func search() async {
        let request = UUID()
        searchRequest = request
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            searchHits = []
            searchedQuery = nil
            searchedScope = nil
            searching = false
            return
        }
        guard let searchEngine else {
            if loaded && searchError == nil { searchError = "Open a database to search." }
            return
        }
        let generation = databaseGeneration
        let scope = searchScope
        searching = true
        searchError = nil
        do {
            try await Task.sleep(for: .milliseconds(250))
            let results = try await searchEngine.search(query, scope: scope)
            guard !Task.isCancelled, request == searchRequest, generation == databaseGeneration,
                  query == searchQuery.trimmingCharacters(in: .whitespacesAndNewlines), scope == searchScope else { return }
            let allowed = Set(pages.map(\.id))
            searchHits = results.filter { allowed.contains($0.pageId) }
            searchedQuery = query
            searchedScope = scope
            searchError = nil
            searching = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, request == searchRequest, generation == databaseGeneration,
                  query == searchQuery.trimmingCharacters(in: .whitespacesAndNewlines), scope == searchScope else { return }
            searchHits = []
            searchError = error.localizedDescription
            searching = false
        }
    }

    #if os(macOS)
    /// Opens the database the Worlds desktop app keeps on this Mac
    /// (~/Library/Application Support/Worlds/worlds.db). Whether it can be
    /// edited in place is decided by the same preflight as any other database.
    @MainActor private func openDesktopWorkspace() async {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
        let url = support.appendingPathComponent("Worlds", isDirectory: true).appendingPathComponent("worlds.db")
        guard FileManager.default.fileExists(atPath: url.path) else {
            errorMessage = String(localized: "No Worlds desktop workspace was found on this Mac. Open the Worlds desktop app once, or choose Open Database.")
            return
        }
        await open(url)
    }
    #endif

    @discardableResult
    @MainActor
    private func open(_ url: URL, preserveLocalCopy: Bool = false) async -> Bool {
        let request = UUID()
        openRequest = request
        loading = true
        defer { if openRequest == request { loading = false } }
        let hasAccess = url.startAccessingSecurityScopedResource()
        defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let identityBefore = VideoDatabaseIdentity.read(url)
            let database = try WorldsDatabase(url: url)
            let snapshot = try await database.snapshot()
            #if WORLDS_EXPERIMENTAL_LOCAL_COPY
            // The opened workspace is written in place only when its location
            // and schema pass the preflight. A local copy keeps its own target.
            var ownTarget: WorkspaceWriteTarget?
            var readOnly: WorkspaceWriteAccess.Reason?
            var trash: [StoredTrashedPage] = []
            if !preserveLocalCopy, !Self.isInsideAppBundle(url) {
                let access = await Task.detached(priority: .userInitiated) { WorkspaceWritePreflight.evaluate(url) }.value
                ownTarget = WorkspaceWriteTarget.route(openedDatabase: url, access: access, activeCopy: nil, bundleURL: Bundle.main.bundleURL)
                if case .readOnly(let reason) = access { readOnly = reason }
                if ownTarget != nil { trash = (try? await database.trashedPages()) ?? [] }
            }
            #endif
            guard openRequest == request else { return false }
            let identityAfter = VideoDatabaseIdentity.read(url)
            let videoSource: VideoDatabaseSource?
            if let identityBefore, identityAfter == identityBefore {
                videoSource = VideoDatabaseSource(url: url, identity: identityBefore)
            } else { videoSource = nil }
            do {
                searchEngine = try WorldsSearch(url: url)
                searchError = nil
            } catch {
                searchEngine = nil
                searchError = error.localizedDescription
            }
            databaseGeneration = UUID()
            #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
            localHistoryDatabase = preserveLocalCopy ? database : nil
            #endif
            searchRequest = UUID()
            openedVideoDatabase = videoSource
            searchQuery = ""
            searchHits = []
            searchedQuery = nil
            pages = snapshot.pages
            #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_PERSONAL_TABS
            tabCopyID = nil
            personalTabs = PersonalTabSession(eligibleIDs: [])
            #endif
            #if WORLDS_EXPERIMENTAL_LOCAL_COPY
            hierarchyCopyID = nil
            #endif
            expandedPageIDs = []
            showPageHierarchy = false
            selectedID = nil
            returnStack.removeAll()
            loaded = true
            #if WORLDS_EXPERIMENTAL_LOCAL_COPY
            readOnlyReason = readOnly
            storeTrash = trash
            if !preserveLocalCopy {
                copyContext = nil
                if let ownTarget {
                    do { copyContext = try LocalCopyContext(target: ownTarget) }
                    catch { readOnlyReason = .unavailable }
                }
            }
            #endif
            return true
        } catch {
            guard openRequest == request else { return false }
            errorMessage = error.localizedDescription
            return false
        }
    }

    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    /// Bundled databases are test fixtures and are never written in place.
    private static func isInsideAppBundle(_ url: URL) -> Bool {
        let bundle = Bundle.main.bundleURL.standardizedFileURL.path
        return url.standardizedFileURL.path.hasPrefix(bundle.hasSuffix("/") ? bundle : bundle + "/")
    }

    private var projectLinkEditingEnabled: Bool {
        #if WORLDS_EXPERIMENTAL_PROJECT_LINKS
        true
        #else
        false
        #endif
    }
    private func projectLinkCandidates() -> [ProjectLinkCandidate] {
        pages.map { page in
            ProjectLinkCandidate(id: page.id, title: page.title, kind: page.kind, parentID: page.parentID,
                                 archived: page.archived, sortKey: page.sortKey, createdAt: page.createdAt, updatedAt: page.updatedAt)
        }
    }
    @MainActor private func coordinator() throws -> LocalProjectImportCoordinator {
        if let copyCoordinator { return copyCoordinator }
        let created = try LocalProjectImportCoordinator(backup: NativeSQLiteBackup())
        copyCoordinator = created
        return created
    }
    @MainActor private func openCopyPicker() {
        do { _ = try coordinator(); showLocalCopies = true }
        catch { errorMessage = error.localizedDescription }
    }
    @MainActor private func importLocalCopy(_ url: URL) async {
        loading = true
        do {
            let copy = try await coordinator().importCopy(from: url)
            loading = false
            await activateCopy(copy)
        } catch { loading = false; errorMessage = localCopyErrorMessage(error) }
    }
    @MainActor private func activateCopy(_ copy: LocalProjectCopy) async {
        do {
            let context = try LocalCopyContext(copy: copy)
            if await open(copy.databaseURL, preserveLocalCopy: true) {
                copyContext = context
                let stored = hierarchyPreferences.load(copyID: copy.id, eligibleIDs: hierarchyEligibleIDs)
                hierarchyCopyID = copy.id
                expandedPageIDs = stored.expanded
                showPageHierarchy = stored.enabled
                #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_TABS
                tabCopyID = copy.id
                personalTabs = tabPreferences.load(copyID: copy.id, eligibleIDs: Set(pages.map(\.id)))
                selectedID = personalTabs.activeID
                #endif
            }
        } catch { errorMessage = error.localizedDescription }
    }
    private var hierarchyEligibleIDs: Set<String> {
        Set(pages.filter { !$0.archived && $0.kind != "template" }.map(\.id))
    }
    private func saveHierarchyPreferences() {
        guard let id = hierarchyCopyID, copyContext?.copy.id == id, !loading else { return }
        hierarchyPreferences.save(PersonalHierarchyState(enabled: showPageHierarchy, expanded: expandedPageIDs), copyID: id, eligibleIDs: hierarchyEligibleIDs)
    }
    #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_TABS
    private func savePersonalTabs() {
        guard let id = tabCopyID, copyContext?.copy.id == id, !loading else { return }
        tabPreferences.save(personalTabs, copyID: id, eligibleIDs: Set(pages.map(\.id)))
    }
    private func openPersonalTab(_ id: String) {
        guard let copyID = tabCopyID, copyContext?.copy.id == copyID, !databaseActionsDisabled else { return }
        let previous = personalTabs.activeID
        guard personalTabs.openTab(id, eligibleIDs: Set(pages.map(\.id))) else {
            errorMessage = "This page cannot be opened in a tab, or the 20-tab limit was reached."
            return
        }
        if personalTabs.activeID != previous { returnStack.removeAll() }
        selectedID = personalTabs.activeID
    }
    private func selectPersonalTab(_ id: String) {
        guard let copyID = tabCopyID, copyContext?.copy.id == copyID, !databaseActionsDisabled,
              personalTabs.pageIDs.contains(id), pages.contains(where: { $0.id == id }) else { return }
        let previous = personalTabs.activeID
        personalTabs.select(id, eligibleIDs: Set(pages.map(\.id)))
        if personalTabs.activeID != previous { returnStack.removeAll() }
        selectedID = personalTabs.activeID
    }
    private func closePersonalTab(_ id: String) {
        guard let copyID = tabCopyID, copyContext?.copy.id == copyID, !databaseActionsDisabled else { return }
        let previous = personalTabs.activeID
        personalTabs.close(id)
        if personalTabs.activeID != previous {
            returnStack.removeAll()
            selectedID = personalTabs.activeID
        }
    }
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_PAGE
    @MainActor private func showCreatedPage(_ id: String, request: LocalCreatePageRequest) async -> Bool {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { return false }
        do {
            let database = try WorldsDatabase(url: request.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
                  VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  snapshot.pages.contains(where: { $0.id == id && $0.kind == "page" && $0.parentID == request.parentID }) else { return false }
            pages = snapshot.pages
            returnStack.removeAll()
            selectedID = id
            return true
        } catch { return false }
    }
    #endif
    #if WORLDS_EXPERIMENTAL_RENAME_PAGE
    @MainActor private func savePageName(request: LocalRenamePageRequest, baseline: LocalPageNameRevision, title: String, operationID: UUID) async throws -> LocalPageNameRevision {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { throw NativeWriteError.invalidResponse }
        let store = try NativePersonalStore(url: request.copy.databaseURL)
        let result = try await store.renamePageChecked(id: request.pageID, base: baseline.revision, expectedTitle: baseline.title, title: title, operationID: operationID)
        guard case .object(let values) = result, case .string(let savedID)? = values["id"], savedID == request.pageID,
              case .string(let savedTitle)? = values["title"], savedTitle.utf8.elementsEqual(title.utf8),
              case .integer(let savedRevision)? = values["updatedAt"],
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { throw NativeWriteError.invalidResponse }
        let database = try WorldsDatabase(url: request.copy.databaseURL)
        let snapshot = try await database.snapshot()
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
              let page = snapshot.pages.first(where: { $0.id == request.pageID }),
              page.title.utf8.elementsEqual(savedTitle.utf8), page.updatedAt == savedRevision else { throw NativeWriteError.invalidResponse }
        pages = snapshot.pages
        return LocalPageNameRevision(title: page.title, revision: page.updatedAt)
    }
    #endif
    #if WORLDS_EXPERIMENTAL_MOVE_PAGE
    @MainActor private func movePersonalPage(request: LocalMovePageRequest, baseline: LocalPagePlacement, destination: String?, operationID: UUID) async throws -> LocalPagePlacement {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { throw NativeWriteError.invalidResponse }
        let destinationRevision: Int64?
        if let destination {
            guard let candidate = request.candidates.first(where: { $0.id == destination }) else { throw NativeWriteError.invalidResponse }
            destinationRevision = candidate.updatedAt
        } else { destinationRevision = nil }
        let store = try NativePersonalStore(url: request.copy.databaseURL)
        let result = try await store.movePageChecked(id: request.pageID, base: baseline.revision, expectedParent: baseline.parent, expectedSort: baseline.sortKey, destination: destination, destinationRevision: destinationRevision, operationID: operationID)
        guard case .object(let fields) = result, case .string(let resultID)? = fields["id"], resultID == request.pageID,
              case .integer(let resultRevision)? = fields["updatedAt"], resultRevision == baseline.revision,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { throw NativeWriteError.invalidResponse }
        let resultSort: Double
        switch fields["sortKey"] {
        case .integer(let value)?: resultSort = Double(value)
        case .number(let value)?: resultSort = value
        default: throw NativeWriteError.invalidResponse
        }
        guard resultSort.isFinite else { throw NativeWriteError.invalidResponse }
        let database = try WorldsDatabase(url: request.copy.databaseURL)
        let snapshot = try await database.snapshot()
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
              let page = snapshot.pages.first(where: { $0.id == request.pageID }),
              page.parentID == destination, page.updatedAt == resultRevision, page.sortKey == resultSort else { throw NativeWriteError.invalidResponse }
        pages = snapshot.pages
        returnStack.removeAll()
        return LocalPagePlacement(parent: page.parentID, sortKey: page.sortKey, revision: page.updatedAt)
    }
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
    @MainActor private func showCreatedDocument(_ id: String, request: LocalCreateDocumentRequest) async -> Bool {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { return false }
        do {
            let database = try WorldsDatabase(url: request.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
                  VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  snapshot.pages.contains(where: { $0.id == id && $0.kind == "document" && $0.parentID == nil }) else { return false }
            pages = snapshot.pages
            returnStack.removeAll()
            selectedID = id
            return true
        } catch { return false }
    }
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_PROJECT
    @MainActor private func showCreatedProject(_ id: String, request: LocalCreateProjectRequest) async -> Bool {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { return false }
        do {
            let database = try WorldsDatabase(url: request.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
                  VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  snapshot.pages.contains(where: { $0.id == id && $0.kind == "project" && $0.parentID == nil }) else { return false }
            pages = snapshot.pages
            returnStack.removeAll()
            selectedID = id
            return true
        } catch { return false }
    }
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
    @MainActor private func showCreatedPresentation(_ id: String, request: LocalCreatePresentationRequest) async -> Bool {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { return false }
        do {
            let database = try WorldsDatabase(url: request.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
                  VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  let presentation = snapshot.pages.first(where: { $0.id == id && $0.kind == "presentation" && $0.parentID == nil }),
                  presentation.blocks.contains(where: { $0.type == "slide" }) else { return false }
            pages = snapshot.pages
            returnStack.removeAll()
            selectedID = id
            return true
        } catch { return false }
    }
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_GALLERY
    @MainActor private func showCreatedGallery(_ id: String, request: LocalCreateGalleryRequest) async -> Bool {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { return false }
        do {
            let database = try WorldsDatabase(url: request.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
                  VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  snapshot.pages.contains(where: { $0.id == id && $0.kind == "gallery" && $0.parentID == nil }) else { return false }
            pages = snapshot.pages
            returnStack.removeAll()
            selectedID = id
            return true
        } catch { return false }
    }
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_STREAM
    @MainActor private func showCreatedStream(_ id: String, link: String, request: LocalCreateStreamRequest) async -> Bool {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { return false }
        do {
            let database = try WorldsDatabase(url: request.copy.databaseURL)
            let snapshot = try await database.snapshot()
            let format = worldsStreamFormat(link)
            guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
                  VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  let page = snapshot.pages.first(where: { $0.id == id && $0.kind == "stream" && $0.parentID == nil }),
                  let metadata = page.metadataJSON.data(using: .utf8),
                  let object = try JSONSerialization.jsonObject(with: metadata) as? [String: Any],
                  let stream = object["stream"] as? [String: Any], let saved = stream["url"] as? String,
                  let savedFormat = stream["format"] as? String, savedFormat == format,
                  saved.utf8.elementsEqual(link.utf8) else { return false }
            pages = snapshot.pages
            returnStack.removeAll()
            selectedID = id
            return true
        } catch { return false }
    }
    #endif
    #if WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
    @MainActor private func showCreatedDrawing(_ id: String, request: LocalCreateDrawingRequest) async -> Bool {
        guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
              VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity else { return false }
        do {
            let database = try WorldsDatabase(url: request.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == request.copy.id, databaseGeneration == request.generation,
                  VideoDatabaseIdentity.read(request.copy.databaseURL) == request.databaseIdentity,
                  snapshot.pages.contains(where: { $0.id == id && $0.kind == "drawing" && $0.parentID == nil }) else { return false }
            pages = snapshot.pages
            returnStack.removeAll()
            selectedID = id
            return true
        } catch { return false }
    }
    #endif
    @MainActor private func trashInWorkspace(page: StoredPage, context: LocalCopyContext, generation: UUID) async {
        guard copyContext?.copy.id == context.copy.id, databaseGeneration == generation else { return }
        do {
            let store = try NativePersonalStore(url: context.copy.databaseURL)
            try await store.trashPage(id: page.id, base: page.updatedAt)
            if selectedID == page.id { selectedID = nil }
            if phoneDetailPageID == page.id { phoneDetailPageID = nil }
        } catch NativeWriteError.conflict {
            trashFailure = String(localized: "This page changed elsewhere. Look at the latest version, then try again.")
        } catch {
            trashFailure = String(localized: "This page could not be moved to Trash. Pages with shared subpages stay where they are.")
        }
        await refreshCopy(id: context.copy.id, generation: generation)
    }

    @MainActor private func restoreInWorkspace(entry: StoredTrashedPage, context: LocalCopyContext, generation: UUID) async {
        guard copyContext?.copy.id == context.copy.id, databaseGeneration == generation else { return }
        do {
            let store = try NativePersonalStore(url: context.copy.databaseURL)
            _ = try await store.restorePage(id: entry.id, base: entry.page.updatedAt, deletedAt: entry.deletedAt)
        } catch NativeWriteError.conflict {
            trashFailure = String(localized: "This page changed in Trash. The list is now up to date; try again.")
        } catch {
            trashFailure = String(localized: "This page could not be restored.")
        }
        await refreshCopy(id: context.copy.id, generation: generation)
    }

    @MainActor private func refreshCopy(id: UUID, generation: UUID) async {
        guard let current = copyContext, current.copy.id == id, databaseGeneration == generation else { return }
        do {
            let database = try WorldsDatabase(url: current.copy.databaseURL)
            let snapshot = try await database.snapshot()
            var trash: [StoredTrashedPage] = []
            if current.copy.usesStoreTrash { trash = try await database.trashedPages() }
            guard copyContext?.copy.id == id, databaseGeneration == generation else { return }
            pages = snapshot.pages
            storeTrash = trash
            expandedPageIDs.formIntersection(Set(pages.filter { !$0.archived && $0.kind != "template" }.map(\.id)))
            #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_TABS
            // Tabs belong to a local copy; the own workspace keeps its selection.
            if tabCopyID != nil {
                personalTabs.filter(eligibleIDs: Set(pages.map(\.id)))
                if selectedID != personalTabs.activeID { selectedID = personalTabs.activeID }
            }
            #endif
            if let selectedID, !pages.contains(where: { $0.id == selectedID }) { self.selectedID = nil }
            if !searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { await search() }
        } catch {
            guard copyContext?.copy.id == id, databaseGeneration == generation else { return }
            errorMessage = error.localizedDescription
        }
    }
    #endif
}

private struct PageListRow: View {
    let page: StoredPage
    let parentTitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(page.title.isEmpty ? "Untitled" : page.title)
                .font(.body.weight(.medium))
            if let parentTitle {
                Text(parentTitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            if !page.preview.isEmpty {
                Text(page.preview).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}

#if WORLDS_EXPERIMENTAL_LOCAL_COPY
private struct ProjectEditorRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let generation: UUID
    let candidates: [ProjectLinkCandidate]
}
#if WORLDS_EXPERIMENTAL_STREAM_EDITOR
private struct LocalStreamEditorRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let generation: UUID
}
#endif
#if WORLDS_EXPERIMENTAL_SPREADSHEET_EDITOR
private struct LocalSpreadsheetEditorRequest: Identifiable {
    let id: String
    let title: String
    let context: LocalCopyContext
    let generation: UUID
}
#endif
#if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
private struct LocalGalleryImportRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let generation: UUID
}
#endif
#if WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
private struct LocalPresentationEditorRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let generation: UUID
}
#endif
#if WORLDS_EXPERIMENTAL_PAGE_EDITOR
private struct LocalPageEditorRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let generation: UUID
}
#endif
#endif

private struct VideoDatabaseSource {
    let url: URL
    let identity: VideoDatabaseIdentity
}

#if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_DOCUMENT
private struct PersonalDocumentRequest: Identifiable { let id: String; let source: VideoDatabaseSource; var blockID: String? = nil }
#endif

#if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
private struct PersonalVideoRequest: Identifiable { let id: String; let source: VideoDatabaseSource }
#endif

#if WORLDS_EXPERIMENTAL_LOCAL_COPY && DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
private struct LocalAutomationsRequest: Identifiable {
    let id = UUID()
    let context: LocalCopyContext
    let identity: VideoDatabaseIdentity
}
#endif

#if WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
private struct LocalDrawingEditorRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let identity: VideoDatabaseIdentity
    let generation: UUID
}
#endif
