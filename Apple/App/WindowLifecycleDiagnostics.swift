#if DEBUG && os(macOS) && WORLDS_UI_WINDOW_DIAGNOSTICS
import AppKit
import Darwin

/// Fixture-only lifecycle diagnostics. Never creates or activates a window and
/// records no document names, page IDs or contents.
@MainActor final class WindowLifecycleDiagnostics: NSObject, NSApplicationDelegate {
    private var output: FileHandle?
    private var timer: Timer?
    private var samples = 0

    func applicationWillFinishLaunching(_ notification: Notification) {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains(where: { $0.hasPrefix("--ui-testing-") }),
              let raw = ProcessInfo.processInfo.environment["WORLDS_WINDOW_TRACE_TOKEN"],
              let token = UUID(uuidString: raw) else { return }
        let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent("worlds-window-trace-\(token.uuidString)", isDirectory: true)
        var info = stat()
        guard lstat(directory.path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
              info.st_uid == getuid(), (info.st_mode & 0o077) == 0 else { return }
        let directoryFD = Darwin.open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directoryFD >= 0 else { return }
        defer { Darwin.close(directoryFD) }
        var opened = stat()
        guard fstat(directoryFD, &opened) == 0, opened.st_dev == info.st_dev, opened.st_ino == info.st_ino,
              opened.st_uid == getuid(), (opened.st_mode & S_IFMT) == S_IFDIR,
              (opened.st_mode & 0o077) == 0 else { return }
        let fd = openat(directoryFD, "lifecycle.log", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard fd >= 0 else { return }
        output = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        let center = NotificationCenter.default
        for name in [NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
                     NSWindow.willCloseNotification, NSWindow.didMiniaturizeNotification,
                     NSApplication.didHideNotification, NSApplication.didUnhideNotification] {
            center.addObserver(self, selector: #selector(observed(_:)), name: name, object: nil)
        }
        record("willFinishLaunching")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first {
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
        }
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            if let window = NSApp.windows.first {
                window.makeKeyAndOrderFront(nil)
                window.orderFrontRegardless()
                timer.invalidate()
            }
        }
        guard output != nil else { return }
        record("didFinishLaunching")
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.samples += 1
                self.record("sample-\(self.samples)")
                if self.samples >= 30 { self.stop() }
            }
        }
    }

    @objc private func observed(_ notification: Notification) { record(notification.name.rawValue) }
    private func stop() {
        timer?.invalidate(); timer = nil
        NotificationCenter.default.removeObserver(self)
        try? output?.close()
        output = nil
    }
    private func record(_ event: String) {
        guard let output else { return }
        let windows = NSApp.windows.map { window in
            "visible=\(window.isVisible),miniaturized=\(window.isMiniaturized),key=\(window.isKeyWindow)"
        }.joined(separator: ";")
        let line = "\(event) active=\(NSApp.isActive) hidden=\(NSApp.isHidden) modal=\(NSApp.modalWindow != nil) windows=\(NSApp.windows.count) [\(windows)]\n"
        try? output.write(contentsOf: Data(line.utf8))
    }
}
#endif
