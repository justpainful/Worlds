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
#if DEBUG && WORLDS_EXPERIMENTAL_CREATE_STREAM
import WorldsModels
#endif
#if DEBUG && (WORLDS_EXPERIMENTAL_RENAME_PAGE || WORLDS_EXPERIMENTAL_MOVE_PAGE)
import WorldsNativeWrites
#endif
#endif

extension Notification.Name {
    static let worldsOpenDatabaseAction = Notification.Name("worldsOpenDatabaseAction")
    static let worldsFocusSearchAction = Notification.Name("worldsFocusSearchAction")
    static let worldsNavigateHomeAction = Notification.Name("worldsNavigateHomeAction")
    static let worldsNavigateTemplatesAction = Notification.Name("worldsNavigateTemplatesAction")
    static let worldsNavigateTrashAction = Notification.Name("worldsNavigateTrashAction")
    static let worldsOpenSettingsAction = Notification.Name("worldsOpenSettingsAction")
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
@MainActor final class WorldsAppTestingDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first {
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
        }
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            if let window = NSApp.windows.first {
                window.makeKeyAndOrderFront(nil)
                window.orderFrontRegardless()
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
    var body: some Scene {
        #if os(macOS) && DEBUG
        WindowGroup { rootView }
            .defaultSize(width: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 1320 : (ProcessInfo.processInfo.arguments.contains("--ui-testing-large-window") ? 1100 : 800),
                         height: ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? 860 : (ProcessInfo.processInfo.arguments.contains("--ui-testing-large-window") ? 780 : 600))
            .commands { appCommands }
        #elseif os(macOS)
        WindowGroup { rootView }
            .commands { appCommands }
        #else
        WindowGroup { rootView }
        #endif
    }

    #if os(macOS)
    @CommandsBuilder
    private var appCommands: some Commands {
        SidebarCommands()
        CommandGroup(replacing: .newItem) {
            Button("Open Database…") {
                NotificationCenter.default.post(name: .worldsOpenDatabaseAction, object: nil)
            }
            .keyboardShortcut("o", modifiers: .command)
        }
        CommandGroup(after: .pasteboard) {
            Divider()
            Button("Find in Pages…") {
                NotificationCenter.default.post(name: .worldsFocusSearchAction, object: nil)
            }
            .keyboardShortcut("f", modifiers: .command)
        }
        CommandMenu("Navigate") {
            Button("Home") {
                NotificationCenter.default.post(name: .worldsNavigateHomeAction, object: nil)
            }
            .keyboardShortcut("1", modifiers: [.command, .option])

            Button("Templates") {
                NotificationCenter.default.post(name: .worldsNavigateTemplatesAction, object: nil)
            }
            .keyboardShortcut("2", modifiers: [.command, .option])

            Button("Trash") {
                NotificationCenter.default.post(name: .worldsNavigateTrashAction, object: nil)
            }
            .keyboardShortcut("3", modifiers: [.command, .option])

            Divider()

            Button("Settings…") {
                NotificationCenter.default.post(name: .worldsOpenSettingsAction, object: nil)
            }
            .keyboardShortcut(",", modifiers: .command)
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
    func body(content: Content) -> some View {
        let args = ProcessInfo.processInfo.arguments
        content
            .environment(\.layoutDirection, args.contains("--ui-testing-rtl") ? .rightToLeft : direction)
            .environment(\.dynamicTypeSize, args.contains("--ui-testing-large-text") ? .accessibility3 : textSize)
            .preferredColorScheme((args.contains("--ui-testing-dark") || args.contains("--ui-testing-complete-showcase")) ? .dark : (args.contains("--ui-testing-light") ? .light : nil))
            #if os(macOS)
            .onAppear {
                NSApp.setActivationPolicy(.regular)
                NSApp.activate(ignoringOtherApps: true)
                if args.contains("--ui-testing-dark") || args.contains("--ui-testing-complete-showcase") {
                    NSApp.appearance = NSAppearance(named: .darkAqua)
                }
                DispatchQueue.main.async {
                    if let window = NSApp.windows.first {
                        if args.contains("--ui-testing-complete-showcase") {
                            window.setContentSize(NSSize(width: 1320, height: 860))
                        }
                        window.makeKeyAndOrderFront(nil)
                        window.orderFrontRegardless()
                    }
                }
            }
            #endif
    }
}
#endif

private struct WorldsLibraryView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var pages: [StoredPage] = ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") ? WorldsLibraryView.makeShowcasePages() : []
    @State private var selectedID: String?
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
    @State private var showSettings = false
    @State private var showAssistant = false
    #if WORLDS_MAIN_APP_MODULES
    @State private var pendingMCPApproval: MCPRenameApproval?
    private let mcpRunner = DualMCPToolRunner()
    #endif
    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    @State private var copyContext: LocalCopyContext?
    @State private var copyCoordinator: LocalProjectImportCoordinator?
    @State private var copyImportSelected = false
    @State private var showCopyExplanation = false
    @State private var showLocalCopies = false
    @State private var editingProject: ProjectEditorRequest?
    #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
    @State private var fixtureGalleryCopyID: UUID?
    @State private var galleryDraftRequest: LocalGalleryDraftRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
    @State private var creatingDrawing: LocalCreateDrawingRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_STREAM
    @State private var creatingStream: LocalCreateStreamRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_GALLERY
    @State private var creatingGallery: LocalCreateGalleryRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
    @State private var creatingPresentation: LocalCreatePresentationRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PROJECT
    @State private var creatingProject: LocalCreateProjectRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
    @State private var creatingDocument: LocalCreateDocumentRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_MOVE_PAGE
    @State private var movingPage: LocalMovePageRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_RENAME_PAGE
    @State private var renamingPage: LocalRenamePageRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PAGE
    @State private var creatingPage: LocalCreatePageRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
    @State private var editingDrawing: LocalDrawingEditorRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
    @State private var automationsRequest: LocalAutomationsRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_STREAM_EDITOR
    @State private var editingStream: LocalStreamEditorRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
    @State private var importingGallery: LocalGalleryImportRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
    @State private var editingPresentation: LocalPresentationEditorRequest?
    #endif
    #if DEBUG && WORLDS_EXPERIMENTAL_PAGE_EDITOR
    @State private var editingPage: LocalPageEditorRequest?
    #endif
    #endif

    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
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
            .navigationSplitViewColumnWidth(min: dynamicTypeSize.isAccessibilitySize ? 320 : 240,
                                            ideal: dynamicTypeSize.isAccessibilitySize ? 360 : 280,
                                            max: dynamicTypeSize.isAccessibilitySize ? 440 : 360)
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
                #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New presentation", systemImage: "rectangle.on.rectangle") {
                            creatingPresentation = LocalCreatePresentationRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-presentation").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New drawing", systemImage: "pencil.tip.crop.circle") {
                            creatingDrawing = LocalCreateDrawingRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-drawing").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_STREAM
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New stream", systemImage: "play.rectangle") {
                            creatingStream = LocalCreateStreamRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-stream").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_GALLERY
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New gallery", systemImage: "photo.on.rectangle") {
                            creatingGallery = LocalCreateGalleryRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-gallery").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PROJECT
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New project", systemImage: "folder.badge.plus") {
                            creatingProject = LocalCreateProjectRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-project").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
                if let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem {
                        Button("New document", systemImage: "doc.badge.plus") {
                            creatingDocument = LocalCreateDocumentRequest(copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("new-local-document").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PAGE
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
                if let context = copyContext, let source = openedVideoDatabase,
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
                        ResourceContentView(page: page, pages: pages, projectEditingAvailable: projectEditingAvailable(for: page), otherEditingAvailable: otherResourceEditingAvailable(for: page), openVideo: videoAction(for: page), openDocument: documentAction(for: page)) { target in
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
                            }
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
                #if DEBUG && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
                if let id = selectedID, let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL,
                   pages.contains(where: { $0.id == id && $0.kind == "drawing" }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit drawing", systemImage: "pencil.tip") {
                            editingDrawing = LocalDrawingEditorRequest(id: id, context: context, identity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("edit-local-drawing").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_STREAM_EDITOR
                if let id = selectedID, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "stream" }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit link", systemImage: "link") { editingStream = LocalStreamEditorRequest(id: id, context: context, generation: databaseGeneration) }
                            .disabled(loading)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_DRAFT_FIXTURE
                if selectedID == "gallery-draft-fixture", let context = copyContext,
                   context.copy.id == fixtureGalleryCopyID, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit fixture gallery", systemImage: "pencil") {
                            galleryDraftRequest = LocalGalleryDraftRequest(copy: context.copy, identity: source.identity, generation: databaseGeneration)
                        }.disabled(databaseActionsDisabled).accessibilityIdentifier("edit-fixture-gallery")
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
                if let id = selectedID, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "gallery" }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Import file", systemImage: "square.and.arrow.down") { importingGallery = LocalGalleryImportRequest(id: id, context: context, generation: databaseGeneration) }
                            .disabled(loading)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
                if let id = selectedID, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "presentation" }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit presentation", systemImage: "pencil") { editingPresentation = LocalPresentationEditorRequest(id: id, context: context, generation: databaseGeneration) }
                            .accessibilityIdentifier("edit-local-presentation").disabled(loading)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_MOVE_PAGE
                if let id = selectedID, let page = pages.first(where: { $0.id == id && ($0.kind == "page" || $0.kind == "document") }),
                   let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Move page", systemImage: "folder") {
                            movingPage = LocalMovePageRequest(pageID: id, title: page.title, originalParent: page.parentID, originalSortKey: page.sortKey, originalRevision: page.updatedAt, candidates: pages, copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("move-local-page").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_RENAME_PAGE
                if let id = selectedID, let page = pages.first(where: { $0.id == id && ($0.kind == "page" || $0.kind == "document") }),
                   let context = copyContext, let source = openedVideoDatabase,
                   source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Rename page", systemImage: "pencil.line") {
                            renamingPage = LocalRenamePageRequest(pageID: id, originalTitle: page.title, originalRevision: page.updatedAt, copy: context.copy, databaseIdentity: source.identity, generation: databaseGeneration)
                        }.accessibilityIdentifier("rename-local-page").disabled(databaseActionsDisabled)
                    }
                }
                #endif
                #if DEBUG && WORLDS_EXPERIMENTAL_PAGE_EDITOR
                if let id = selectedID, let context = copyContext, pages.contains(where: { $0.id == id && ($0.kind == "page" || $0.kind == "document") }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit page", systemImage: "pencil") { editingPage = LocalPageEditorRequest(id: id, context: context, generation: databaseGeneration) }
                            .accessibilityIdentifier("edit-local-page").disabled(loading)
                    }
                }
                #endif
                if let id = selectedID, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "project" }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit project", systemImage: "pencil") { editingProject = ProjectEditorRequest(id: id, context: context, generation: databaseGeneration, candidates: projectLinkCandidates()) }
                            .accessibilityIdentifier("edit-local-project")
                            .disabled(loading)
                    }
                }
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
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_HISTORY
        .sheet(item: $historyRequest) { request in
            LocalHistoryView(request: request)
        }
        #endif
        .safeAreaInset(edge: .bottom) {
            if copyContext != nil { LocalCopyNotice() }
        }
        .confirmationDialog("Create an independent local copy?", isPresented: $showCopyExplanation) {
            Button("Choose database") { copyImportSelected = true; showImporter = true }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Changes remain in the copy and do not sync to the original. Attachments are not copied. Shared records may be present but cannot be edited here.")
        }
        .sheet(isPresented: $showLocalCopies) {
            if let copyCoordinator { LocalCopyPicker(coordinator: copyCoordinator) { copy in Task { await activateCopy(copy) } } }
        }
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PAGE
        .sheet(item: $creatingPage) { request in
            LocalCreatePageView(request: request) { id in
                await showCreatedPage(id, request: request)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_RENAME_PAGE
        .sheet(item: $renamingPage) { request in
            LocalRenamePageView(request: request) { baseline, title, operationID in
                try await savePageName(request: request, baseline: baseline, title: title, operationID: operationID)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_MOVE_PAGE
        .sheet(item: $movingPage) { request in
            LocalMovePageView(request: request) { baseline, destination, operationID in
                try await movePersonalPage(request: request, baseline: baseline, destination: destination, operationID: operationID)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
        .sheet(item: $creatingDocument) { request in
            LocalCreateDocumentView(request: request) { id in
                await showCreatedDocument(id, request: request)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PROJECT
        .sheet(item: $creatingProject) { request in
            LocalCreateProjectView(request: request) { id in
                await showCreatedProject(id, request: request)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        .sheet(item: $creatingPresentation) { request in
            LocalCreatePresentationView(request: request) { id in
                await showCreatedPresentation(id, request: request)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_GALLERY
        .sheet(item: $creatingGallery) { request in
            LocalCreateGalleryView(request: request) { id in
                await showCreatedGallery(id, request: request)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_STREAM
        .sheet(item: $creatingStream) { request in
            LocalCreateStreamView(request: request) { id, link in
                await showCreatedStream(id, link: link, request: request)
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
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
        #if DEBUG && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        .sheet(item: $editingDrawing) { request in
            LocalDrawingEditor(databaseURL: request.context.copy.databaseURL, pageID: request.id, identity: request.identity) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
        .sheet(item: $automationsRequest) { request in
            LocalAutomationsView(databaseURL: request.context.copy.databaseURL, identity: request.identity)
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_STREAM_EDITOR
        .sheet(item: $editingStream) { request in
            LocalStreamEditor(copy: request.context.copy, pageID: request.id) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
        .sheet(item: $importingGallery) { request in
            LocalGalleryImportView(copy: request.context.copy, pageID: request.id) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        .sheet(item: $editingPresentation) { request in
            LocalPresentationEditor(databaseURL: request.context.copy.databaseURL, pageID: request.id) {
                Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
            }
        }
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_PAGE_EDITOR
        .sheet(item: $editingPage) { request in
            LocalPageEditorView(databaseURL: request.context.copy.databaseURL, pageID: request.id) {
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
        }
        .sheet(isPresented: $showAssistant) {
            AssistantHostView(pages: pages)
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
        .searchable(text: $searchQuery, placement: .sidebar, prompt: "Search personal pages")
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
        .tint(WorldsPalette.accent(for: colorScheme))
        .onReceive(NotificationCenter.default.publisher(for: .worldsOpenDatabaseAction)) { _ in
            #if WORLDS_EXPERIMENTAL_LOCAL_COPY
            copyImportSelected = false
            #endif
            showImporter = true
            WorldsHaptics.light()
        }
        .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateHomeAction)) { _ in
            selectedID = nil
            selectedSidebarSection = .home
            WorldsHaptics.selection()
        }
        .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateTemplatesAction)) { _ in
            selectedID = nil
            selectedSidebarSection = .templates
            WorldsHaptics.selection()
        }
        .onReceive(NotificationCenter.default.publisher(for: .worldsNavigateTrashAction)) { _ in
            selectedID = nil
            selectedSidebarSection = .trash
            WorldsHaptics.selection()
        }
        .onReceive(NotificationCenter.default.publisher(for: .worldsOpenSettingsAction)) { _ in
            showSettings = true
            WorldsHaptics.light()
        }
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-complete-showcase") {
                UserDefaults.standard.set(true, forKey: "worlds_pack_study")
                seedCompleteShowcasePages()
                loaded = true
                loading = false
                errorMessage = nil
                selectedID = nil
                selectedSidebarSection = .home
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
        guard copyContext == nil else { return nil }
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
        guard copyContext == nil else { return nil }
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
        guard copyContext == nil else { return nil }
        #endif
        return { blockID in documentRequest = PersonalDocumentRequest(id: page.id, source: source, blockID: blockID) }
        #else
        return nil
        #endif
    }

    private var createPageAction: (() -> Void)? {
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PAGE
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
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
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
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
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
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PROJECT
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
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
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
                createPage: createPageAction,
                createDocument: createDocumentAction,
                createDrawing: createDrawingAction,
                createProject: createProjectAction,
                createPresentation: createPresentationAction,
                openAssistant: { showAssistant = true },
                openTemplates: {
                    selectedID = nil
                    selectedSidebarSection = .templates
                },
                openAutomations: openAutomationsAction,
                openSpreadsheets: {
                    selectedID = nil
                    selectedSidebarSection = .spreadsheets
                },
                openPlanning: {
                    selectedID = nil
                    selectedSidebarSection = .planning
                },
                openStudyPack: {
                    selectedID = nil
                    selectedSidebarSection = .study
                },
                openStudio: {
                    selectedID = nil
                    selectedSidebarSection = .studio
                },
                onRequestLocalCopy: {
                    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                    showCopyExplanation = true
                    #endif
                }
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
                onEmptyTrash: emptyTrash
            )
        }
    }

    private var workspaceNavigationBar: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
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
            HStack(spacing: 4) {
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
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial)
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    private func navPillButton(title: String, icon: String, identifier: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .semibold))
                Text(title)
                    .font(.system(size: 9, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(isActive ? WorldsPalette.accent(for: colorScheme) : .primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 5)
            .background(
                isActive ? WorldsPalette.accent(for: colorScheme).opacity(0.16) : Color.clear,
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityIdentifier(identifier)
        .disabled(databaseActionsDisabled)
    }

    private var openAutomationsAction: (() -> Void)? {
        #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY && WORLDS_EXPERIMENTAL_AUTOMATIONS
        guard let context = copyContext, let source = openedVideoDatabase,
              source.url.standardizedFileURL == context.copy.databaseURL.standardizedFileURL else { return nil }
        return {
            automationsRequest = LocalAutomationsRequest(context: context, identity: source.identity)
        }
        #else
        return nil
        #endif
    }

    private func createPageFromTemplate(_ template: WorkspaceTemplate) {
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PAGE
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
        if let context = copyContext {
            persistTrashMutation(in: context.copy.databaseURL, sql: "DELETE FROM pages WHERE id=?;", id: id)
        }
        #endif
        pages.removeAll(where: { $0.id == id })
    }

    private func emptyTrash() {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        if let context = copyContext {
            persistTrashMutation(in: context.copy.databaseURL, sql: "DELETE FROM pages WHERE archived=1;", id: nil)
        }
        #endif
        pages.removeAll(where: { $0.archived })
    }

    private func persistTrashMutation(in databaseURL: URL, sql: String, id: String?) {
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

    private func projectEditingAvailable(for page: StoredPage) -> Bool {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        page.kind == "project" && copyContext != nil
        #else
        false
        #endif
    }

    private func otherResourceEditingAvailable(for page: StoredPage) -> Bool {
        #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
        guard copyContext != nil else { return false }
        #if WORLDS_EXPERIMENTAL_STREAM_EDITOR
        if page.kind == "stream" { return true }
        #endif
        #if WORLDS_EXPERIMENTAL_GALLERY_IMPORT
        if page.kind == "gallery" { return true }
        #endif
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
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        disabled = disabled || creatingDrawing != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_STREAM
        disabled = disabled || creatingStream != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_GALLERY
        disabled = disabled || creatingGallery != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        disabled = disabled || creatingPresentation != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PROJECT
        disabled = disabled || creatingProject != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
        disabled = disabled || creatingDocument != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_MOVE_PAGE
        disabled = disabled || movingPage != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_RENAME_PAGE
        disabled = disabled || renamingPage != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PAGE
        disabled = disabled || creatingPage != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
        disabled = disabled || editingDrawing != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_AUTOMATIONS
        disabled = disabled || automationsRequest != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_STREAM_EDITOR
        disabled = disabled || editingStream != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_GALLERY_IMPORT
        disabled = disabled || importingGallery != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
        disabled = disabled || editingPresentation != nil
        #endif
        #if DEBUG && WORLDS_EXPERIMENTAL_PAGE_EDITOR
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
            if !preserveLocalCopy { copyContext = nil }
            #endif
            return true
        } catch {
            guard openRequest == request else { return false }
            errorMessage = error.localizedDescription
            return false
        }
    }

    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
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
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PAGE
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
    #if DEBUG && WORLDS_EXPERIMENTAL_RENAME_PAGE
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
    #if DEBUG && WORLDS_EXPERIMENTAL_MOVE_PAGE
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
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DOCUMENT
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
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PROJECT
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
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_PRESENTATION && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
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
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_GALLERY
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
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_STREAM
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
    #if DEBUG && WORLDS_EXPERIMENTAL_CREATE_DRAWING && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
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
    @MainActor private func refreshCopy(id: UUID, generation: UUID) async {
        guard let current = copyContext, current.copy.id == id, databaseGeneration == generation else { return }
        do {
            let database = try WorldsDatabase(url: current.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == id, databaseGeneration == generation else { return }
            pages = snapshot.pages
            expandedPageIDs.formIntersection(Set(pages.filter { !$0.archived && $0.kind != "template" }.map(\.id)))
            #if DEBUG && WORLDS_EXPERIMENTAL_PERSONAL_TABS
            personalTabs.filter(eligibleIDs: Set(pages.map(\.id)))
            if selectedID != personalTabs.activeID { selectedID = personalTabs.activeID }
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
#if DEBUG && WORLDS_EXPERIMENTAL_STREAM_EDITOR
private struct LocalStreamEditorRequest: Identifiable {
    let id: String
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
#if DEBUG && WORLDS_EXPERIMENTAL_PRESENTATION_EDITOR
private struct LocalPresentationEditorRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let generation: UUID
}
#endif
#if DEBUG && WORLDS_EXPERIMENTAL_PAGE_EDITOR
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

#if WORLDS_EXPERIMENTAL_LOCAL_COPY && DEBUG && WORLDS_EXPERIMENTAL_DRAWING_EDITOR
private struct LocalDrawingEditorRequest: Identifiable {
    let id: String
    let context: LocalCopyContext
    let identity: VideoDatabaseIdentity
    let generation: UUID
}
#endif
