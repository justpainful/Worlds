#if DEBUG
import Foundation
import Darwin
import SQLite3
import XCTest
@testable import WorldsFixtureBundleImport

final class FixtureBundleImporterTests: XCTestCase {
    private func fixture() throws -> (URL, URL, URL) {
        let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("bundle-fixture-\(UUID().uuidString)", isDirectory: true)
        let source = root.appendingPathComponent("source", isDirectory: true), privateRoot = root.appendingPathComponent("private", isDirectory: true)
        try FileManager.default.createDirectory(at: source.appendingPathComponent("attachments/sub", isDirectory: true), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: privateRoot, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let fixture = try XCTUnwrap(Bundle.module.url(forResource: "worlds-v11", withExtension: "db"))
        let database = source.appendingPathComponent("worlds.db"); try FileManager.default.copyItem(at: fixture, to: database)
        var raw: OpaquePointer?
        guard sqlite3_open(database.path, &raw) == SQLITE_OK, let db = raw else { throw FixtureBundleError.invalidResult }
        let code = sqlite3_exec(db, "INSERT INTO attachments(id,page_id,kind,file_name,mime,size,rel_path,created_at) VALUES('bundle-a','fixture-page','file','a.bin','application/octet-stream',4,'sub/a.bin',1)", nil, nil, nil)
        sqlite3_close_v2(db); XCTAssertEqual(code, SQLITE_OK)
        try Data("safe".utf8).write(to: source.appendingPathComponent("attachments/sub/a.bin"))
        return (root, source, privateRoot)
    }
    func testFixtureBundleCopiesDataAndLeavesSourceUntouched() async throws {
        let (root, source, privateRoot) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        if let resolved = realpath(source.path, nil) {
            defer { free(resolved) }
            let actual = String(cString: resolved)
            let inputFirst = source.pathComponents.dropFirst().first ?? "none"
            let actualFirst = URL(fileURLWithPath: actual).pathComponents.dropFirst().first ?? "none"
            print("Fixture source path matches realpath: \(source.path == actual); first component: \(inputFirst); realpath first component: \(actualFirst)")
        }
        let database = source.appendingPathComponent("worlds.db"), before = try Data(contentsOf: database)
        let copy: URL
        do { copy = try await FixtureBundleImporter().prepare(source: source, privateRoot: privateRoot) }
        catch let error as FixtureBundleError {
            switch error {
            case .invalidPath: XCTFail("Fixture import rejected URL paths")
            case .invalidResult: XCTFail("Fixture import returned an invalid response")
            case .failed(let reason): XCTFail("Fixture import failed: \(reason)")
            }
            throw error
        }
        XCTAssertTrue(copy.deletingLastPathComponent().lastPathComponent.hasPrefix("worlds-unverified-bundle-"))
        XCTAssertEqual(try Data(contentsOf: copy.deletingLastPathComponent().appendingPathComponent("attachments/sub/a.bin")), Data("safe".utf8))
        XCTAssertEqual(try Data(contentsOf: database), before)
        XCTAssertEqual(try Data(contentsOf: source.appendingPathComponent("attachments/sub/a.bin")), Data("safe".utf8))
    }
    func testMissingAttachmentDoesNotPublishBundle() async throws {
        let (root, source, privateRoot) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.removeItem(at: source.appendingPathComponent("attachments/sub/a.bin"))
        do { _ = try await FixtureBundleImporter().prepare(source: source, privateRoot: privateRoot); XCTFail("Missing file must fail") }
        catch FixtureBundleError.failed(_) { }
        catch { XCTFail("Expected a missing-file import failure, got \(error)") }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: privateRoot.path).isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.appendingPathComponent("worlds.db").path))
    }
}
#endif
