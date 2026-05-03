import ApplicationServices
import Foundation

struct AXMenuProjectionHints {
    let activeTopLevelTitle: String?
    let activePathTitles: [String]
}

struct AXMenuPresentationResolution {
    let liveState: AXMenuLiveState?
    let notes: [String]
}

protocol AXMenuPresentationProvider {
    func currentPresentation(
        appElement: AXUIElement,
        processIdentifier: pid_t,
        menuMode: AXMenuMode,
        tracker: AXMenuObserverTracker?,
        activationResult: AXMenuActivationResult?
    ) -> AXMenuPresentationResolution
}

struct DefaultAXMenuPresentationProvider: AXMenuPresentationProvider {
    private let snapshotDetector = AXMenuSnapshotDetector()

    func currentPresentation(
        appElement: AXUIElement,
        processIdentifier: pid_t,
        menuMode: AXMenuMode,
        tracker: AXMenuObserverTracker?,
        activationResult: AXMenuActivationResult?
    ) -> AXMenuPresentationResolution {
        guard menuMode != .none else {
            return AXMenuPresentationResolution(liveState: nil, notes: [])
        }

        if let snapshotState = snapshotDetector.detect(appElement: appElement, processIdentifier: processIdentifier) {
            return AXMenuPresentationResolution(
                liveState: snapshotState,
                notes: ["Menu presentation was derived from a synchronous accessibility snapshot probe."]
            )
        }

        if let trackerState = tracker?.snapshot() {
            var notes = tracker?.warnings ?? []
            notes.append("Menu presentation was derived from AX menu-open notifications observed during this read.")
            return AXMenuPresentationResolution(liveState: trackerState, notes: notes)
        }

        if let fallbackState = activationResult?.fallbackState(processIdentifier: processIdentifier) {
            var notes = activationResult?.warnings ?? []
            notes.append("Menu presentation fell back to the menu path the experiment opened because no stronger live signal was available.")
            return AXMenuPresentationResolution(liveState: fallbackState, notes: notes)
        }

        return AXMenuPresentationResolution(
            liveState: nil,
            notes: ["No reliable open-menu signal was available; menu projection will fall back to passive menu-bar summaries if menu roots are included."]
        )
    }
}

struct AXMenuLiveState {
    let source: String
    let confidence: String
    let activeTopLevelTitle: String?
    let activePathTitles: [String]
    let appPID: pid_t
    let observedAt: Date
    let isOpenMenuLikelyVisible: Bool
    let warnings: [String]
    let menuBarItem: AXUIElement?
    let anchorElement: AXUIElement?

    var dto: AXMenuPresentationDTO {
        AXMenuPresentationDTO(
            mode: "observed",
            source: source,
            confidence: confidence,
            activeTopLevelTitle: activeTopLevelTitle,
            activePathTitles: activePathTitles,
            appPID: appPID,
            observedAt: Time.iso8601String(from: observedAt),
            isOpenMenuLikelyVisible: isOpenMenuLikelyVisible,
            warnings: warnings
        )
    }
}

enum AXMenuPathSupport {
    static func makeState(
        from element: AXUIElement,
        processIdentifier: pid_t,
        source: String,
        confidence: String,
        warnings: [String] = [],
        isOpenMenuLikelyVisible: Bool = true
    ) -> AXMenuLiveState? {
        let chain = ancestorChain(from: element)
        guard chain.isEmpty == false else { return nil }

        let reversed = chain.reversed()
        let titledPath = reversed.compactMap { node -> String? in
            guard let role = AXHelpers.stringAttribute(node, attribute: kAXRoleAttribute as CFString) else {
                return nil
            }
            guard role == String(kAXMenuBarItemRole) || role == String(kAXMenuItemRole) else {
                return nil
            }
            return normalizedTitle(AXHelpers.stringAttribute(node, attribute: kAXTitleAttribute as CFString))
        }

        let topLevelTitle = reversed.first(where: {
            AXHelpers.stringAttribute($0, attribute: kAXRoleAttribute as CFString) == String(kAXMenuBarItemRole)
        }).flatMap {
            normalizedTitle(AXHelpers.stringAttribute($0, attribute: kAXTitleAttribute as CFString))
        } ?? titledPath.first

        guard topLevelTitle != nil || titledPath.isEmpty == false else {
            return nil
        }

        let menuBarItem = reversed.first(where: {
            AXHelpers.stringAttribute($0, attribute: kAXRoleAttribute as CFString) == String(kAXMenuBarItemRole)
        })

        return AXMenuLiveState(
            source: source,
            confidence: confidence,
            activeTopLevelTitle: topLevelTitle,
            activePathTitles: titledPath,
            appPID: processIdentifier,
            observedAt: Date(),
            isOpenMenuLikelyVisible: isOpenMenuLikelyVisible,
            warnings: warnings,
            menuBarItem: menuBarItem,
            anchorElement: element
        )
    }

    static func normalizedTitle(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func ancestorChain(from element: AXUIElement) -> [AXUIElement] {
        var chain: [AXUIElement] = []
        var current: AXUIElement? = element
        var visited = Set<UInt>()
        while let node = current {
            let hash = CFHash(node)
            if visited.contains(hash) {
                break
            }
            visited.insert(hash)
            chain.append(node)
            current = AXHelpers.parent(node)
        }
        return chain
    }
}
