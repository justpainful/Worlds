import XCTest
@testable import WorldsModels

final class StreamFormatTests: XCTestCase {
    func testDelimitersBeforeVariationSelectors() {
        XCTAssertEqual(worldsStreamFormat("https://example.invalid/video.mpd?\u{FE0F}x"), "dash")
        XCTAssertEqual(worldsStreamFormat("https://example.invalid/live.M3U8#\u{FE0F}x"), "hls")
        XCTAssertEqual(worldsStreamFormat("https://example.invalid/video.mp4?file=.mpd"), "progressive")
    }
}
