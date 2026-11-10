import Foundation

/// Matches Worlds stream classification by examining UTF-8 before the first
/// query or fragment delimiter. Validation of the URL is a separate step.
public func worldsStreamFormat(_ link: String) -> String {
    let path = String(decoding: link.utf8.prefix { $0 != 63 && $0 != 35 }, as: UTF8.self).lowercased()
    if path.hasSuffix(".m3u8") || path.hasSuffix(".m3u") { return "hls" }
    if path.hasSuffix(".mpd") { return "dash" }
    return "progressive"
}
