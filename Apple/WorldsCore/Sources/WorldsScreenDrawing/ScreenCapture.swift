#if os(macOS)
import AppKit
import CoreGraphics
import ScreenCaptureKit

public enum ScreenCaptureError: Error, Equatable {
    case permissionRequired, displayUnavailable, invalidDimensions
}

/// The caller chooses a display and explicitly starts capture. No stream is kept.
@MainActor
public protocol ScreenImageSource {
    func capture(displayID: CGDirectDisplayID) async throws -> CGImage
}

@MainActor
public struct ScreenCaptureSource: ScreenImageSource {
    public init() {}
    public var hasPermission: Bool { CGPreflightScreenCaptureAccess() }
    public func capture(displayID: CGDirectDisplayID) async throws -> CGImage {
        guard hasPermission else { throw ScreenCaptureError.permissionRequired }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first(where: { $0.displayID == displayID }),
              CGDisplayIsOnline(displayID) != 0 else { throw ScreenCaptureError.displayUnavailable }
        let width = CGDisplayPixelsWide(displayID), height = CGDisplayPixelsHigh(displayID)
        guard width > 0, height > 0, width <= 16384, height <= 16384,
              width <= (64 * 1024 * 1024) / height else { throw ScreenCaptureError.invalidDimensions }
        let ownApps = content.applications.filter { $0.processID == ProcessInfo.processInfo.processIdentifier }
        let filter = SCContentFilter(display: display, excludingApplications: ownApps, exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.width = width; config.height = height
        config.showsCursor = false
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }
}
#endif
