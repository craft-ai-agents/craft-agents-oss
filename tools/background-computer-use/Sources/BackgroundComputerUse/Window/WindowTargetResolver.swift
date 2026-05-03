import AppKit
import ApplicationServices
import Foundation

struct ResolvedWindowTarget {
    let windowID: String
    let bundleID: String
    let launchDate: Date?
    let app: NSRunningApplication
    let appElement: AXUIElement
    let window: AXWindowRecord
    let resolutionStrategy: String
    let notes: [String]

    var title: String { window.title }
    var windowNumber: Int { window.windowNumber }
    var frameAppKit: CGRect { window.frameAppKit }
}

struct WindowTargetResolver {
    private let runningAppService = RunningAppService()
    private let axWindowDiscovery = AXWindowDiscovery()
    private let targetCache = WindowTargetCache.shared

    func resolve(windowID: String) throws -> ResolvedWindowTarget {
        try AXHelpers.requireAccessibility()

        if let cached = targetCache.entry(for: windowID),
           let cachedMatch = try resolveCached(windowID: windowID, cached: cached) {
            return cachedMatch
        }

        for app in runningAppService.targetableApps() {
            guard let bundleID = app.bundleIdentifier else {
                continue
            }

            let (windows, notes) = try axWindowDiscovery.windows(for: app)
            if let match = windows.first(where: {
                WindowID.make(
                    bundleID: bundleID,
                    pid: app.processIdentifier,
                    launchDate: app.launchDate,
                    windowNumber: $0.windowNumber
                ) == windowID
            }) {
                targetCache.remember(
                    windowID: windowID,
                    bundleID: bundleID,
                    pid: app.processIdentifier,
                    launchDate: app.launchDate,
                    windowNumber: match.windowNumber,
                    title: match.title
                )
                return ResolvedWindowTarget(
                    windowID: windowID,
                    bundleID: bundleID,
                    launchDate: app.launchDate,
                    app: app,
                    appElement: AXHelpers.applicationElement(pid: app.processIdentifier),
                    window: match,
                    resolutionStrategy: "scanned_window_id",
                    notes: notes
                )
            }
        }

        throw DiscoveryError.windowNotFound(windowID)
    }

    func resolve(appQuery: String, windowTitleContains: String? = nil) throws -> ResolvedWindowTarget {
        guard let app = runningAppService.resolveApp(query: appQuery) else {
            throw DiscoveryError.appNotFound(appQuery)
        }

        let appElement = AXHelpers.applicationElement(pid: app.processIdentifier)
        let (windows, notes) = try axWindowDiscovery.windows(for: app)

        var resolvedNotes = notes
        let titleHint = windowTitleContains?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let rankedWindows: [AXWindowRecord]
        var matchedTitleHint = false
        var resolutionStrategy = "fallback_window"
        if let titleHint, titleHint.isEmpty == false {
            let scoredWindows = windows.map { record in
                (record: record, score: titleMatchScore(windowTitle: record.title, titleHint: titleHint))
            }
            let bestScore = scoredWindows.map(\.score).max() ?? 0
            matchedTitleHint = bestScore > 0
            rankedWindows = scoredWindows
                .sorted { lhs, rhs in
                    if lhs.score != rhs.score {
                        return lhs.score > rhs.score
                    }
                    if lhs.record.isFocused != rhs.record.isFocused {
                        return lhs.record.isFocused && rhs.record.isFocused == false
                    }
                    if lhs.record.isMain != rhs.record.isMain {
                        return lhs.record.isMain && rhs.record.isMain == false
                    }
                    return lhs.record.windowNumber < rhs.record.windowNumber
                }
                .map(\.record)

            if matchedTitleHint {
                resolutionStrategy = "title_hint_window"
                resolvedNotes.append("Window resolution ranked windows by title hint: \(titleHint)")
            } else {
                resolvedNotes.append("No open window title matched '\(titleHint)'; fell back to focused/main window ordering.")
            }
        } else {
            rankedWindows = windows
        }

        let window: AXWindowRecord?
        if matchedTitleHint {
            window = rankedWindows.first
        } else {
            window = rankedWindows.first(where: { $0.isFocused }) ??
                rankedWindows.first(where: { $0.isMain }) ??
                rankedWindows.first
        }

        guard let window else {
            throw DiscoveryError.windowNotFound("No usable window found for app query: \(appQuery)")
        }

        if resolutionStrategy == "fallback_window" {
            resolutionStrategy = window.isFocused ? "focused_window" : (window.isMain ? "main_window" : "first_window")
        }

        let bundleID = app.bundleIdentifier ?? ""
        let windowID = WindowID.make(
            bundleID: bundleID,
            pid: app.processIdentifier,
            launchDate: app.launchDate,
            windowNumber: window.windowNumber
        )

        return ResolvedWindowTarget(
            windowID: windowID,
            bundleID: bundleID,
            launchDate: app.launchDate,
            app: app,
            appElement: appElement,
            window: window,
            resolutionStrategy: resolutionStrategy,
            notes: resolvedNotes
        )
    }

    private func resolveCached(windowID: String, cached: WindowTargetCacheEntry) throws -> ResolvedWindowTarget? {
        guard let app = runningAppService.targetableApps().first(where: {
            $0.processIdentifier == cached.pid &&
            $0.bundleIdentifier == cached.bundleID &&
            $0.launchDate.map(Time.iso8601String) == cached.launchDate
        }) else {
            targetCache.remove(windowID: windowID)
            return nil
        }

        let (windows, notes) = try axWindowDiscovery.windows(for: app)
        guard let match = windows.first(where: { $0.windowNumber == cached.windowNumber }) else {
            targetCache.remove(windowID: windowID)
            return nil
        }

        return ResolvedWindowTarget(
            windowID: windowID,
            bundleID: cached.bundleID,
            launchDate: app.launchDate,
            app: app,
            appElement: AXHelpers.applicationElement(pid: app.processIdentifier),
            window: match,
            resolutionStrategy: "cached_window_id",
            notes: notes
        )
    }

    private func titleMatchScore(windowTitle: String, titleHint: String) -> Int {
        let normalizedWindowTitle = normalizedSearchText(windowTitle)
        let normalizedTitleHint = normalizedSearchText(titleHint)
        guard normalizedTitleHint.isEmpty == false else {
            return 0
        }
        if normalizedWindowTitle == normalizedTitleHint {
            return 4
        }
        if normalizedWindowTitle.contains(normalizedTitleHint) {
            return 3
        }

        let hintTokens = Set(normalizedTitleHint.split(separator: " ").map(String.init))
        guard hintTokens.isEmpty == false else {
            return 0
        }
        let windowTokens = Set(normalizedWindowTitle.split(separator: " ").map(String.init))
        let sharedTokenCount = hintTokens.intersection(windowTokens).count
        if sharedTokenCount == hintTokens.count {
            return 2
        }
        if sharedTokenCount > 0 {
            return 1
        }
        return 0
    }

    private func normalizedSearchText(_ text: String) -> String {
        ProjectionTextSupport.cleaned(text)?
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}
