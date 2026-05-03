import ApplicationServices
import Foundation

struct AXMenuLiveCaptureOptions {
    let menuMode: AXMenuMode
    let menuPathComponents: [String]
}

struct AXMenuLiveCaptureContext {
    let roots: [AXUIElement]
    let menuPresentation: AXMenuPresentationDTO?
    let projectionHints: AXMenuProjectionHints
    let notes: [String]
}

struct AXMenuLiveCaptureService {
    private let provider = DefaultAXMenuPresentationProvider()
    private let rootPlanner = AXMenuRootPlanner()
    private let activator = AXMenuPathActivator()

    func prepare(
        windowRoot: AXUIElement,
        appElement: AXUIElement,
        processIdentifier: pid_t,
        includeMenuBar: Bool,
        options: AXMenuLiveCaptureOptions
    ) -> AXMenuLiveCaptureContext {
        let effectiveMenuMode = includeMenuBar || options.menuMode != .none ? options.menuMode : .none
        guard effectiveMenuMode != .none else {
            return AXMenuLiveCaptureContext(
                roots: [windowRoot],
                menuPresentation: nil,
                projectionHints: AXMenuProjectionHints(activeTopLevelTitle: nil, activePathTitles: []),
                notes: []
            )
        }

        let tracker = effectiveMenuMode == .openMenuOnly
            ? AXMenuObserverTracker(appElement: appElement, processIdentifier: processIdentifier)
            : nil
        tracker?.start()
        defer { tracker?.stop() }

        var notes: [String] = []
        var activationResult: AXMenuActivationResult?
        if options.menuPathComponents.isEmpty == false {
            activationResult = activator.open(appElement: appElement, pathComponents: options.menuPathComponents)
            if activationResult?.activated == true {
                notes.append("The experiment opened the menu path \(options.menuPathComponents.joined(separator: " > ")) before reading state.")
            } else {
                notes.append("The experiment attempted to open the menu path \(options.menuPathComponents.joined(separator: " > ")) before reading state, but it did not fully verify.")
            }
            notes.append(contentsOf: activationResult?.warnings ?? [])
        }

        let resolution = provider.currentPresentation(
            appElement: appElement,
            processIdentifier: processIdentifier,
            menuMode: effectiveMenuMode,
            tracker: tracker,
            activationResult: activationResult
        )
        notes.append(contentsOf: resolution.notes)

        let plan = rootPlanner.plan(
            windowRoot: windowRoot,
            menuBar: AXHelpers.menuBar(appElement),
            menuMode: effectiveMenuMode,
            liveState: resolution.liveState
        )
        notes.append(contentsOf: plan.notes)

        return AXMenuLiveCaptureContext(
            roots: plan.roots,
            menuPresentation: plan.presentation,
            projectionHints: plan.hints,
            notes: notes
        )
    }
}
