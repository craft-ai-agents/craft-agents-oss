import ApplicationServices
import Foundation
import QuartzCore

private let windowMotionAXMessagingTimeout: Float = 0.05
private let projectionObserverEnvironmentKey = "BACKGROUND_COMPUTER_USE_WINDOW_MOTION_OBSERVER"

private func projectionObserverEnabled() -> Bool {
    guard let rawValue = ProcessInfo.processInfo.environment[projectionObserverEnvironmentKey]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased() else {
        return false
    }
    return ["1", "true", "yes", "on"].contains(rawValue)
}

struct WindowMotionBackendProjectionResult {
    let rawStatus: String
    let projectionMs: Double
    let projectionDiagnostics: MotionProjectionDiagnosticsDTO?
}

enum WindowMotionExecutionProjection {
    case linear
    case drag(cursorMotion: CursorMotionPlan)
    case resize(handle: ResizeHandleDTO, cursorMotion: CursorMotionPlan)
}

protocol WindowMotionExecutionBackend {
    var backendID: String { get }

    func applyStep(
        element: AXUIElement,
        step: WindowMotionSegmentPlan,
        animate: Bool,
        projection: WindowMotionExecutionProjection
    ) -> WindowMotionBackendProjectionResult
}

private struct ProjectionObserverTelemetry {
    let observedEvents: Int
    let observedFrameChanges: Int
    let observedEchoes: Int
    let divergentObservedEvents: Int
    let invalidObservedEvents: Int
    let maxObservedGapMs: Double
    let firstObservedChangeDelayMs: Double
    let lastObservedChangeDelayMs: Double

    static let empty = ProjectionObserverTelemetry(
        observedEvents: 0,
        observedFrameChanges: 0,
        observedEchoes: 0,
        divergentObservedEvents: 0,
        invalidObservedEvents: 0,
        maxObservedGapMs: 0,
        firstObservedChangeDelayMs: 0,
        lastObservedChangeDelayMs: 0
    )
}

private final class ProjectionObserverMonitor {
    private struct CommandedWrite {
        let frame: CGRect
        let timestamp: TimeInterval
    }

    private final class ObserverBox {
        weak var monitor: ProjectionObserverMonitor?

        init(monitor: ProjectionObserverMonitor) {
            self.monitor = monitor
        }
    }

    private let element: AXUIElement
    private let recentWriteEchoWindow: TimeInterval = 0.3
    private let echoTolerance: CGFloat = 10

    private var observer: AXObserver?
    private var observerBox: ObserverBox?
    private var recentWrites: [CommandedWrite] = []
    private var observedEvents = 0
    private var observedFrameChanges = 0
    private var observedEchoes = 0
    private var divergentObservedEvents = 0
    private var invalidObservedEvents = 0
    private var lastObservedFrame: CGRect?
    private var firstObservedChangeAt: TimeInterval?
    private var lastObservedChangeAt: TimeInterval?
    private var maxObservedGapMs = 0.0

    init?(element: AXUIElement) {
        self.element = element

        var pid: pid_t = 0
        guard AXUIElementGetPid(element, &pid) == .success, pid != 0 else {
            return nil
        }

        let box = ObserverBox(monitor: self)
        observerBox = box

        var createdObserver: AXObserver?
        let callback: AXObserverCallback = { _, targetElement, _, refcon in
            guard let refcon else { return }
            let box = Unmanaged<ObserverBox>.fromOpaque(refcon).takeUnretainedValue()
            box.monitor?.handleObservedFrame(from: targetElement)
        }

        guard AXObserverCreate(pid, callback, &createdObserver) == .success,
              let createdObserver else {
            return nil
        }

        let refcon = Unmanaged.passUnretained(box).toOpaque()
        _ = AXObserverAddNotification(createdObserver, element, kAXWindowMovedNotification as CFString, refcon)
        _ = AXObserverAddNotification(createdObserver, element, kAXWindowResizedNotification as CFString, refcon)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(createdObserver), .defaultMode)
        observer = createdObserver
    }

    func recordCommandedFrame(_ frame: CGRect, at timestamp: TimeInterval) {
        recentWrites.append(CommandedWrite(frame: frame.standardized, timestamp: timestamp))
        trimRecentWrites(now: timestamp)
    }

    func finish(projectionStartedAt: TimeInterval) -> ProjectionObserverTelemetry {
        trimRecentWrites(now: CACurrentMediaTime())
        removeObserver()
        return ProjectionObserverTelemetry(
            observedEvents: observedEvents,
            observedFrameChanges: observedFrameChanges,
            observedEchoes: observedEchoes,
            divergentObservedEvents: divergentObservedEvents,
            invalidObservedEvents: invalidObservedEvents,
            maxObservedGapMs: maxObservedGapMs,
            firstObservedChangeDelayMs: firstObservedChangeAt.map { ($0 - projectionStartedAt) * 1_000 } ?? 0,
            lastObservedChangeDelayMs: lastObservedChangeAt.map { ($0 - projectionStartedAt) * 1_000 } ?? 0
        )
    }

    private func handleObservedFrame(from targetElement: AXUIElement) {
        let now = CACurrentMediaTime()
        trimRecentWrites(now: now)

        guard let observedFrame = AXHelpers.frame(targetElement)?.standardized else {
            invalidObservedEvents += 1
            return
        }

        observedEvents += 1
        if let lastObservedFrame {
            if frameChanged(observedFrame, after: lastObservedFrame, tolerance: 1) {
                if firstObservedChangeAt == nil {
                    firstObservedChangeAt = now
                }
                if let lastObservedChangeAt {
                    maxObservedGapMs = max(maxObservedGapMs, (now - lastObservedChangeAt) * 1_000)
                }
                self.lastObservedChangeAt = now
                observedFrameChanges += 1
            }
        } else {
            firstObservedChangeAt = now
            lastObservedChangeAt = now
            observedFrameChanges += 1
        }
        lastObservedFrame = observedFrame

        if recentWrites.contains(where: { framesApproximatelyEqual($0.frame, observedFrame) }) {
            observedEchoes += 1
        } else {
            divergentObservedEvents += 1
        }
    }

    private func trimRecentWrites(now: TimeInterval) {
        recentWrites.removeAll { now - $0.timestamp > recentWriteEchoWindow }
    }

    private func removeObserver() {
        guard let observer else { return }
        AXObserverRemoveNotification(observer, element, kAXWindowMovedNotification as CFString)
        AXObserverRemoveNotification(observer, element, kAXWindowResizedNotification as CFString)
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(observer), .defaultMode)
        self.observer = nil
        observerBox = nil
    }

    private func framesApproximatelyEqual(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        abs(lhs.minX - rhs.minX) <= echoTolerance &&
            abs(lhs.minY - rhs.minY) <= echoTolerance &&
            abs(lhs.width - rhs.width) <= echoTolerance &&
            abs(lhs.height - rhs.height) <= echoTolerance
    }
}

private func frameChanged(_ frame: CGRect, after previousFrame: CGRect, tolerance: CGFloat = 1) -> Bool {
    abs(frame.minX - previousFrame.minX) >= tolerance ||
        abs(frame.minY - previousFrame.minY) >= tolerance ||
        abs(frame.width - previousFrame.width) >= tolerance ||
        abs(frame.height - previousFrame.height) >= tolerance
}

private func rawStatusString(for error: AXError) -> String {
    switch error {
    case .success:
        return "success"
    case .attributeUnsupported:
        return "attribute_unsupported"
    case .actionUnsupported:
        return "action_unsupported"
    case .cannotComplete:
        return "cannot_complete"
    case .invalidUIElement:
        return "invalid_ui_element"
    case .illegalArgument:
        return "illegal_argument"
    case .apiDisabled:
        return "api_disabled"
    default:
        return "ax_error_\(error.rawValue)"
    }
}

struct AXFrameProjectionBackend: WindowMotionExecutionBackend {
    let backendID = "ax_frame_projection"

    func applyStep(
        element: AXUIElement,
        step: WindowMotionSegmentPlan,
        animate: Bool,
        projection: WindowMotionExecutionProjection
    ) -> WindowMotionBackendProjectionResult {
        AXHelpers.setMessagingTimeout(element, seconds: windowMotionAXMessagingTimeout)

        let started = DispatchTime.now().uptimeNanoseconds
        let result = performFrameChange(
            element: element,
            from: step.fromFrame,
            to: step.toFrame,
            animate: animate,
            projection: projection
        )
        let finished = DispatchTime.now().uptimeNanoseconds

        return WindowMotionBackendProjectionResult(
            rawStatus: result.rawStatus,
            projectionMs: Double(finished - started) / 1_000_000,
            projectionDiagnostics: result.diagnostics
        )
    }

    private func performFrameChange(
        element: AXUIElement,
        from startFrame: CGRect,
        to endFrame: CGRect,
        animate: Bool,
        projection: WindowMotionExecutionProjection
    ) -> (rawStatus: String, diagnostics: MotionProjectionDiagnosticsDTO?) {
        guard animate else {
            let result = applyDirectFrameChange(
                element: element,
                from: startFrame,
                to: endFrame
            )
            if result.position == .success, result.size == .success {
                return ("success", nil)
            }
            return ("position_\(rawStatusString(for: result.position))__size_\(rawStatusString(for: result.size))", nil)
        }

        return applyProjectedFrames(
            element: element,
            from: startFrame,
            to: endFrame,
            projection: projection
        )
    }

    private func applyDirectFrameChange(
        element: AXUIElement,
        from startFrame: CGRect,
        to endFrame: CGRect
    ) -> (position: AXError, size: AXError) {
        let startFrame = startFrame.standardized
        let endFrame = endFrame.standardized
        let positionChanged =
            abs(startFrame.minX - endFrame.minX) >= 0.01 ||
            abs(startFrame.minY - endFrame.minY) >= 0.01
        let sizeChanged =
            abs(startFrame.width - endFrame.width) >= 0.01 ||
            abs(startFrame.height - endFrame.height) >= 0.01

        var positionStatus: AXError = .success
        var sizeStatus: AXError = .success

        if sizeChanged {
            sizeStatus = AXHelpers.setSize(element, size: endFrame.size)

            if positionChanged, sizeStatus == .success {
                sleepRunLoop(1.0 / 60.0)
            }
        }

        if positionChanged {
            positionStatus = AXHelpers.setPosition(element, frame: endFrame)
        }

        return (positionStatus, sizeStatus)
    }

    private func applyProjectedFrames(
        element: AXUIElement,
        from startFrame: CGRect,
        to endFrame: CGRect,
        projection: WindowMotionExecutionProjection
    ) -> (rawStatus: String, diagnostics: MotionProjectionDiagnosticsDTO) {
        let duration = WindowMotionMath.projectionDuration(from: startFrame, to: endFrame)
        let targetFrameRate = 60.0
        let frameInterval = 1.0 / targetFrameRate
        let loopStartedAt = CACurrentMediaTime()
        let observer = projectionObserverEnabled() ? ProjectionObserverMonitor(element: element) : nil
        var nextSampleTime = loopStartedAt
        var lastPositionStatus: AXError = .success
        var lastSizeStatus: AXError = .success
        var lastCommandedFrame = startFrame.standardized
        var frameWrites = 0
        var skippedSamples = 0
        var lateSamples = 0
        var maxSampleSlipMs = 0.0
        var totalWriteMs = 0.0
        var maxWriteMs = 0.0
        var requestedSamples = max(Int(ceil(duration * targetFrameRate)), 1)

        while true {
            let now = CACurrentMediaTime()
            let sampleSlip = max(now - nextSampleTime, 0)
            maxSampleSlipMs = max(maxSampleSlipMs, sampleSlip * 1_000)
            if sampleSlip > frameInterval * 0.5 {
                lateSamples += 1
            }

            let sample = projectedFrameSample(
                from: startFrame,
                to: endFrame,
                projection: projection,
                startTime: loopStartedAt,
                fallbackDuration: duration,
                now: now
            )
            let frame = sample.frame.standardized

            if shouldApply(frame: frame, after: lastCommandedFrame) || sample.finished {
                let writeStarted = DispatchTime.now().uptimeNanoseconds
                let result = applyFrameUpdate(
                    element: element,
                    previousFrame: lastCommandedFrame,
                    nextFrame: frame,
                    force: sample.finished
                )
                let writeFinished = DispatchTime.now().uptimeNanoseconds
                let writeMs = Double(writeFinished - writeStarted) / 1_000_000
                lastPositionStatus = result.position
                lastSizeStatus = result.size
                totalWriteMs += writeMs
                maxWriteMs = max(maxWriteMs, writeMs)
                lastCommandedFrame = frame
                if result.didWrite {
                    frameWrites += 1
                    observer?.recordCommandedFrame(frame, at: CACurrentMediaTime())
                }
            } else {
                skippedSamples += 1
            }

            if sample.finished {
                break
            }

            nextSampleTime += frameInterval
            let sleepDuration = max(0, nextSampleTime - CACurrentMediaTime())
            if sleepDuration > 0 {
                sleepRunLoop(sleepDuration)
            } else {
                RunLoop.current.run(mode: .default, before: Date())
            }
        }

        let projectionElapsed = max(CACurrentMediaTime() - loopStartedAt, frameInterval)
        requestedSamples = max(requestedSamples, frameWrites + skippedSamples)
        let observerTelemetry = observer?.finish(projectionStartedAt: loopStartedAt) ?? .empty
        let diagnostics = MotionProjectionDiagnosticsDTO(
            backendID: backendID,
            targetFrameRate: targetFrameRate,
            requestedSamples: requestedSamples,
            frameWrites: frameWrites,
            skippedSamples: skippedSamples,
            projectionElapsedMs: projectionElapsed * 1_000,
            effectiveFrameRate: Double(frameWrites) / projectionElapsed,
            lateSamples: lateSamples,
            maxSampleSlipMs: maxSampleSlipMs,
            writeMs: totalWriteMs,
            maxWriteMs: maxWriteMs,
            midProjectionAXReads: 0,
            observedEvents: observerTelemetry.observedEvents,
            observedFrameChanges: observerTelemetry.observedFrameChanges,
            observedEffectiveFrameRate: projectionElapsed > 0
                ? Double(observerTelemetry.observedFrameChanges) / projectionElapsed
                : 0,
            observedEchoes: observerTelemetry.observedEchoes,
            divergentObservedEvents: observerTelemetry.divergentObservedEvents,
            invalidObservedEvents: observerTelemetry.invalidObservedEvents,
            maxObservedGapMs: observerTelemetry.maxObservedGapMs,
            firstObservedChangeDelayMs: observerTelemetry.firstObservedChangeDelayMs,
            lastObservedChangeDelayMs: observerTelemetry.lastObservedChangeDelayMs
        )

        if lastPositionStatus == .success, lastSizeStatus == .success {
            return ("success", diagnostics)
        }
        return ("position_\(rawStatusString(for: lastPositionStatus))__size_\(rawStatusString(for: lastSizeStatus))", diagnostics)
    }

    private func projectedFrameSample(
        from startFrame: CGRect,
        to endFrame: CGRect,
        projection: WindowMotionExecutionProjection,
        startTime: TimeInterval,
        fallbackDuration: TimeInterval,
        now: TimeInterval
    ) -> (frame: CGRect, finished: Bool) {
        switch projection {
        case .linear:
            let linearProgress = min(max((now - startTime) / fallbackDuration, 0), 1)
            let easedProgress = WindowMotionMath.easeInOutCubic(linearProgress)
            return (WindowMotionMath.interpolate(startFrame, endFrame, progress: easedProgress), linearProgress >= 1)

        case .drag(let cursorMotion):
            if cursorMotion.isFinished(at: now) {
                return (endFrame, true)
            }
            return (dragFrameAlongCursorPath(startFrame: startFrame, cursorMotion: cursorMotion, now: now), false)

        case .resize(let handle, let cursorMotion):
            if cursorMotion.isFinished(at: now) {
                return (endFrame, true)
            }
            return (
                WindowMotionMath.frameByMovingHandle(
                    from: startFrame,
                    handle: handle,
                    toPoint: cursorMotion.samplePoint(at: now)
                ).standardized,
                false
            )
        }
    }

    private func dragFrameAlongCursorPath(
        startFrame: CGRect,
        cursorMotion: CursorMotionPlan,
        now: TimeInterval
    ) -> CGRect {
        let startAnchor = CursorTargetProjector.titlebarAnchor(for: startFrame)
        let originOffset = startAnchor - CGPoint(x: startFrame.minX, y: startFrame.minY)
        let anchorPoint = cursorMotion.samplePoint(at: now)
        let origin = anchorPoint - originOffset
        return CGRect(origin: origin, size: startFrame.size).standardized
    }

    private func applyFrameUpdate(
        element: AXUIElement,
        previousFrame: CGRect,
        nextFrame: CGRect,
        force: Bool
    ) -> (position: AXError, size: AXError, didWrite: Bool) {
        let positionChanged =
            abs(previousFrame.minX - nextFrame.minX) >= (force ? 0.01 : 1) ||
            abs(previousFrame.minY - nextFrame.minY) >= (force ? 0.01 : 1)
        let sizeChanged =
            abs(previousFrame.width - nextFrame.width) >= (force ? 0.01 : 1) ||
            abs(previousFrame.height - nextFrame.height) >= (force ? 0.01 : 1)

        let positionStatus = positionChanged
            ? AXHelpers.setPosition(element, frame: nextFrame)
            : .success
        let sizeStatus = sizeChanged
            ? AXHelpers.setSize(element, size: nextFrame.size)
            : .success
        return (positionStatus, sizeStatus, positionChanged || sizeChanged)
    }

    private func shouldApply(frame: CGRect, after previousFrame: CGRect) -> Bool {
        abs(frame.minX - previousFrame.minX) >= 1 ||
            abs(frame.minY - previousFrame.minY) >= 1 ||
            abs(frame.width - previousFrame.width) >= 1 ||
            abs(frame.height - previousFrame.height) >= 1
    }
}
