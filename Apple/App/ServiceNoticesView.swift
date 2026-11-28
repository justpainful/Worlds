#if WORLDS_EXPERIMENTAL_ACCOUNT
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// What the account service tells this app (docs/admin/PLAN.md, phase 9):
/// maintenance, an incident, announcements and an update to install, at the
/// bottom of the window. Read at start and every five minutes, without a
/// sign-in; the account screen sends the usage counts when the person agreed.
struct ServiceNoticesView: View {
    @AppStorage("account.serverUrl") private var savedServer = ""
    @AppStorage("service.dismissed") private var dismissedList = ""
    @State private var notices: [ServiceNotice] = []
    @Environment(\.openURL) private var openURL

    private var server: String {
        let saved = savedServer.trimmingCharacters(in: .whitespacesAndNewlines)
        return saved.isEmpty ? ((Bundle.main.object(forInfoDictionaryKey: "WorldsIdentityURL") as? String) ?? "https://login.enterworlds.space") : saved
    }

    var body: some View {
        VStack(spacing: 8) {
            ForEach(notices) { notice in
                HStack(spacing: 10) {
                    WorldsIconTile(notice.warning ? "exclamationmark.triangle.fill" : "megaphone.fill",
                                   color: notice.warning ? Color.orange : Color.accentColor, size: 24)
                    Text(notice.text).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                    if let link = notice.link {
                        Button(notice.linkLabel) { openURL(link) }.buttonStyle(.borderless)
                    }
                    if notice.dismissible {
                        Button { dismiss(notice.id) } label: { Image(systemName: "xmark") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(Text("Dismiss"))
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .worldsFloatingGlass(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .frame(maxWidth: 560)
            }
        }
        .padding(.horizontal, 16).padding(.bottom, 12)
        .task(id: server) {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(for: .seconds(300))
            }
        }
    }

    private func dismiss(_ id: String) {
        var list = dismissedList.split(separator: "\n").map(String.init)
        list.append(id)
        dismissedList = list.suffix(50).joined(separator: "\n")
        notices.removeAll { $0.id == id }
    }

    private func load() async {
        #if os(macOS)
        let platform = "macos"
        #else
        let platform = UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
        #endif
        let version = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? ""
        let lang = Locale.current.language.languageCode?.identifier == "ar" ? "ar" : "en"
        var parts = URLComponents(string: server.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/config")
        parts?.queryItems = [URLQueryItem(name: "platform", value: platform), URLQueryItem(name: "version", value: version), URLQueryItem(name: "lang", value: lang)]
        guard let url = parts?.url, url.scheme == "https" else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        notices = ServiceNotice.from(config, dismissed: Set(dismissedList.split(separator: "\n").map(String.init)), arabic: lang == "ar")
    }
}

struct ServiceNotice: Identifiable {
    let id: String
    let warning: Bool
    let text: String
    let link: URL?
    let linkLabel: LocalizedStringKey
    let dismissible: Bool

    static func from(_ config: [String: Any], dismissed: Set<String>, arabic: Bool) -> [ServiceNotice] {
        func pick(_ value: Any?) -> String {
            guard let text = value as? [String: Any] else { return "" }
            let ar = text["ar"] as? String ?? "", en = text["en"] as? String ?? ""
            return arabic ? (ar.isEmpty ? en : ar) : (en.isEmpty ? ar : en)
        }
        func safe(_ value: Any?) -> URL? {
            guard let raw = value as? String, let url = URL(string: raw), url.scheme == "https" else { return nil }
            return url
        }
        var out: [ServiceNotice] = []
        if let incident = config["incident"] as? [String: Any], incident["on"] as? Bool == true {
            let text = [pick(incident["title"]), pick(incident["body"])].filter { !$0.isEmpty }.joined(separator: ". ")
            out.append(ServiceNotice(id: "incident", warning: true, text: text, link: URL(string: "https://status.enterworlds.space"), linkLabel: "Status", dismissible: false))
        }
        if let maintenance = config["maintenance"] as? [String: Any], maintenance["on"] as? Bool == true {
            var text = pick(maintenance["message"])
            if text.isEmpty {
                text = maintenance["readOnly"] as? Bool == true
                    ? String(localized: "Worlds is under maintenance. Sharing and syncing are read only for now.")
                    : String(localized: "Worlds is under maintenance.")
            }
            out.append(ServiceNotice(id: "maintenance", warning: true, text: text, link: nil, linkLabel: "", dismissible: false))
        }
        for case let item as [String: Any] in (config["announcements"] as? [Any] ?? []) {
            let id = item["id"] as? String ?? UUID().uuidString
            let dismissible = item["dismissible"] as? Bool == true
            if dismissible && dismissed.contains(id) { continue }
            out.append(ServiceNotice(id: id, warning: (item["level"] as? String) != "info", text: pick(item["text"]), link: safe(item["link"]), linkLabel: "Learn more", dismissible: dismissible))
        }
        if let update = config["update"] as? [String: Any], update["required"] as? Bool == true {
            let minimum = update["minimum"] as? String ?? ""
            let id = "update:" + minimum
            let dismissible = update["dismissible"] as? Bool == true
            if !dismissible || !dismissed.contains(id) {
                out.append(ServiceNotice(id: id, warning: !dismissible, text: String(format: String(localized: "Worlds %@ is ready. Update to keep everything working."), minimum),
                                         link: safe(update["url"]) ?? URL(string: "https://enterworlds.space/apps/"), linkLabel: "Download", dismissible: dismissible))
            }
        }
        return Array(out.filter { !$0.text.isEmpty }.prefix(3))
    }
}
#endif
