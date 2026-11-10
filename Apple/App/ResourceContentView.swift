import SwiftUI
import AVKit
import WorldsPersistence
import WorldsMedia
#if WORLDS_MAIN_APP_MODULES
import WorldsOfficeViews
import WorldsOfficePreview
import Worlds3DViews
#endif

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
    struct Stream: Decodable { let url: String?; let format: String? }
    let project: Project?
    let file: File?
    let stream: Stream?
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
    @StateObject private var streamPlayback = ExternalStreamPlayback()
    let page: StoredPage
    let pages: [StoredPage]
    var projectEditingAvailable: Bool = false
    var otherEditingAvailable: Bool = false
    var openVideo: (() -> Void)? = nil
    var openDocument: (() -> Void)? = nil
    var open3D: (() -> Void)? = nil
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
                case "stream": stream
                case "spreadsheet": NativeSpreadsheetEditorView(metadataJSON: page.metadataJSON)
                case "task", "event", "goal", "inbox", "subject", "lesson", "assignment", "exam", "requirement":
                    NativePlanningAndStudyItemView(page: page)
                default: Text("This resource type is not available in the reader.")
                }
                Label(projectEditingAvailable ? "Project editing available in local copy" : (otherEditingAvailable ? "Editing available in local copy" : "Read only"), systemImage: (projectEditingAvailable || otherEditingAvailable) ? "pencil" : "eye")
                    .font(.body).foregroundStyle(.primary)
            }
            .padding(dynamicTypeSize.isAccessibilitySize ? 16 : 24)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .accessibilityIdentifier("resource-content")
        .onDisappear { streamPlayback.stop() }
        .onChange(of: page.id) { _, _ in streamPlayback.stop() }
        .onChange(of: page.metadataJSON) { _, _ in streamPlayback.stop() }
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
                        Label(block.attrs?.name ?? "Gallery item details unavailable", systemImage: mediaSymbol(block.attrs?.mime, name: block.attrs?.name))
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
                let ext = ((info.name ?? "") as NSString).pathExtension.lowercased()
                let isOffice = ext == "docx" || ext == "xlsx"
                #if WORLDS_MAIN_APP_MODULES
                let is3D = Worlds3D.isSupported(name: info.name ?? "")
                #else
                let is3D = false
                #endif
                let isDoc = [.image, .pdf].contains(WorldsMedia.format(name: info.name ?? "", mime: info.mime ?? "")) || isOffice
                if info.mime?.lowercased().hasPrefix("video/") == true, let openVideo {
                    Button("Open video", systemImage: "play.rectangle", action: openVideo)
                        .accessibilityIdentifier("open-personal-video")
                    Text("Choose the Worlds folder to open this personal video.").foregroundStyle(.secondary)
                } else if is3D {
                    if let open3D {
                        Button(ext == "dxf" ? "Open CAD drawing" : "Open 3D model",
                               systemImage: ext == "dxf" ? "compass.drawing" : "cube.transparent", action: open3D)
                            .accessibilityIdentifier("open-personal-3d")
                        Text("Choose the Worlds folder to interactively view this personal \(ext == "dxf" ? "CAD drawing" : "3D model").").foregroundStyle(.secondary)
                    } else {
                        Label(ext == "dxf" ? "CAD Drawing (DXF)" : "3D Model (\(ext.uppercased()))", systemImage: ext == "dxf" ? "compass.drawing" : "cube")
                            .font(.subheadline.weight(.medium))
                        Text("Interactive 3D viewing with orbital gestures, wireframe/shaded rendering, and lighting is available.").foregroundStyle(.secondary)
                    }
                } else if let openDocument, isDoc {
                    Button(isOffice ? (ext == "docx" ? "Open Word document" : "Open Excel spreadsheet") : "Open document",
                           systemImage: isOffice ? "doc.text" : "doc.richtext", action: openDocument)
                        .accessibilityIdentifier("open-personal-document")
                    Text("Choose the Worlds folder to open this personal \(isOffice ? (ext == "docx" ? "Word document" : "spreadsheet") : "file").").foregroundStyle(.secondary)
                } else {
                    Text("File preview is unavailable in this reader.").foregroundStyle(.secondary)
                }
            } else { Text("File details are unavailable.").foregroundStyle(.secondary) }
        }
    }
    private var stream: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let info = metadata?.stream, let raw = info.url,
               let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
               let scheme = url.scheme?.lowercased(), ["https", "http"].contains(scheme),
               let host = url.host, !host.isEmpty {
                Text("External stream").foregroundStyle(.secondary)
                Text(raw).textSelection(.enabled).font(.caption).environment(\.layoutDirection, .leftToRight)
                if info.format == "dash" {
                    Text("DASH streams are saved, but playback is not supported.")
                        .foregroundStyle(.secondary).accessibilityIdentifier("external-stream-dash")
                } else {
                    if let player = streamPlayback.player {
                        NativeStreamPlayer(player: player)
                            .aspectRatio(16 / 9, contentMode: .fit)
                            .accessibilityLabel("External video stream")
                            .accessibilityIdentifier("external-stream-player")
                    }
                    switch streamPlayback.state {
                    case .idle:
                        Button("Play stream", systemImage: "play.fill") { streamPlayback.play(url) }
                            .accessibilityIdentifier("play-external-stream")
                    case .connecting:
                        ProgressView("Connecting to the stream").accessibilityIdentifier("external-stream-loading")
                        Button("Stop", systemImage: "stop.fill") { streamPlayback.stop() }
                    case .playing:
                        Button("Stop", systemImage: "stop.fill") { streamPlayback.stop() }
                    case .failed:
                        Text("The stream could not be played. The link may be offline, expired, or blocked.")
                            .foregroundStyle(.secondary).accessibilityIdentifier("external-stream-error")
                        Button("Try again", systemImage: "arrow.clockwise") { streamPlayback.play(url) }
                            .accessibilityIdentifier("retry-external-stream")
                    }
                }
                Link("Open link", destination: url)
            } else {
                Text("This stream does not have a valid HTTP or HTTPS link.")
                    .foregroundStyle(.secondary).accessibilityIdentifier("external-stream-invalid")
            }
        }
    }
    @ViewBuilder
    private func projectFacts(_ info: ResourceMetadata.Project) -> some View {
        if let status = info.status { detail("Status", status.capitalized).frame(minWidth: 90) }
        if let start = info.start { detail("Start", start).frame(minWidth: 90) }
        if let due = info.due { detail("Due", due).frame(minWidth: 90) }
    }
    private func mediaSymbol(_ mime: String?, name: String? = nil) -> String {
        #if WORLDS_MAIN_APP_MODULES
        if let name, Worlds3D.isSupported(name: name) {
            return (name as NSString).pathExtension.lowercased() == "dxf" ? "compass.drawing" : "cube"
        }
        #endif
        guard let mime else { return "doc" }
        if mime.hasPrefix("image/") { return "photo" }
        if mime.hasPrefix("video/") { return "film" }
        if mime.hasPrefix("audio/") { return "waveform" }
        if mime.contains("model") || mime.contains("3d") || mime.contains("dxf") { return "cube" }
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

/// AppKit owns only the presentation. ExternalStreamPlayback owns the player,
/// observers and stop/retry lifecycle on every platform.
private struct NativeStreamPlayer: View {
    let player: AVPlayer
    var body: some View {
        #if os(macOS)
        MacStreamPlayer(player: player)
        #else
        VideoPlayer(player: player)
        #endif
    }
}

#if os(macOS)
private struct MacStreamPlayer: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .inline
        view.player = player
        return view
    }
    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player { view.player = player }
    }
    static func dismantleNSView(_ view: AVPlayerView, coordinator: ()) { view.player = nil }
}
#endif

/// Observers belong to one item and are invalidated on navigation or retry.
/// Errors deliberately omit URLs, which may contain private stream tokens.
@MainActor private final class ExternalStreamPlayback: ObservableObject {
    enum State { case idle, connecting, playing, failed }
    @Published private(set) var state: State = .idle
    @Published private(set) var player: AVPlayer?
    private var observation: NSKeyValueObservation?
    private var failureObserver: NSObjectProtocol?
    private var generation = UUID()

    func play(_ url: URL) {
        stop()
        let token = generation
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        self.player = player; state = .connecting
        observation = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            let ready = item.status == .readyToPlay
            let failed = item.status == .failed
            Task { @MainActor [weak self] in
                guard let self, self.generation == token else { return }
                if failed { self.fail(token) }
                else if ready { self.state = .playing }
            }
        }
        failureObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: nil) { [weak self] _ in
            Task { @MainActor [weak self] in self?.fail(token) }
        }
        player.play()
    }
    func stop() {
        generation = UUID(); observation = nil
        if let failureObserver { NotificationCenter.default.removeObserver(failureObserver); self.failureObserver = nil }
        player?.pause(); player?.replaceCurrentItem(with: nil); player = nil; state = .idle
    }
    private func fail(_ token: UUID) {
        guard generation == token else { return }
        generation = UUID()
        observation = nil
        if let failureObserver { NotificationCenter.default.removeObserver(failureObserver); self.failureObserver = nil }
        player?.pause(); player?.replaceCurrentItem(with: nil); player = nil; state = .failed
    }
}
