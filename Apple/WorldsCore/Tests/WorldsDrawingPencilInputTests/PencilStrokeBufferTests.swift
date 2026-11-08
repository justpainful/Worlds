import XCTest
import WorldsDrawing
@testable import WorldsDrawingPencilInput

final class PencilStrokeBufferTests: XCTestCase {
    func testPencilPressureAndOrientation() throws {
        let sample = PencilRawSample(x: 1,y: 2,force: 2,maximumForce: 4,altitude: .pi / 4,azimuth: 0,timeMilliseconds: 100,isPencil: true,hasPendingEstimates: false)
        let value = try PencilSampleConversion.convert(sample)
        XCTAssertEqual(value.pressure, 0.5, accuracy: 0.00001)
        XCTAssertEqual(value.tiltX, 45); XCTAssertEqual(value.tiltY, 0)
    }
    func testPendingEstimateFailsWithoutDiscardingRawSamples() throws {
        var buffer = PencilStrokeBuffer()
        try buffer.append(PencilRawSample(x: 1,y: 2,force: 1,maximumForce: 2,altitude: .pi / 2,azimuth: 0,timeMilliseconds: 1,isPencil: true,hasPendingEstimates: true))
        XCTAssertThrowsError(try buffer.finalized(brush: ToolBrush())) { XCTAssertEqual($0 as? PencilInputError, .unresolvedEstimate) }
        XCTAssertEqual(buffer.rawSamples.count, 1)
    }
    func testMoveSmoothingAndReleasePressureMatchSource() throws {
        var buffer = PencilStrokeBuffer()
        try buffer.append(PencilRawSample(x: 0,y: 0,force: 1,maximumForce: 2,altitude: .pi / 2,azimuth: 0,timeMilliseconds: 1,isPencil: true,hasPendingEstimates: false))
        try buffer.append(PencilRawSample(x: 10,y: 0,force: 1.5,maximumForce: 2,altitude: .pi / 2,azimuth: 0,timeMilliseconds: 2,isPencil: true,hasPendingEstimates: false))
        try buffer.append(PencilRawSample(x: 20,y: 0,force: 0,maximumForce: 2,altitude: .pi / 2,azimuth: 0,timeMilliseconds: 3,isPencil: true,hasPendingEstimates: false,isRelease: true))
        var brush = ToolBrush(); brush.smoothing = 0.5
        let samples = try buffer.finalized(brush: brush)
        XCTAssertEqual(samples[1].x, 5, accuracy: 0.00001)
        XCTAssertEqual(samples[2].x, 20, accuracy: 0.00001)
        XCTAssertEqual(samples[2].pressure, 0.75, accuracy: 0.00001)
    }
}
