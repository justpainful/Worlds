import SwiftUI
import WorldsMedia
import WorldsOfficePreview

public enum OfficeContent: Sendable, Equatable {
    case word(WordPreview)
    case workbook(WorkbookPreview)
}

public enum OfficeLoadError: Error, Equatable { case unsupported }

/// Isolated read-only Office preview. Authorization must be checked by the host
/// before it passes a trusted root and attachment; the vault is not an ACL.
public enum OfficeContentLoader {
    public static func load(attachment: WorldsAttachment, root: URL) throws -> OfficeContent {
        let ext = (attachment.fileName as NSString).pathExtension.lowercased()
        guard ext == "docx" || ext == "xlsx" else { throw OfficeLoadError.unsupported }
        let file = try AttachmentVault(root: root).open(attachment)
        return ext == "docx" ? .word(try OfficePreview.docx(file: file)) : .workbook(try OfficePreview.xlsx(file: file))
    }
}

/// Displays only data returned by the bounded parser. The limitations are
/// visible because this is not a faithful document or spreadsheet renderer.
public struct OfficeContentView: View {
    public let content: OfficeContent
    @State private var selectedSheet = 0
    public init(content: OfficeContent) { self.content = content }

    public var body: some View {
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 16) {
                switch content {
                case .word(let word):
                    limitations(word.limitations)
                    ForEach(Array(word.paragraphs.enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph.isEmpty ? " " : paragraph).textSelection(.enabled)
                    }
                case .workbook(let workbook):
                    limitations(workbook.limitations)
                    if workbook.sheets.isEmpty {
                        Text("No worksheets")
                    } else {
                        Picker("Worksheet", selection: $selectedSheet) {
                            ForEach(workbook.sheets.indices, id: \.self) { index in
                                Text(workbook.sheets[index].name).tag(index)
                            }
                        }.pickerStyle(.menu)
                        if workbook.sheets.indices.contains(selectedSheet) {
                            ForEach(Array(workbook.sheets[selectedSheet].rows.enumerated()), id: \.offset) { _, row in
                                HStack(alignment: .top, spacing: 16) {
                                    Text(String(row.number)).foregroundStyle(.secondary)
                                    ForEach(Array(row.cells.enumerated()), id: \.offset) { _, cell in
                                        VStack(alignment: .leading) {
                                            Text(cell.reference).font(.caption).foregroundStyle(.secondary)
                                            Text(cell.value).textSelection(.enabled)
                                            if let formula = cell.formula { Text("=\(formula)").font(.caption).textSelection(.enabled) }
                                        }.frame(minWidth: 80, alignment: .leading)
                                    }
                                }
                            }
                        }
                    }
                }
            }.padding().frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private func limitations(_ values: [String]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(values, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
        }.accessibilityLabel("Preview limitations")
    }
}

