import AppKit
import Foundation

struct WindowListService {
    private let runningAppService = RunningAppService()
    private let axWindowDiscovery = AXWindowDiscovery()
    private let targetCache = WindowTargetCache.shared

    func listWindows(appQuery: String) throws -> ListWindowsResponse {
        guard let app = runningAppService.resolveApp(query: appQuery),
              let bundleID = app.bundleIdentifier,
              let name = app.localizedName else {
            throw DiscoveryError.appNotFound(appQuery)
        }

        let (windows, notes) = try axWindowDiscovery.windows(for: app)
        return ListWindowsResponse(
            contractVersion: ContractVersion.current,
            app: AppReferenceDTO(
                name: name,
                bundleID: bundleID,
                pid: app.processIdentifier,
                launchDate: app.launchDate.map(Time.iso8601String)
            ),
            windows: windows.map { window in
                let windowID = WindowID.make(
                    bundleID: bundleID,
                    pid: app.processIdentifier,
                    launchDate: app.launchDate,
                    windowNumber: window.windowNumber
                )
                targetCache.remember(
                    windowID: windowID,
                    bundleID: bundleID,
                    pid: app.processIdentifier,
                    launchDate: app.launchDate,
                    windowNumber: window.windowNumber,
                    title: window.title
                )
                return WindowDTO(
                    windowID: windowID,
                    title: window.title,
                    bundleID: bundleID,
                    pid: app.processIdentifier,
                    launchDate: app.launchDate.map(Time.iso8601String),
                    role: window.role,
                    subrole: window.subrole,
                    windowNumber: window.windowNumber,
                    frameAppKit: RectDTO(
                        x: window.frameAppKit.minX,
                        y: window.frameAppKit.minY,
                        width: window.frameAppKit.width,
                        height: window.frameAppKit.height
                    ),
                    isFocused: window.isFocused,
                    isMain: window.isMain,
                    isMinimized: window.isMinimized,
                    isOnScreen: window.isOnScreen
                )
            },
            notes: notes
        )
    }
}
