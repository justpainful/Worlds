import AppIntents
import Foundation

/// Siri, Spotlight and the Shortcuts app: "Ask Worlds", "Add to Worlds" and
/// "Note in Worlds" open the app with the assistant ready and the words
/// already written, so nothing changes without the person seeing it first.
enum WorldsIntentInbox {
    static let key = "worlds.intent.prompt"
    static let notification = Notification.Name("worlds.intent.prompt")

    /// Hand a prompt to the app: kept for a cold start and announced for a running app.
    @MainActor
    static func deliver(_ prompt: String) {
        UserDefaults.standard.set(prompt, forKey: key)
        NotificationCenter.default.post(name: notification, object: prompt)
    }

    /// The prompt an intent left, once.
    @MainActor
    static func take() -> String? {
        guard let prompt = UserDefaults.standard.string(forKey: key), !prompt.isEmpty else { return nil }
        UserDefaults.standard.removeObject(forKey: key)
        return prompt
    }
}

struct AskWorldsIntent: AppIntent {
    static let title: LocalizedStringResource = "Ask Worlds"
    static let description = IntentDescription("Ask Claude in Worlds about your pages.")
    static let openAppWhenRun = true

    @Parameter(title: "Question")
    var question: String

    @MainActor
    func perform() async throws -> some IntentResult {
        WorldsIntentInbox.deliver(question)
        return .result()
    }
}

struct AddTaskToWorldsIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a Task to Worlds"
    static let description = IntentDescription("Add a task for today in Worlds.")
    static let openAppWhenRun = true

    @Parameter(title: "Task")
    var task: String

    @MainActor
    func perform() async throws -> some IntentResult {
        let arabic = Locale.current.language.languageCode?.identifier == "ar"
        WorldsIntentInbox.deliver(arabic ? "أضف مهمة لليوم: \(task)" : "Add a task for today: \(task)")
        return .result()
    }
}

struct NoteToWorldsIntent: AppIntent {
    static let title: LocalizedStringResource = "Note in Worlds"
    static let description = IntentDescription("Save a quick note as a new page in Worlds.")
    static let openAppWhenRun = true

    @Parameter(title: "Note")
    var note: String

    @MainActor
    func perform() async throws -> some IntentResult {
        let arabic = Locale.current.language.languageCode?.identifier == "ar"
        WorldsIntentInbox.deliver(arabic ? "أنشئ صفحة جديدة فيها هذه الملاحظة: \(note)" : "Make a new page with this note: \(note)")
        return .result()
    }
}

struct WorldsShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: AskWorldsIntent(), phrases: ["Ask \(.applicationName)", "Ask \(.applicationName) a question"], shortTitle: "Ask Worlds", systemImageName: "sparkles")
        AppShortcut(intent: AddTaskToWorldsIntent(), phrases: ["Add a task to \(.applicationName)", "Add to \(.applicationName)"], shortTitle: "Add a Task", systemImageName: "checklist")
        AppShortcut(intent: NoteToWorldsIntent(), phrases: ["Note in \(.applicationName)", "Take a note in \(.applicationName)"], shortTitle: "Quick Note", systemImageName: "square.and.pencil")
    }
}
