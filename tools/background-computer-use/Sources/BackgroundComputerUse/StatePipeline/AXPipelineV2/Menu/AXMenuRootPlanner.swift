import ApplicationServices
import Foundation

struct AXMenuRootPlan {
    let roots: [AXUIElement]
    let presentation: AXMenuPresentationDTO?
    let hints: AXMenuProjectionHints
    let notes: [String]
}

struct AXMenuRootPlanner {
    func plan(
        windowRoot: AXUIElement,
        menuBar: AXUIElement?,
        menuMode: AXMenuMode,
        liveState: AXMenuLiveState?
    ) -> AXMenuRootPlan {
        var roots: [AXUIElement] = [windowRoot]
        var notes: [String] = []
        let hints = AXMenuProjectionHints(
            activeTopLevelTitle: liveState?.activeTopLevelTitle,
            activePathTitles: liveState?.activePathTitles ?? []
        )

        switch menuMode {
        case .none:
            break

        case .fullMenuTraversal:
            if liveState?.isOpenMenuLikelyVisible == true,
               let menuBarItem = liveState?.menuBarItem,
               AXHelpers.elementsEqual(windowRoot, menuBarItem) == false {
                roots = [menuBarItem]
                if let title = liveState?.activeTopLevelTitle {
                    notes.append("An active menu branch was detected during full traversal, so roots were narrowed to the transient menu surface: \(title).")
                } else {
                    notes.append("An active menu branch was detected during full traversal, so roots were narrowed to the transient menu surface.")
                }
                notes.append("The main window tree was omitted from projection because the open menu is the active transient surface.")
            } else if let menuBar, AXHelpers.elementsEqual(windowRoot, menuBar) == false {
                roots.append(menuBar)
                notes.append("Menu roots include the full app menu bar for exhaustive traversal.")
            }

        case .openMenuOnly:
            if let menuBarItem = liveState?.menuBarItem, AXHelpers.elementsEqual(windowRoot, menuBarItem) == false {
                roots = [menuBarItem]
                if let title = liveState?.activeTopLevelTitle {
                    notes.append("Menu roots were narrowed to the active top-level menu branch: \(title).")
                    notes.append("The main window tree was omitted from projection because the open menu is the active transient surface.")
                } else {
                    notes.append("Menu roots were narrowed to the active open-menu branch reported by the menu-state provider.")
                    notes.append("The main window tree was omitted from projection because the open menu is the active transient surface.")
                }
            } else if let menuBar, AXHelpers.elementsEqual(windowRoot, menuBar) == false {
                roots.append(menuBar)
                notes.append("No active menu branch was detected, so the read fell back to menu-bar summary roots.")
            }
        }

        return AXMenuRootPlan(
            roots: roots,
            presentation: liveState?.dto,
            hints: hints,
            notes: notes
        )
    }
}
