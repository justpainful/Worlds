import SwiftUI
import UniformTypeIdentifiers
import WorldsPersistence
import WorldsSearch

@main
struct WorldsApp: App {
    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-rtl") {
                WorldsLibraryView().environment(\.layoutDirection, .rightToLeft)
            } else {
                WorldsLibraryView()
            }
            #else
            WorldsLibraryView()
            #endif
        }
    }
}

private struct WorldsLibraryView: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var pages: [StoredPage] = []
    @State private var selectedID: String?
    @State private var showImporter = false
    @State private var loaded = false
    @State private var loading = false
    @State private var errorMessage: String?
    @State private var searchEngine: WorldsSearch?
    @State private var searchQuery = ""
    @State private var searchHits: [WorldsSearchHit] = []
    @State private var searchError: String?
    @State private var searching = false
    @State private var searchedQuery: String?

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
                        Button("Open Database") { showImporter = true }
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
                    List(pages, selection: $selectedID) { page in
                        NavigationLink(value: page.id) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(page.title.isEmpty ? "Untitled" : page.title)
                                    .font(.body.weight(.medium))
                                if let parentID = page.parentID,
                                   let parent = pages.first(where: { $0.id == parentID }), !parent.title.isEmpty {
                                    Text(parent.title)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                if !page.preview.isEmpty {
                                    Text(page.preview)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .accessibilityIdentifier("page.\(page.id)")
                        .accessibilityHint("Opens page")
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 360)
            .navigationTitle("Pages")
            .toolbar {
                ToolbarItem {
                    Button {
                        showImporter = true
                    } label: {
                        Label("Open Database", systemImage: "folder")
                    }
                    .disabled(loading)
                }
            }
        } detail: {
            if let selectedID, let page = pages.first(where: { $0.id == selectedID }) {
                PageContentView(page: page)
            } else {
                ContentUnavailableView("Select a page", systemImage: "doc.text")
            }
        }
        .searchable(text: $searchQuery, placement: .sidebar, prompt: "Search personal pages")
        .tint(WorldsPalette.accent(for: colorScheme))
        .task {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-search-fixture"),
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
                Task { await open(url) }
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
                List(searchHits, selection: $selectedID) { hit in
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
        searching = true
        searchError = nil
        do {
            try await Task.sleep(for: .milliseconds(250))
            let results = try await searchEngine.search(query)
            guard !Task.isCancelled else { return }
            let allowed = Set(pages.map(\.id))
            searchHits = results.filter { allowed.contains($0.pageId) }
            searchedQuery = query
            searchError = nil
            searching = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            searchHits = []
            searchError = error.localizedDescription
            searching = false
        }
    }

    @MainActor
    private func open(_ url: URL) async {
        loading = true
        defer { loading = false }
        let hasAccess = url.startAccessingSecurityScopedResource()
        defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let database = try WorldsDatabase(url: url)
            let snapshot = try await database.snapshot()
            do {
                searchEngine = try WorldsSearch(url: url)
                searchError = nil
            } catch {
                searchEngine = nil
                searchError = error.localizedDescription
            }
            searchQuery = ""
            searchHits = []
            searchedQuery = nil
            pages = snapshot.pages
            selectedID = nil
            loaded = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
