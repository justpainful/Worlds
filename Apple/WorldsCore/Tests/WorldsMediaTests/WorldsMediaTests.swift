import Foundation
import XCTest
@testable import WorldsMedia

final class WorldsMediaTests: XCTestCase {
    private func workspace() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }
    private func attachment(_ path: String, name: String = "sample.txt") -> WorldsAttachment {
        WorldsAttachment(id: "fixture", pageId: "page", kind: "file", fileName: name, mime: "text/plain", size: 0, relPath: path, width: nil, height: nil, createdAt: 1)
    }
    func testReadsOnlyFilesInsideRoot() throws {
        let root = try workspace()
        let folder = root.appendingPathComponent("2026-01", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data("Hello".utf8).write(to: folder.appendingPathComponent("a.txt"))
        let vault = try AttachmentVault(root: root)
        XCTAssertEqual(try WorldsMedia.text(file: vault.open(attachment("2026-01/a.txt"))), "Hello")
        for path in ["../secret", "/etc/passwd", "2026-01/../a.txt", "C:\\secret", "2026-01//a.txt"] {
            XCTAssertThrowsError(try vault.open(attachment(path)))
        }
    }
    func testOpenRejectsFileAboveExplicitLimit() throws {
        let root = try workspace()
        try Data("small".utf8).write(to: root.appendingPathComponent("a.txt"))
        let vault = try AttachmentVault(root: root)
        do { _ = try vault.open(attachment("a.txt"), maxSize: 4); XCTFail("Expected size rejection") }
        catch MediaError.tooLarge { } catch { XCTFail("Unexpected error: \(error)") }
        XCTAssertEqual(try vault.open(attachment("a.txt"), maxSize: 5).read(), Data("small".utf8))
    }
    func testRejectsSymlinkForFileAndDirectory() throws {
        let root = try workspace()
        let outside = try workspace()
        try Data("secret".utf8).write(to: outside.appendingPathComponent("secret.txt"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("link"), withDestinationURL: outside)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("file"), withDestinationURL: outside.appendingPathComponent("secret.txt"))
        let vault = try AttachmentVault(root: root)
        XCTAssertThrowsError(try vault.open(attachment("link/secret.txt")))
        XCTAssertThrowsError(try vault.open(attachment("file")))
    }
    func testRejectsHardLinkedAttachment() throws {
        let root = try workspace()
        let outside = try workspace()
        let source = outside.appendingPathComponent("source.txt")
        try Data("secret".utf8).write(to: source)
        try FileManager.default.linkItem(at: source, to: root.appendingPathComponent("hardlink.txt"))
        XCTAssertThrowsError(try AttachmentVault(root: root).open(attachment("hardlink.txt")))
    }
    func testCSVParsesQuotedValuesAndDoesNotEvaluateFormulas() throws {
        let root = try workspace()
        try Data("name,note\r\n\"A,B\",\"hello\nworld\"\r\n=1+1,ok".utf8).write(to: root.appendingPathComponent("a.csv"))
        let file = try AttachmentVault(root: root).open(attachment("a.csv", name: "a.csv"))
        XCTAssertEqual(try DelimitedText.rows(file: file), [["name", "note"], ["A,B", "hello\nworld"], ["=1+1", "ok"]])
    }
    func testImageDecoderInspectsActualBytes() throws {
        let root = try workspace()
        let bytes = try XCTUnwrap(Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="))
        try bytes.write(to: root.appendingPathComponent("a.png"))
        let image = try WorldsMedia.image(file: AttachmentVault(root: root).open(attachment("a.png", name: "a.png")))
        XCTAssertEqual(image.image.width, 1)
        XCTAssertEqual(image.frameCount, 1)
        try Data("not an image".utf8).write(to: root.appendingPathComponent("bad.png"))
        XCTAssertThrowsError(try WorldsMedia.image(file: AttachmentVault(root: root).open(attachment("bad.png"))))
    }
    func testUnsupportedOfficeFormatsAreHonest() {
        XCTAssertEqual(WorldsMedia.format(name: "sample.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), .unsupported)
        XCTAssertEqual(WorldsMedia.format(name: "sample.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), .unsupported)
    }
    func testReadLimitsAndPlaybackLease() throws {
        let root = try workspace()
        try Data("small".utf8).write(to: root.appendingPathComponent("a.mp4"))
        let file = try AttachmentVault(root: root).open(attachment("a.mp4", name: "a.mp4"))
        XCTAssertThrowsError(try file.read(maxBytes: 2))
        var lease: TemporaryMediaFile? = try file.playbackCopy(fileExtension: "mp4")
        let copied = try XCTUnwrap(lease?.url)
        XCTAssertEqual(try Data(contentsOf: copied), Data("small".utf8))
        lease = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: copied.path))
    }
    func testOpenedAttachmentUsesOriginalDescriptorAfterPathReplacement() throws {
        let root = try workspace()
        let path = root.appendingPathComponent("clip.mp4")
        try Data("original".utf8).write(to: path)
        let opened = try AttachmentVault(root: root).open(attachment("clip.mp4", name: "clip.mp4"))
        try FileManager.default.moveItem(at: path, to: root.appendingPathComponent("old.mp4"))
        try Data("replacement".utf8).write(to: path)
        let copy = try opened.playbackCopy(fileExtension: "mp4")
        XCTAssertEqual(try Data(contentsOf: copy.url), Data("original".utf8))
        XCTAssertEqual(try Data(contentsOf: path), Data("replacement".utf8))
    }
    func testChangedOpenAttachmentIsRejectedBeforeReadAndPlaybackCopy() throws {
        let root = try workspace()
        let path = root.appendingPathComponent("clip.mp4")
        try Data("original".utf8).write(to: path)
        let opened = try AttachmentVault(root: root).open(attachment("clip.mp4", name: "clip.mp4"))
        let writer = try FileHandle(forWritingTo: path)
        try writer.write(contentsOf: Data("modified".utf8)); try writer.close()
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: 1_600_000_000)], ofItemAtPath: path.path)
        XCTAssertThrowsError(try opened.read())
        XCTAssertThrowsError(try opened.playbackCopy(fileExtension: "mp4"))
        XCTAssertEqual(try Data(contentsOf: path), Data("modified".utf8))
    }
    func testHardLinkAddedAfterOpenIsRejected() throws {
        let root = try workspace()
        let path = root.appendingPathComponent("source.mp4")
        try Data("original".utf8).write(to: path)
        let opened = try AttachmentVault(root: root).open(attachment("source.mp4", name: "source.mp4"))
        try FileManager.default.linkItem(at: path, to: root.appendingPathComponent("other.mp4"))
        XCTAssertThrowsError(try opened.read())
        XCTAssertThrowsError(try opened.playbackCopy(fileExtension: "mp4"))
        XCTAssertEqual(try Data(contentsOf: path), Data("original".utf8))
    }
}
