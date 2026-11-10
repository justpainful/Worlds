import Foundation
import Combine
import CoreGraphics
import PDFKit
import AVFoundation
import WorldsMedia

@MainActor
public enum MediaViewState {
    case loading
    case image(ImagePreview)
    case pdf(PDFDocument)
    case text(String)
    case table([[String]])
    case video(AVPlayer)
    case audio(AVPlayer)
    case unsupported
    case failure(String)
}

/// The unchecked wrapper transfers sole ownership from the worker to the main
/// actor. Mutable UI objects are created only after that transfer.
private enum LoadedMedia: @unchecked Sendable {
    case image(ImagePreview)
    case pdf(Data)
    case text(String)
    case table([[String]])
    case playback(TemporaryMediaFile, isVideo: Bool)
    case unsupported
}
private struct ShareLease: @unchecked Sendable { let value: TemporaryMediaFile }

@MainActor
public final class MediaPreviewModel: ObservableObject {
    @Published public private(set) var state: MediaViewState = .loading
    @Published public private(set) var shareURL: URL?
    @Published public private(set) var shareError: String?
    @Published public private(set) var preparingShare = false
    public let attachment: WorldsAttachment
    private let root: URL
    private var playbackLease: TemporaryMediaFile?
    private var shareLease: TemporaryMediaFile?
    private var generation = UUID()

    public init(attachment: WorldsAttachment, attachmentsRoot: URL) {
        self.attachment = attachment; self.root = attachmentsRoot
    }
    public func load() async {
        let token = UUID(); generation = token
        stopPlayer(); playbackLease = nil; state = .loading
        let root = self.root, attachment = self.attachment
        do {
            let payload = try await Task.detached(priority: .userInitiated) { () async throws -> LoadedMedia in
                let file = try AttachmentVault(root: root).open(attachment)
                switch WorldsMedia.format(name: attachment.fileName, mime: attachment.mime) {
                case .image: return .image(try WorldsMedia.image(file: file))
                case .pdf: return .pdf(try file.read())
                case .text: return .text(try WorldsMedia.text(file: file))
                case .delimited:
                    let delimiter: Character = (attachment.fileName as NSString).pathExtension.lowercased() == "tsv" ? "\t" : ","
                    return .table(try DelimitedText.rows(file: file, delimiter: delimiter))
                case .video, .audio:
                    let ext = (attachment.fileName as NSString).pathExtension.lowercased()
                    let playback = try WorldsMedia.playback(file: file, extension: ext)
                    guard try await playback.asset.load(.isPlayable) else { throw MediaError.invalidContent }
                    return .playback(playback.lease, isVideo: WorldsMedia.format(name: attachment.fileName, mime: attachment.mime) == .video)
                case .unsupported: return .unsupported
                }
            }.value
            guard generation == token else { return }
            switch payload {
            case .image(let preview): state = .image(preview)
            case .pdf(let data):
                guard let document = PDFDocument(data: data), document.pageCount > 0 else { throw MediaError.invalidContent }
                state = .pdf(document)
            case .text(let text): state = .text(text)
            case .table(let rows): state = .table(rows)
            case .playback(let lease, let video):
                playbackLease = lease
                let player = AVPlayer(url: lease.url)
                state = video ? .video(player) : .audio(player)
            case .unsupported: state = .unsupported
            }
        } catch {
            guard generation == token else { return }
            state = .failure(error.localizedDescription)
        }
    }
    public func prepareShare() async {
        guard !preparingShare else { return }
        preparingShare = true; shareError = nil
        defer { preparingShare = false }
        let root = self.root, attachment = self.attachment, token = generation
        do {
            let lease = try await Task.detached(priority: .userInitiated) {
                let file = try AttachmentVault(root: root).open(attachment)
                let ext = (attachment.fileName as NSString).pathExtension.lowercased()
                return ShareLease(value: try file.playbackCopy(fileExtension: ext))
            }.value
            guard generation == token else { return }
            shareLease = lease.value
            shareURL = lease.value.url
        } catch {
            guard generation == token else { return }
            shareError = error.localizedDescription
        }
    }
    public func close() {
        generation = UUID(); stopPlayer(); playbackLease = nil
        // Keep the share lease until the model is released so the system share
        // controller can continue reading while this view is being dismissed.
    }
    private func stopPlayer() {
        switch state { case .video(let player), .audio(let player): player.pause(); default: break }
    }
}
