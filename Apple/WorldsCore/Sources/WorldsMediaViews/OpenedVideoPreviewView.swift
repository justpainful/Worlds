import SwiftUI
import AVKit
import WorldsMedia

/// The creator transfers sole ownership of the already opened attachment.
/// This does not authorize the file: the caller must verify the session and
/// page permissions before opening it. This view never reopens its source path
/// and deliberately provides no sharing action.
public struct OpenedVideoPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: OpenedVideoModel

    public init(attachment: WorldsAttachment, openedFile: AttachmentFile) {
        _model = StateObject(wrappedValue: OpenedVideoModel(attachment: attachment, openedFile: openedFile))
    }

    public var body: some View {
        VStack(spacing: 12) {
            HStack {
                Button("Back", systemImage: "chevron.backward") { model.close(); dismiss() }
                Spacer()
                Text(model.name).lineLimit(1)
            }.padding()
            switch model.state {
            case .loading: ProgressView("Opening video")
            case .playing(let player): VideoPlayer(player: player)
            case .failure(let text): ContentUnavailableView("Unable to open video", systemImage: "exclamationmark.triangle", description: Text(text))
            }
        }
        .task { await model.load() }
        .onDisappear { model.close() }
    }
}

// The file leaves this box exactly once. No concurrent reads are permitted.
private final class OneShotAttachment: @unchecked Sendable {
    private let lock = NSLock()
    private var file: AttachmentFile?
    init(_ file: AttachmentFile) { self.file = file }
    func take() -> AttachmentFile? {
        lock.lock(); defer { lock.unlock() }
        let result = file; file = nil; return result
    }
}

private struct VideoLease: @unchecked Sendable { let value: TemporaryMediaFile }

@MainActor
private final class OpenedVideoModel: ObservableObject {
    enum State { case loading, playing(AVPlayer), failure(String) }
    @Published private(set) var state: State = .loading
    let name: String
    private let typeIsVideo: Bool
    private let source: OneShotAttachment
    private var lease: TemporaryMediaFile?
    private var started = false
    private var closed = false
    private var generation = UUID()

    init(attachment: WorldsAttachment, openedFile: AttachmentFile) {
        name = attachment.fileName
        typeIsVideo = attachment.mime.lowercased().hasPrefix("video/") && WorldsMedia.format(name: attachment.fileName, mime: attachment.mime) == .video
        source = OneShotAttachment(openedFile)
    }

    func load() async {
        guard !started, !closed else { return }
        started = true
        guard typeIsVideo, let file = source.take() else { state = .failure(MediaError.unsupported.localizedDescription); return }
        let transfer = OneShotAttachment(file)
        let ext = (name as NSString).pathExtension.lowercased()
        let token = generation
        do {
            let result = try await Task.detached(priority: .userInitiated) {
                guard let file = transfer.take() else { throw MediaError.inaccessible }
                let playback = try WorldsMedia.playback(file: file, extension: ext)
                guard try await playback.asset.load(.isPlayable) else { throw MediaError.invalidContent }
                return VideoLease(value: playback.lease)
            }.value
            guard generation == token else { return }
            lease = result.value
            state = .playing(AVPlayer(url: result.value.url))
        } catch {
            guard generation == token else { return }
            state = .failure(error.localizedDescription)
        }
    }

    func close() {
        closed = true
        generation = UUID()
        if case .playing(let player) = state { player.pause() }
        lease = nil
    }
}
