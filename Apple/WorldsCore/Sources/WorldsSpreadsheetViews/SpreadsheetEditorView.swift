import Foundation
import SwiftUI
import WorldsSpreadsheet

private enum SpreadsheetFocus: Hashable { case grid, formula }

/// A spreadsheet grid with a formula bar and sheet tabs.
///
/// Cells keep a left to right column order in every language, like any
/// spreadsheet; labels and controls follow the interface language.
/// Keyboard: arrows move, Return edits and confirms, Tab and Shift Tab move
/// across, Escape cancels, Delete clears. On touch, tap a cell to select it and
/// tap it again (or the formula bar) to edit.
public struct SpreadsheetEditorView: View {
    @ObservedObject private var model: SpreadsheetEditorModel
    @FocusState private var focus: SpreadsheetFocus?
    @ScaledMetric(relativeTo: .body) private var rowHeight: CGFloat = SpreadsheetMetrics.rowHeight
    @ScaledMetric(relativeTo: .body) private var headerWidth: CGFloat = 44

    public init(model: SpreadsheetEditorModel) { self.model = model }

    public var body: some View {
        VStack(spacing: 0) {
            formulaBar
            Divider()
            grid
            Divider()
            sheetBar
        }
        .onChange(of: model.workbook.activeSheetID) { _, _ in if focus == .formula { focus = .grid } }
    }

    // MARK: Formula bar

    private var formulaBar: some View {
        HStack(spacing: 8) {
            Text(verbatim: model.selection.key)
                .font(.callout.monospaced().weight(.semibold))
                .lineLimit(1)
                .frame(minWidth: 52)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                .accessibilityLabel(Text("Selected cell"))
                .accessibilityValue(Text(verbatim: model.selection.key))
            Image(systemName: "function")
                .font(.callout.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            if model.isEditable {
                TextField("Enter a value or a formula", text: $model.draft)
                    .textFieldStyle(.plain)
                    .font(.callout.monospaced())
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.next)
                    #endif
                    .focused($focus, equals: .formula)
                    .onSubmit { commitAndMove(rows: 1, columns: 0) }
                    .onKeyPress(keys: [.tab], phases: .down) { press in
                        commitAndMove(rows: 0, columns: press.modifiers.contains(.shift) ? -1 : 1)
                        return .handled
                    }
                    .onKeyPress(.escape) {
                        model.cancelDraft()
                        focus = .grid
                        return .handled
                    }
                    .accessibilityLabel(Text("Formula bar"))
                    .accessibilityIdentifier("spreadsheet-formula-field")
                if focus == .formula || model.draftIsPending {
                    Button {
                        model.cancelDraft()
                        focus = .grid
                    } label: {
                        Label("Cancel edit", systemImage: "xmark.circle.fill")
                    }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.secondary)
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("spreadsheet-cancel-edit")
                    Button {
                        commitAndMove(rows: 1, columns: 0)
                    } label: {
                        Label("Confirm value", systemImage: "checkmark.circle.fill")
                    }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.tint)
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("spreadsheet-confirm-edit")
                }
            } else {
                Text(verbatim: model.draft)
                    .font(.callout.monospaced())
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel(Text("Formula bar"))
            }
        }
        .environment(\.layoutDirection, .leftToRight)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private func commitAndMove(rows: Int, columns: Int) {
        model.commitDraft()
        model.move(rows: rows, columns: columns)
        focus = .grid
    }

    // MARK: Grid

    private var scale: CGFloat { rowHeight / SpreadsheetMetrics.rowHeight }

    private func columnWidth(_ column: Int) -> CGFloat {
        let stored = model.activeSheet.columnWidth(column).map { CGFloat(min(max($0, 32), 600)) } ?? SpreadsheetMetrics.columnWidth
        return stored * scale
    }

    private func height(of row: Int) -> CGFloat {
        guard let stored = model.activeSheet.rowHeight(row) else { return rowHeight }
        return max(rowHeight, CGFloat(min(stored, 400)) * scale)
    }

    private var grid: some View {
        let sheet = model.activeSheet
        let frozen = min(sheet.frozenRows, sheet.rows, SpreadsheetMetrics.maximumPinnedRows)
        return ScrollViewReader { proxy in
            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    Section {
                        ForEach(frozen..<sheet.rows, id: \.self) { row in rowView(row) }
                    } header: {
                        VStack(alignment: .leading, spacing: 0) {
                            columnHeader
                            ForEach(0..<frozen, id: \.self) { row in rowView(row) }
                        }
                        .background(.background)
                        .overlay(alignment: .bottom) {
                            if frozen > 0 { Rectangle().fill(.tint).frame(height: 1.5) }
                        }
                    }
                }
            }
            .background(.background)
            .focusable()
            .focusEffectDisabled()
            .focused($focus, equals: .grid)
            .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow, .tab, .return, .delete, .deleteForward], phases: [.down, .repeat]) { press in
                handle(press)
            }
            .onChange(of: model.selection) { _, position in
                withAnimation(.easeOut(duration: 0.16)) { proxy.scrollTo(position, anchor: nil) }
            }
            .accessibilityIdentifier("spreadsheet-grid")
        }
        .environment(\.layoutDirection, .leftToRight)
    }

    private func handle(_ press: KeyPress) -> KeyPress.Result {
        switch press.key {
        case .upArrow: model.move(rows: -1, columns: 0)
        case .downArrow: model.move(rows: 1, columns: 0)
        case .leftArrow: model.move(rows: 0, columns: -1)
        case .rightArrow: model.move(rows: 0, columns: 1)
        case .tab: model.move(rows: 0, columns: press.modifiers.contains(.shift) ? -1 : 1)
        case .return:
            guard model.isEditable else { model.move(rows: 1, columns: 0); return .handled }
            focus = .formula
        case .delete, .deleteForward:
            guard model.isEditable else { return .ignored }
            model.clearSelectedCell()
        default: return .ignored
        }
        return .handled
    }

    private var columnHeader: some View {
        let sheet = model.activeSheet
        return HStack(spacing: 0) {
            Color.clear
                .frame(width: headerWidth, height: rowHeight)
                .background(.quaternary.opacity(0.6))
                .overlay(alignment: .trailing) { SpreadsheetMetrics.line.frame(width: 0.5) }
                .accessibilityHidden(true)
            ForEach(0..<sheet.cols, id: \.self) { column in
                let selected = column == model.selection.column
                Text(verbatim: SpreadsheetAddress.columnName(column))
                    .font(.caption.weight(selected ? .bold : .regular))
                    .foregroundStyle(selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                    .frame(width: columnWidth(column), height: rowHeight)
                    .background(selected ? AnyShapeStyle(.tint.opacity(0.14)) : AnyShapeStyle(.quaternary.opacity(0.6)))
                    .overlay(alignment: .trailing) { SpreadsheetMetrics.line.frame(width: 0.5) }
                    .overlay(alignment: .bottom) { SpreadsheetMetrics.line.frame(height: 0.5) }
                    .accessibilityHidden(true)
            }
        }
    }

    private func rowView(_ row: Int) -> some View {
        let sheet = model.activeSheet
        let lineHeight = self.height(of: row)
        let selectedRow = row == model.selection.row
        let hasAnchor = model.mergeAnchors.keys.contains { $0.row == row }
        return HStack(spacing: 0) {
            Text(verbatim: String(row + 1))
                .font(.caption.monospacedDigit().weight(selectedRow ? .bold : .regular))
                .foregroundStyle(selectedRow ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                .frame(width: headerWidth, height: lineHeight)
                .background(selectedRow ? AnyShapeStyle(.tint.opacity(0.14)) : AnyShapeStyle(.quaternary.opacity(0.6)))
                .overlay(alignment: .trailing) { SpreadsheetMetrics.line.frame(width: 0.5) }
                .overlay(alignment: .bottom) { SpreadsheetMetrics.line.frame(height: 0.5) }
                .accessibilityHidden(true)
            ForEach(0..<sheet.cols, id: \.self) { column in
                cell(row: row, column: column, height: lineHeight)
            }
        }
        .zIndex(hasAnchor ? 1 : 0)
    }

    @ViewBuilder
    private func cell(row: Int, column: Int, height: CGFloat) -> some View {
        let position = SpreadsheetCellPosition(row: row, column: column)
        let width = columnWidth(column)
        if model.coveredCells.contains(position) {
            Color.clear
                .frame(width: width, height: height)
                .contentShape(Rectangle())
                .onTapGesture { tap(position) }
                .accessibilityHidden(true)
                .id(position)
        } else {
            let merge = model.mergeAnchors[position]
            let spanWidth = merge.map { m in (m.firstColumn...m.lastColumn).reduce(CGFloat(0)) { $0 + columnWidth($1) } } ?? width
            let spanHeight = merge.map { m in (m.firstRow...m.lastRow).reduce(CGFloat(0)) { $0 + self.height(of: $1) } } ?? height
            let result = model.result(row: row, column: column)
            let input = model.activeSheet.input(at: position.key)
            let content = SpreadsheetCellContent(
                text: result?.display ?? input,
                style: model.activeSheet.cells[position.key]?.style,
                isNumber: result?.numeric != nil,
                isError: result?.error != nil,
                isSelected: model.selection == position,
                width: spanWidth,
                height: spanHeight
            )
            Color.clear
                .frame(width: width, height: height)
                .overlay(alignment: .topLeading) { content.equatable() }
                .contentShape(Rectangle())
                .onTapGesture { tap(position) }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text("Cell \(position.key)"))
                .accessibilityValue(content.text.isEmpty ? Text("Empty") : Text(verbatim: content.text))
                .accessibilityHint(input.hasPrefix("=") ? Text(verbatim: input) : Text(verbatim: ""))
                .accessibilityAddTraits(model.selection == position ? [.isButton, .isSelected] : .isButton)
                .accessibilityAction { tap(position) }
                .id(position)
        }
    }

    private func tap(_ position: SpreadsheetCellPosition) {
        if position == model.selection && model.isEditable {
            focus = .formula
        } else {
            model.select(row: position.row, column: position.column)
            focus = .grid
        }
    }

    // MARK: Sheets and structure

    private var sheetBar: some View {
        HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.workbook.sheets) { sheet in
                        let active = sheet.id == model.workbook.activeSheetID
                        Button {
                            model.selectSheet(id: sheet.id)
                        } label: {
                            Text(verbatim: sheet.name)
                                .font(.callout.weight(active ? .semibold : .regular))
                                .lineLimit(1)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(active ? AnyShapeStyle(.tint.opacity(0.16)) : AnyShapeStyle(.clear), in: Capsule())
                                .foregroundStyle(active ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary))
                                .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(active ? .isSelected : [])
                        .accessibilityIdentifier("spreadsheet-sheet-\(sheet.id)")
                    }
                }
                .padding(.vertical, 2)
            }
            .accessibilityLabel(Text("Sheets"))
            if model.isEditable {
                Menu {
                    Button("Add row", systemImage: "plus.rectangle") { model.addRow() }
                        .disabled(!model.canAddRow)
                    Button("Add column", systemImage: "plus.rectangle.portrait") { model.addColumn() }
                        .disabled(!model.canAddColumn)
                    Button("Add sheet", systemImage: "plus.square.on.square") { model.addSheet() }
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityIdentifier("spreadsheet-add-menu")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }
}

enum SpreadsheetMetrics {
    #if os(macOS)
    static let rowHeight: CGFloat = 26
    #else
    static let rowHeight: CGFloat = 36
    #endif
    /// The desktop's default column width.
    static let columnWidth: CGFloat = 108
    /// Frozen rows stay pinned under the column letters, up to this many.
    static let maximumPinnedRows = 10
    static var line: Color { Color.primary.opacity(0.12) }
}

/// One cell's drawing. Equatable so unchanged cells are not redrawn while scrolling.
struct SpreadsheetCellContent: View, Equatable {
    let text: String
    let style: SpreadsheetCellStyle?
    let isNumber: Bool
    let isError: Bool
    let isSelected: Bool
    let width: CGFloat
    let height: CGFloat

    private var alignment: Alignment {
        switch style?.align {
        case "center"?: return .center
        case "right"?: return .trailing
        case "left"?: return .leading
        default: return isNumber ? .trailing : .leading
        }
    }

    private var textAlignment: TextAlignment {
        switch alignment {
        case .center: return .center
        case .trailing: return .trailing
        default: return .leading
        }
    }

    private var foreground: Color {
        if isError { return .red }
        if let hex = style?.color, let color = Color(spreadsheetHex: hex) { return color }
        return .primary
    }

    var body: some View {
        Text(verbatim: text)
            .font(SpreadsheetCellContent.font)
            .fontWeight(style?.bold == true ? .bold : .regular)
            .italic(style?.italic == true)
            .underline(style?.underline == true)
            .strikethrough(style?.strike == true)
            .foregroundStyle(foreground)
            .multilineTextAlignment(textAlignment)
            .lineLimit(style?.wrap == true ? nil : 1)
            .padding(.horizontal, 6)
            .frame(width: width, height: height, alignment: alignment)
            .background(style?.background.flatMap { Color(spreadsheetHex: $0) } ?? Color.clear)
            .overlay(alignment: .trailing) { SpreadsheetMetrics.line.frame(width: 0.5) }
            .overlay(alignment: .bottom) { SpreadsheetMetrics.line.frame(height: 0.5) }
            .overlay {
                if isSelected {
                    Rectangle().strokeBorder(.tint, lineWidth: 2)
                }
            }
            .clipped()
    }

    #if os(macOS)
    static let font = Font.body
    #else
    static let font = Font.subheadline
    #endif
}

extension Color {
    /// `#rgb` or `#rrggbb`, as the desktop stores cell colours.
    init?(spreadsheetHex: String) {
        var text = spreadsheetHex.trimmingCharacters(in: .whitespaces)
        guard text.hasPrefix("#") else { return nil }
        text.removeFirst()
        if text.count == 3 { text = text.map { "\($0)\($0)" }.joined() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(.sRGB,
                  red: Double((value >> 16) & 0xFF) / 255,
                  green: Double((value >> 8) & 0xFF) / 255,
                  blue: Double(value & 0xFF) / 255,
                  opacity: 1)
    }
}

/// A read only spreadsheet for a resource's metadata. Cells can be selected
/// and sheets switched; the formula bar shows each cell's input.
public struct SpreadsheetPreview: View {
    private let metadataJSON: String
    @StateObject private var model: SpreadsheetEditorModel

    public init(metadataJSON: String) {
        self.metadataJSON = metadataJSON
        _model = StateObject(wrappedValue: SpreadsheetEditorModel(metadataJSON: metadataJSON, editable: false))
    }

    public var body: some View {
        SpreadsheetEditorView(model: model)
            .onChange(of: metadataJSON) { _, json in model.replace(with: SpreadsheetWorkbook(metadataJSON: json)) }
    }
}
