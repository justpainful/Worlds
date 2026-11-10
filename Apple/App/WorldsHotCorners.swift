import SwiftUI
#if os(macOS)
import AppKit
#endif

// MARK: - macOS Hot Corners & Floating Quick Note HUD

enum HotCornerAction: String, CaseIterable, Identifiable {
    case none = "Disabled"
    case quickNote = "Quick Note"
    case assistant = "AI Assistant"
    case focusTimer = "Focus Timer"

    var id: String { rawValue }
}

@MainActor
final class WorldsHotCornersCoordinator: ObservableObject {
    @Published var showingQuickNote: Bool = false
    @Published var quickNoteDraft: String = ""
    @Published var lastTriggeredCorner: String? = nil

    @AppStorage("worlds_hot_corners_enabled") var enabled: Bool = true
    @AppStorage("worlds_hot_corner_bottom_right") var bottomRightActionRaw: String = HotCornerAction.quickNote.rawValue
    @AppStorage("worlds_hot_corner_top_right") var topRightActionRaw: String = HotCornerAction.assistant.rawValue
    @AppStorage("worlds_hot_corner_bottom_left") var bottomLeftActionRaw: String = HotCornerAction.focusTimer.rawValue

    var onTriggerAssistant: (() -> Void)?
    var onTriggerFocus: (() -> Void)?
    var onSaveQuickNote: ((String) -> Void)?

    #if os(macOS)
    private var monitor: Any?
    private var lastTriggerTime: Date = .distantPast

    func startMonitoring() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved]) { [weak self] event in
            Task { @MainActor [weak self] in
                self?.evaluatePointer(in: event.window, point: event.locationInWindow)
            }
            return event
        }
    }

    func stopMonitoring() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }

    private func evaluatePointer(in window: NSWindow?, point: NSPoint) {
        guard enabled, let window, window.isKeyWindow else { return }
        let bounds = window.contentLayoutRect
        let threshold: CGFloat = 14
        guard Date().timeIntervalSince(lastTriggerTime) > 1.2 else { return }

        let inRight = point.x >= bounds.maxX - threshold
        let inLeft = point.x <= bounds.minX + threshold
        let inBottom = point.y <= bounds.minY + threshold
        let inTop = point.y >= bounds.maxY - threshold

        if inRight && inBottom {
            lastTriggerTime = Date()
            lastTriggeredCorner = "Bottom-Right"
            execute(actionRaw: bottomRightActionRaw)
        } else if inRight && inTop {
            lastTriggerTime = Date()
            lastTriggeredCorner = "Top-Right"
            execute(actionRaw: topRightActionRaw)
        } else if inLeft && inBottom {
            lastTriggerTime = Date()
            lastTriggeredCorner = "Bottom-Left"
            execute(actionRaw: bottomLeftActionRaw)
        }
    }

    private func execute(actionRaw: String) {
        let action = HotCornerAction(rawValue: actionRaw) ?? .none
        switch action {
        case .quickNote:
            withAnimation(.spring(duration: 0.25)) { showingQuickNote = true }
        case .assistant:
            onTriggerAssistant?()
        case .focusTimer:
            onTriggerFocus?()
        case .none:
            break
        }
    }
    #endif

    func openQuickNote() {
        withAnimation(.spring(duration: 0.25)) {
            showingQuickNote = true
        }
    }

    func saveDraft() {
        let trimmed = quickNoteDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        onSaveQuickNote?(trimmed)
        quickNoteDraft = ""
        withAnimation(.easeOut(duration: 0.2)) {
            showingQuickNote = false
        }
    }
}

/// Floating Liquid Glass Quick Note overlay anchored cleanly to the corner (never obscuring workspace content until triggered).
struct HotCornerQuickNoteHUD: View {
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject var coordinator: WorldsHotCornersCoordinator

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Quick Note · Hot Corner", systemImage: "note.text.badge.plus")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(WorldsPalette.accent(for: colorScheme))
                Spacer()
                Button {
                    withAnimation(.easeOut(duration: 0.18)) {
                        coordinator.showingQuickNote = false
                    }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
            }

            TextEditor(text: $coordinator.quickNoteDraft)
                .font(.subheadline)
                .scrollContentBackground(.hidden)
                .frame(height: 88)
                .padding(8)
                .background(WorldsPalette.cardBackground(for: colorScheme).opacity(0.6), in: RoundedRectangle(cornerRadius: 8))

            HStack {
                Text("⌥Space or Bottom-Right Corner")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Save to Inbox") {
                    coordinator.saveDraft()
                }
                .buttonStyle(.borderedProminent)
                .tint(WorldsPalette.accent(for: colorScheme))
                .controlSize(.small)
                .disabled(coordinator.quickNoteDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(14)
        .frame(width: 320)
        .worldsFloatingGlass(in: RoundedRectangle(cornerRadius: 16, style: .continuous), interactive: true)
        .shadow(color: .black.opacity(0.28), radius: 18, y: 8)
        .padding(20)
        .accessibilityIdentifier("hot-corner-quick-note-hud")
    }
}

struct HotCornersSettingsRows: View {
    @AppStorage("worlds_hot_corners_enabled") private var enabled: Bool = true
    @AppStorage("worlds_hot_corner_bottom_right") private var bottomRight: String = HotCornerAction.quickNote.rawValue
    @AppStorage("worlds_hot_corner_top_right") private var topRight: String = HotCornerAction.assistant.rawValue
    @AppStorage("worlds_hot_corner_bottom_left") private var bottomLeft: String = HotCornerAction.focusTimer.rawValue

    var body: some View {
        Toggle("Enable Active Hot Corners", isOn: $enabled)

        if enabled {
            Picker("Bottom-Right Corner", selection: $bottomRight) {
                ForEach(HotCornerAction.allCases) { act in
                    Text(act.rawValue).tag(act.rawValue)
                }
            }
            Picker("Top-Right Corner", selection: $topRight) {
                ForEach(HotCornerAction.allCases) { act in
                    Text(act.rawValue).tag(act.rawValue)
                }
            }
            Picker("Bottom-Left Corner", selection: $bottomLeft) {
                ForEach(HotCornerAction.allCases) { act in
                    Text(act.rawValue).tag(act.rawValue)
                }
            }
        }
    }
}
