import SwiftUI
import WorldsPersistence

struct SettingsView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.dismiss) private var dismiss

    @AppStorage("worlds_theme_preference") private var themePreference: String = "system"
    @AppStorage("worlds_auto_save_interval") private var autoSaveInterval: Double = 3.0
    @AppStorage("worlds_mcp_auto_approve_reads") private var autoApproveReads: Bool = true
    @AppStorage("worlds_pack_study") private var studyPackEnabled: Bool = false

    let databaseURL: URL?
    let pageCount: Int
    let onVacuumDatabase: (() -> Void)?
    let onClearCache: (() -> Void)?

    @State private var vacuumCompleted = false
    @State private var cacheCleared = false

    var body: some View {
        NavigationStack {
            Form {
                // Section 1: Appearance & Theme
                Section("Appearance & Theme") {
                    Picker(selection: $themePreference) {
                        Text("System").tag("system")
                        Text("Dark (#0C0C0E)").tag("dark")
                        Text("Light (#FDFDFC)").tag("light")
                    } label: {
                        SettingsRowLabel("Theme", symbol: "circle.lefthalf.filled", color: .indigo)
                    }
                    .pickerStyle(.menu)

                    HStack {
                        SettingsRowLabel("Accent Color", symbol: "paintpalette.fill", color: .blue)
                        Spacer()
                        Circle()
                            .fill(WorldsPalette.accent(for: colorScheme))
                            .frame(width: 20, height: 20)
                        Text(colorScheme == .dark ? "Blue (#2E92FF)" : "Blue (#0066CC)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        SettingsRowLabel("Materials", symbol: "square.stack.3d.up.fill", color: .teal)
                        Spacer()
                        #if os(macOS)
                        Text("Liquid Glass · NSVisualEffectView Vibrancy")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        #else
                        Text("Liquid Glass")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        #endif
                    }
                }

                #if os(macOS)
                // macOS Experience: Vibrancy & Hot Corners
                Section("macOS Experience & Hot Corners") {
                    HotCornersSettingsRows()
                }
                #endif

                // Section 2: Packs (Opt-In Domain Features)
                Section("Packs (Opt-In Features)") {
                    Toggle(isOn: $studyPackEnabled) {
                        SettingsRowLabel("Study Pack (Subjects, Timetable, Assignments, Exams)", symbol: "graduationcap.fill", color: .orange)
                    }
                    .accessibilityIdentifier("toggle-study-pack")

                    Text("Tasks, Calendar, Inbox, Goals, and Spreadsheets are always on for everyone. Turn on Study only if you are a student; when off, all academic views are hidden without losing any saved data.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Section 3: Workspace & Storage
                Section("Workspace & Storage") {
                    if let databaseURL {
                        LabeledContent {
                            Text(databaseURL.lastPathComponent)
                        } label: {
                            SettingsRowLabel("Database Location", symbol: "externaldrive.fill", color: .gray)
                        }
                    }
                    LabeledContent {
                        Text(pageCount, format: .number)
                    } label: {
                        SettingsRowLabel("Total Pages", symbol: "doc.on.doc.fill", color: .blue)
                    }

                    Button {
                        onVacuumDatabase?()
                        vacuumCompleted = true
                    } label: {
                        SettingsRowLabel("Vacuum Database", symbol: "arrow.triangle.2.circlepath", color: .green)
                    }
                    .accessibilityIdentifier("vacuum-database-button")

                    if vacuumCompleted {
                        Text("Database optimized and fragmented pages cleared.")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }

                    Button(role: .destructive) {
                        onClearCache?()
                        cacheCleared = true
                    } label: {
                        SettingsRowLabel("Clear Local Cache", symbol: "trash.fill", color: .red)
                    }
                    .accessibilityIdentifier("clear-cache-button")

                    if cacheCleared {
                        Text("In-memory render caches and previews purged.")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                }

                // Section 4: Model Context Protocol (MCP) & AI
                Section("Model Context Protocol & Assistant") {
                    #if WORLDS_MAIN_APP_MODULES
                    NavigationLink {
                        AIProviderSettingsView()
                    } label: {
                        SettingsRowLabel("AI Providers", symbol: "sparkles", color: .purple)
                    }
                    .accessibilityIdentifier("open-ai-provider-settings")
                    #endif

                    #if os(macOS)
                    LabeledContent("MCP Architecture", value: "Dual (Process + Entitlements)")
                    LabeledContent("Claude CLI Discovery", value: "Automatic (.local/bin, PATH)")
                    #else
                    LabeledContent("MCP Architecture", value: "In-Process (iOS Sandbox Compliant)")
                    LabeledContent("Subprocess Execution", value: "Disabled (Sandbox Invariant)")
                    #endif

                    Toggle(isOn: $autoApproveReads) {
                        SettingsRowLabel("Auto-approve read operations", symbol: "checkmark.shield.fill", color: .green)
                    }

                    LabeledContent("Write Authorization Gate", value: "Single-Use Explicit Approval")
                }

                // Section 5: Collaboration & CRDT
                Section("Collaboration & Wire Protocol") {
                    LabeledContent("CRDT Engine", value: "Yrs Rust Native FFI")
                    LabeledContent("Sync Protocol", value: "worlds-sync.v1")
                    LabeledContent("Drawing Schema", value: "Schema 1 (.worldsdraw)")
                }

                // Section 6: About Worlds
                Section("About Worlds") {
                    LabeledContent("Version", value: "0.1.0 (Build 1)")
                    LabeledContent("Platforms", value: "iOS 17+ · macOS 14+")
                    LabeledContent("Design System", value: "Apple Native Liquid Glass")
                    Text("Worlds is a local-first, privacy-respecting cross-platform workspace.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            // No opaque paint behind the groups: the sheet glass (or window vibrancy) shows through.
            .scrollContentBackground(.hidden)
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("close-settings-button")
                }
            }
        }
        .worldsSheetGlass()
        .accessibilityIdentifier("settings-view")
    }
}

/// A settings row title with its coloured icon tile, as in System Settings.
struct SettingsRowLabel: View {
    let title: LocalizedStringKey
    let symbol: String
    let color: Color

    init(_ title: LocalizedStringKey, symbol: String, color: Color) {
        self.title = title
        self.symbol = symbol
        self.color = color
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            WorldsIconTile(symbol, color: color, size: 22)
        }
    }
}
