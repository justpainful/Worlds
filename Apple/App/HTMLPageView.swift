import SwiftUI
import WebKit
import WorldsModels
import WorldsPersistence

/// An HTML page (docs/HTML_PAGES.md), rendered read only. The page runs in a
/// WKWebView with a non-persistent data store and a content rule list that
/// blocks every load, so nothing reaches the network. It talks to Worlds only
/// through one script message handler: saved state, tapped links, other pages.
struct HTMLPageView: View {
    let page: StoredPage
    /// Keeps `worlds.save()` with the page; nil when the page cannot be edited here, and the page still runs.
    let saveState: (@MainActor (String) async -> Void)?
    let openPage: (String) -> Void

    private var content: (source: String, state: JSONValue?) { HTMLPageDocument.read(metadataJSON: page.metadataJSON) }
    private var language: String { Bundle.main.preferredLocalizations.first?.hasPrefix("ar") == true ? "ar" : "en" }

    var body: some View {
        let content = self.content
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text(page.title.isEmpty ? String(localized: "Untitled") : page.title)
                    .font(.title.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Text(saveState == nil ? LocalizedStringKey("Read only. Runs here without the internet; its own changes are not kept on this device.") : LocalizedStringKey("Runs here without the internet. Edit its source in Worlds on the desktop."))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 12)
            if content.source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ContentUnavailableView("This HTML page is empty", systemImage: "chevron.left.forwardslash.chevron.right",
                                       description: Text("Write it in Worlds on the desktop, or ask Claude to build it."))
            } else {
                HTMLPageWebView(pageID: page.id, source: content.source, state: content.state, language: language, saveState: saveState, openPage: openPage)
                    // A new page or language loads a new document; saved state alone keeps the running page.
                    .id("\(page.id)|\(language)|\(content.source.hashValue)")
                    .accessibilityIdentifier("html-page-web-view")
            }
        }
        .navigationTitle(page.title.isEmpty ? String(localized: "Untitled") : page.title)
    }
}

/// Base styles with the fonts inlined, the runtime, and the rule list, read once from the app bundle (copied from src/htmlpage at build time).
@MainActor enum HTMLPageResources {
    static let fonts = ["instrument-sans.woff2", "plex-arabic-400.woff2", "plex-arabic-600.woff2", "plex-mono-500.woff2"]
    static let messageHandler = "worlds"
    /// The frame's own policy, as on the desktop's whtml: protocol; fonts arrive inline.
    static let policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; "
        + "font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
    /// Hands the runtime's messages to Worlds. Height reports are not needed full screen.
    static let bridge = """
    (function(){window.addEventListener("message",function(e){var d=e.data;if(e.source===window&&d&&d.worldsHtmlPage===1&&d.type!=="height"){\
    try{window.webkit.messageHandlers.\(messageHandler).postMessage(JSON.stringify(d));}catch(_){}}},true);})();
    """
    /// Blocks every load; the document itself is inline, as are its images and fonts.
    static let rules = #"[{"trigger":{"url-filter":".*"},"action":{"type":"block"}},{"trigger":{"url-filter":"^(about|data|blob):"},"action":{"type":"ignore-previous-rules"}}]"#

    private static var loaded: (css: String, runtime: String)?
    static func assets() -> (css: String, runtime: String)? {
        if let loaded { return loaded }
        guard let cssURL = Bundle.main.url(forResource: "base", withExtension: "css"),
              let runtimeURL = Bundle.main.url(forResource: "runtime", withExtension: "js"),
              var css = try? String(contentsOf: cssURL, encoding: .utf8),
              let runtime = try? String(contentsOf: runtimeURL, encoding: .utf8) else { return nil }
        for font in fonts {
            let name = (font as NSString).deletingPathExtension
            if let url = Bundle.main.url(forResource: name, withExtension: "woff2", subdirectory: "htmlpage-fonts") ?? Bundle.main.url(forResource: name, withExtension: "woff2"),
               let data = try? Data(contentsOf: url) {
                css = css.replacingOccurrences(of: "/_w/fonts/\(font)", with: "data:font/woff2;base64,\(data.base64EncodedString())")
            }
        }
        // On the desktop the frame sits in the page column; full screen it needs the screen's own edge. The page's styles still win.
        loaded = (css + "\nbody { padding-inline: 16px; }\n", runtime)
        return loaded
    }

    private static var compiled: WKContentRuleList?
    static func ruleList() async -> WKContentRuleList? {
        if let compiled { return compiled }
        let list = try? await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "worlds-html-page-offline", encodedContentRuleList: rules)
        compiled = list
        return list
    }
}

#if os(macOS)
private typealias PlatformViewRepresentable = NSViewRepresentable
#else
private typealias PlatformViewRepresentable = UIViewRepresentable
#endif

/// Remembers when the person last tapped or clicked the page, so links open only right after one.
private final class HTMLPageWKWebView: WKWebView {
    var lastTap = Date.distantPast
    #if os(macOS)
    override func mouseDown(with event: NSEvent) { lastTap = Date(); super.mouseDown(with: event) }
    #endif
}

private struct HTMLPageWebView: PlatformViewRepresentable {
    let pageID: String
    let source: String
    let state: JSONValue?
    let language: String
    let saveState: (@MainActor (String) async -> Void)?
    let openPage: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    #if os(macOS)
    func makeNSView(context: Context) -> WKWebView { make(context) }
    func updateNSView(_ view: WKWebView, context: Context) { context.coordinator.update(self) }
    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) { coordinator.dismantle(view) }
    #else
    func makeUIView(context: Context) -> WKWebView { make(context) }
    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.update(self) }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) { coordinator.dismantle(view) }
    #endif

    private func make(_ context: Context) -> WKWebView {
        let coordinator = context.coordinator
        coordinator.update(self)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        #if os(iOS)
        configuration.dataDetectorTypes = []
        configuration.allowsInlineMediaPlayback = true
        #endif
        let controller = configuration.userContentController
        controller.add(WeakMessageHandler(coordinator), name: HTMLPageResources.messageHandler)
        controller.addUserScript(WKUserScript(source: HTMLPageResources.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = HTMLPageWKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.allowsLinkPreview = false
        view.allowsBackForwardNavigationGestures = false
        #if os(macOS)
        view.setValue(false, forKey: "drawsBackground")
        #else
        view.isOpaque = false
        // The dark surface role (#1C1C1E) the Windows app gives HTML pages.
        view.backgroundColor = UIColor(WorldsPalette.surfaceDeep)
        view.scrollView.backgroundColor = view.backgroundColor
        let tap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.tapped))
        tap.cancelsTouchesInView = false
        tap.delaysTouchesBegan = false
        tap.delaysTouchesEnded = false
        tap.delegate = coordinator
        view.addGestureRecognizer(tap)
        #endif
        coordinator.webView = view
        let source = source, state = state, language = language
        coordinator.loading = Task { @MainActor [weak view] in
            // Nothing loads until every network load is blocked.
            guard let rules = await HTMLPageResources.ruleList(), let view, let assets = HTMLPageResources.assets() else { return }
            view.configuration.userContentController.add(rules)
            let extra = "<meta http-equiv=\"Content-Security-Policy\" content=\"\(HTMLPageResources.policy)\">"
            let document = HTMLPageDocument.compose(source: source, state: state, lang: language, baseCSS: assets.css, runtimeJS: assets.runtime, extraHead: extra)
            coordinator.allowNextLoad = true
            view.loadHTMLString(document, baseURL: nil)
        }
        return view
    }

    @MainActor final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: HTMLPageWKWebView?
        var loading: Task<Void, Never>?
        var allowNextLoad = false
        private var saveState: (@MainActor (String) async -> Void)?
        private var openPage: (String) -> Void = { _ in }
        private var pending: String?
        private var debounce: Task<Void, Never>?
        private var saving: Task<Void, Never>?

        func update(_ view: HTMLPageWebView) { saveState = view.saveState; openPage = view.openPage }

        @objc func tapped() { webView?.lastTap = Date() }

        func dismantle(_ view: WKWebView) {
            loading?.cancel()
            flush()
            view.configuration.userContentController.removeScriptMessageHandler(forName: HTMLPageResources.messageHandler)
            view.stopLoading()
        }

        // The page never navigates: links go through the runtime, everything else stays put.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard action.targetFrame?.isMainFrame == true, action.request.url?.absoluteString == "about:blank", allowNextLoad else { return .cancel }
            allowNextLoad = false
            return .allow
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == HTMLPageResources.messageHandler, message.frameInfo.isMainFrame,
                  let text = message.body as? String, text.utf8.count <= 8 * HTMLPageDocument.maxStateBytes,
                  case .object(let body)? = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)),
                  body["worldsHtmlPage"] == .integer(1), case .string(let type)? = body["type"] else { return }
            switch type {
            case "save":
                guard case .string(let state)? = body["state"], state.utf8.count <= HTMLPageDocument.maxStateBytes else { return }
                pending = state
                debounce?.cancel()
                debounce = Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    guard !Task.isCancelled else { return }
                    self?.flush()
                }
            case "openPage":
                guard case .string(let id)? = body["id"], HTMLPageDocument.isPageID(id) else { return }
                openPage(id)
            case "openLink":
                guard case .string(let raw)? = body["url"], let url = URL(string: raw),
                      let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme),
                      let webView, Date().timeIntervalSince(webView.lastTap) < 2 else { return }
                webView.lastTap = .distantPast
                #if os(macOS)
                _ = NSWorkspace.shared.open(url)
                #else
                UIApplication.shared.open(url)
                #endif
            default:
                return
            }
        }

        /// Saves run one after another, so the last state the page saved is the one kept.
        private func flush() {
            debounce?.cancel()
            guard let state = pending, let saveState else { pending = nil; return }
            pending = nil
            let previous = saving
            saving = Task { @MainActor in
                await previous?.value
                await saveState(state)
            }
        }
    }
}

#if os(iOS)
extension HTMLPageWebView.Coordinator: UIGestureRecognizerDelegate {
    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
}
#endif

/// WKUserContentController keeps its handlers strongly; this breaks the cycle with the coordinator.
@MainActor private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
