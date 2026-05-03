import ApplicationServices
import Foundation

private let axMenuObserverCallback: AXObserverCallback = { _, element, notification, refcon in
    guard let refcon else { return }
    let tracker = Unmanaged<AXMenuObserverTracker>.fromOpaque(refcon).takeUnretainedValue()
    tracker.handle(notification: notification as String, element: element)
}

final class AXMenuObserverTracker {
    private let openedNotification = String(kAXMenuOpenedNotification)
    private let closedNotification = String(kAXMenuClosedNotification)
    private let selectedNotification = String(kAXMenuItemSelectedNotification)

    private let appElement: AXUIElement
    private let processIdentifier: pid_t
    private var observer: AXObserver?
    private var isStarted = false
    private var lastOpenedState: AXMenuLiveState?
    private(set) var warnings: [String] = []

    init(appElement: AXUIElement, processIdentifier: pid_t) {
        self.appElement = appElement
        self.processIdentifier = processIdentifier
    }

    deinit {
        stop()
    }

    func start() {
        guard isStarted == false else { return }

        var observerRef: AXObserver?
        let createStatus = AXObserverCreate(processIdentifier, axMenuObserverCallback, &observerRef)
        guard createStatus == .success, let observerRef else {
            warnings.append("AXObserverCreate failed with \(createStatus.rawValue).")
            return
        }

        observer = observerRef
        isStarted = true
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        let runLoopSource = AXObserverGetRunLoopSource(observerRef)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .defaultMode)

        let notificationNames = [
            kAXMenuOpenedNotification as CFString,
            kAXMenuClosedNotification as CFString,
            kAXMenuItemSelectedNotification as CFString,
        ]

        addNotifications(notificationNames, on: appElement, label: "app", refcon: refcon)
        if let menuBar = AXHelpers.menuBar(appElement) {
            addNotifications(notificationNames, on: menuBar, label: "menu_bar", refcon: refcon)
        } else {
            warnings.append("The app did not expose an accessibility menu bar, so menu notifications could not be attached there.")
        }
    }

    func stop() {
        guard let observer else { return }
        let runLoopSource = AXObserverGetRunLoopSource(observer)
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), runLoopSource, .defaultMode)
        self.observer = nil
        isStarted = false
    }

    func snapshot(maxAge: TimeInterval = 3.0) -> AXMenuLiveState? {
        guard let lastOpenedState else { return nil }
        guard Date().timeIntervalSince(lastOpenedState.observedAt) <= maxAge else {
            return nil
        }
        return lastOpenedState
    }

    private func addNotifications(_ notifications: [CFString], on element: AXUIElement, label: String, refcon: UnsafeMutableRawPointer) {
        guard let observer else { return }
        for notification in notifications {
            let result = AXObserverAddNotification(observer, element, notification, refcon)
            if result != .success && result != .notificationAlreadyRegistered {
                warnings.append("Failed to register \(notification) on \(label) with \(result.rawValue).")
            }
        }
    }

    fileprivate func handle(notification: String, element: AXUIElement) {
        switch notification {
        case openedNotification:
            if let state = AXMenuPathSupport.makeState(
                from: element,
                processIdentifier: processIdentifier,
                source: "observer_menu_opened",
                confidence: "high"
            ) {
                lastOpenedState = state
            }

        case closedNotification:
            guard let current = lastOpenedState else { return }
            guard let closingState = AXMenuPathSupport.makeState(
                from: element,
                processIdentifier: processIdentifier,
                source: "observer_menu_closed",
                confidence: "high"
            ) else {
                lastOpenedState = nil
                return
            }
            if closingState.activeTopLevelTitle == current.activeTopLevelTitle {
                lastOpenedState = nil
            }

        case selectedNotification:
            guard let current = lastOpenedState else { return }
            guard let selectionState = AXMenuPathSupport.makeState(
                from: element,
                processIdentifier: processIdentifier,
                source: "observer_menu_item_selected",
                confidence: "medium"
            ) else {
                return
            }

            let mergedPath = selectionState.activePathTitles.isEmpty ? current.activePathTitles : selectionState.activePathTitles
            lastOpenedState = AXMenuLiveState(
                source: current.source,
                confidence: current.confidence,
                activeTopLevelTitle: current.activeTopLevelTitle ?? selectionState.activeTopLevelTitle,
                activePathTitles: mergedPath,
                appPID: current.appPID,
                observedAt: Date(),
                isOpenMenuLikelyVisible: current.isOpenMenuLikelyVisible,
                warnings: current.warnings,
                menuBarItem: current.menuBarItem ?? selectionState.menuBarItem,
                anchorElement: current.anchorElement ?? selectionState.anchorElement
            )

        default:
            return
        }
    }
}
