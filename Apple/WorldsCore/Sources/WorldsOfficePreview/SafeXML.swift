import Foundation

/// Rejects DTD and entity declarations before XMLParser sees the bytes.
/// OOXML previews currently accept UTF-8 XML only.
final class SafeXML: NSObject, XMLParserDelegate {
    private let onStart: (String, [String: String]) throws -> Void
    private let onEnd: (String) throws -> Void
    private let onText: (String) throws -> Void
    private let limits: OfficeLimits
    private var depth = 0, count = 0
    private var failure: Error?
    init(limits: OfficeLimits, onStart: @escaping (String, [String: String]) throws -> Void, onEnd: @escaping (String) throws -> Void, onText: @escaping (String) throws -> Void) {
        self.limits = limits; self.onStart = onStart; self.onEnd = onEnd; self.onText = onText
    }
    func parse(_ data: Data) throws {
        guard limits.xmlDepth > 0, limits.xmlElements > 0, let text = String(data: data, encoding: .utf8),
              !text.lowercased().contains("<!doctype"), !text.lowercased().contains("<!entity") else { throw OfficePreviewError.invalidXML }
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.shouldProcessNamespaces = false
        parser.delegate = self
        let okay = parser.parse()
        if let failure { throw failure }
        guard okay, depth == 0 else { throw OfficePreviewError.invalidXML }
    }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        depth += 1; count += 1
        guard depth <= limits.xmlDepth, count <= limits.xmlElements, attributeDict.count <= 128 else { failure = OfficePreviewError.archiveLimit; parser.abortParsing(); return }
        do { try onStart(local(elementName), attributeDict) } catch { failure = error; parser.abortParsing() }
    }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        do { try onEnd(local(elementName)); depth -= 1 } catch { failure = error; parser.abortParsing() }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        do { try onText(string) } catch { failure = error; parser.abortParsing() }
    }
    func parser(_ parser: XMLParser, resolveExternalEntityName name: String, systemID: String?) -> Data? {
        failure = OfficePreviewError.invalidXML; parser.abortParsing(); return nil
    }
}
private func local(_ name: String) -> String { String(name.split(separator: ":").last ?? Substring(name)) }
