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
                    Picker("Theme", selection: $themePreference) {
                        Text("System").tag("system")
                        Text("Dark (#0C0C0E)").tag("dark")
                        Text("Light (#FDFDFC)").tag("light")
                    }
                    .pickerStyle(.menu)

                    HStack {
                        Text("Accent Color")
                        Spacer()
                        Circle()
                            .fill(WorldsPalette.accent(for: colorScheme))
                            .frame(width: 20, height: 20)
                        Text(colorScheme == .dark ? "Gold (#D2A46E)" : "Warm Bronze (#8A5820)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Text("Materials")
                        Spacer()
                        Text("Liquid Glass")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                // Section 2: Packs (Opt-In Domain Features)
                Section("Packs (Opt-In Features)") {
                    Toggle("Study Pack (Subjects, Timetable, Assignments, Exams)", isOn: $studyPackEnabled)
                        .accessibilityIdentifier("toggle-study-pack")

                    Text("Tasks, Calendar, Inbox, Goals, and Spreadsheets are always on for everyone. Turn on Study only if you are a student; when off, all academic views are hidden without losing any saved data.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                // Section 3: Workspace & Storage
                Section("Workspace & Storage") {
                    if let databaseURL {
                        LabeledContent("Database Location", value: databaseURL.lastPathComponent)
                    }
                    LabeledContent("Total Pages", value: "\(pageCount)")

                    Button("Vacuum Database") {
                        onVacuumDatabase?()
                        vacuumCompleted = true
                    }
                    .accessibilityIdentifier("vacuum-database-button")

                    if vacuumCompleted {
                        Text("Database optimized and fragmented pages cleared.")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }

                    Button("Clear Local Cache", role: .destructive) {
                        onClearCache?()
                        cacheCleared = true
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
                    #if os(macOS)
                    LabeledContent("MCP Architecture", value: "Dual (Process + Entitlements)")
                    LabeledContent("Claude CLI Discovery", value: "Automatic (.local/bin, PATH)")
                    #else
                    LabeledContent("MCP Architecture", value: "In-Process (iOS Sandbox Compliant)")
                    LabeledContent("Subprocess Execution", value: "Disabled (Sandbox Invariant)")
                    #endif

                    Toggle("Auto-approve read operations", isOn: $autoApproveReads)

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
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                        .accessibilityIdentifier("close-settings-button")
                }
            }
        }
        .accessibilityIdentifier("settings-view")
    }
}
