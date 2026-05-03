import ApplicationServices
import Foundation

struct AXMenuActivationResult {
    let activated: Bool
    let pathTitles: [String]
    let topLevelMenuBarItem: AXUIElement?
    let anchorElement: AXUIElement?
    let warnings: [String]

    func fallbackState(processIdentifier: pid_t) -> AXMenuLiveState? {
        guard activated, let topLevelMenuBarItem else { return nil }
        return AXMenuLiveState(
            source: "activation_fallback",
            confidence: "low",
            activeTopLevelTitle: pathTitles.first,
            activePathTitles: pathTitles,
            appPID: processIdentifier,
            observedAt: Date(),
            isOpenMenuLikelyVisible: true,
            warnings: warnings + ["The active menu path was inferred from the experiment's own menu activation sequence."],
            menuBarItem: topLevelMenuBarItem,
            anchorElement: anchorElement ?? topLevelMenuBarItem
        )
    }
}

struct AXMenuPathActivator {
    func open(appElement: AXUIElement, pathComponents: [String]) -> AXMenuActivationResult {
        let normalizedPath = pathComponents.compactMap(AXMenuPathSupport.normalizedTitle)
        guard normalizedPath.isEmpty == false else {
            return AXMenuActivationResult(
                activated: false,
                pathTitles: [],
                topLevelMenuBarItem: nil,
                anchorElement: nil,
                warnings: ["The requested menu path was empty after normalization."]
            )
        }

        guard let menuBar = AXHelpers.menuBar(appElement) else {
            return AXMenuActivationResult(
                activated: false,
                pathTitles: normalizedPath,
                topLevelMenuBarItem: nil,
                anchorElement: nil,
                warnings: ["The target app did not expose an accessibility menu bar."]
            )
        }

        guard let topLevelMenuBarItem = findMenuBarItem(in: menuBar, title: normalizedPath[0]) else {
            return AXMenuActivationResult(
                activated: false,
                pathTitles: normalizedPath,
                topLevelMenuBarItem: nil,
                anchorElement: nil,
                warnings: ["Could not resolve the top-level menu \(normalizedPath[0])."]
            )
        }

        var warnings: [String] = []
        guard performMenuPresentationAction(on: topLevelMenuBarItem) else {
            return AXMenuActivationResult(
                activated: false,
                pathTitles: normalizedPath,
                topLevelMenuBarItem: topLevelMenuBarItem,
                anchorElement: topLevelMenuBarItem,
                warnings: ["Failed to open the top-level menu \(normalizedPath[0])."]
            )
        }

        sleepRunLoop(0.12)
        var currentAnchor = topLevelMenuBarItem

        if normalizedPath.count > 1 {
            for component in normalizedPath.dropFirst() {
                guard let menuItem = findMenuItem(under: currentAnchor, title: component) else {
                    warnings.append("Could not resolve submenu item \(component) under the active menu path.")
                    return AXMenuActivationResult(
                        activated: false,
                        pathTitles: normalizedPath,
                        topLevelMenuBarItem: topLevelMenuBarItem,
                        anchorElement: currentAnchor,
                        warnings: warnings
                    )
                }

                guard performMenuPresentationAction(on: menuItem) else {
                    warnings.append("Failed to open menu item \(component) while activating the menu path.")
                    return AXMenuActivationResult(
                        activated: false,
                        pathTitles: normalizedPath,
                        topLevelMenuBarItem: topLevelMenuBarItem,
                        anchorElement: currentAnchor,
                        warnings: warnings
                    )
                }

                currentAnchor = menuItem
                sleepRunLoop(0.12)
            }
        }

        sleepRunLoop(0.18)
        return AXMenuActivationResult(
            activated: true,
            pathTitles: normalizedPath,
            topLevelMenuBarItem: topLevelMenuBarItem,
            anchorElement: currentAnchor,
            warnings: warnings
        )
    }

    private func performMenuPresentationAction(on element: AXUIElement) -> Bool {
        let actions = AXHelpers.actionNames(element)
        if actions.contains(kAXPressAction as String) {
            return AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
        }
        if actions.contains("AXShowMenu") {
            return AXUIElementPerformAction(element, "AXShowMenu" as CFString) == .success
        }
        return false
    }

    private func findMenuBarItem(in menuBar: AXUIElement, title: String) -> AXUIElement? {
        AXHelpers.children(menuBar).first(where: { child in
            AXMenuPathSupport.normalizedTitle(
                AXHelpers.stringAttribute(child, attribute: kAXTitleAttribute as CFString)
            ) == title
        })
    }

    private func findMenuItem(under anchor: AXUIElement, title: String) -> AXUIElement? {
        var stack = AXHelpers.children(anchor)
        while let candidate = stack.popLast() {
            let role = AXHelpers.stringAttribute(candidate, attribute: kAXRoleAttribute as CFString)
            let candidateTitle = AXMenuPathSupport.normalizedTitle(
                AXHelpers.stringAttribute(candidate, attribute: kAXTitleAttribute as CFString)
            )
            if role == String(kAXMenuItemRole), candidateTitle == title {
                return candidate
            }
            stack.append(contentsOf: AXHelpers.children(candidate))
        }
        return nil
    }

    private func sleepRunLoop(_ duration: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(duration))
    }
}
