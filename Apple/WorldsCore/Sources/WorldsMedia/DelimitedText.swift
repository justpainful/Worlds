import Foundation

public enum DelimitedText {
    /// Parses UTF-8 CSV or TSV without evaluating formulas or opening links.
    public static func rows(file: AttachmentFile, delimiter: Character = ",", maxRows: Int = 1000, maxColumns: Int = 100) throws -> [[String]] {
        guard delimiter == "," || delimiter == "\t", (1...10000).contains(maxRows), (1...1000).contains(maxColumns) else { throw MediaError.invalidContent }
        let text = try WorldsMedia.text(file: file)
        var rows: [[String]] = []
        var row: [String] = []
        var field = ""
        var quoted = false
        var justClosedQuote = false
        var i = text.startIndex
        func appendField() throws {
            guard row.count < maxColumns else { throw MediaError.tooLarge }
            row.append(field); field = ""; justClosedQuote = false
        }
        func appendRow() throws {
            try appendField()
            guard rows.count < maxRows else { throw MediaError.tooLarge }
            rows.append(row); row = []
        }
        while i < text.endIndex {
            let c = text[i]
            let next = text.index(after: i)
            if quoted {
                if c == "\"" {
                    if next < text.endIndex && text[next] == "\"" { field.append("\""); i = text.index(after: next); continue }
                    quoted = false; justClosedQuote = true
                } else { field.append(c) }
            } else if c == delimiter { try appendField() }
            else if c == "\n" || c == "\r" || c == "\r\n" { try appendRow() }
            else if c == "\"" && field.isEmpty && !justClosedQuote { quoted = true }
            else {
                guard !justClosedQuote && c != "\"" else { throw MediaError.invalidContent }
                field.append(c)
            }
            i = next
        }
        guard !quoted else { throw MediaError.invalidContent }
        if !field.isEmpty || !row.isEmpty || justClosedQuote { try appendRow() }
        return rows
    }
}
