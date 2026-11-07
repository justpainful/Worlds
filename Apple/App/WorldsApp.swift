import SwiftUI
import UniformTypeIdentifiers
import WorldsPersistence

@main
struct WorldsApp: App {
    var body: some Scene {
        WindowGroup {
            WorldsLibraryView()
        }
    }
}

private struct WorldsLibraryView: View {
    @State private var pages: [StoredPage] = []
    @State private var selectedID: String?
    @State private var showImporter = false
    @State private var loaded = false
    @State private var loading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationSplitView {
            Group {
                if loading {
                    ProgressView("Opening database")
                } else if !loaded {
                    ContentUnavailableView(
                        "Open your Worlds database",
                        systemImage: "externaldrive",
                        description: Text("Choose a local Worlds database to view its personal pages.")
                    )
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
                                if !page.preview.isEmpty {
                                    Text(page.preview)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
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

    @MainActor
    private func open(_ url: URL) async {
        loading = true
        defer { loading = false }
        let hasAccess = url.startAccessingSecurityScopedResource()
        defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let database = try WorldsDatabase(url: url)
            let snapshot = try await database.snapshot()
            pages = snapshot.pages
            selectedID = nil
            loaded = true
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
