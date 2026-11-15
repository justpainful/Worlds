import Foundation
import XCTest
@testable import WorldsModels

final class HTMLPageDocumentTests: XCTestCase {
    private func compose(_ source: String, state: JSONValue? = nil, lang: String = "en") -> String {
        HTMLPageDocument.compose(source: source, state: state, lang: lang, baseCSS: "/*base*/", runtimeJS: "/*runtime*/", extraHead: "<meta data-extra>")
    }
    private func index(_ needle: String, in text: String) -> Int {
        text.range(of: needle).map { text.distance(from: text.startIndex, to: $0.lowerBound) } ?? -1
    }

    func testFragmentGetsTheAppLanguageAndTheBaseFirst() {
        let doc = compose("<p>Hello</p>", lang: "ar")
        XCTAssertTrue(doc.hasPrefix("<!doctype html><html lang=\"ar\" dir=\"rtl\"><head><meta charset=\"utf-8\">"))
        XCTAssertLessThan(index("<meta data-extra>", in: doc), index("data-worlds-base", in: doc))
        XCTAssertLessThan(index("data-worlds-base", in: doc), index("/*runtime*/", in: doc))
        XCTAssertLessThan(index("/*runtime*/", in: doc), index("<p>Hello</p>", in: doc))
        XCTAssertTrue(compose("<p>x</p>", lang: "de").hasPrefix("<!doctype html><html lang=\"en\"><head>"))
    }

    func testFullDocumentKeepsItsOwnLanguageAndStylesWin() {
        let doc = compose("<!DOCTYPE html><HTML Lang=\"en\"><Head><title>T</title><style>p{}</style></head><body><p>x</p></body></html>",
                          state: .object(["n": .integer(1)]), lang: "ar")
        XCTAssertTrue(doc.hasPrefix("<!DOCTYPE html><HTML Lang=\"en\"><Head>"))
        XCTAssertFalse(doc.contains("dir=\"rtl\""))
        let base = index("data-worlds-base", in: doc)
        XCTAssertTrue(base > index("<Head>", in: doc) && base < index("<title>", in: doc))
        XCTAssertTrue(doc.contains("\"state\":{\"n\":1}"))
    }

    func testDocumentWithoutLanguageOrHeadGetsBoth() {
        let doc = compose("<html class=\"x\"><body><header>h</header></body></html>", lang: "ar")
        XCTAssertTrue(doc.hasPrefix("<!doctype html><html class=\"x\" lang=\"ar\" dir=\"rtl\"><head><meta charset"))
        XCTAssertTrue(doc.contains("</head><body><header>h</header>"))
        XCTAssertTrue(compose("<html data-lang=\"fr\"><p>x</p></html>").contains("<html data-lang=\"fr\" lang=\"en\">"))
    }

    func testSavedStateCannotCloseTheBootScript() throws {
        let doc = compose("<p>x</p>", state: .string("</script><script>alert(1)</script>"))
        XCTAssertFalse(doc.contains("</script><script>alert(1)"))
        let start = try XCTUnwrap(doc.range(of: "window.__worldsBoot="))
        let end = try XCTUnwrap(doc.range(of: ";</script>", range: start.upperBound..<doc.endIndex))
        let boot = try JSONDecoder().decode(JSONValue.self, from: Data(doc[start.upperBound..<end.lowerBound].utf8))
        XCTAssertEqual(boot, .object(["lang": .string("en"), "state": .string("</script><script>alert(1)</script>")]))
    }

    func testNonASCIIBeforeTheTagKeepsIndexes() {
        let doc = compose("<!-- İİİ عربي --><html><head></head><body>ok</body></html>")
        XCTAssertTrue(doc.hasPrefix("<!doctype html><!-- İİİ عربي --><html lang=\"en\"><head><meta charset"))
        XCTAssertTrue(doc.hasSuffix("</head><body>ok</body></html>"))
    }

    func testReadsSourceAndStateFromMetadata() {
        XCTAssertEqual(HTMLPageDocument.read(metadataJSON: #"{"html":{"source":"<p>a</p>","state":null}}"#).source, "<p>a</p>")
        XCTAssertNil(HTMLPageDocument.read(metadataJSON: #"{"html":{"source":"<p>a</p>","state":null}}"#).state)
        XCTAssertEqual(HTMLPageDocument.read(metadataJSON: #"{"html":{"source":"s","state":{"done":[1]}}}"#).state, .object(["done": .array([.integer(1)])]))
        XCTAssertEqual(HTMLPageDocument.read(metadataJSON: "not json").source, "")
        XCTAssertTrue(HTMLPageDocument.isPageID("a1_B-2"))
        XCTAssertFalse(HTMLPageDocument.isPageID("../x"))
        XCTAssertFalse(HTMLPageDocument.isPageID(""))
    }

    /// The app bundles src/htmlpage itself; the runtime must still send what the app's bridge reads.
    func testSharedRuntimeStillSpeaksTheMessagesTheBridgeExpects() throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../")
        let runtime = try String(contentsOf: repository.appendingPathComponent("src/htmlpage/runtime.js"), encoding: .utf8)
        for marker in ["worldsHtmlPage = 1", "type: \"save\"", "type: \"openPage\"", "type: \"openLink\"", "window.__worldsBoot"] {
            XCTAssertTrue(runtime.contains(marker), marker)
        }
        let css = try String(contentsOf: repository.appendingPathComponent("src/htmlpage/base.css"), encoding: .utf8)
        for font in ["instrument-sans.woff2", "plex-arabic-400.woff2", "plex-arabic-600.woff2", "plex-mono-500.woff2"] {
            XCTAssertTrue(css.contains("/_w/fonts/\(font)"), font)
        }
    }
}
