import Foundation

struct WindowTargetCacheEntry {
    let bundleID: String
    let pid: pid_t
    let launchDate: String?
    let windowNumber: Int
    let title: String
}

final class WindowTargetCache: @unchecked Sendable {
    static let shared = WindowTargetCache()

    private let lock = NSLock()
    private var entries: [String: WindowTargetCacheEntry] = [:]

    private init() {}

    func remember(
        windowID: String,
        bundleID: String,
        pid: pid_t,
        launchDate: Date?,
        windowNumber: Int,
        title: String
    ) {
        lock.lock()
        defer { lock.unlock() }

        entries[windowID] = WindowTargetCacheEntry(
            bundleID: bundleID,
            pid: pid,
            launchDate: launchDate.map(Time.iso8601String),
            windowNumber: windowNumber,
            title: title
        )
    }

    func entry(for windowID: String) -> WindowTargetCacheEntry? {
        lock.lock()
        defer { lock.unlock() }
        return entries[windowID]
    }

    func remove(windowID: String) {
        lock.lock()
        defer { lock.unlock() }
        entries.removeValue(forKey: windowID)
    }
}
