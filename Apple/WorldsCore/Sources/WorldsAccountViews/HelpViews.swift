import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import WorldsIdentity
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// A screenshot made small enough for a report: at most 1600 points across, as JPEG.
func reportPicture(_ data: Data) -> Data? {
    #if canImport(UIKit)
    guard let image = UIImage(data: data) else { return nil }
    let longest = max(image.size.width, image.size.height)
    let scale = min(1, 1600 / max(longest, 1))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat.default(); format.scale = 1
    let sized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    return sized.jpegData(compressionQuality: 0.82)
    #elseif canImport(AppKit)
    guard let rep = NSBitmapImageRep(data: data) else { return nil }
    return rep.representation(using: .jpeg, properties: [.compressionFactor: 0.82])
    #else
    return nil
    #endif
}

/// Help and feedback, messages from the Worlds team, a copy of one's data and
/// deleting the account (docs/admin/PLAN.md, phase 9).

struct TeamMessage: Decodable, Identifiable, Sendable {
    let id: String
    let author: String
    let body: String
    let createdAt: Double
}

struct TeamThread: Decodable, Identifiable, Sendable {
    let id: String
    let subject: String
    let status: String
    let messages: [TeamMessage]
}

struct AccountDataDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

enum HelpSheet: String, Identifiable {
    case idea, problem, delete
    var id: String { rawValue }
}

@MainActor
final class HelpModel: ObservableObject {
    static let supportSite = URL(string: "https://support.enterworlds.space")!
    static let roadmap = URL(string: "https://support.enterworlds.space/roadmap")!

    @Published var threads: [TeamThread]?
    @Published var dueAt: Date?
    @Published var busy = false
    @Published var message: String?
    @Published var failed = false
    @Published var exportDocument: AccountDataDocument?
    @Published var deletionChallenge: EmailChallenge?
    @Published var tester: String?
    @Published var testerKnown = false
    /// Set by the account view: the service signed this device out after a deletion.
    var onSignedOut: @MainActor () -> Void = {}
    private let session: any AccountSession
    private let platform: String

    init(session: any AccountSession, platform: String) {
        self.session = session; self.platform = platform
    }

    private static var lang: String { Locale.current.language.languageCode?.identifier == "ar" ? "ar" : "en" }

    private func call(_ path: String, _ method: String = "GET", _ body: [String: Any]? = nil) async throws -> Data {
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        return try await session.serviceRequest(path: path, method: method, body: data)
    }

    private static func describe(_ error: Error) -> String {
        if case IdentityError.http(_, let code, _) = error {
            if code == "owns_shared_workspaces" { return String(localized: "You own shared workspaces. Hand them to someone else or delete them first.") }
            if code.hasPrefix("invalid_code") || code == "code_invalid" || code == "invalid_request" { return String(localized: "That code is not right. Check it and try again.") }
        }
        return String(localized: "That did not work. Check the connection and try again.")
    }

    private func perform(_ action: () async throws -> String?) async {
        guard !busy else { return }
        busy = true; failed = false; message = nil
        defer { busy = false }
        do { message = try await action() } catch { failed = true; message = Self.describe(error) }
    }

    func load() async {
        if let data = try? await call("/me/deletion"),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let due = object["dueAt"] as? Double {
            dueAt = Date(timeIntervalSince1970: due / 1000)
        } else {
            dueAt = nil
        }
        if let data = try? await call("/me/testers"),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            tester = object["status"] as? String
            testerKnown = true
        }
        await sendUsageIfDue()
        if let data = try? await call("/me/messages") {
            threads = (try? JSONDecoder().decode([TeamThread].self, from: data)) ?? []
        } else {
            threads = []
        }
    }

    /// Once a day, when the person agreed in Privacy and testing: how many, never what.
    private func sendUsageIfDue() async {
        let defaults = UserDefaults.standard
        guard defaults.bool(forKey: "service.usageCounts"), Date().timeIntervalSince1970 - defaults.double(forKey: "service.usageSentAt") > 86_400 else { return }
        let data: [String: Any] = ["platform": platform, "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "", "language": Self.lang]
        if (try? await call("/me/usage", "POST", ["data": data])) != nil { defaults.set(Date().timeIntervalSince1970, forKey: "service.usageSentAt") }
    }

    func setUsageCounts(_ on: Bool) async {
        UserDefaults.standard.set(on, forKey: "service.usageCounts")
        if on { UserDefaults.standard.set(0, forKey: "service.usageSentAt"); await sendUsageIfDue() }
    }

    func setTester(_ on: Bool) async {
        await perform {
            if on {
                let data = try await call("/me/testers", "POST", ["platforms": [platform]])
                tester = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["status"] as? String
            } else {
                _ = try await call("/me/testers", "DELETE")
                tester = nil
            }
            return nil
        }
    }

    func suggest(title: String, body: String) async {
        await perform {
            let data = try await call("/community/suggestions", "POST", ["title": title, "body": body, "lang": Self.lang])
            let number = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["number"] as? Int ?? 0
            return String(format: String(localized: "Thanks. Your idea is #%@."), "\(number)")
        }
    }

    func report(subject: String, body: String, details: Bool, pictures: [Data] = []) async {
        var fields: [String: String] = ["platform": platform, "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""]
        if details {
            fields["system"] = ProcessInfo.processInfo.operatingSystemVersionString
            fields["language"] = Locale.current.identifier
        }
        await perform {
            var files: [String] = []
            for picture in pictures.prefix(6) {
                guard let jpeg = reportPicture(picture) else { continue }
                let uploaded = try await call("/support/files", "POST", ["mime": "image/jpeg", "data": jpeg.base64EncodedString()])
                if let key = (try? JSONSerialization.jsonObject(with: uploaded) as? [String: Any])?["key"] as? String { files.append(key) }
            }
            let data = try await call("/support/requests", "POST", ["kind": "problem", "via": "app", "lang": Self.lang, "subject": subject, "body": body, "fields": fields, "files": files])
            let ref = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["ref"] as? String ?? ""
            return String(format: String(localized: "Request %@ is open. The reply comes by email."), ref)
        }
    }

    func reply(thread: String, body: String) async {
        await perform {
            _ = try await call("/me/messages/\(thread)", "POST", ["body": body])
            await load()
            return nil
        }
    }

    func exportData() async {
        await perform {
            let data = try await call("/me/export")
            exportDocument = AccountDataDocument(data: data)
            return nil
        }
    }

    func sendDeletionCode(email: String) async {
        await perform {
            deletionChallenge = try await session.beginEmail(email)
            return nil
        }
    }

    func delete(code: String) async {
        guard let challenge = deletionChallenge else { return }
        await perform {
            _ = try await call("/me/deletion", "POST", ["challengeId": challenge.challengeId, "code": code, "lang": Self.lang])
            // The service signed every device out; this one forgets its session too.
            _ = try? await session.logout()
            deletionChallenge = nil
            onSignedOut()
            return String(localized: "Your account will be deleted in 30 days. Sign in before then to keep it.")
        }
    }

    func cancelDeletion() async {
        await perform {
            _ = try await call("/me/deletion", "DELETE")
            dueAt = nil
            return String(localized: "Your account is kept.")
        }
    }
}

/// The sections Account shows while signed in.
struct HelpSections: View {
    @ObservedObject var model: HelpModel
    let email: String
    @State private var sheet: HelpSheet?
    @State private var drafts: [String: String] = [:]
    @State private var exporting = false
    @AppStorage("service.usageCounts") private var usageCounts = false

    var body: some View {
        if let due = model.dueAt {
            Section {
                Text(String(format: String(localized: "This account will be deleted on %@. Until then everything can come back as it was."), due.formatted(date: .long, time: .omitted)))
                Button("Cancel deletion") { Task { await model.cancelDeletion() } }.disabled(model.busy)
            }
        }
        Section("Help and feedback") {
            Button { sheet = .idea } label: { Label("Suggest an idea", systemImage: "lightbulb") }
            Button { sheet = .problem } label: { Label("Report a problem", systemImage: "exclamationmark.bubble") }
            Link(destination: HelpModel.supportSite) { Label("Help center", systemImage: "questionmark.circle") }
            Link(destination: HelpModel.roadmap) { Label("Ideas and roadmap", systemImage: "map") }
            if let message = model.message { Text(message).foregroundStyle(model.failed ? .red : .secondary) }
        }
        .sheet(item: $sheet) { which in
            switch which {
            case .idea: FeedbackForm(problem: false) { title, body, _, _ in Task { await model.suggest(title: title, body: body) } }
            case .problem: FeedbackForm(problem: true) { title, body, details, pictures in Task { await model.report(subject: title, body: body, details: details, pictures: pictures) } }
            case .delete: DeleteAccountForm(model: model, email: email)
            }
        }
        Section("Messages from Worlds") {
            if let threads = model.threads {
                if threads.isEmpty { Text("No messages. When the Worlds team writes to you, it shows up here.").foregroundStyle(.secondary) }
                ForEach(threads) { thread in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(thread.subject).font(.headline)
                        ForEach(thread.messages) { m in
                            Text("\(m.author == "team" ? String(localized: "Worlds team") : String(localized: "You")): \(m.body)")
                                .foregroundStyle(m.author == "team" ? .primary : .secondary)
                        }
                        if thread.status != "closed" {
                            TextField("Reply", text: Binding(get: { drafts[thread.id] ?? "" }, set: { drafts[thread.id] = String($0.prefix(4000)) }), axis: .vertical)
                            Button("Send") {
                                let text = drafts[thread.id] ?? ""
                                drafts[thread.id] = ""
                                Task { await model.reply(thread: thread.id, body: text) }
                            }
                            .disabled(model.busy || (drafts[thread.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                }
            } else {
                ProgressView()
            }
        }
        Section {
            Toggle(isOn: Binding(get: { usageCounts }, set: { on in usageCounts = on; Task { await model.setUsageCounts(on) } })) {
                VStack(alignment: .leading) {
                    Text("Send usage counts")
                    Text("Once a day: the version and language. Never titles, text or files.").font(.footnote).foregroundStyle(.secondary)
                }
            }
            Toggle(isOn: Binding(get: { model.tester == "applied" || model.tester == "accepted" }, set: { on in Task { await model.setTester(on) } })) {
                VStack(alignment: .leading) {
                    Text("Be a Worlds tester")
                    Text(model.tester == "accepted" ? "You are a tester. Thank you." : model.tester == "applied" ? "Asked. The team answers soon." : model.tester == "declined" ? "Not this time." : "Try new versions before everyone else.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .disabled(!model.testerKnown || model.busy)
        } header: {
            Text("Privacy and testing")
        }
        Section {
            Button { Task { await model.exportData(); exporting = model.exportDocument != nil } } label: { Label("Download my data", systemImage: "arrow.down.doc") }
                .disabled(model.busy)
            Button(role: .destructive) { sheet = .delete } label: { Label("Delete account", systemImage: "trash") }
                .disabled(model.busy || model.dueAt != nil)
        } header: {
            Text("Your data")
        } footer: {
            Text("A copy of what the account service keeps about you. Your pages are already on this device.")
        }
        .fileExporter(isPresented: $exporting, document: model.exportDocument, contentType: .json, defaultFilename: "worlds-account") { _ in
            model.exportDocument = nil
        }
        .task { await model.load() }
    }
}

private struct FeedbackForm: View {
    let problem: Bool
    let send: (String, String, Bool, [Data]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var text = ""
    @State private var details = true
    @State private var items: [PhotosPickerItem] = []
    @State private var pictures: [Data] = []

    var body: some View {
        NavigationStack {
            Form {
                TextField(problem ? "What went wrong, in a line" : "Your idea in a line", text: $title)
                TextField(problem ? "What you did, what you expected, and what happened" : "Why it would help (optional)", text: $text, axis: .vertical)
                    .lineLimit(4...10)
                if problem {
                    PhotosPicker(selection: $items, maxSelectionCount: 6, matching: .images) {
                        Label(pictures.isEmpty ? String(localized: "Add screenshots") : String(format: String(localized: "%@ screenshots"), "\(pictures.count)"), systemImage: "photo")
                    }
                    .onChange(of: items) { _, picked in
                        Task {
                            var loaded: [Data] = []
                            for item in picked { if let data = try? await item.loadTransferable(type: Data.self) { loaded.append(data) } }
                            pictures = loaded
                        }
                    }
                    Toggle("Include the Worlds version, system version and language", isOn: $details)
                }
            }
            .navigationTitle(problem ? "Report a problem" : "Suggest an idea")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") { send(String(title.prefix(140)), String(text.prefix(4000)), details, pictures); dismiss() }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (problem && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
        }
    }
}

private struct DeleteAccountForm: View {
    @ObservedObject var model: HelpModel
    let email: String
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""

    var body: some View {
        NavigationStack {
            Form {
                if model.deletionChallenge == nil {
                    Text("Every device signs out now, and your account, profile, published pages and Team membership are erased in 30 days. Until then you can sign in and cancel it. Pages on this device stay on this device.")
                    Button("Email me a code") { Task { await model.sendDeletionCode(email: email) } }.disabled(model.busy)
                } else {
                    Text("We sent a 6 digit code to your email. Enter it to confirm.")
                    TextField("Verification code", text: $code).textContentType(.oneTimeCode)
                    Button("Delete account", role: .destructive) {
                        let submitted = code.filter(\.isNumber)
                        Task { await model.delete(code: submitted); if model.deletionChallenge == nil && !model.failed { dismiss() } }
                    }
                    .disabled(model.busy || code.filter(\.isNumber).count != 6)
                }
                if model.failed, let message = model.message { Text(message).foregroundStyle(.red) }
            }
            .navigationTitle("Delete your Worlds account?")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.deletionChallenge = nil; dismiss() } } }
        }
    }
}
