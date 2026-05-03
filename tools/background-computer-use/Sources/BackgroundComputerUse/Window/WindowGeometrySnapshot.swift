import AppKit
import Foundation

struct WindowGeometrySnapshot {
    let target: ResolvedWindowTarget
    let frameAppKit: CGRect
    let frontmostBefore: String?
    let notes: [String]
}

struct WindowGeometrySnapshotService {
    private let resolver = WindowTargetResolver()

    func snapshot(windowID: String) throws -> WindowGeometrySnapshot {
        let frontmostBefore = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let resolved = try resolver.resolve(windowID: windowID)
        AXHelpers.setMessagingTimeout(resolved.window.element, seconds: 0.05)
        let liveFrame = AXHelpers.frame(resolved.window.element) ?? resolved.window.frameAppKit

        return WindowGeometrySnapshot(
            target: resolved,
            frameAppKit: liveFrame.standardized,
            frontmostBefore: frontmostBefore,
            notes: resolved.notes
        )
    }
}
