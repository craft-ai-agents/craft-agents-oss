import AppKit
import ApplicationServices
import Foundation

private let axWindowDiscoveryTimeout: Float = 1.0

struct AXWindowRecord {
    let element: AXUIElement
    let windowNumber: Int
    let title: String
    let role: String?
    let subrole: String?
    let frameAppKit: CGRect
    let isFocused: Bool
    let isMain: Bool
    let isMinimized: Bool
    let isOnScreen: Bool
}

struct AXWindowDiscovery {
    func windows(for app: NSRunningApplication) throws -> ([AXWindowRecord], [String]) {
        try AXHelpers.requireAccessibility()

        let application = AXHelpers.applicationElement(pid: app.processIdentifier)
        let focusedHash = AXHelpers.elementAttribute(application, attribute: kAXFocusedWindowAttribute as CFString).map(CFHash)
        let mainHash = AXHelpers.elementAttribute(application, attribute: kAXMainWindowAttribute as CFString).map(CFHash)
        let cgWindows = CGWindowInventory.windows(for: app.processIdentifier, onScreenOnly: true)
        let cgWindowsByNumber = Dictionary(uniqueKeysWithValues: cgWindows.map { ($0.windowNumber, $0) })

        var notes: [String] = []
        let axWindows = candidateWindows(for: application)
        let records = axWindows.compactMap { element -> AXWindowRecord? in
            AXUIElementSetMessagingTimeout(element, axWindowDiscoveryTimeout)
            guard let frame = AXHelpers.frame(element),
                  (frame.width > 80 && frame.height > 80) ||
                    focusedHash == CFHash(element) ||
                    mainHash == CFHash(element) else {
                return nil
            }

            let title = AXHelpers.stringAttribute(element, attribute: kAXTitleAttribute as CFString) ?? ""
            let role = AXHelpers.stringAttribute(element, attribute: kAXRoleAttribute as CFString)
            let subrole = AXHelpers.stringAttribute(element, attribute: kAXSubroleAttribute as CFString)
            let isFocused = focusedHash == CFHash(element)
            let isMain = mainHash == CFHash(element)
            let isMinimized = AXHelpers.boolAttribute(element, attribute: kAXMinimizedAttribute as CFString) ?? false

            let windowNumber = AXHelpers.windowNumber(for: element)
                ?? fuzzyMatchWindowNumber(title: title, frame: frame, candidates: cgWindows)

            guard let windowNumber else {
                notes.append("Skipped one AX window because no stable window number could be derived.")
                return nil
            }

            let isOnScreen = cgWindowsByNumber[windowNumber]?.isOnScreen ?? !isMinimized

            return AXWindowRecord(
                element: element,
                windowNumber: windowNumber,
                title: title,
                role: role,
                subrole: subrole,
                frameAppKit: frame,
                isFocused: isFocused,
                isMain: isMain,
                isMinimized: isMinimized,
                isOnScreen: isOnScreen
            )
        }
        .sorted { lhs, rhs in
            if lhs.isFocused != rhs.isFocused {
                return lhs.isFocused && rhs.isFocused == false
            }
            if lhs.isMain != rhs.isMain {
                return lhs.isMain && rhs.isMain == false
            }

            let lhsOrder = cgWindowsByNumber[lhs.windowNumber]?.orderIndex ?? Int.max
            let rhsOrder = cgWindowsByNumber[rhs.windowNumber]?.orderIndex ?? Int.max
            if lhsOrder != rhsOrder {
                return lhsOrder < rhsOrder
            }

            return lhs.windowNumber < rhs.windowNumber
        }

        return (records, notes)
    }

    private func candidateWindows(for application: AXUIElement) -> [AXUIElement] {
        AXUIElementSetMessagingTimeout(application, axWindowDiscoveryTimeout)
        var candidates: [AXUIElement] = []
        if let focusedWindow = AXHelpers.elementAttribute(application, attribute: kAXFocusedWindowAttribute as CFString) {
            candidates.append(focusedWindow)
        }
        if let mainWindow = AXHelpers.elementAttribute(application, attribute: kAXMainWindowAttribute as CFString) {
            candidates.append(mainWindow)
        }
        candidates.append(contentsOf: AXHelpers.elementArrayAttribute(application, attribute: kAXWindowsAttribute as CFString))

        var result: [AXUIElement] = []
        for candidate in candidates {
            if result.contains(where: { AXHelpers.elementsEqual($0, candidate) }) {
                continue
            }
            result.append(candidate)
        }
        return result
    }

    private func fuzzyMatchWindowNumber(title: String, frame: CGRect, candidates: [CGWindowRecord]) -> Int? {
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)

        return candidates.max { lhs, rhs in
            fuzzyScore(window: lhs, title: normalizedTitle, frame: frame) < fuzzyScore(window: rhs, title: normalizedTitle, frame: frame)
        }?.windowNumber
    }

    private func fuzzyScore(window: CGWindowRecord, title: String, frame: CGRect) -> Double {
        var score = Double(max(1, 10_000 - window.orderIndex))

        let delta =
            abs(window.frameAppKit.minX - frame.minX) +
            abs(window.frameAppKit.minY - frame.minY) +
            abs(window.frameAppKit.width - frame.width) +
            abs(window.frameAppKit.height - frame.height)
        score += Double(max(0, 20_000 - delta * 10))

        let normalizedTitle = window.title.trimmingCharacters(in: .whitespacesAndNewlines)
        if title.isEmpty == false, normalizedTitle.isEmpty == false {
            if normalizedTitle.caseInsensitiveCompare(title) == .orderedSame {
                score += 8_000
            } else if normalizedTitle.localizedCaseInsensitiveContains(title) || title.localizedCaseInsensitiveContains(normalizedTitle) {
                score += 2_500
            }
        }

        return score
    }
}
