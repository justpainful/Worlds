import Foundation
import WorldsDrawing

public enum PencilCancellationReason: Sendable { case systemCancelled, invalidInput }

public enum PencilInputError: Error, Equatable { case invalidSample, unresolvedEstimate, cancelled, empty }

/// Pointer coordinates must already be transformed into the drawing frame.
public struct PencilRawSample: Sendable, Equatable {
    public let x: Double, y: Double, force: Double, maximumForce: Double
    public let altitude: Double, azimuth: Double, timeMilliseconds: Double
    public let isPencil: Bool, hasPendingEstimates: Bool, isRelease: Bool
    public init(x: Double, y: Double, force: Double, maximumForce: Double, altitude: Double, azimuth: Double, timeMilliseconds: Double, isPencil: Bool, hasPendingEstimates: Bool, isRelease: Bool = false) {
        self.x = x; self.y = y; self.force = force; self.maximumForce = maximumForce
        self.altitude = altitude; self.azimuth = azimuth; self.timeMilliseconds = timeMilliseconds
        self.isPencil = isPencil; self.hasPendingEstimates = hasPendingEstimates; self.isRelease = isRelease
    }
}

/// Does not silently commit provisional force/location estimates.
public enum PencilSampleConversion {
    public static func convert(_ raw: PencilRawSample) throws -> ToolSample {
        guard [raw.x, raw.y, raw.force, raw.maximumForce, raw.altitude, raw.azimuth, raw.timeMilliseconds].allSatisfy(\.isFinite),
              raw.timeMilliseconds >= 0 else { throw PencilInputError.invalidSample }
        guard !raw.hasPendingEstimates else { throw PencilInputError.unresolvedEstimate }
        guard raw.isPencil else { return ToolSample(x: raw.x, y: raw.y, pressure: 1, time: raw.timeMilliseconds) }
        guard raw.maximumForce > 0, (0...Double.pi / 2).contains(raw.altitude) else { throw PencilInputError.invalidSample }
        let pressure = min(1, max(0.01, raw.force / raw.maximumForce))
        let azimuth = raw.azimuth.truncatingRemainder(dividingBy: 2 * .pi)
        let horizontal = cos(raw.altitude)
        let vertical = sin(raw.altitude)
        let x = atan2(cos(azimuth) * horizontal, vertical) * 180 / .pi
        let y = atan2(sin(azimuth) * horizontal, vertical) * 180 / .pi
        // Pointer Events uses JavaScript Math.round, including negative halves.
        return ToolSample(x: raw.x, y: raw.y, pressure: pressure, tiltX: floor(x + 0.5), tiltY: floor(y + 0.5), time: raw.timeMilliseconds)
    }
}

/// Matches the source's coordinate smoothing for movement; pressure and tilt
/// remain those of the incoming sample.
public struct PencilStrokeBuffer {
    public private(set) var rawSamples: [PencilRawSample] = []
    public init() {}
    public mutating func append(_ sample: PencilRawSample) throws {
        guard rawSamples.count < 100_000 else { throw PencilInputError.invalidSample }
        rawSamples.append(sample)
    }
    public func finalized(brush: ToolBrush) throws -> [ToolSample] {
        guard !rawSamples.isEmpty else { throw PencilInputError.empty }
        guard brush.smoothing.isFinite, (0...0.95).contains(brush.smoothing), brush.stabilizer.isFinite, (0...100).contains(brush.stabilizer) else { throw PencilInputError.invalidSample }
        var result: [ToolSample] = []
        for raw in rawSamples {
            var sample = try PencilSampleConversion.convert(raw)
            if let previous = result.last, raw.isRelease {
                sample.pressure = previous.pressure
            } else if let previous = result.last {
                let d = hypot(sample.x - previous.x, sample.y - previous.y)
                if d != 0 {
                    let a = (1 - brush.smoothing) * (brush.stabilizer != 0 ? min(1, d / brush.stabilizer) : 1)
                    sample.x = previous.x + (sample.x - previous.x) * a
                    sample.y = previous.y + (sample.y - previous.y) * a
                }
            }
            result.append(sample)
        }
        return result
    }
}
