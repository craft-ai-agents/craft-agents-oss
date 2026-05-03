import AppKit
import Dispatch

enum AppKitRuntimeBootstrap {
    static func startIfNeeded() {
        if Thread.isMainThread {
            MainActor.assumeIsolated {
                bootstrap()
            }
            return
        }

        DispatchQueue.main.sync { @MainActor in
            bootstrap()
        }
    }

    @MainActor
    private static func bootstrap() {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.accessory)
        CursorRuntime.startIfNeeded()
    }

    static func runEventLoop() {
        if Thread.isMainThread {
            MainActor.assumeIsolated {
                NSApplication.shared.run()
            }
            return
        }

        DispatchQueue.main.sync { @MainActor in
            NSApplication.shared.run()
        }
    }
}
