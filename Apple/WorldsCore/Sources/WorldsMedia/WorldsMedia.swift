import Foundation
import ImageIO
import CoreGraphics
import PDFKit
import AVFoundation

public enum AttachmentFormat: Sendable, Equatable {
    case image, pdf, text, delimited, video, audio, unsupported
}

public struct ImagePreview {
    public let image: CGImage
    public let frameCount: Int
}

public struct MediaPlayback {
    /// Keep this value alive until playback ends so its private copy remains.
    public let lease: TemporaryMediaFile
    public let asset: AVURLAsset
}

public enum WorldsMedia {
    /// Classification is advisory; actual decoders must validate file bytes.
    public static func format(name: String, mime: String) -> AttachmentFormat {
        let ext = (name as NSString).pathExtension.lowercased()
        if ["png", "jpg", "jpeg", "gif", "heic", "heif", "tif", "tiff", "bmp"].contains(ext) { return .image }
        if ext == "pdf" { return .pdf }
        if ["csv", "tsv"].contains(ext) { return .delimited }
        if ["txt", "md", "markdown", "json", "jsonc", "log", "ini", "toml", "yaml", "yml", "xml", "html", "css", "js", "ts", "tsx", "py", "rs", "swift", "sql", "sh", "ps1"].contains(ext) { return .text }
        if ["mp4", "mov", "m4v"].contains(ext) { return .video }
        if ["mp3", "wav", "m4a", "aac", "aiff"].contains(ext) { return .audio }
        return .unsupported
    }
    public static func image(file: AttachmentFile, maxDimension: Int = 2048) throws -> ImagePreview {
        guard (1...4096).contains(maxDimension) else { throw MediaError.tooLarge }
        let data = try file.read() as CFData
        guard let source = CGImageSourceCreateWithData(data, nil), CGImageSourceGetCount(source) > 0,
              let metadata = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = (metadata[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
              let h = (metadata[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
              w > 0, h > 0, w <= 16384, h <= 16384, Int64(w) * Int64(h) <= 64 * 1024 * 1024 else { throw MediaError.invalidContent }
        let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maxDimension]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw MediaError.invalidContent }
        return ImagePreview(image: image, frameCount: CGImageSourceGetCount(source))
    }
    public static func pdf(file: AttachmentFile) throws -> PDFDocument {
        let data = try file.read()
        guard let document = PDFDocument(data: data), document.pageCount > 0 else { throw MediaError.invalidContent }
        return document
    }
    public static func text(file: AttachmentFile, maxBytes: Int = 2 * 1024 * 1024) throws -> String {
        let data = try file.read(maxBytes: maxBytes)
        guard let text = String(data: data, encoding: .utf8) else { throw MediaError.invalidContent }
        return text
    }
    public static func playback(file: AttachmentFile, extension fileExtension: String) throws -> MediaPlayback {
        guard ["mp4", "mov", "m4v", "mp3", "wav", "m4a", "aac", "aiff"].contains(fileExtension.lowercased()) else { throw MediaError.unsupported }
        let lease = try file.playbackCopy(fileExtension: fileExtension)
        return MediaPlayback(lease: lease, asset: AVURLAsset(url: lease.url))
    }
}
