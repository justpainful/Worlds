import Foundation
import CoreGraphics
import ImageIO
import XCTest
import WorldsMedia
@testable import WorldsMediaViews

@MainActor final class OpenedDocumentModelTests: XCTestCase {
    private func root() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }
    private func item(_ name: String, size: Int) -> WorldsAttachment {
        WorldsAttachment(id: "a", pageId: "personal-page", kind: "file", fileName: name,
            mime: name.hasSuffix(".pdf") ? "application/pdf" : "image/png", size: Int64(size), relPath: name,
            width: nil, height: nil, createdAt: 1)
    }
    func testResolutionBudgetPreservesSmallOriginalAndCapsLargeImage() {
        XCTAssertEqual(documentResolutionCap(width: 2500, height: 1000), 2500)
        XCTAssertEqual(documentResolutionCap(width: 8000, height: 8000), 4096)
        XCTAssertEqual(documentResolutionCap(width: 0, height: 100), 0)
    }
    func testImageReadsVerifiedDescriptorAfterPathReplacement() async throws {
        let root = try root()
        let data = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="))
        let path = root.appendingPathComponent("image.png"); try data.write(to: path)
        let attachment = item("image.png", size: data.count)
        let opened = try AttachmentVault(root: root).open(attachment)
        try FileManager.default.moveItem(at: path, to: root.appendingPathComponent("original.png"))
        try Data(repeating: 0, count: data.count).write(to: path)
        let model = OpenedDocumentModel(attachment: attachment, openedFile: opened)
        await model.load()
        guard case .image(let result) = model.state else { return XCTFail("Original opened image was not decoded") }
        XCTAssertEqual(result.image.width, 1); XCTAssertEqual(result.image.height, 1)
    }
    func testPDFAndChangedSizeFailClosed() async throws {
        let root = try root(); let pdfPath = root.appendingPathComponent("document.pdf")
        let data = NSMutableData()
        let consumer = try XCTUnwrap(CGDataConsumer(data: data as CFMutableData))
        var box = CGRect(x: 0, y: 0, width: 64, height: 64)
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &box, nil))
        context.beginPDFPage(nil); context.setFillColor(CGColor(gray: 0, alpha: 1)); context.fill(box); context.endPDFPage(); context.closePDF()
        try (data as Data).write(to: pdfPath)
        let attachment = item("document.pdf", size: data.length)
        let valid = OpenedDocumentModel(attachment: attachment, openedFile: try AttachmentVault(root: root).open(attachment))
        await valid.load()
        guard case .pdf(let document) = valid.state else { return XCTFail("PDF was not decoded") }
        XCTAssertEqual(document.pageCount, 1)
        let mismatch = item("document.pdf", size: data.length + 1)
        let refused = OpenedDocumentModel(attachment: mismatch, openedFile: try AttachmentVault(root: root).open(mismatch))
        await refused.load()
        guard case .failure = refused.state else { return XCTFail("Changed size must fail closed") }
    }
    func testLargeImageIsReportedAsDownsampled() async throws {
        let root = try root(); let path = root.appendingPathComponent("large.png")
        let color = try XCTUnwrap(CGColorSpace(name: CGColorSpace.sRGB))
        let context = try XCTUnwrap(CGContext(data: nil, width: 2500, height: 1, bitsPerComponent: 8, bytesPerRow: 0,
            space: color, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let image = try XCTUnwrap(context.makeImage())
        let data = NSMutableData(); let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, image, nil); XCTAssertTrue(CGImageDestinationFinalize(destination))
        try (data as Data).write(to: path)
        let attachment = item("large.png", size: data.length)
        let model = OpenedDocumentModel(attachment: attachment, openedFile: try AttachmentVault(root: root).open(attachment))
        await model.load()
        guard case .image(let preview) = model.state else { return XCTFail("Expected image preview") }
        XCTAssertEqual(preview.sourceWidth, 2500); XCTAssertLessThanOrEqual(preview.image.width, 2048)
        await model.requestImageResolution(scale: 2)
        guard case .image(let detailed) = model.state else { return XCTFail("Expected detailed preview") }
        XCTAssertEqual(detailed.image.width, 2500)
        XCTAssertEqual(detailed.maximumDimension, 2500)
    }
    func testPasswordProtectedPDFReportsLimit() async throws {
        let root = try root(); let path = root.appendingPathComponent("locked.pdf")
        let data = NSMutableData(); let consumer = try XCTUnwrap(CGDataConsumer(data: data as CFMutableData))
        var box = CGRect(x: 0, y: 0, width: 64, height: 64)
        let options = [kCGPDFContextUserPassword: "fixture-password"] as CFDictionary
        let context = try XCTUnwrap(CGContext(consumer: consumer, mediaBox: &box, options))
        context.beginPDFPage(nil); context.endPDFPage(); context.closePDF(); try (data as Data).write(to: path)
        let attachment = item("locked.pdf", size: data.length)
        let model = OpenedDocumentModel(attachment: attachment, openedFile: try AttachmentVault(root: root).open(attachment))
        await model.load()
        guard case .failure(let message) = model.state else { return XCTFail("Locked PDF must not be shown as open") }
        XCTAssertTrue(message.contains("password protected"))
    }
    func testTruncatedOpenFileIsRejected() async throws {
        let root = try root(); let path = root.appendingPathComponent("document.pdf")
        try Data(repeating: 0x25, count: 40).write(to: path)
        let attachment = item("document.pdf", size: 40)
        let opened = try AttachmentVault(root: root).open(attachment)
        let output = try FileHandle(forWritingTo: path); try output.truncate(atOffset: 5); try output.close()
        let model = OpenedDocumentModel(attachment: attachment, openedFile: opened)
        await model.load()
        guard case .failure = model.state else { return XCTFail("Shorter content must be rejected") }
    }
    func testCloseBeforeLoadDoesNotDecode() async throws {
        let root = try root(); let path = root.appendingPathComponent("image.png")
        try Data("not an image".utf8).write(to: path)
        let attachment = item("image.png", size: 12)
        let model = OpenedDocumentModel(attachment: attachment, openedFile: try AttachmentVault(root: root).open(attachment))
        model.close(); await model.load()
        guard case .loading = model.state else { return XCTFail("Closed model processed a file") }
    }
}
