import Foundation
import WorldsMedia

public struct WordPreview: Sendable, Equatable {
    public let paragraphs: [String]
    public let limitations: [String]
}
public struct SpreadsheetCell: Sendable, Equatable {
    public let reference: String
    public let value: String
    public let formula: String?
}
public struct SpreadsheetRow: Sendable, Equatable {
    public let number: Int
    public let cells: [SpreadsheetCell]
}
public struct SpreadsheetSheet: Sendable, Equatable {
    public let name: String
    public let rows: [SpreadsheetRow]
}
public struct WorkbookPreview: Sendable, Equatable {
    public let sheets: [SpreadsheetSheet]
    public let limitations: [String]
}

public enum OfficePreview {
    public static func docx(file: AttachmentFile, limits: OfficeLimits = OfficeLimits()) throws -> WordPreview {
        try docx(data: file.read(maxBytes: limits.archiveBytes), limits: limits)
    }
    public static func docx(data: Data, limits: OfficeLimits = OfficeLimits()) throws -> WordPreview {
        let archive = try OfficeArchive(data: data, limits: limits)
        let xml = try archive.data(for: "word/document.xml")
        var paragraphs: [String] = [], paragraph: String?, inText = false
        let parser = SafeXML(limits: limits, onStart: { name, _ in
            switch name {
            case "p": guard paragraph == nil else { throw OfficePreviewError.invalidDocument }; paragraph = ""
            case "t": inText = true
            case "tab": if paragraph != nil { paragraph! += "\t" }
            case "br", "cr": if paragraph != nil { paragraph! += "\n" }
            default: break
            }
        }, onEnd: { name in
            if name == "t" { inText = false }
            if name == "p", let value = paragraph {
                guard paragraphs.count < 10_000 else { throw OfficePreviewError.archiveLimit }
                paragraphs.append(value); paragraph = nil
            }
        }, onText: { text in if inText, paragraph != nil { paragraph! += text } })
        try parser.parse(xml)
        return WordPreview(paragraphs: paragraphs, limitations: ["Text-only preview; formatting, layout, images, tracked changes and embedded objects are not fully represented."])
    }

    public static func xlsx(file: AttachmentFile, limits: OfficeLimits = OfficeLimits()) throws -> WorkbookPreview {
        try xlsx(data: file.read(maxBytes: limits.archiveBytes), limits: limits)
    }
    public static func xlsx(data: Data, limits: OfficeLimits = OfficeLimits()) throws -> WorkbookPreview {
        let archive = try OfficeArchive(data: data, limits: limits)
        let shared = archive.has("xl/sharedStrings.xml") ? try parseShared(archive.data(for: "xl/sharedStrings.xml"), limits: limits) : []
        let links = try parseRelationships(archive.data(for: "xl/_rels/workbook.xml.rels"), limits: limits)
        let sheets = try parseWorkbook(archive.data(for: "xl/workbook.xml"), limits: limits)
        guard sheets.count <= 32 else { throw OfficePreviewError.archiveLimit }
        var previews: [SpreadsheetSheet] = []
        for (name, id) in sheets {
            guard let path = links[id] else { throw OfficePreviewError.invalidDocument }
            previews.append(SpreadsheetSheet(name: name, rows: try parseSheet(archive.data(for: path), shared: shared, limits: limits)))
        }
        return WorkbookPreview(sheets: previews, limitations: ["Cell values are shown without layout, charts, style or recalculation; formulas are not executed."])
    }
}

private func parseRelationships(_ data: Data, limits: OfficeLimits) throws -> [String: String] {
    var links: [String: String] = [:]
    let parser = SafeXML(limits: limits, onStart: { name, attrs in
        guard name == "Relationship", attrs["Type"]?.hasSuffix("/worksheet") == true else { return }
        guard attrs["TargetMode"]?.lowercased() != "external", let id = attrs["Id"], let target = attrs["Target"], links[id] == nil,
              !target.contains("%"), !target.contains("?"), !target.contains("#") else { throw OfficePreviewError.invalidPath }
        let path = target.hasPrefix("/xl/") ? String(target.dropFirst()) : (target.hasPrefix("xl/") ? target : "xl/" + target)
        guard path.hasPrefix("xl/worksheets/"), validArchivePath(path) else { throw OfficePreviewError.invalidPath }
        links[id] = path
    }, onEnd: { _ in }, onText: { _ in })
    try parser.parse(data)
    return links
}
private func parseWorkbook(_ data: Data, limits: OfficeLimits) throws -> [(String, String)] {
    var sheets: [(String, String)] = []
    let parser = SafeXML(limits: limits, onStart: { name, attrs in
        guard name == "sheet" else { return }
        guard let label = attrs["name"], let id = attrs["r:id"] ?? attrs["id"], !label.isEmpty, sheets.count < 32 else { throw OfficePreviewError.invalidDocument }
        sheets.append((label, id))
    }, onEnd: { _ in }, onText: { _ in })
    try parser.parse(data)
    return sheets
}
private func parseShared(_ data: Data, limits: OfficeLimits) throws -> [String] {
    var strings: [String] = [], current: String?, inText = false
    let parser = SafeXML(limits: limits, onStart: { name, _ in
        if name == "si" { current = "" }
        if name == "t" { inText = true }
    }, onEnd: { name in
        if name == "t" { inText = false }
        if name == "si", let value = current {
            guard strings.count < 100_000 else { throw OfficePreviewError.archiveLimit }
            strings.append(value); current = nil
        }
    }, onText: { text in if inText, current != nil { current! += text } })
    try parser.parse(data)
    return strings
}
private func parseSheet(_ data: Data, shared: [String], limits: OfficeLimits) throws -> [SpreadsheetRow] {
    var rows: [SpreadsheetRow] = [], rowNumber: Int?, cells: [SpreadsheetCell] = []
    var ref: String?, type = "", value = "", formula: String?, current: String?
    var totalCells = 0
    let parser = SafeXML(limits: limits, onStart: { name, attrs in
        switch name {
        case "row":
            guard rowNumber == nil, let n = attrs["r"].flatMap(Int.init), n > 0, n <= 1_048_576, rows.count < 1000 else { throw OfficePreviewError.archiveLimit }
            rowNumber = n; cells = []
        case "c":
            guard rowNumber != nil, ref == nil, let r = attrs["r"], validCellReference(r) else { throw OfficePreviewError.invalidDocument }
            ref = r; type = attrs["t"] ?? ""; value = ""; formula = nil
        case "v", "f", "t": current = name
        default: break
        }
    }, onEnd: { name in
        if ["v", "f", "t"].contains(name) { current = nil }
        if name == "c", let reference = ref {
            totalCells += 1
            guard cells.count < 1000, totalCells <= 100_000 else { throw OfficePreviewError.archiveLimit }
            let display: String
            if type == "s" {
                guard let index = Int(value), index >= 0, index < shared.count else { throw OfficePreviewError.invalidDocument }
                display = shared[index]
            } else if type == "b" { display = value == "1" ? "TRUE" : "FALSE" }
            else { display = value }
            cells.append(SpreadsheetCell(reference: reference, value: display, formula: formula)); ref = nil
        }
        if name == "row", let n = rowNumber { rows.append(SpreadsheetRow(number: n, cells: cells)); rowNumber = nil }
    }, onText: { text in
        guard ref != nil else { return }
        if current == "f" { formula = (formula ?? "") + text }
        else if current == "v" || current == "t" { value += text }
    })
    try parser.parse(data)
    return rows
}
private func validCellReference(_ value: String) -> Bool {
    let chars = Array(value.utf8)
    guard !chars.isEmpty, chars.count <= 10 else { return false }
    let prefix = chars.prefix { (65...90).contains($0) }
    let digits = chars.dropFirst(prefix.count)
    guard !prefix.isEmpty, prefix.count <= 3, !digits.isEmpty, digits.allSatisfy({ (48...57).contains($0) }), digits.first != 48 else { return false }
    return true
}
