import ApplicationServices
import Foundation

struct AXMenuSnapshotDetector {
    func detect(appElement: AXUIElement, processIdentifier: pid_t) -> AXMenuLiveState? {
        if let shownMenu = AXHelpers.elementAttribute(appElement, attribute: "AXShownMenuUIElement" as CFString),
           let state = AXMenuPathSupport.makeState(
                from: shownMenu,
                processIdentifier: processIdentifier,
                source: "snapshot_app_shown_menu",
                confidence: "high"
           ) {
            return state
        }

        if let menuBar = AXHelpers.menuBar(appElement) {
            for item in AXHelpers.children(menuBar) {
                if let shownMenu = AXHelpers.elementAttribute(item, attribute: "AXShownMenuUIElement" as CFString),
                   let state = AXMenuPathSupport.makeState(
                        from: shownMenu,
                        processIdentifier: processIdentifier,
                        source: "snapshot_menu_bar_item_shown_menu",
                        confidence: "high"
                   ) {
                    return state
                }

                let selected = AXHelpers.boolAttribute(item, attribute: kAXSelectedAttribute as CFString) ?? false
                let expanded = AXHelpers.boolAttribute(item, attribute: kAXExpandedAttribute as CFString) ?? false
                if selected || expanded,
                   let state = AXMenuPathSupport.makeState(
                        from: item,
                        processIdentifier: processIdentifier,
                        source: "snapshot_selected_menu_bar_item",
                        confidence: "medium",
                        warnings: ["Selected or expanded state was used as a weak menu-open hint."]
                   ) {
                    return state
                }
            }
        }

        let systemWide = AXUIElementCreateSystemWide()
        if let focusedElement = AXHelpers.elementAttribute(systemWide, attribute: kAXFocusedUIElementAttribute as CFString),
           let role = AXHelpers.stringAttribute(focusedElement, attribute: kAXRoleAttribute as CFString),
           [String(kAXMenuRole), String(kAXMenuItemRole), String(kAXMenuBarItemRole)].contains(role),
           let state = AXMenuPathSupport.makeState(
                from: focusedElement,
                processIdentifier: processIdentifier,
                source: "snapshot_system_focus",
                confidence: "medium",
                warnings: ["System-wide focused UI element was used as a menu-open hint."]
           ) {
            return state
        }

        return nil
    }
}
