import ApplicationServices
import Foundation

struct WindowMotionSettleResult {
    let settledFrame: CGRect
    let settleMs: Double
}

struct WindowMotionVerifier {
    let timeout: TimeInterval = 0.9
    let pollInterval: TimeInterval = 1.0 / 60.0
    let stabilitySamplesRequired = 2

    func waitForSettledFrame(
        element: AXUIElement,
        startingFrame: CGRect,
        expectedFrame: CGRect
    ) -> WindowMotionSettleResult {
        let started = DispatchTime.now().uptimeNanoseconds
        let deadline = Date().addingTimeInterval(timeout)
        var latest = startingFrame.standardized
        var previousSample = startingFrame.standardized
        var sawChange = false
        var stabilitySamples = 0

        while Date() < deadline {
            sleepRunLoop(pollInterval)
            guard let reread = AXHelpers.frame(element)?.standardized else {
                continue
            }

            latest = reread
            if WindowMotionMath.approximatelyMatches(expected: expectedFrame, actual: latest) {
                return WindowMotionSettleResult(
                    settledFrame: latest,
                    settleMs: millisecondsSince(started)
                )
            }

            if WindowMotionMath.frameChanged(from: startingFrame, to: latest) {
                sawChange = true
            }

            if WindowMotionMath.approximatelyMatches(expected: previousSample, actual: latest, tolerance: 1) {
                stabilitySamples += 1
            } else {
                stabilitySamples = 0
            }
            previousSample = latest

            if sawChange && stabilitySamples >= stabilitySamplesRequired {
                break
            }
        }

        return WindowMotionSettleResult(
            settledFrame: latest,
            settleMs: millisecondsSince(started)
        )
    }

    private func millisecondsSince(_ start: UInt64) -> Double {
        Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000
    }
}
