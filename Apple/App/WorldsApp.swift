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
    @State private var showImporter = false
    @State private var loaded = false
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var searchEngine: WorldsSearch?
    @State private var databaseGeneration = UUID()
    @State private var openedVideoDatabase: VideoDatabaseSource?
    #if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
    @State private var videoRequest: PersonalVideoRequest?
    #endif
    @State private var openRequest = UUID()
    @State private var searchQuery = ""
    @State private var searchHits: [WorldsSearchHit] = []
    @State private var searchError: String?
    @State private var searching = false
    @State private var searchedQuery: String?
    #if WORLDS_EXPERIMENTAL_LOCAL_COPY
    @State private var copyContext: LocalCopyContext?
    @State private var copyCoordinator: LocalProjectImportCoordinator?
    @State private var copyImportSelected = false
    @State private var showCopyExplanation = false
    @State private var showLocalCopies = false
    @State private var editingProject: ProjectEditorRequest?
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
                    if ["project", "gallery", "presentation", "file"].contains(page.kind) {
                        ResourceContentView(page: page, pages: pages, projectEditingAvailable: projectEditingAvailable(for: page), openVideo: videoAction(for: page)) { target in
                            guard target != page.id else { return }
                            returnStack.append(page.id)
                            selectedID = target
                        }
                    } else {
                        PageContentView(page: page)
                    }
                } else {
                    ContentUnavailableView("Select a page", systemImage: "doc.text")
                }
            }
            .toolbar {
                #if WORLDS_EXPERIMENTAL_LOCAL_COPY
                if let id = selectedID, let context = copyContext, pages.contains(where: { $0.id == id && $0.kind == "project" }) {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Edit project", systemImage: "pencil") { editingProject = ProjectEditorRequest(id: id, context: context, generation: databaseGeneration) }
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
        .sheet(item: $editingProject) { request in
            NavigationStack {
                ProjectDraftView(projectID: request.id, repository: request.context.repository) {
                    Task { await refreshCopy(id: request.context.copy.id, generation: request.generation) }
                }
            }
        }
        #endif
        #if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
        .sheet(item: $videoRequest) { request in
            PersonalVideoView(databaseURL: request.source.url, databaseIdentity: request.source.identity, pageID: request.id)
        }
        #endif
        .searchable(text: $searchQuery, placement: .sidebar, prompt: "Search personal pages")
        .tint(WorldsPalette.accent(for: colorScheme))
        .task {
            #if DEBUG && WORLDS_EXPERIMENTAL_LOCAL_COPY
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-local-copy-fixture") {
                do {
                    let (importer, source) = try LocalCopyUITestFixture.make()
                    copyCoordinator = importer
                    let copy = try await importer.importCopy(from: source)
                    await activateCopy(copy)
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

    private func projectEditingAvailable(for page: StoredPage) -> Bool {
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        page.kind == "project" && copyContext != nil
        #else
        false
        #endif
    }

    private var databaseActionsDisabled: Bool {
        var disabled = loading
        #if WORLDS_EXPERIMENTAL_LOCAL_COPY
        disabled = disabled || editingProject != nil
        #endif
        #if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
        disabled = disabled || videoRequest != nil
        #endif
        return disabled
    }

    private var sidebarSelection: Binding<String?> {
        Binding(get: { selectedID }, set: { newSelection in
            // SwiftUI can write the current selection back while updating a
            // split view. Preserve link history unless selection really changed.
            guard selectedID != newSelection else { return }
            selectedID = newSelection
            returnStack.removeAll()
        })
    }

    private var pageList: some View {
        List(pages, selection: sidebarSelection) { page in
            NavigationLink(value: page.id) {
                PageListRow(page: page, parentTitle: parentTitle(for: page))
            }
            .accessibilityIdentifier("page.\(page.id)")
            .accessibilityHint("Opens page")
        }
        .contentMargins(.bottom, dynamicTypeSize.isAccessibilitySize ? 24 : 8, for: .scrollContent)
        .accessibilityIdentifier("personal-page-list")
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
                    .accessibilityHint("Opens page")
                }
            }
        }
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
            guard !Task.isCancelled, generation == databaseGeneration,
                  query == searchQuery.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            let allowed = Set(pages.map(\.id))
            searchHits = results.filter { allowed.contains($0.pageId) }
            searchedQuery = query
            searchError = nil
            searching = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, generation == databaseGeneration,
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
            openedVideoDatabase = videoSource
            searchQuery = ""
            searchHits = []
            searchedQuery = nil
            pages = snapshot.pages
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
            if await open(copy.databaseURL, preserveLocalCopy: true) { copyContext = context }
        } catch { errorMessage = error.localizedDescription }
    }
    @MainActor private func refreshCopy(id: UUID, generation: UUID) async {
        guard let current = copyContext, current.copy.id == id, databaseGeneration == generation else { return }
        do {
            let database = try WorldsDatabase(url: current.copy.databaseURL)
            let snapshot = try await database.snapshot()
            guard copyContext?.copy.id == id, databaseGeneration == generation else { return }
            pages = snapshot.pages
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
}
#endif

private struct VideoDatabaseSource {
    let url: URL
    let identity: VideoDatabaseIdentity
}

#if WORLDS_EXPERIMENTAL_PERSONAL_VIDEO
private struct PersonalVideoRequest: Identifiable { let id: String; let source: VideoDatabaseSource }
#endif
