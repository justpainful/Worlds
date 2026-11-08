import SwiftUI
import PDFKit
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
import WorldsMedia

private struct OriginalAttachmentDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.data]
    let data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { throw CocoaError(.fileReadUnsupportedScheme) }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

/// Consumes the already-authorized descriptor. The caller retains the folder
/// security scope and is responsible for page and attachment authorization.
public struct OpenedDocumentPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: OpenedDocumentModel
    @State private var exporting = false
    @State private var exportDocument: OriginalAttachmentDocument?
    @State private var exportError: String?
    public init(attachment: WorldsAttachment, openedFile: AttachmentFile) {
        _model = StateObject(wrappedValue: OpenedDocumentModel(attachment: attachment, openedFile: openedFile))
    }
    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Back", systemImage: "chevron.backward") { model.close(); dismiss() }
                Spacer(minLength: 8)
                Text(model.name).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                #if WORLDS_EXPERIMENTAL_ATTACHMENT_EXPORT
                if let bytes = model.originalBytes {
                    Button("Export", systemImage: "square.and.arrow.up") {
                        exportError = nil; exportDocument = OriginalAttachmentDocument(data: bytes); exporting = true
                    }.accessibilityIdentifier("export-original-attachment")
                }
                #endif
            }.padding()
            Divider()
            Group {
                switch model.state {
                case .loading: ProgressView("Opening preview")
                case .image(let preview):
                    VStack(spacing: 4) {
                        OpenedZoomImage(image: preview.image) { scale in Task { await model.requestImageResolution(scale: scale) } }
                        if max(preview.sourceWidth, preview.sourceHeight) > max(preview.image.width, preview.image.height) {
                            Text(preview.maximumDimension < max(preview.sourceWidth, preview.sourceHeight)
                                ? "Preview resolution is limited to protect memory."
                                : "Zoom to load more image detail.")
                                .font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("image-preview-reduced")
                        }
                        if let error = model.resolutionError { Text(error).font(.caption).foregroundStyle(.secondary) }
                        if preview.frameCount > 1 { Text("Showing the first frame").font(.caption).foregroundStyle(.secondary) }
                    }.accessibilityIdentifier("opened-image-preview")
                case .pdf(let document):
                    OpenedNativePDFView(document: document).accessibilityLabel("PDF preview").accessibilityIdentifier("opened-pdf-preview")
                case .failure(let message):
                    ContentUnavailableView("Unable to open file", systemImage: "exclamationmark.triangle", description: Text(message))
                        .accessibilityIdentifier("opened-document-error")
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
            if let exportError { Text(exportError).foregroundStyle(.secondary).padding() }
        }
        .fileExporter(isPresented: $exporting, document: exportDocument, contentType: .data, defaultFilename: model.exportName) { result in
            exportDocument = nil
            if case .failure = result { exportError = "The file could not be exported." }
        }
        .task { await model.load() }.onDisappear {
            exporting = false; exportDocument = nil; model.close()
        }
    }
}

private final class DocumentFileTransfer: @unchecked Sendable {
    private let lock = NSLock()
    private var file: AttachmentFile?
    init(_ file: AttachmentFile) { self.file = file }
    func take() -> AttachmentFile? {
        lock.lock(); defer { lock.unlock() }
        let result = file; file = nil; return result
    }
    func discard() { lock.lock(); file = nil; lock.unlock() }
}
struct OpenedDocumentImage {
    let image: CGImage
    let frameCount: Int
    let sourceWidth: Int
    let sourceHeight: Int
    let maximumDimension: Int
    let encoded: Data
}
func documentResolutionCap(width: Int, height: Int) -> Int {
    guard width > 0, height > 0 else { return 0 }
    let pixels = Double(width) * Double(height), budget = Double(16 * 1024 * 1024)
    return max(1, Int(Double(max(width, height)) * min(1, sqrt(budget / pixels))))
}
private func makeDocumentThumbnail(_ data: Data, maximumDimension: Int) throws -> CGImage {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw MediaError.invalidContent }
    let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: maximumDimension]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { throw MediaError.invalidContent }
    return image
}
private enum DocumentPreviewError: LocalizedError {
    case lockedPDF, tooManyPages
    var errorDescription: String? {
        switch self {
        case .lockedPDF: "This PDF is password protected. Unlocking is not available in this preview."
        case .tooManyPages: "This PDF has too many pages for this preview."
        }
    }
}
private enum DocumentPayload: @unchecked Sendable { case image(OpenedDocumentImage), pdf(Data) }

@MainActor final class OpenedDocumentModel: ObservableObject {
    enum State { case loading, image(OpenedDocumentImage), pdf(PDFDocument), failure(String) }
    @Published private(set) var state: State = .loading
    @Published private(set) var resolutionError: String?
    @Published private(set) var originalBytes: Data?
    let name: String
    private let format: AttachmentFormat
    private let expectedSize: Int64
    private let source: DocumentFileTransfer
    private var started = false
    private var closed = false
    private var generation = UUID()
    private var imageDecoding = false
    private var requestedDimension = 0
    var exportName: String {
        let last = (name as NSString).lastPathComponent
        let clean = String(last.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) })
        return clean.isEmpty || clean == "." || clean == ".." ? "Attachment" : String(clean.prefix(180))
    }
    init(attachment: WorldsAttachment, openedFile: AttachmentFile) {
        name = attachment.fileName; expectedSize = attachment.size
        format = WorldsMedia.format(name: attachment.fileName, mime: attachment.mime)
        source = DocumentFileTransfer(openedFile)
    }
    func load() async {
        guard !started, !closed else { return }
        started = true
        let token = generation, transfer = source, expected = expectedSize, format = format
        do {
            let payload = try await Task.detached(priority: .userInitiated) { () throws -> DocumentPayload in
                guard format == .image || format == .pdf else { throw MediaError.unsupported }
                guard let file = transfer.take(), file.size == expected else { throw MediaError.inaccessible }
                let data = try file.read()
                guard Int64(data.count) == expected else { throw MediaError.inaccessible }
                switch format {
                case .image:
                    guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0,
                          let metadata = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                          let w = (metadata[kCGImagePropertyPixelWidth] as? NSNumber)?.intValue,
                          let h = (metadata[kCGImagePropertyPixelHeight] as? NSNumber)?.intValue,
                          w > 0, h > 0, w <= 16384, h <= 16384, Int64(w) * Int64(h) <= 64 * 1024 * 1024 else { throw MediaError.invalidContent }
                    // Limit one decoded representation to 16 megapixels. The
                    // old and new representations may coexist during replacement.
                    let maximum = documentResolutionCap(width: w, height: h)
                    let image = try makeDocumentThumbnail(data, maximumDimension: min(2048, maximum))
                    return .image(OpenedDocumentImage(image: image, frameCount: CGImageSourceGetCount(source),
                        sourceWidth: w, sourceHeight: h, maximumDimension: maximum, encoded: data))
                case .pdf: return .pdf(data)
                default: throw MediaError.unsupported
                }
            }.value
            guard token == generation else { return }
            switch payload {
            case .image(let value): originalBytes = value.encoded; state = .image(value)
            case .pdf(let data):
                guard let document = PDFDocument(data: data) else { throw MediaError.invalidContent }
                guard !document.isLocked else { throw DocumentPreviewError.lockedPDF }
                guard document.pageCount > 0 else { throw MediaError.invalidContent }
                guard document.pageCount <= 1000 else { throw DocumentPreviewError.tooManyPages }
                originalBytes = data; state = .pdf(document)
            }
        } catch {
            guard token == generation else { return }
            state = .failure((error as? LocalizedError)?.errorDescription ?? "The file could not be opened.")
        }
    }
    func requestImageResolution(scale: CGFloat) async {
        guard !closed, scale.isFinite, case .image(let initial) = state else { return }
        let target = min(initial.maximumDimension, max(1, Int(ceil(2048 * min(8, max(1, scale))))))
        requestedDimension = max(requestedDimension, target)
        guard !imageDecoding else { return }
        imageDecoding = true; defer { imageDecoding = false }
        let token = generation
        while !closed, token == generation, case .image(let current) = state {
            let currentDimension = max(current.image.width, current.image.height)
            let requested = min(requestedDimension, current.maximumDimension)
            guard requested > currentDimension else { break }
            do {
                let encoded = current.encoded, frameCount = current.frameCount
                let sourceWidth = current.sourceWidth, sourceHeight = current.sourceHeight, maximumDimension = current.maximumDimension
                let payload = try await Task.detached(priority: .userInitiated) { () throws -> DocumentPayload in
                    let image = try makeDocumentThumbnail(encoded, maximumDimension: requested)
                    return .image(OpenedDocumentImage(image: image, frameCount: frameCount,
                        sourceWidth: sourceWidth, sourceHeight: sourceHeight,
                        maximumDimension: maximumDimension, encoded: encoded))
                }.value
                guard token == generation, !closed else { return }
                guard case .image(let next) = payload else { return }
                // Do not repeatedly decode an image source that ignored the requested size.
                guard max(next.image.width, next.image.height) > currentDimension else { break }
                state = .image(next); resolutionError = nil
            } catch {
                guard token == generation, !closed else { return }
                resolutionError = "Higher resolution could not be loaded; the current preview remains available."
                break
            }
        }
    }
    func close() { closed = true; generation = UUID(); source.discard(); originalBytes = nil; state = .loading }
}

private struct OpenedZoomImage: View {
    let image: CGImage
    let onZoom: @MainActor (CGFloat) -> Void
    @State private var scale: CGFloat = 1
    @GestureState private var gestureScale: CGFloat = 1
    var body: some View {
        GeometryReader { geometry in
            let fit = min(max(1, geometry.size.width) / CGFloat(image.width), max(1, geometry.size.height) / CGFloat(image.height))
            let zoom = min(8, max(0.5, scale * gestureScale))
            ScrollView([.horizontal, .vertical]) {
                Image(decorative: image, scale: 1).resizable().aspectRatio(contentMode: .fit)
                    .frame(width: CGFloat(image.width) * fit * zoom, height: CGFloat(image.height) * fit * zoom)
                    .gesture(MagnificationGesture().updating($gestureScale) { value, state, _ in state = value }.onEnded { scale = min(8, max(0.5, scale * $0)); onZoom(scale) })
                    .padding()
            }
        }.accessibilityLabel("Image preview")
    }
}
#if canImport(UIKit)
import UIKit
private struct OpenedNativePDFView: UIViewRepresentable {
    let document: PDFDocument
    func makeUIView(context: Context) -> PDFView { let view = PDFView(); view.autoScales = true; view.displayMode = .singlePageContinuous; return view }
    func updateUIView(_ view: PDFView, context: Context) { if view.document !== document { view.document = document; view.autoScales = true } }
}
#elseif canImport(AppKit)
import AppKit
private struct OpenedNativePDFView: NSViewRepresentable {
    let document: PDFDocument
    func makeNSView(context: Context) -> PDFView { let view = PDFView(); view.autoScales = true; view.displayMode = .singlePageContinuous; return view }
    func updateNSView(_ view: PDFView, context: Context) { if view.document !== document { view.document = document; view.autoScales = true } }
}
#endif
