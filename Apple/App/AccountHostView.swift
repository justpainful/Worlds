#if WORLDS_EXPERIMENTAL_ACCOUNT
import SwiftUI
import WorldsAccountViews
import WorldsIdentityContinuity

/// Experimental entry point. No production identity endpoint is assumed.
struct AccountHostView: View {
    @Environment(\.dismiss) private var dismiss
    @AppStorage("account.serverUrl") private var savedServer = ""
    @State private var entry = ""
    @State private var coordinator: IdentitySessionCoordinator?
    @State private var error: String?
    @State private var started = false

    var body: some View {
        NavigationStack {
            Group {
                if let coordinator {
                    WorldsAccountView(coordinator: coordinator, deviceName: deviceName, platform: platform)
                } else {
                    Form {
                        Section("Identity service") {
                            Text("Enter the address of your Worlds identity service. This setting is not a password.")
                            TextField("https://identity.example", text: $entry)
                                .textContentType(.URL)
                            if let error { Text(error).foregroundStyle(.red) }
                            Button("Continue") { openService() }
                        }
                    }
                }
            }
            .navigationTitle("Account")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .task {
                guard !started else { return }
                started = true
                entry = savedServer.isEmpty ? buildDefault : savedServer
            }
        }
    }

    private var buildDefault: String {
        (Bundle.main.object(forInfoDictionaryKey: "WorldsIdentityURL") as? String) ?? ""
    }
    private var platform: String {
        #if os(macOS)
        "macos"
        #else
        "ios"
        #endif
    }
    private var deviceName: String { platform == "macos" ? "Worlds on Mac" : "Worlds on iPhone or iPad" }

    private func openService() {
        do {
            #if DEBUG
            let developmentLoopback = true
            #else
            let developmentLoopback = false
            #endif
            let url = try AccountServiceConfiguration.resolve(userValue: entry, buildValue: buildDefault, allowInsecureLoopback: developmentLoopback)
            guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
                throw AccountServiceConfigurationError.notConfigured
            }
            let lockDirectory = support.resolvingSymlinksInPath().appendingPathComponent("Worlds/IdentityLocks", isDirectory: true)
            let created = try IdentitySessionCoordinator(baseURL: url, lockDirectory: lockDirectory)
            savedServer = url.absoluteString
            error = nil; coordinator = created
        } catch AccountServiceConfigurationError.notConfigured {
            error = "Set the address of your identity service to continue."
        } catch AccountServiceConfigurationError.invalidAddress {
            error = "Enter a valid HTTPS service address. Local HTTP is allowed for development."
        } catch {
            self.error = error.localizedDescription
        }
    }
}
#endif
