import SwiftUI
import PDFKit
import AVKit
import WorldsMedia

public struct AttachmentPreviewView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: MediaPreviewModel
    @State private var sharePresented = false
    public init(attachment: WorldsAttachment, attachmentsRoot: URL) {
        _model = StateObject(wrappedValue: MediaPreviewModel(attachment: attachment, attachmentsRoot: attachmentsRoot))
    }
    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button("Back", systemImage: "chevron.backward") { model.close(); dismiss() }
                Spacer(minLength: 8)
                Text(model.attachment.fileName).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                Button("Share", systemImage: "square.and.arrow.up") {
                    Task { await model.prepareShare(); if model.shareURL != nil && model.shareError == nil { sharePresented = true } }
                }
                .disabled(model.preparingShare)
            }
            .padding()
            Divider()
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
            if let error = model.shareError { Text(error).font(.caption).foregroundStyle(.secondary).padding(.horizontal) }
        }
        .task { await model.load() }
        .onDisappear { model.close() }
        .sheet(isPresented: $sharePresented) {
            VStack(spacing: 20) {
                Text(model.attachment.fileName).font(.headline)
                if let url = model.shareURL { ShareLink(item: url) }
                Button("Done") { sharePresented = false }
            }
            .padding(32)
        }
    }
    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading:
            ProgressView("Loading preview")
        case .image(let preview):
            VStack(spacing: 4) {
                ZoomImage(image: preview.image)
                if preview.frameCount > 1 { Text("Showing the first frame").font(.caption).foregroundStyle(.secondary) }
            }
        case .pdf(let document):
            NativePDFView(document: document)
        case .text(let text):
            ScrollView([.vertical, .horizontal]) { Text(text).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding() }
        case .table(let rows):
            ScrollView([.vertical, .horizontal]) {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        GridRow { ForEach(Array(row.enumerated()), id: \.offset) { _, cell in Text(cell).textSelection(.enabled) } }
                    }
                }
                .padding()
            }
        case .video(let player), .audio(let player):
            VideoPlayer(player: player).padding()
        case .unsupported:
            ContentUnavailableView("Preview unavailable", systemImage: "doc", description: Text("This file format is not supported here. You can share the original file."))
        case .failure(let message):
            VStack(spacing: 12) {
                ContentUnavailableView("Unable to open file", systemImage: "exclamationmark.triangle", description: Text(message))
                Button("Try Again") { Task { await model.load() } }
            }
        }
    }
}

private struct ZoomImage: View {
    let image: CGImage
    @State private var scale: CGFloat = 1
    @GestureState private var gestureScale: CGFloat = 1
    var body: some View {
        GeometryReader { geometry in
            let fit = min(max(1, geometry.size.width) / CGFloat(image.width), max(1, geometry.size.height) / CGFloat(image.height))
            let zoom = min(8, max(0.5, scale * gestureScale))
            ScrollView([.horizontal, .vertical]) {
                Image(decorative: image, scale: 1)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: CGFloat(image.width) * fit * zoom, height: CGFloat(image.height) * fit * zoom)
                    .gesture(MagnificationGesture().updating($gestureScale) { value, state, _ in state = value }.onEnded { scale = min(8, max(0.5, scale * $0)) })
                    .padding()
            }
        }
        .accessibilityLabel("Image preview")
    }
}

#if canImport(UIKit)
import UIKit
private struct NativePDFView: UIViewRepresentable {
    let document: PDFDocument
    func makeUIView(context: Context) -> PDFView { let view = PDFView(); view.autoScales = true; view.displayMode = .singlePageContinuous; return view }
    func updateUIView(_ view: PDFView, context: Context) { if view.document !== document { view.document = document; view.autoScales = true } }
}
#elseif canImport(AppKit)
import AppKit
private struct NativePDFView: NSViewRepresentable {
    let document: PDFDocument
    func makeNSView(context: Context) -> PDFView { let view = PDFView(); view.autoScales = true; view.displayMode = .singlePageContinuous; return view }
    func updateNSView(_ view: PDFView, context: Context) { if view.document !== document { view.document = document; view.autoScales = true } }
}
#endif

