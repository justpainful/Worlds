import Foundation
import XCTest
@testable import WorldsDrawing

final class StrokeDabEngineTests: XCTestCase {
    struct Fixture: Decodable {
        let samples: [ToolSample]
        let brush: ToolBrush
        let spray: ToolBrush
        let hard: [StrokeDab]
        let sprayDabs: [StrokeDab]
    }
    func testOriginalDabGeometryAndSeededSpray() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "original-dabs-fixture", withExtension: "json"))
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        try compare(StrokeDabEngine.generate(samples: fixture.samples, brush: fixture.brush, seed: 123), fixture.hard)
        try compare(StrokeDabEngine.generate(samples: fixture.samples, brush: fixture.spray, seed: 123), fixture.sprayDabs)
    }
    private func compare(_ actual: [StrokeDab], _ expected: [StrokeDab]) throws {
        XCTAssertEqual(actual.count, expected.count)
        for (a, b) in zip(actual, expected) {
            for (x, y) in zip([a.x,a.y,a.size,a.opacity,a.angle,a.roundness,a.noise], [b.x,b.y,b.size,b.opacity,b.angle,b.roundness,b.noise]) {
                XCTAssertEqual(x, y, accuracy: 1e-10)
            }
        }
    }
    func testRejectsUnboundedWork() {
        let samples = [ToolSample(x: 0, y: 0, pressure: 1, time: 0), ToolSample(x: 1e12, y: 0, pressure: 1, time: 1)]
        XCTAssertThrowsError(try StrokeDabEngine.generate(samples: samples, brush: ToolBrush()))
    }
}
