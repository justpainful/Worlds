import SwiftUI
import WorldsPersistence

private struct ResourceMetadata: Decodable {
    struct Project: Decodable {
        let status: String?
        let start: String?
        let due: String?
        let description: String?
        let links: [String]?
    }
    struct File: Decodable {
        let name: String?
        let mime: String?
        let size: Int64?
    }
    let project: Project?
    let file: File?
}
private struct ResourceBlock: Decodable {
    struct Attributes: Decodable {
        struct Element: Decodable { let type: String?; let text: String? }
        let name: String?
        let caption: String?
        let mime: String?
        let notes: String?
        let elements: [Element]?
    }
    let type: String?
    let attrs: Attributes?
}

/// Read-only summary over the same personal-page snapshot used by navigation.
/// No attachment path or user data is modified by this view.
struct ResourceContentView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let page: StoredPage
    let pages: [StoredPage]
    var projectEditingAvailable: Bool = false
    var openVideo: (() -> Void)? = nil
    let openPage: (String) -> Void

    private var metadata: ResourceMetadata? { try? JSONDecoder().decode(ResourceMetadata.self, from: Data(page.metadataJSON.utf8)) }
    private var blocks: [(String, ResourceBlock?)] {
        page.blocks.map { block in (block.id, try? JSONDecoder().decode(ResourceBlock.self, from: Data(block.contentJSON.utf8))) }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(page.title.isEmpty ? "Untitled" : page.title)
                    .font(.title.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    .frame(maxWidth: .infinity, alignment: .leading)
                switch page.kind {
                case "project": project
                case "gallery": gallery
                case "presentation": presentation
                case "file": file
                default: Text("This resource type is not available in the reader.")
                }
                Label(projectEditingAvailable ? "Project editing available in local copy" : "Read only", systemImage: projectEditingAvailable ? "pencil" : "eye")
                    .font(.body).foregroundStyle(.secondary)
            }
            .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .accessibilityIdentifier("resource-content")
        #if os(macOS)
        .navigationTitle(page.title.isEmpty ? "Untitled" : page.title)
        #else
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
    private var project: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let info = metadata?.project {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 12) { projectFacts(info) }
                } else {
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 20) { projectFacts(info) }
                        VStack(alignment: .leading, spacing: 12) { projectFacts(info) }
                    }
                }
                if let description = info.description, !description.isEmpty { Text(description).textSelection(.enabled) }
                let linked = linkedPages(info.links ?? [])
                if !linked.isEmpty { pageLinks("Linked pages", linked) }
                if (info.links ?? []).contains(page.id) {
                    Text("This project links to itself.").font(.body).foregroundStyle(.secondary)
                }
                if (info.links ?? []).contains(where: { id in !pages.contains(where: { $0.id == id }) }) {
                    Text("Some linked pages are unavailable in this snapshot.").font(.body).foregroundStyle(.secondary)
                }
            } else { Text("Project details are unavailable.").foregroundStyle(.secondary) }
            let children = pages.filter { $0.parentID == page.id && $0.kind != "template" && !$0.archived }
            if !children.isEmpty { pageLinks("Pages inside", children) }
        }
    }
    private var gallery: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Media previews are unavailable in this reader.").foregroundStyle(.secondary)
            if blocks.isEmpty { Text("This gallery has no items.").foregroundStyle(.secondary) }
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, pair in
                if let block = pair.1, block.type == "galleryItem" {
                    VStack(alignment: .leading, spacing: 4) {
                        Label(block.attrs?.name ?? "Gallery item details unavailable", systemImage: mediaSymbol(block.attrs?.mime))
                        if let caption = block.attrs?.caption, !caption.isEmpty { Text(caption).foregroundStyle(.secondary) }
                    }
                } else { Text("Unsupported gallery content").foregroundStyle(.secondary) }
            }
        }
    }
    private var presentation: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Slide text and notes are shown below. Visual slide rendering is unavailable.").foregroundStyle(.secondary)
            if blocks.isEmpty { Text("This presentation has no slides.").foregroundStyle(.secondary) }
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, pair in
                if let block = pair.1, block.type == "slide" {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Slide \(blocks.prefix(index + 1).filter { $0.1?.type == "slide" }.count)").font(.headline).accessibilityAddTraits(.isHeader)
                        ForEach(Array((block.attrs?.elements ?? []).enumerated()), id: \.offset) { _, element in
                            if element.type == "text", let text = element.text { Text(text).textSelection(.enabled) }
                            else { Text("Visual element unavailable").font(.caption).foregroundStyle(.secondary) }
                        }
                        if let notes = block.attrs?.notes, !notes.isEmpty { detail("Speaker notes", notes) }
                    }
                } else { Text("Unsupported presentation content").foregroundStyle(.secondary) }
            }
        }
    }
    private var file: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let info = metadata?.file {
                if let name = info.name { detail("File", name) }
                if let mime = info.mime { detail("Type", mime) }
                if let size = info.size, size >= 0 { detail("Size", ByteCountFormatter.string(fromByteCount: size, countStyle: .file)) }
                if info.mime?.lowercased().hasPrefix("video/") == true, let openVideo {
                    Button("Open video", systemImage: "play.rectangle", action: openVideo)
                        .accessibilityIdentifier("open-personal-video")
                    Text("Choose the Worlds folder to open this personal video.").foregroundStyle(.secondary)
                } else {
                    Text("File preview is unavailable in this reader.").foregroundStyle(.secondary)
                }
            } else { Text("File details are unavailable.").foregroundStyle(.secondary) }
        }
    }
    @ViewBuilder
    private func projectFacts(_ info: ResourceMetadata.Project) -> some View {
        if let status = info.status { detail("Status", status.capitalized).frame(minWidth: 90) }
        if let start = info.start { detail("Start", start).frame(minWidth: 90) }
        if let due = info.due { detail("Due", due).frame(minWidth: 90) }
    }
    private func mediaSymbol(_ mime: String?) -> String {
        guard let mime else { return "doc" }
        if mime.hasPrefix("image/") { return "photo" }
        if mime.hasPrefix("video/") { return "film" }
        if mime.hasPrefix("audio/") { return "waveform" }
        return "doc"
    }
    private func linkedPages(_ ids: [String]) -> [StoredPage] {
        var seen = Set<String>()
        return ids.compactMap { id in
            guard id != page.id, seen.insert(id).inserted else { return nil }
            return pages.first(where: { $0.id == id })
        }
    }
    private func detail(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.body).foregroundStyle(.secondary)
            Text(value).textSelection(.enabled)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func pageLinks(_ label: String, _ entries: [StoredPage]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.headline).accessibilityAddTraits(.isHeader)
            ForEach(entries) { item in
                Button { openPage(item.id) } label: {
                    HStack(spacing: 10) {
                        Label(item.title.isEmpty ? "Untitled" : item.title, systemImage: "doc.text")
                        Image(systemName: "chevron.forward").font(.caption.weight(.semibold)).foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("resource-page.\(item.id)")
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
