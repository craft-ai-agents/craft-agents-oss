import ApplicationServices
import Foundation

enum MotionResponseFactory {
    static func motionWindow(snapshot: WindowGeometrySnapshot, afterFrame: CGRect) -> MotionWindowDTO {
        MotionWindowDTO(
            windowID: snapshot.target.windowID,
            title: AXHelpers.stringAttribute(snapshot.target.window.element, attribute: kAXTitleAttribute as CFString)
                ?? snapshot.target.window.title,
            bundleID: snapshot.target.bundleID,
            pid: snapshot.target.app.processIdentifier,
            launchDate: snapshot.target.launchDate.map(Time.iso8601String),
            windowNumber: snapshot.target.window.windowNumber,
            frameBeforeAppKit: RectDTO(
                x: snapshot.frameAppKit.minX,
                y: snapshot.frameAppKit.minY,
                width: snapshot.frameAppKit.width,
                height: snapshot.frameAppKit.height
            ),
            frameAfterAppKit: RectDTO(
                x: afterFrame.minX,
                y: afterFrame.minY,
                width: afterFrame.width,
                height: afterFrame.height
            )
        )
    }

    static func backgroundSafety(before: String?, after: String?) -> BackgroundSafetyDTO {
        BackgroundSafetyDTO(
            frontmostBefore: FrontmostAppObservationDTO(bundleID: before),
            frontmostAfter: FrontmostAppObservationDTO(bundleID: after),
            backgroundSafeObserved: before == after
        )
    }

    static func performance(
        resolveStarted: UInt64,
        resolveFinished: UInt64,
        planningStarted: UInt64,
        planningFinished: UInt64,
        projectionMs: Double,
        settleMs: Double,
        projectionDiagnostics: MotionProjectionDiagnosticsDTO?,
        totalStarted: UInt64
    ) -> MotionPerformanceDTO {
        MotionPerformanceDTO(
            resolveMs: milliseconds(since: resolveStarted, to: resolveFinished),
            planningMs: milliseconds(since: planningStarted, to: planningFinished),
            projectionMs: projectionMs,
            settleMs: settleMs,
            totalMs: milliseconds(since: totalStarted),
            projectionDiagnostics: projectionDiagnostics
        )
    }

    private static func milliseconds(since start: UInt64, to end: UInt64 = DispatchTime.now().uptimeNanoseconds) -> Double {
        Double(end - start) / 1_000_000
    }
}
