import SwiftUI
import WorldsPersistence
#if WORLDS_MAIN_APP_MODULES
import Worlds3DViews
import WorldsMathDiagrams
import WorldsNativeDiagrams
#endif

// MARK: - Focus Timer & Reading Ruler Bar (Universal Productivity Feature)

@MainActor
struct NativeFocusTimerBar: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var mode: String = "Focus 25m"
    @State private var remainingSeconds: Int = 25 * 60
    @State private var isRunning: Bool = false
    @State private var readingRulerEnabled: Bool = false
    @State private var completedSessions: Int = 3

    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 6) {
                Image(systemName: isRunning ? "timer.circle.fill" : "timer")
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                Text(formattedTime)
                    .font(.system(.subheadline, design: .monospaced, weight: .bold))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(WorldsPalette.accent(for: colorScheme).opacity(0.16), in: Capsule())

            Picker("Mode", selection: $mode) {
                Text("25m Pomodoro").tag("Focus 25m")
                Text("50m Deep Work").tag("Deep 50m")
                Text("5m Break").tag("Break 5m")
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 260)
            .onChange(of: mode) { _, newMode in
                isRunning = false
                switch newMode {
                case "Deep 50m": remainingSeconds = 50 * 60
                case "Break 5m": remainingSeconds = 5 * 60
                default: remainingSeconds = 25 * 60
                }
            }

            Button {
                isRunning.toggle()
            } label: {
                Label(isRunning ? "Pause" : "Start", systemImage: isRunning ? "pause.fill" : "play.fill")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(WorldsPalette.accent(for: colorScheme))
            .accessibilityIdentifier("focus-timer-toggle")

            Spacer()

            Button {
                readingRulerEnabled.toggle()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: readingRulerEnabled ? "eye.fill" : "line.3.horizontal.decrease")
                    Text("Reading Ruler")
                        .font(.caption.weight(.medium))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    readingRulerEnabled ? Color.cyan.opacity(0.22) : Color.secondary.opacity(0.12),
                    in: Capsule()
                )
                .foregroundStyle(readingRulerEnabled ? Color.cyan : .secondary)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("reading-ruler-toggle")

            HStack(spacing: 4) {
                Image(systemName: "flame.fill")
                    .foregroundStyle(.orange)
                    .font(.caption)
                Text("\(completedSessions) sessions")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .worldsGlass(cornerRadius: 12)
        .overlay(alignment: .bottom) {
            if readingRulerEnabled {
                Rectangle()
                    .fill(WorldsPalette.accent(for: colorScheme).opacity(0.35))
                    .frame(height: 3)
            }
        }
    }

    private var formattedTime: String {
        let mins = remainingSeconds / 60
        let secs = remainingSeconds % 60
        return String(format: "%02d:%02d", mins, secs)
    }
}

// MARK: - Full Excel-like Spreadsheet Studio

@MainActor
struct WorldsSpreadsheetStudioView: View {
    @Environment(\.colorScheme) private var colorScheme
    var initialTitle: String = "Q4 Financial Budget & KPI Workbook"
    let metadataJSON: String?

    @State private var activeRibbonTab: String = "Home"
    @State private var activeSheetIndex: Int = 0
    @State private var sheets: [String] = ["Financial Budget", "KPI & OKRs", "Academic GPA", "Forecast"]
    @State private var selectedCell: String = "D6"
    @State private var formulaInput: String = "=SUM(D2:D5)"
    @State private var freezeHeader: Bool = true
    @State private var autoFilterEnabled: Bool = true
    @State private var showShortcutsSheet: Bool = false
    @State private var cellData: [String: String] = [
        "A1": "Category / البند", "B1": "Q3 Actual", "C1": "Q4 Planned", "D1": "Q4 Actual", "E1": "Variance", "F1": "Status",
        "A2": "Enterprise Subscriptions", "B2": "142000", "C2": "165000", "D2": "184500", "E2": "=D2-C2", "F2": "=IF(D2>=C2,\"Above Target\",\"Review\")",
        "A3": "Cloud & AI Workspaces", "B3": "68000", "C3": "82000", "D3": "91200", "E3": "=D3-C3", "F3": "=IF(D3>=C3,\"Above Target\",\"Review\")",
        "A4": "Infrastructure & R&D", "B4": "-54000", "C4": "-60000", "D4": "-57800", "E4": "=D4-C4", "F4": "Optimized",
        "A5": "Marketing & Operations", "B5": "-29000", "C5": "-32000", "D5": "-30400", "E5": "=D5-C5", "F5": "On Track",
        "A6": "Net Operating Profit", "B6": "=SUM(B2:B5)", "C6": "=SUM(C2:C5)", "D6": "=SUM(D2:D5)", "E6": "=D6-C6", "F6": "+21.0% YoY",
        "A7": "Average Line Item", "B7": "=AVERAGE(B2:B5)", "C7": "=AVERAGE(C2:C5)", "D7": "=AVERAGE(D2:D5)", "E7": "=MAX(D2:D5)", "F7": "Verified"
    ]

    private let columns = ["A", "B", "C", "D", "E", "F"]
    private let rows = Array(1...10)
    private let quickFormulas = [
        "=SUM(D2:D5)", "=AVERAGE(D2:D5)", "=MIN(D2:D5)", "=MAX(D2:D5)",
        "=IF(D2>=C2,\"Hit\",\"Miss\")", "=VLOOKUP(A2,A2:F6,4,FALSE)", "=XLOOKUP(A2,A2:A6,D2:D6)", "=PMT(0.05/12,60,100000)"
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                headerBar
                ribbonToolbar
                formulaBar
                functionPillsBar
                spreadsheetGrid
                sheetTabsAndStatusBar
            }
            .padding(20)
            .frame(maxWidth: 1060, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .accessibilityIdentifier("spreadsheet-studio-view")
        .sheet(isPresented: $showShortcutsSheet) {
            spreadsheetShortcutsModal
        }
    }

    private var headerBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "tablecells.fill")
                .font(.title2)
                .foregroundStyle(.green)
                .frame(width: 40, height: 40)
                .background(Color.green.opacity(0.15), in: RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 2) {
                Text(initialTitle)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                Text("Excel-Compatible Multi-Sheet Engine · 55+ Formulas · Live FTS5 Indexed · .XLSX / .CSV")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()

            Menu {
                Button("Financial Budget & Cashflow") { loadTemplate("budget") }
                Button("Company KPI & OKR Tracker") { loadTemplate("kpi") }
                Button("Academic Gradebook & GPA") { loadTemplate("gpa") }
            } label: {
                Label("Workbook Templates", systemImage: "sparkles.rectangle.stack")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.bordered)

            Button {
                showShortcutsSheet = true
            } label: {
                Label("Shortcuts (F1)", systemImage: "keyboard")
                    .font(.caption.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("spreadsheet-shortcuts-button")
        }
    }

    private var ribbonToolbar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ForEach(["Home", "Formulas", "Data & Filter", "View & Freeze"], id: \.self) { tab in
                    Button {
                        activeRibbonTab = tab
                    } label: {
                        Text(tab)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 5)
                            .background(
                                activeRibbonTab == tab
                                    ? WorldsPalette.accent(for: colorScheme).opacity(0.22)
                                    : Color.clear,
                                in: Capsule()
                            )
                            .foregroundStyle(activeRibbonTab == tab ? WorldsPalette.accent(for: colorScheme) : .secondary)
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
                Text("Auto-Saved · Revision 4")
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ribbonChip(icon: "bold", label: "Bold ⌘B")
                    ribbonChip(icon: "italic", label: "Italic ⌘I")
                    ribbonChip(icon: "dollarsign.circle", label: "Currency $")
                    ribbonChip(icon: "percent", label: "Percent %")
                    Divider().frame(height: 18)
                    ribbonChip(icon: "arrow.up.arrow.down", label: "Sort A→Z") {
                        sortRowsAscending()
                    }
                    ribbonChip(icon: "line.3.horizontal.decrease.circle", label: autoFilterEnabled ? "Filter: ON" : "Filter: OFF") {
                        autoFilterEnabled.toggle()
                    }
                    ribbonChip(icon: "pin.fill", label: freezeHeader ? "Frozen Row 1" : "Freeze Panes") {
                        freezeHeader.toggle()
                    }
                    Divider().frame(height: 18)
                    ribbonChip(icon: "plus.rectangle.on.rectangle", label: "+ Insert Row")
                    ribbonChip(icon: "square.and.arrow.up", label: "Export .XLSX")
                }
            }
        }
        .padding(12)
        .worldsGlass(cornerRadius: 12)
    }

    private func ribbonChip(icon: String, label: String, action: @escaping () -> Void = {}) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.caption)
                Text(label)
                    .font(.caption.weight(.medium))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
            .foregroundStyle(WorldsPalette.ink(for: colorScheme))
        }
        .buttonStyle(.plain)
    }

    private var formulaBar: some View {
        HStack(spacing: 10) {
            Text(selectedCell)
                .font(.system(.subheadline, design: .monospaced, weight: .bold))
                .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                .frame(width: 58, height: 32)
                .background(WorldsPalette.accent(for: colorScheme).opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityIdentifier("spreadsheet-name-box")

            Text("fx")
                .font(.system(.subheadline, design: .serif, weight: .bold).italic())
                .foregroundStyle(.green)
                .frame(width: 28, height: 32)
                .background(Color.green.opacity(0.14), in: RoundedRectangle(cornerRadius: 8))

            TextField("Enter value or Excel formula (=SUM, =AVERAGE, =IF, =VLOOKUP...)", text: $formulaInput)
                .font(.system(.subheadline, design: .monospaced))
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    cellData[selectedCell] = formulaInput
                }
                .accessibilityIdentifier("spreadsheet-formula-input")

            Button("Apply") {
                cellData[selectedCell] = formulaInput
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .padding(10)
        .worldsGlass(cornerRadius: 10)
    }

    private var functionPillsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text("Quick Functions:")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(quickFormulas, id: \.self) { fn in
                    Button {
                        formulaInput = fn
                        cellData[selectedCell] = fn
                    } label: {
                        Text(fn)
                            .font(.caption2.monospaced())
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.green.opacity(0.12), in: Capsule())
                            .foregroundStyle(.green)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var spreadsheetGrid: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            VStack(spacing: 1) {
                // Column Headers
                HStack(spacing: 1) {
                    Text("#")
                        .font(.caption.monospaced().weight(.bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 40, height: 32)
                        .background(WorldsPalette.surface(for: colorScheme))

                    ForEach(columns, id: \.self) { col in
                        HStack(spacing: 4) {
                            Text(col)
                                .font(.caption.monospaced().weight(.bold))
                                .foregroundStyle(selectedCell.hasPrefix(col) ? WorldsPalette.accent(for: colorScheme) : .secondary)
                            if autoFilterEnabled {
                                Image(systemName: "chevron.down.square.fill")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .frame(width: col == "A" ? 190 : 125, height: 32)
                        .background(
                            selectedCell.hasPrefix(col)
                                ? WorldsPalette.accent(for: colorScheme).opacity(0.16)
                                : WorldsPalette.surface(for: colorScheme)
                        )
                    }
                }

                // Rows
                ForEach(rows, id: \.self) { row in
                    HStack(spacing: 1) {
                        Text("\(row)")
                            .font(.caption.monospaced().weight(.semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 40, height: 32)
                            .background(WorldsPalette.surface(for: colorScheme))

                        ForEach(columns, id: \.self) { col in
                            let coord = "\(col)\(row)"
                            let isSelected = selectedCell == coord
                            let isHeaderRow = row == 1
                            let isSummaryRow = row == 6 || row == 7
                            let raw = cellData[coord] ?? ""
                            let evaluated = evaluateCell(coord, visited: [])

                            Button {
                                selectedCell = coord
                                formulaInput = raw
                            } label: {
                                HStack {
                                    if col == "A" || isHeaderRow || col == "F" {
                                        Text(evaluated)
                                            .lineLimit(1)
                                        Spacer(minLength: 0)
                                    } else {
                                        Spacer(minLength: 0)
                                        Text(evaluated)
                                            .lineLimit(1)
                                    }
                                }
                                .font(
                                    isHeaderRow || isSummaryRow
                                        ? .caption.monospaced().weight(.bold)
                                        : .caption.monospaced()
                                )
                                .foregroundStyle(cellForeground(evaluated: evaluated, isHeader: isHeaderRow, isSummary: isSummaryRow))
                                .padding(.horizontal, 8)
                                .frame(width: col == "A" ? 190 : 125, height: 32)
                                .background(cellBackground(isSelected: isSelected, isHeader: isHeaderRow, isSummary: isSummaryRow))
                                .overlay(
                                    Rectangle()
                                        .stroke(isSelected ? Color.green : Color.secondary.opacity(0.14), lineWidth: isSelected ? 2 : 0.5)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("cell-\(coord)")
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.25), lineWidth: 1))
        }
    }

    private var sheetTabsAndStatusBar: some View {
        HStack(spacing: 10) {
            ForEach(Array(sheets.enumerated()), id: \.offset) { idx, sheet in
                Button {
                    activeSheetIndex = idx
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "tablecells")
                            .font(.caption2)
                        Text(sheet)
                            .font(.caption.weight(activeSheetIndex == idx ? .bold : .medium))
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        activeSheetIndex == idx
                            ? Color.green.opacity(0.2)
                            : Color.secondary.opacity(0.1),
                        in: RoundedRectangle(cornerRadius: 8)
                    )
                    .foregroundStyle(activeSheetIndex == idx ? .green : .secondary)
                }
                .buttonStyle(.plain)
            }

            Button {
                sheets.append("Sheet \(sheets.count + 1)")
                activeSheetIndex = sheets.count - 1
            } label: {
                Image(systemName: "plus.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)

            Spacer()

            HStack(spacing: 14) {
                Text("SUM: $187,500")
                Text("AVG: $46,875")
                Text("MIN: -$57,800")
                Text("MAX: $184,500")
                Text("COUNT: 16")
            }
            .font(.caption2.monospaced().weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding(10)
        .worldsGlass(cornerRadius: 10)
    }

    private var spreadsheetShortcutsModal: some View {
        NavigationStack {
            List {
                Section("Navigation & Editing") {
                    LabeledContent("Edit Active Cell", value: "F2 / Return")
                    LabeledContent("Toggle Absolute Reference ($A$1)", value: "F4")
                    LabeledContent("AutoSum Selected Range", value: "Opt + = (Alt + =)")
                    LabeledContent("Fill Down / Fill Right", value: "⌘D / ⌘R")
                }
                Section("Formatting & Data") {
                    LabeledContent("Bold / Italic / Underline", value: "⌘B / ⌘I / ⌘U")
                    LabeledContent("Insert Current Date / Time", value: "⌃; / ⌃⇧:")
                    LabeledContent("Find & Replace in Sheet", value: "⌘F")
                }
            }
            .navigationTitle("Spreadsheet Shortcuts")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { showShortcutsSheet = false }
                }
            }
        }
        .frame(minWidth: 420, minHeight: 340)
    }

    private func cellForeground(evaluated: String, isHeader: Bool, isSummary: Bool) -> Color {
        if isHeader { return WorldsPalette.accent(for: colorScheme) }
        if evaluated.hasPrefix("-") { return .red }
        if evaluated == "Above Target" || evaluated.hasPrefix("+") { return .green }
        if isSummary { return WorldsPalette.ink(for: colorScheme) }
        return WorldsPalette.ink(for: colorScheme)
    }

    private func cellBackground(isSelected: Bool, isHeader: Bool, isSummary: Bool) -> Color {
        if isSelected { return Color.green.opacity(0.18) }
        if isHeader { return WorldsPalette.surface(for: colorScheme) }
        if isSummary { return WorldsPalette.accent(for: colorScheme).opacity(0.10) }
        return WorldsPalette.paper(for: colorScheme)
    }

    private func evaluateCell(_ coord: String, visited: Set<String>) -> String {
        guard let raw = cellData[coord]?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return ""
        }
        guard raw.hasPrefix("=") else {
            if let num = Double(raw), !coord.hasPrefix("A") {
                return formatNumber(num)
            }
            return raw
        }
        if visited.contains(coord) { return "#CYCLE!" }
        var nextVisited = visited
        nextVisited.insert(coord)

        let expr = String(raw.dropFirst()).trimmingCharacters(in: .whitespaces)
        let upper = expr.uppercased()

        func numericValue(_ ref: String) -> Double {
            let clean = ref.replacingOccurrences(of: "$", with: "").trimmingCharacters(in: .whitespaces).uppercased()
            if let direct = Double(clean) { return direct }
            let rendered = evaluateCell(clean, visited: nextVisited)
                .replacingOccurrences(of: "$", with: "")
                .replacingOccurrences(of: ",", with: "")
            return Double(rendered) ?? 0
        }

        func expandRange(_ rangeStr: String) -> [Double] {
            let parts = rangeStr.split(separator: ":").map { String($0).replacingOccurrences(of: "$", with: "").trimmingCharacters(in: .whitespaces).uppercased() }
            guard parts.count == 2,
                  let c1 = columns.firstIndex(of: String(parts[0].prefix(1))),
                  let r1 = Int(parts[0].dropFirst()),
                  let c2 = columns.firstIndex(of: String(parts[1].prefix(1))),
                  let r2 = Int(parts[1].dropFirst()) else { return [] }
            var values: [Double] = []
            for c in min(c1, c2)...max(c1, c2) {
                for r in min(r1, r2)...max(r1, r2) {
                    let key = "\(columns[c])\(r)"
                    if let rawVal = cellData[key], !rawVal.isEmpty {
                        values.append(numericValue(key))
                    }
                }
            }
            return values
        }

        if upper.hasPrefix("SUM(") && upper.hasSuffix(")") {
            let inner = String(expr.dropFirst(4).dropLast())
            return formatNumber(expandRange(inner).reduce(0, +))
        }
        if upper.hasPrefix("AVERAGE(") && upper.hasSuffix(")") {
            let vals = expandRange(String(expr.dropFirst(8).dropLast()))
            guard !vals.isEmpty else { return "#DIV/0!" }
            return formatNumber(vals.reduce(0, +) / Double(vals.count))
        }
        if upper.hasPrefix("MAX(") && upper.hasSuffix(")") {
            let vals = expandRange(String(expr.dropFirst(4).dropLast()))
            return formatNumber(vals.max() ?? 0)
        }
        if upper.hasPrefix("MIN(") && upper.hasSuffix(")") {
            let vals = expandRange(String(expr.dropFirst(4).dropLast()))
            return formatNumber(vals.min() ?? 0)
        }
        if upper.hasPrefix("IF(") && upper.hasSuffix(")") {
            let inner = String(expr.dropFirst(3).dropLast())
            let parts = inner.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
            if parts.count == 3 {
                let cond = parts[0]
                if cond.contains(">=") {
                    let lr = cond.components(separatedBy: ">=")
                    let pass = numericValue(lr[0]) >= numericValue(lr[1])
                    return (pass ? parts[1] : parts[2]).replacingOccurrences(of: "\"", with: "")
                }
            }
        }
        if expr.contains("-") && !expr.hasPrefix("-") {
            let parts = expr.split(separator: "-", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                return formatNumber(numericValue(parts[0]) - numericValue(parts[1]))
            }
        }
        if expr.contains("+") {
            let parts = expr.split(separator: "+", maxSplits: 1).map(String.init)
            if parts.count == 2 {
                return formatNumber(numericValue(parts[0]) + numericValue(parts[1]))
            }
        }
        return raw
    }

    private func formatNumber(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        let formatted = formatter.string(from: NSNumber(value: abs(value))) ?? "\(Int(abs(value)))"
        return value < 0 ? "-$\(formatted)" : "$\(formatted)"
    }

    private func sortRowsAscending() {
        let sortable = [2, 3, 4, 5].sorted { r1, r2 in
            (cellData["A\(r1)"] ?? "") < (cellData["A\(r2)"] ?? "")
        }
        var copy: [[String: String]] = []
        for r in sortable {
            var rowDict: [String: String] = [:]
            for c in columns { rowDict[c] = cellData["\(c)\(r)"] ?? "" }
            copy.append(rowDict)
        }
        for (idx, r) in [2, 3, 4, 5].enumerated() {
            for c in columns { cellData["\(c)\(r)"] = copy[idx][c] ?? "" }
        }
    }

    private func loadTemplate(_ key: String) {
        switch key {
        case "kpi":
            cellData["A1"] = "KPI Metric / المؤشر"
            cellData["B1"] = "Baseline"
            cellData["C1"] = "Target"
            cellData["D1"] = "Current"
            cellData["A2"] = "Monthly Active Teams"
            cellData["B2"] = "1200"
            cellData["C2"] = "1800"
            cellData["D2"] = "1940"
        case "gpa":
            cellData["A1"] = "Course / المقرر"
            cellData["B1"] = "Midterm"
            cellData["C1"] = "Target"
            cellData["D1"] = "Total Score"
            cellData["A2"] = "Algorithms & Data Structures"
            cellData["B2"] = "88"
            cellData["C2"] = "90"
            cellData["D2"] = "95"
        default:
            break
        }
    }
}

// MARK: - Interactive Visual Mind Map & Concept Map Canvas Preview

@MainActor
struct VisualMindMapCanvasPreview: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var selectedPreset: String = "radial"
    var onCreateCanvas: ((String) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Image(systemName: "point.3.connected.trianglepath.dotted")
                            .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                        Text("Visual Mind Maps & Concept Canvases — الخرائط الذهنية والمفاهيمية البصرية")
                            .font(.headline)
                            .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                    }
                    Text("Interactive infinite-canvas node graphs with anchored connectors, plus 10 structured Mermaid & Cornell/Feynman templates.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    onCreateCanvas?(selectedPreset)
                } label: {
                    Label("Open in Canvas", systemImage: "arrow.up.right.square")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(WorldsPalette.accent(for: colorScheme))
                .accessibilityIdentifier("create-visual-mindmap-canvas")
            }

            HStack(spacing: 8) {
                presetTab(id: "radial", title: "Radial Mind Map (خريطة شعاعية)", icon: "brain.head.profile", color: .purple)
                presetTab(id: "concept", title: "Concept Network (شبكة مفاهيمية)", icon: "network", color: .indigo)
                presetTab(id: "fishbone", title: "Fishbone Ishikawa (الأسباب الجذرية)", icon: "arrow.triangle.branch", color: .orange)
                presetTab(id: "swot", title: "SWOT 2×2 Canvas (مصفوفة SWOT)", icon: "square.grid.2x2.fill", color: .green)
            }

            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(red: 15 / 255, green: 16 / 255, blue: 20 / 255))
                    .frame(height: 230)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(WorldsPalette.accent(for: colorScheme).opacity(0.3), lineWidth: 1)
                    )

                Canvas { context, size in
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    let branches: [(CGPoint, Color)] = [
                        (CGPoint(x: size.width * 0.20, y: size.height * 0.26), .purple),
                        (CGPoint(x: size.width * 0.80, y: size.height * 0.26), .blue),
                        (CGPoint(x: size.width * 0.20, y: size.height * 0.76), .green),
                        (CGPoint(x: size.width * 0.80, y: size.height * 0.76), .orange)
                    ]
                    for (pt, col) in branches {
                        var path = Path()
                        path.move(to: center)
                        path.addQuadCurve(to: pt, control: CGPoint(x: (center.x + pt.x) / 2, y: center.y))
                        context.stroke(path, with: .color(col.opacity(0.75)), lineWidth: 2.5)
                    }
                }
                .frame(height: 230)

                // Nodes overlay
                VStack(spacing: 42) {
                    HStack(spacing: 180) {
                        mindMapNode(title: selectedPreset == "swot" ? "💪 Strengths (نقاط القوة)" : "المحور الأول · Core Architecture", subtitle: "2 sub-branches linked", color: .purple)
                        mindMapNode(title: selectedPreset == "swot" ? "🩹 Weaknesses (نقاط الضعف)" : "المحور الثاني · Research & Data", subtitle: "Propositions verified", color: .blue)
                    }
                    mindMapNode(
                        title: presetCenterTitle,
                        subtitle: "Central Concept Root",
                        color: WorldsPalette.goldAccent,
                        isRoot: true
                    )
                    HStack(spacing: 180) {
                        mindMapNode(title: selectedPreset == "swot" ? "🌱 Opportunities (الفرص)" : "المحور الثالث · Execution Plan", subtitle: "Actionable milestones", color: .green)
                        mindMapNode(title: selectedPreset == "swot" ? "⚡ Threats (التهديدات)" : "المحور الرابع · Outcomes & KPIs", subtitle: "Measured impact", color: .orange)
                    }
                }
                .padding(16)
            }
        }
        .padding(16)
        .worldsGlass(cornerRadius: 16)
        .accessibilityIdentifier("visual-mindmap-preview")
    }

    private var presetCenterTitle: String {
        switch selectedPreset {
        case "concept": return "المفهوم الأساسي · Core Proposition"
        case "fishbone": return "🎯 المشكلة الجذرية · Root Cause"
        case "swot": return "SWOT Strategic Matrix"
        default: return "الفكرة المركزية · Central Topic"
        }
    }

    private func presetTab(id: String, title: String, icon: String, color: Color) -> some View {
        Button {
            selectedPreset = id
        } label: {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Text(title)
                    .lineLimit(1)
            }
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(selectedPreset == id ? color.opacity(0.22) : Color.secondary.opacity(0.1), in: Capsule())
            .foregroundStyle(selectedPreset == id ? color : .primary)
        }
        .buttonStyle(.plain)
    }

    private func mindMapNode(title: String, subtitle: String, color: Color, isRoot: Bool = false) -> some View {
        VStack(spacing: 2) {
            Text(title)
                .font((isRoot ? Font.subheadline : Font.caption).weight(.bold))
                .foregroundStyle(.white)
            Text(subtitle)
                .font(.system(size: 9))
                .foregroundStyle(.white.opacity(0.75))
        }
        .padding(.horizontal, isRoot ? 16 : 12)
        .padding(.vertical, isRoot ? 10 : 6)
        .background(color.opacity(isRoot ? 0.38 : 0.25), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(color, lineWidth: isRoot ? 2 : 1.2))
    }
}

// MARK: - Universal Planning Hub (Tasks, Goals, Calendar, Inbox, Print Queue)

@MainActor
struct WorldsPlanningHubView: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var activeTab: String = "Tasks"
    @State private var newTaskTitle: String = ""
    @State private var tasks: [(id: String, title: String, priority: String, due: String, project: String, done: Bool, printQueued: Bool)] = [
        ("t1", "Finalize Q4 Architecture & Security Audit", "High", "Today · 17:00", "Core Platform", false, true),
        ("t2", "Review Financial Workbook & KPI Variance", "High", "Tomorrow", "Finance", false, true),
        ("t3", "Publish Mind Map & Concept Map Templates", "Medium", "Thu · Nov 12", "Design System", true, false),
        ("t4", "Prepare Executive Presentation Deck", "Medium", "Fri · Nov 13", "Leadership", false, true),
        ("t5", "Sync Offline SQLite Replicas & Backups", "Low", "Next Week", "Infrastructure", true, false)
    ]

    private let goals: [(title: String, category: String, progress: Double, target: String, metric: String)] = [
        ("Ship Native macOS, iPhone & iPad 1.0 Release", "Engineering", 0.92, "Nov 30, 2026", "29 / 29 Modules Verified"),
        ("Achieve Zero-Latency Offline FTS5 Search & Spreadsheets", "Performance", 0.85, "Dec 15, 2026", "< 4ms Query P99"),
        ("Complete Enterprise & Academic Template Library", "Product", 1.00, "Completed", "22 Built-in Templates")
    ]

    private let inboxItems: [(title: String, note: String, time: String)] = [
        ("Voice memo: Add Fischbone & SWOT visual presets to Canvas", "Captured from iPhone Quick Capture", "12m ago"),
        ("Client request: Export multi-sheet KPI workbook to .xlsx", "Needs formula preservation check", "1h ago"),
        ("Reading bookmark: Distributed Systems Chapter 6 notes", "Convert to Cornell + Feynman page", "3h ago")
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                NativeFocusTimerBar()

                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 10) {
                            Image(systemName: "checklist.checked")
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                            Text("Planning & Productivity Hub")
                                .font(.system(.largeTitle, design: .default, weight: .bold))
                                .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        }
                        Text("Universal workspace for teams, companies, and individuals — Tasks, OKR Goals, Calendar, Quick Capture Inbox, and Print Queue.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }

                // Sub-navigation pills
                HStack(spacing: 8) {
                    ForEach(["Tasks", "Goals & OKRs", "Calendar", "Inbox (3)", "Print Queue (3)"], id: \.self) { tab in
                        Button {
                            activeTab = tab
                        } label: {
                            Text(tab)
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(
                                    activeTab == tab
                                        ? WorldsPalette.accent(for: colorScheme).opacity(0.22)
                                        : Color.secondary.opacity(0.1),
                                    in: Capsule()
                                )
                                .foregroundStyle(activeTab == tab ? WorldsPalette.accent(for: colorScheme) : .primary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("planning-tab-\(tab)")
                    }
                }

                // Quick add task / capture bar
                HStack(spacing: 10) {
                    Image(systemName: "plus.circle.fill")
                        .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                    TextField("Quick capture task, goal, or inbox note… (Press Return)", text: $newTaskTitle)
                        .textFieldStyle(.plain)
                        .onSubmit {
                            guard !newTaskTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                            tasks.insert(("t\(tasks.count + 1)", newTaskTitle, "High", "Today", "Workspace", false, false), at: 0)
                            newTaskTitle = ""
                        }
                    Button("Add Task") {
                        guard !newTaskTitle.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                        tasks.insert(("t\(tasks.count + 1)", newTaskTitle, "High", "Today", "Workspace", false, false), at: 0)
                        newTaskTitle = ""
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(WorldsPalette.accent(for: colorScheme))
                }
                .padding(12)
                .worldsGlass(cornerRadius: 12)

                if activeTab == "Goals & OKRs" {
                    goalsSection
                } else if activeTab == "Calendar" {
                    calendarSection
                } else if activeTab.hasPrefix("Inbox") {
                    inboxSection
                } else if activeTab.hasPrefix("Print Queue") {
                    printQueueSection
                } else {
                    tasksSection
                }

                // Always show compact Goals & Calendar overview underneath Tasks for rich dashboard visibility
                if activeTab == "Tasks" {
                    HStack(alignment: .top, spacing: 16) {
                        goalsSection
                        printQueueSection
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 1020, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .navigationTitle("Planning")
        .accessibilityIdentifier("planning-hub-view")
    }

    private var tasksSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Active Tasks & Deliverables")
                .font(.headline)
                .foregroundStyle(WorldsPalette.ink(for: colorScheme))

            ForEach(Array(tasks.enumerated()), id: \.element.id) { idx, item in
                HStack(spacing: 12) {
                    Button {
                        tasks[idx].done.toggle()
                    } label: {
                        Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(item.done ? .green : WorldsPalette.accent(for: colorScheme))
                    }
                    .buttonStyle(.plain)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title)
                            .font(.body.weight(.medium))
                            .strikethrough(item.done)
                            .foregroundStyle(item.done ? .secondary : WorldsPalette.ink(for: colorScheme))
                        HStack(spacing: 8) {
                            Label(item.project, systemImage: "folder")
                            Label(item.due, systemImage: "calendar")
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }

                    Spacer()

                    if item.printQueued {
                        Label("Print Queue", systemImage: "printer.fill")
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.cyan.opacity(0.16), in: Capsule())
                            .foregroundStyle(.cyan)
                    }

                    Text(item.priority)
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(priorityColor(item.priority).opacity(0.18), in: Capsule())
                        .foregroundStyle(priorityColor(item.priority))
                }
                .padding(12)
                .worldsGlass(cornerRadius: 12)
            }
        }
    }

    private var goalsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "target")
                    .foregroundStyle(.purple)
                Text("Strategic Goals & OKRs")
                    .font(.headline)
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
            }

            ForEach(goals, id: \.title) { goal in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(goal.title)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        Spacer()
                        Text("\(Int(goal.progress * 100))%")
                            .font(.caption.monospaced().weight(.bold))
                            .foregroundStyle(.purple)
                    }
                    ProgressView(value: goal.progress)
                        .tint(.purple)
                    HStack {
                        Text(goal.category)
                        Spacer()
                        Text("\(goal.metric) · Due \(goal.target)")
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }
                .padding(12)
                .worldsGlass(cornerRadius: 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var calendarSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "calendar.badge.clock")
                    .foregroundStyle(.orange)
                Text("Weekly Schedule & Events")
                    .font(.headline)
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
            }
            HStack(spacing: 10) {
                ForEach(["Sun 10", "Mon 11", "Tue 12", "Wed 13", "Thu 14"], id: \.self) { day in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(day)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(day == "Tue 12" ? WorldsPalette.accent(for: colorScheme) : .secondary)
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.blue.opacity(0.18))
                            .frame(height: 54)
                            .overlay(
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("09:30 Architecture Sync")
                                        .font(.system(size: 10, weight: .semibold))
                                    Text("Room B · Online")
                                        .font(.system(size: 9))
                                        .foregroundStyle(.secondary)
                                }
                                .padding(6),
                                alignment: .topLeading
                            )
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.orange.opacity(0.18))
                            .frame(height: 54)
                            .overlay(
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("14:00 KPI & Budget Review")
                                        .font(.system(size: 10, weight: .semibold))
                                    Text("Q4 Spreadsheet")
                                        .font(.system(size: 9))
                                        .foregroundStyle(.secondary)
                                }
                                .padding(6),
                                alignment: .topLeading
                            )
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .worldsGlass(cornerRadius: 10)
                }
            }
        }
    }

    private var inboxSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "tray.full.fill")
                    .foregroundStyle(.teal)
                Text("Quick Capture Inbox")
                    .font(.headline)
            }
            ForEach(inboxItems, id: \.title) { item in
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title)
                            .font(.subheadline.weight(.medium))
                        Text("\(item.note) · \(item.time)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("→ Task") {}
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    Button("→ Page") {}
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
                .padding(12)
                .worldsGlass(cornerRadius: 12)
            }
        }
    }

    private var printQueueSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "printer.fill")
                    .foregroundStyle(.cyan)
                Text("Print Queue (طابور الطباعة)")
                    .font(.headline)
                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                Spacer()
                Button {
                } label: {
                    Label("Print All (3)", systemImage: "printer")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
            }

            ForEach(tasks.filter(\.printQueued), id: \.id) { item in
                HStack {
                    Image(systemName: "doc.richtext")
                        .foregroundStyle(.cyan)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.subheadline.weight(.medium))
                        Text("Ready for PDF / AirPrint · A4 Paginated")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("Queued")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.cyan.opacity(0.15), in: Capsule())
                        .foregroundStyle(.cyan)
                }
                .padding(12)
                .worldsGlass(cornerRadius: 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func priorityColor(_ priority: String) -> Color {
        switch priority {
        case "High": return .red
        case "Medium": return .orange
        default: return .blue
        }
    }
}

// MARK: - Opt-In Study & Academic Pack Hub (Subjects, Timetable, Exams, Textbooks, Links)

@MainActor
struct WorldsStudyPackHubView: View {
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("worlds_pack_study") private var studyPackEnabled: Bool = false
    @State private var textbookPage1: Int = 148
    @State private var textbookPage2: Int = 92

    private let subjects: [(code: String, name: String, teacher: String, room: String, color: Color, nextExam: String)] = [
        ("CS-301", "هندسة البرمجيات · Software Engineering", "د. عبدالله القحطاني", "Hall B-204", .indigo, "Exam in 5 days"),
        ("MATH-204", "الجبر الخطي والمعادلات · Linear Algebra", "د. سارة العتيبي", "Room A-108", .purple, "Assignment Due Tomorrow"),
        ("AI-410", "الذكاء الاصطناعي وتعلم الآلة · Machine Learning", "د. فهد الدوسري", "Lab C-301", .teal, "Lab Project Active")
    ]

    private let platformLinks: [(title: String, provider: String, subject: String, color: Color, icon: String)] = [
        ("محاضرات الجبر الخطي المسجلة (Playlist)", "YouTube", "MATH-204", .red, "play.rectangle.fill"),
        ("قناة مناقشة هندسة البرمجيات والملخصات", "Telegram", "CS-301", .blue, "paperplane.fill"),
        ("واجب الشبكات العصبية العميقة (Colab & Slides)", "Google Classroom", "AI-410", .green, "graduationcap.fill"),
        ("مجلد الكتب والمراجع وحلول الاختبارات السابقة", "Google Drive", "All Subjects", .orange, "externaldrive.fill"),
        ("بوابة الواجبات والجدول الرسمي", "منصة مدرستي / الجامعة", "Academic Portal", .purple, "globe")
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Header with Opt-In Pack badge & toggle
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 10) {
                            Image(systemName: "graduationcap.fill")
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(.indigo)
                            Text("Study & Academic Pack — الحقيبة الدراسية")
                                .font(.system(.largeTitle, design: .default, weight: .bold))
                                .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        }
                        Text("Opt-in Academic Workspace: Subjects, Weekly Timetable, Assignments, Exams, Textbooks with Current-Page Bookmarks, and Platform Links.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Toggle("Study Pack Active", isOn: $studyPackEnabled)
                        .toggleStyle(.switch)
                        .labelsHidden()
                }

                // 1. Subjects Grid
                VStack(alignment: .leading, spacing: 10) {
                    Text("Subjects & Courses (المواد الدراسية)")
                        .font(.headline)
                    HStack(spacing: 12) {
                        ForEach(subjects, id: \.code) { sub in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(sub.code)
                                        .font(.caption.monospaced().weight(.bold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(sub.color.opacity(0.2), in: Capsule())
                                        .foregroundStyle(sub.color)
                                    Spacer()
                                    Text(sub.room)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Text(sub.name)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                                Text(sub.teacher)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Divider()
                                Label(sub.nextExam, systemImage: "bell.badge.fill")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(sub.color)
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .worldsGlass(cornerRadius: 14)
                        }
                    }
                }

                // 2. Weekly Timetable Grid
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Image(systemName: "calendar.day.timeline.leading")
                            .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                        Text("Weekly Timetable (الجدول الدراسي الأسبوعي)")
                            .font(.headline)
                    }
                    VStack(spacing: 1) {
                        HStack(spacing: 1) {
                            Text("Day / اليوم")
                                .font(.caption.weight(.bold))
                                .frame(width: 110, height: 30)
                                .background(WorldsPalette.surface(for: colorScheme))
                            ForEach(["08:00 - 09:30", "09:45 - 11:15", "11:30 - 13:00", "13:30 - 15:00"], id: \.self) { slot in
                                Text(slot)
                                    .font(.caption2.monospaced().weight(.bold))
                                    .frame(maxWidth: .infinity, minHeight: 30)
                                    .background(WorldsPalette.surface(for: colorScheme))
                            }
                        }
                        timetableRow(day: "الأحد · Sun", slots: ["CS-301 · هندسة البرمجيات", "MATH-204 · الجبر الخطي", "فراغ / مكتبة", "AI-410 · الذكاء الاصطناعي"])
                        timetableRow(day: "الإثنين · Mon", slots: ["MATH-204 · الجبر الخطي", "AI-410 · معمل الذكاء", "CS-301 · مراجعة مشروع", "ساعات مكتبية"])
                        timetableRow(day: "الثلاثاء · Tue", slots: ["CS-301 · هندسة البرمجيات", "MATH-204 · تمارين وحلول", "AI-410 · الذكاء الاصطناعي", "مشروع التخرج"])
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.22), lineWidth: 1))
                }

                // 3. Textbooks & Solution Books + Subject Links side by side
                HStack(alignment: .top, spacing: 16) {
                    // Textbooks & Solution Books with current page bookmark
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: "book.pages.fill")
                                .foregroundStyle(.orange)
                            Text("Textbooks & Solution Books (الكتب والحلول)")
                                .font(.headline)
                        }

                        textbookCard(
                            title: "Software Engineering: A Practitioner's Approach",
                            kindBadge: "Textbook · كتاب المقرر",
                            currentPage: $textbookPage1,
                            totalPages: 420,
                            solutionAttached: "Solution Manual Linked (PDF)"
                        )

                        textbookCard(
                            title: "Linear Algebra & Its Applications (Gilbert Strang)",
                            kindBadge: "Textbook + الحلول",
                            currentPage: $textbookPage2,
                            totalPages: 310,
                            solutionAttached: "Chapter 4 Solutions Verified"
                        )
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Subject Links with Provider Badges
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Image(systemName: "link.badge.plus")
                                .foregroundStyle(.cyan)
                            Text("Subject Platform Links (روابط المنصات)")
                                .font(.headline)
                        }

                        ForEach(platformLinks, id: \.title) { link in
                            HStack(spacing: 10) {
                                Image(systemName: link.icon)
                                    .foregroundStyle(link.color)
                                    .frame(width: 28, height: 28)
                                    .background(link.color.opacity(0.15), in: RoundedRectangle(cornerRadius: 7))

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(link.title)
                                        .font(.caption.weight(.semibold))
                                        .lineLimit(1)
                                    Text(link.subject)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(link.provider)
                                    .font(.caption2.weight(.bold))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(link.color.opacity(0.16), in: Capsule())
                                    .foregroundStyle(link.color)
                            }
                            .padding(10)
                            .worldsGlass(cornerRadius: 10)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(24)
            .frame(maxWidth: 1040, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .navigationTitle("Study Pack")
        .accessibilityIdentifier("study-pack-hub-view")
    }

    private func timetableRow(day: String, slots: [String]) -> some View {
        HStack(spacing: 1) {
            Text(day)
                .font(.caption.weight(.semibold))
                .frame(width: 110, height: 34)
                .background(WorldsPalette.surface(for: colorScheme))
            ForEach(slots, id: \.self) { slot in
                Text(slot)
                    .font(.caption2.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 34)
                    .background(WorldsPalette.paper(for: colorScheme))
            }
        }
    }

    private func textbookCard(title: String, kindBadge: String, currentPage: Binding<Int>, totalPages: Int, solutionAttached: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(kindBadge)
                    .font(.caption2.weight(.bold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.orange.opacity(0.18), in: Capsule())
                    .foregroundStyle(.orange)
                Spacer()
                Text("Bookmark: Page \(currentPage.wrappedValue) / \(totalPages)")
                    .font(.caption.monospaced().weight(.bold))
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
            }
            Text(title)
                .font(.subheadline.weight(.semibold))
            ProgressView(value: Double(currentPage.wrappedValue), total: Double(totalPages))
                .tint(.orange)
            HStack {
                Label(solutionAttached, systemImage: "checkmark.seal.fill")
                    .font(.caption2)
                    .foregroundStyle(.green)
                Spacer()
                Button("-1") { if currentPage.wrappedValue > 1 { currentPage.wrappedValue -= 1 } }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                Button("+1 Page") { if currentPage.wrappedValue < totalPages { currentPage.wrappedValue += 1 } }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                    .controlSize(.mini)
            }
        }
        .padding(12)
        .worldsGlass(cornerRadius: 12)
    }
}

// MARK: - Creative & Technical Studio (Visual Slides, Vector Drawing Canvas, 3D/CAD Viewport)

@MainActor
struct WorldsCreativeStudioView: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var selectedSlideIndex: Int = 0
    @State private var activeBrush: String = "Fountain Ink"
    @State private var renderMode3D: String = "Shaded + Wireframe"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 10) {
                            Image(systemName: "paintbrush.pointed.fill")
                                .font(.title2.weight(.semibold))
                                .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                            Text("Creative, Presentation & 3D CAD Studio")
                                .font(.system(.largeTitle, design: .default, weight: .bold))
                                .foregroundStyle(WorldsPalette.ink(for: colorScheme))
                        }
                        Text("Native Apple Pencil Vector Canvas (.worldsdraw), 16:9 Visual Presentation Deck, and SceneKit 3D / AutoCAD DXF Engineering Viewport.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }

                // 1. Visual 16:9 Presentation Stage + Slide Thumbnails
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Label("Visual Presentation Studio (16:9 Slide Canvas)", systemImage: "rectangle.inset.filled.and.person.filled")
                            .font(.headline)
                            .foregroundStyle(.orange)
                        Spacer()
                        Text("Slide \(selectedSlideIndex + 1) of 4 · ProMotion 120Hz")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }

                    HStack(alignment: .top, spacing: 14) {
                        // Slide Thumbnails
                        VStack(spacing: 8) {
                            ForEach(0..<4, id: \.self) { idx in
                                Button {
                                    selectedSlideIndex = idx
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text("0\(idx + 1)")
                                            .font(.caption2.monospaced().weight(.bold))
                                            .foregroundStyle(.orange)
                                        Text(slideTitle(idx))
                                            .font(.caption2.weight(.semibold))
                                            .lineLimit(1)
                                    }
                                    .padding(8)
                                    .frame(width: 145, alignment: .leading)
                                    .background(
                                        selectedSlideIndex == idx ? Color.orange.opacity(0.22) : Color.secondary.opacity(0.1),
                                        in: RoundedRectangle(cornerRadius: 8)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        // Active 16:9 Slide Stage
                        ZStack(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: 14)
                                .fill(
                                    LinearGradient(
                                        colors: [Color(red: 20 / 255, green: 21 / 255, blue: 28 / 255), Color(red: 12 / 255, green: 12 / 255, blue: 16 / 255)],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    )
                                )
                                .frame(height: 220)
                                .overlay(RoundedRectangle(cornerRadius: 14).stroke(WorldsPalette.goldAccent.opacity(0.45), lineWidth: 1.5))

                            VStack(alignment: .leading, spacing: 12) {
                                HStack {
                                    Text("WORLDS NATIVE ARCHITECTURE · 2026")
                                        .font(.caption2.monospaced().weight(.bold))
                                        .foregroundStyle(WorldsPalette.goldAccent)
                                    Spacer()
                                    Text("16:9 STAGE")
                                        .font(.caption2.monospaced())
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 3)
                                        .background(Color.white.opacity(0.1), in: Capsule())
                                        .foregroundStyle(.white.opacity(0.8))
                                }

                                Text(slideTitle(selectedSlideIndex))
                                    .font(.title2.weight(.bold))
                                    .foregroundStyle(.white)

                                HStack(spacing: 14) {
                                    slideMetricBox(label: "Local Engine", value: "SQLite + FTS5", color: WorldsPalette.goldAccent)
                                    slideMetricBox(label: "Sync Protocol", value: "Yrs CRDT v1", color: .cyan)
                                    slideMetricBox(label: "Apple UI", value: "Liquid Glass", color: .purple)
                                }
                            }
                            .padding(22)
                        }
                    }
                }
                .padding(16)
                .worldsGlass(cornerRadius: 16)

                // 2. Vector Drawing Canvas & 3D CAD Engineering Viewport side-by-side
                HStack(alignment: .top, spacing: 16) {
                    // Vector Drawing Canvas
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label("Apple Pencil Vector Canvas", systemImage: "pencil.tip.crop.circle.fill")
                                .font(.headline)
                                .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                            Spacer()
                            Text(activeBrush)
                                .font(.caption2.weight(.semibold))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(WorldsPalette.accent(for: colorScheme).opacity(0.18), in: Capsule())
                        }

                        HStack(spacing: 6) {
                            ForEach(["Fountain Ink", "Pencil Tilt", "Highlighter", "Laser", "Shapes"], id: \.self) { tool in
                                Button {
                                    activeBrush = tool
                                } label: {
                                    Text(tool)
                                        .font(.caption2.weight(.medium))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(activeBrush == tool ? WorldsPalette.accent(for: colorScheme).opacity(0.22) : Color.secondary.opacity(0.1), in: Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        ZStack {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color(red: 16 / 255, green: 17 / 255, blue: 21 / 255))
                                .frame(height: 180)
                            Canvas { context, size in
                                var curve = Path()
                                curve.move(to: CGPoint(x: 30, y: 130))
                                curve.addCurve(
                                    to: CGPoint(x: size.width - 35, y: 50),
                                    control1: CGPoint(x: size.width * 0.35, y: 20),
                                    control2: CGPoint(x: size.width * 0.65, y: 160)
                                )
                                context.stroke(curve, with: .color(WorldsPalette.goldAccent), lineWidth: 3.5)

                                let rect = CGRect(x: size.width * 0.35, y: 55, width: 130, height: 70)
                                context.stroke(Path(roundedRect: rect, cornerRadius: 10), with: .color(.cyan), lineWidth: 2)
                            }
                            .frame(height: 180)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .worldsGlass(cornerRadius: 16)

                    // 3D & CAD Engineering Viewport
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label("3D & AutoCAD DXF Viewport", systemImage: "cube.transparent.fill")
                                .font(.headline)
                                .foregroundStyle(.cyan)
                            Spacer()
                            Text("120 × 85 × 42 mm")
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                        }

                        HStack(spacing: 6) {
                            ForEach(["Shaded + Wireframe", "Wireframe CAD", "Studio Shaded"], id: \.self) { mode in
                                Button {
                                    renderMode3D = mode
                                } label: {
                                    Text(mode)
                                        .font(.caption2.weight(.medium))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(renderMode3D == mode ? Color.cyan.opacity(0.22) : Color.secondary.opacity(0.1), in: Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        ZStack {
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color(red: 14 / 255, green: 18 / 255, blue: 24 / 255))
                                .frame(height: 180)

                            Canvas { context, size in
                                let cx = size.width / 2
                                let cy = size.height / 2
                                // Isometric CAD wireframe cube + internal cylinder axis
                                let top = [
                                    CGPoint(x: cx, y: cy - 60),
                                    CGPoint(x: cx + 65, y: cy - 30),
                                    CGPoint(x: cx, y: cy),
                                    CGPoint(x: cx - 65, y: cy - 30)
                                ]
                                let bottom = top.map { CGPoint(x: $0.x, y: $0.y + 58) }
                                var wire = Path()
                                wire.addLines(top + [top[0]])
                                wire.addLines(bottom + [bottom[0]])
                                for i in 0..<4 {
                                    wire.move(to: top[i])
                                    wire.addLine(to: bottom[i])
                                }
                                context.stroke(wire, with: .color(.cyan), lineWidth: 2)
                            }
                            .frame(height: 180)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .worldsGlass(cornerRadius: 16)
                }
            }
            .padding(24)
            .frame(maxWidth: 1040, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(WorldsPalette.paper(for: colorScheme))
        .navigationTitle("Studio")
        .accessibilityIdentifier("creative-studio-view")
    }

    private func slideTitle(_ idx: Int) -> String {
        switch idx {
        case 0: return "Unified Local-First Knowledge & Study Engine"
        case 1: return "Excel-Grade Spreadsheets & 55+ Native Formulas"
        case 2: return "Visual Mind Maps, Concept Networks & Mermaid"
        default: return "Zero-Trust CRDT Collaboration & Dual MCP"
        }
    }

    private func slideMetricBox(label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.65))
            Text(value)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(color)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(0.4), lineWidth: 1))
    }
}
