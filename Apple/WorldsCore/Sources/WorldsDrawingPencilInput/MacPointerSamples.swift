import Foundation

/// AppKit pressure is normalized to 0...1. This adapter intentionally does
/// not claim that AppKit tilt has the same semantics as Pointer Events tilt.
public enum MacPointerSamples {
    public static func make(x: Double, y: Double, pressure: Double, timestamp: Double,
                            isTablet: Bool, isRelease: Bool) throws -> PencilRawSample {
        guard [x, y, pressure, timestamp].allSatisfy(\.isFinite), timestamp >= 0,
              !isTablet || (0...1).contains(pressure) else { throw PencilInputError.invalidSample }
        return PencilRawSample(x: x, y: y, force: isTablet ? pressure : 1, maximumForce: 1,
            altitude: .pi / 2, azimuth: 0, timeMilliseconds: timestamp,
            isPencil: isTablet, hasPendingEstimates: false, isRelease: isRelease)
    }
}
