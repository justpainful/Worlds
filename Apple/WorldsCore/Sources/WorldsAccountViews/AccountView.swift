import SwiftUI
import WorldsIdentity
import WorldsIdentityContinuity

protocol AccountSession: Sendable {
    func accountHasSession() async throws -> Bool
    func beginEmail(_ email: String) async throws -> EmailChallenge
    func verifyCode(challengeID: String, code: String, deviceName: String, platform: String) async throws
    func fetchAccount() async throws -> IdentityAccountSnapshot
    func logout() async throws -> IdentitySignOutResult
}
extension IdentitySessionCoordinator: AccountSession {
    func accountHasSession() async throws -> Bool { try await hasStoredSession() }
    func beginEmail(_ email: String) async throws -> EmailChallenge { try await startEmail(email) }
    func verifyCode(challengeID: String, code: String, deviceName: String, platform: String) async throws {
        _ = try await verifyEmail(challengeID: challengeID, code: code, deviceName: deviceName, platform: platform)
    }
    func fetchAccount() async throws -> IdentityAccountSnapshot { try await accountSnapshot() }
    func logout() async throws -> IdentitySignOutResult { try await signOut() }
}

/// Host supplies a coordinator configured with the actual service URL and one
/// app-private lock directory. No credentials or example accounts are embedded.
public struct WorldsAccountView: View {
    @StateObject private var model: AccountModel
    @State private var email = ""
    @State private var code = ""
    public init(coordinator: IdentitySessionCoordinator, deviceName: String, platform: String) {
        _model = StateObject(wrappedValue: AccountModel(coordinator: coordinator, deviceName: deviceName, platform: platform))
    }

    public var body: some View {
        Form {
            if model.busy { ProgressView("Connecting") }
            if let notice = model.notice { Text(notice).foregroundStyle(.secondary) }
            if let error = model.error { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            if let snapshot = model.snapshot {
                Section("Account") {
                    LabeledContent("Name", value: snapshot.profile.displayName)
                    LabeledContent("Email", value: snapshot.profile.email)
                    if let username = snapshot.profile.username { LabeledContent("Username", value: username) }
                }
                Section("Workspaces") {
                    if snapshot.workspaces.isEmpty { Text("No workspaces") }
                    ForEach(snapshot.workspaces, id: \.id) { workspace in
                        LabeledContent(workspace.name, value: workspace.role)
                    }
                }
                Button("Refresh account") { Task { await model.refresh() } }.disabled(model.busy)
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }.disabled(model.busy)
            } else if model.hasSession {
                Section("Account") {
                    Text("Account details are unavailable.")
                    Button("Retry") { Task { await model.refresh() } }.disabled(model.busy)
                    Button("Sign out", role: .destructive) { Task { await model.signOut() } }.disabled(model.busy)
                }
            } else if let challenge = model.challenge {
                Section("Verification") {
                    Text("Enter the code sent to your email.")
                    TextField("Verification code", text: $code).textContentType(.oneTimeCode)
                    Button("Verify") {
                        let submitted = code
                        code = ""
                        Task { await model.verify(challenge: challenge, code: submitted) }
                    }.disabled(model.busy || code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button("Cancel") { model.cancelChallenge(); code = "" }.disabled(model.busy)
                }
            } else {
                Section("Sign in") {
                    TextField("Email", text: $email).textContentType(.emailAddress)
                    Button("Send verification code") { Task { await model.startEmail(email) } }
                        .disabled(model.busy || email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .task { await model.restore() }
    }
}

@MainActor
final class AccountModel: ObservableObject {
    @Published var snapshot: IdentityAccountSnapshot?
    @Published var hasSession = false
    @Published var challenge: EmailChallenge?
    @Published var busy = false
    @Published var notice: String?
    @Published var error: String?
    private let coordinator: any AccountSession
    private let deviceName: String
    private let platform: String

    init(coordinator: any AccountSession, deviceName: String, platform: String) {
        self.coordinator = coordinator; self.deviceName = deviceName; self.platform = platform
    }
    func restore() async {
        guard snapshot == nil, challenge == nil, !busy else { return }
        busy = true
        do {
            hasSession = try await coordinator.accountHasSession()
            busy = false
            if hasSession { await refresh(isRestore: true) }
        } catch { busy = false; self.error = error.localizedDescription }
    }
    func startEmail(_ email: String) async {
        guard !busy else { return }
        busy = true; error = nil; notice = nil; defer { busy = false }
        do { challenge = try await coordinator.beginEmail(email.trimmingCharacters(in: .whitespacesAndNewlines)) }
        catch is CancellationError { notice = "The request was cancelled." }
        catch { self.error = error.localizedDescription }
    }
    func cancelChallenge() { challenge = nil; error = nil; notice = nil }
    func verify(challenge: EmailChallenge, code: String) async {
        guard !busy, self.challenge?.challengeId == challenge.challengeId else { return }
        busy = true; error = nil; notice = nil; defer { busy = false }
        do {
            try await coordinator.verifyCode(challengeID: challenge.challengeId, code: code, deviceName: deviceName, platform: platform)
            hasSession = true
            self.challenge = nil
            // Authentication succeeded even if the subsequent profile request fails.
            do { snapshot = try await coordinator.fetchAccount() }
            catch IdentityError.signedOut { hasSession = false; notice = "The session expired. Sign in again." }
            catch IdentityContinuityError.signedOut { hasSession = false; notice = "The session expired. Sign in again." }
            catch { notice = "Signed in, but account details could not be loaded."; self.error = error.localizedDescription }
        } catch is CancellationError {
            self.challenge = nil
            notice = "Verification may have been interrupted. Request a new code."
        }
        catch is URLError {
            self.challenge = nil
            notice = "The verification result is unknown. Request a new code."
        }
        catch { self.error = error.localizedDescription }
    }
    func refresh(isRestore: Bool = false) async {
        guard !busy else { return }
        busy = true; error = nil; defer { busy = false }
        do { snapshot = try await coordinator.fetchAccount(); notice = nil }
        catch IdentityError.signedOut { snapshot = nil; hasSession = false }
        catch IdentityContinuityError.signedOut { snapshot = nil; hasSession = false }
        catch is CancellationError { if !isRestore { notice = "The request was cancelled." } }
        catch { self.error = error.localizedDescription }
    }
    func signOut() async {
        guard !busy else { return }
        busy = true; error = nil; defer { busy = false }
        do {
            let result = try await coordinator.logout()
            snapshot = nil; challenge = nil; hasSession = false
            switch result {
            case .revokedRemotely: notice = "Signed out."
            case .localOnly: notice = "Signed out on this device. Server sign-out could not be confirmed."
            }
        } catch { self.error = error.localizedDescription }
    }
}
