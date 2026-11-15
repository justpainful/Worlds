import Foundation

/// HTML pages (docs/HTML_PAGES.md): the document a page's web view receives.
/// It follows `compose` in src-tauri/src/html_page.rs: the Worlds base styles
/// and runtime go first in `<head>` so the page's own styles win, the boot data
/// cannot close its script, and a page that sets no language gets the app's.
public enum HTMLPageDocument {
    public static let kind = "html"
    public static let maxStateBytes = 256 * 1024

    /// The page's source and saved state from its metadata (`html.source`, `html.state`).
    public static func read(metadataJSON: String) -> (source: String, state: JSONValue?) {
        guard let metadata = try? JSONDecoder().decode(JSONValue.self, from: Data(metadataJSON.utf8)),
              case .object(let object) = metadata, case .object(let html)? = object["html"] else { return ("", nil) }
        var source = ""
        if case .string(let text)? = html["source"] { source = text }
        let state = html["state"].flatMap { $0 == .null ? nil : $0 }
        return (source, state)
    }

    public static func isPageID(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 128 && id.unicodeScalars.allSatisfy { $0.isASCII && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }
    }

    /// `extraHead` goes right after the viewport, before the base styles and
    /// the runtime: the platform's own policy and message bridge.
    public static func compose(source: String, state: JSONValue?, lang: String, baseCSS: String, runtimeJS: String, extraHead: String = "") -> String {
        let language = lang == "ar" ? "ar" : "en"
        let head = "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\(extraHead)"
            + "<style data-worlds-base>\(baseCSS)</style><script>window.__worldsBoot=\(boot(state: state, lang: language));</script><script>\(runtimeJS)</script>"
        let langAttributes = language == "ar" ? " lang=\"ar\" dir=\"rtl\"" : " lang=\"en\""
        // Work on bytes, lowered as ASCII only, so every index matches the source.
        let bytes = Array(source.utf8)
        let lower = bytes.map { $0 >= 65 && $0 <= 90 ? $0 + 32 : $0 }
        func text(_ range: Range<Int>) -> String { String(decoding: bytes[range], as: UTF8.self) }
        guard let html = firstTag(lower, "html", from: 0) else {
            return "<!doctype html><html\(langAttributes)><head>\(head)</head><body>\(source)</body></html>"
        }
        var document = ""
        document.reserveCapacity(bytes.count + head.utf8.count + 64)
        if attribute(Array(lower[html]), "lang") {
            document += text(0..<html.upperBound)
        } else {
            document += text(0..<(html.upperBound - 1)) + langAttributes + ">"
        }
        if let afterHead = firstTag(lower, "head", from: html.upperBound)?.upperBound {
            document += text(html.upperBound..<afterHead) + head + text(afterHead..<bytes.count)
        } else {
            document += "<head>" + head + "</head>" + text(html.upperBound..<bytes.count)
        }
        let start = lower.firstIndex { !(" \t\n\r\u{0C}".utf8.contains($0)) } ?? lower.count
        let doctype = Array("<!doctype".utf8)
        if !lower[start...].starts(with: doctype) { document = "<!doctype html>" + document }
        return document
    }

    private struct Boot: Encodable {
        let lang: String
        let state: JSONValue
    }

    private static func boot(state: JSONValue?, lang: String) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = (try? encoder.encode(Boot(lang: lang, state: state ?? .null))) ?? Data("{\"lang\":\"\(lang)\",\"state\":null}".utf8)
        return String(decoding: data, as: UTF8.self).replacingOccurrences(of: "</", with: "<\\/")
    }

    /// The first opening tag `<name` at or after `from`, from `<` to just past its `>`.
    private static func firstTag(_ lower: [UInt8], _ name: String, from: Int) -> Range<Int>? {
        let open = Array("<\(name)".utf8)
        var at = from
        while at + open.count <= lower.count {
            guard let start = find(open, in: lower, from: at) else { return nil }
            let after = start + open.count
            if after < lower.count, [0x20, 0x09, 0x0A, 0x0D, 0x0C, 0x3E, 0x2F].contains(lower[after]) {
                let end = lower[after...].firstIndex(of: 0x3E).map { $0 + 1 } ?? lower.count
                return start..<end
            }
            at = after
        }
        return nil
    }

    /// Whether one opening tag sets `name`, quoted or not.
    private static func attribute(_ tag: [UInt8], _ name: String) -> Bool {
        let needle = Array(name.utf8)
        var from = 0
        while let start = find(needle, in: tag, from: from) {
            let before = start == 0 ? 0x20 : tag[start - 1]
            var index = start + needle.count
            while index < tag.count, [0x20, 0x09, 0x0A, 0x0D, 0x0C].contains(tag[index]) { index += 1 }
            if [0x20, 0x09, 0x0A, 0x0D, 0x0C, 0x3C].contains(before), index < tag.count, tag[index] == 0x3D { return true }
            from = start + needle.count
        }
        return false
    }

    private static func find(_ needle: [UInt8], in haystack: [UInt8], from: Int) -> Int? {
        guard !needle.isEmpty, haystack.count >= needle.count, from <= haystack.count - needle.count else { return nil }
        var index = from
        while index <= haystack.count - needle.count {
            if haystack[index] == needle[0], haystack[index..<(index + needle.count)].elementsEqual(needle) { return index }
            index += 1
        }
        return nil
    }
}
