import SwiftUI
import UniformTypeIdentifiers
import WorldsPersistence
import WorldsSearch
#if WORLDS_EXPERIMENTAL_LOCAL_COPY
import WorldsLocalImport
import WorldsProjectEditingViews
#endif

@main
struct WorldsApp: App {
    #if DEBUG && os(macOS) && WORLDS_UI_WINDOW_DIAGNOSTICS
    @NSApplicationDelegateAdaptor(WindowLifecycleDiagnostics.self) private var windowLifecycleDiagnostics
    #endif
    var body: some Scene {
        #if os(macOS) && DEBUG
        WindowGroup { rootView }
            .defaultSize(width: ProcessInfo.processInfo.arguments.contains("--ui-testing-large-window") ? 1100 : 800,
                         height: ProcessInfo.processInfo.arguments.contains("--ui-testing-large-window") ? 780 : 600)
        #else
        WindowGroup { rootView }
        #endif
    }

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
            .preferredColorScheme(args.contains("--ui-testing-dark") ? .dark : (args.contains("--ui-testing-light") ? .light : nil))
    }
}
#endif

private struct WorldsLibraryView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var pages: [StoredPage] = []
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
    @State private var loaded = false
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
    @State private var searchHits: [WorldsSearchHit] = []
    @State private var searchError: String?
    @State private var searching = false
    @State private var searchedQuery: String?
    @State private var searchRequest = UUID()
    #if WORLDS_EXPERIMENTAL_ACCOUNT
    @State private var showAccount = false
    #endif
    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    @State private var copyContext: LocalCopyContext?
    @State private var copyCoordinator: LocalProjectImportCoordinator?
    @State private var copyImportSelected = false
    @State private var showCopyExplanation = false
    @State private var showLocalCopies = false
    @State private var editingProject: ProjectEditorRequest?
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

    var body: some View {
        NavigationSplitView {
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
                if let selectedPageID = selectedID, let page = pages.first(where: { $0.id == selectedPageID }) {
                    if ["project", "gallery", "presentation", "file", "stream"].contains(page.kind) {
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
                    ContentUnavailableView("Select a page", systemImage: "doc.text")
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
        .task {
            #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-local-copy-fixture") {
                do {
                    let (importer, source) = try LocalCopyUITestFixture.make()
                    copyCoordinator = importer
                    let copy = try await importer.importCopy(from: source)
                    await activateCopy(copy)
                    #if WORLDS_EXPERIMENTAL_LOCAL_HISTORY
                    if copyContext?.copy.id == copy.id { fixtureHistoryCopyID = copy.id }
                    #endif
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
        Group {
            if let searchError {
                ContentUnavailableView("Search unavailable", systemImage: "exclamationmark.magnifyingglass", description: Text(searchError))
            } else if searching || searchedQuery != searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) {
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
            searching = false
            return
        }
        guard let searchEngine else {
            if loaded && searchError == nil { searchError = "Open a database to search." }
            return
        }
        let generation = databaseGeneration
        searching = true
        searchError = nil
        do {
            try await Task.sleep(for: .milliseconds(250))
            let results = try await searchEngine.search(query)
            guard !Task.isCancelled, request == searchRequest, generation == databaseGeneration,
                  query == searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            let allowed = Set(pages.map(\.id))
            searchHits = results.filter { allowed.contains($0.pageId) }
            searchedQuery = query
            searchError = nil
            searching = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, request == searchRequest, generation == databaseGeneration,
                  query == searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
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
