import ApplicationServices
import AppKit
import Foundation

struct WindowMotionExecutionResult {
    let rawStatus: String
    let settledFrame: CGRect
    let effectVerified: Bool
    let frontmostAfter: String?
    let projectionMs: Double
    let settleMs: Double
    let projectionDiagnostics: MotionProjectionDiagnosticsDTO?
}

struct WindowMotionEngine {
    private let backend: any WindowMotionExecutionBackend
    private let executionOptions: ActionExecutionOptions
    private let verifier = WindowMotionVerifier()

    init(
        backend: any WindowMotionExecutionBackend = AXFrameProjectionBackend(),
        executionOptions: ActionExecutionOptions = .visualCursorEnabled
    ) {
        self.backend = backend
        self.executionOptions = executionOptions
    }

    func execute(
        plan: WindowMotionPlan,
        target: ResolvedWindowTarget,
        cursorID: String
    ) -> WindowMotionExecutionResult {
        let element = target.window.element
        let windowNumber = target.window.windowNumber

        guard plan.segments.isEmpty == false else {
            let frontmostAfter = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
            return WindowMotionExecutionResult(
                rawStatus: "success",
                settledFrame: plan.targetFrame,
                effectVerified: true,
                frontmostAfter: frontmostAfter,
                projectionMs: 0,
                settleMs: 0,
                projectionDiagnostics: nil
            )
        }

        var currentFrame = plan.segments.first?.fromFrame ?? plan.targetFrame
        var rawStatuses: [String] = []
        var totalProjectionMs = 0.0
        var totalSettleMs = 0.0
        var collectedDiagnostics: [MotionProjectionDiagnosticsDTO] = []

        for (index, step) in plan.segments.enumerated() {
            let shouldAnimate = plan.animate && executionOptions.visualCursorEnabled
            let projection = runtimeProjection(
                step: step,
                windowNumber: windowNumber,
                cursorID: cursorID,
                currentFrame: currentFrame,
                isFirstStep: index == 0
            )

            let backendResult = backend.applyStep(
                element: element,
                step: WindowMotionSegmentPlan(
                    kind: step.kind,
                    fromFrame: currentFrame,
                    toFrame: step.toFrame,
                    resizeHandle: step.resizeHandle,
                    cursorStartPoint: step.cursorStartPoint,
                    cursorEndPoint: step.cursorEndPoint,
                    duration: step.duration
                ),
                animate: shouldAnimate,
                projection: projection
            )
            rawStatuses.append(backendResult.rawStatus)
            totalProjectionMs += backendResult.projectionMs
            if let diagnostics = backendResult.projectionDiagnostics {
                collectedDiagnostics.append(diagnostics)
            }

            let settle = verifier.waitForSettledFrame(
                element: element,
                startingFrame: currentFrame,
                expectedFrame: step.toFrame
            )
            currentFrame = settle.settledFrame
            totalSettleMs += settle.settleMs
        }

        let shouldAnimate = plan.animate && executionOptions.visualCursorEnabled
        if shouldAnimate, WindowMotionMath.requestedFrameSatisfied(expected: plan.targetFrame, actual: currentFrame) == false {
            let correctionStep = WindowMotionSegmentPlan(
                kind: .direct,
                fromFrame: currentFrame,
                toFrame: plan.targetFrame,
                resizeHandle: nil,
                cursorStartPoint: nil,
                cursorEndPoint: nil,
                duration: 0
            )
            let correction = backend.applyStep(
                element: element,
                step: correctionStep,
                animate: false,
                projection: .linear
            )
            rawStatuses.append("correction_\(correction.rawStatus)")
            totalProjectionMs += correction.projectionMs
            if let diagnostics = correction.projectionDiagnostics {
                collectedDiagnostics.append(diagnostics)
            }

            let settle = verifier.waitForSettledFrame(
                element: element,
                startingFrame: currentFrame,
                expectedFrame: plan.targetFrame
            )
            currentFrame = settle.settledFrame
            totalSettleMs += settle.settleMs
        }

        if shouldAnimate {
            CursorRuntime.release(cursorID: cursorID, afterHold: CursorRuntime.releaseHoldDuration())
        }

        let rawStatus: String
        if rawStatuses.allSatisfy({ $0 == "success" }) {
            rawStatus = "success"
        } else if rawStatuses.count == 1 {
            rawStatus = rawStatuses[0]
        } else {
            rawStatus = rawStatuses.enumerated()
                .map { "step\($0.offset + 1)_\($0.element)" }
                .joined(separator: "__")
        }

        return WindowMotionExecutionResult(
            rawStatus: rawStatus,
            settledFrame: currentFrame.standardized,
            effectVerified: WindowMotionMath.requestedFrameSatisfied(expected: plan.targetFrame, actual: currentFrame),
            frontmostAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
            projectionMs: totalProjectionMs,
            settleMs: totalSettleMs,
            projectionDiagnostics: mergeDiagnostics(collectedDiagnostics)
        )
    }

    private func runtimeProjection(
        step: WindowMotionSegmentPlan,
        windowNumber: Int,
        cursorID: String,
        currentFrame: CGRect,
        isFirstStep: Bool
    ) -> WindowMotionExecutionProjection {
        guard step.kind != .direct else {
            return .linear
        }

        guard executionOptions.visualCursorEnabled else {
            return .linear
        }

        guard let endPoint = step.cursorEndPoint else {
            return .linear
        }

        let startPoint: CGPoint
        switch step.kind {
        case .drag:
            startPoint = CursorTargetProjector.titlebarAnchor(for: currentFrame)

        case .resize:
            guard let handle = step.resizeHandle else {
                return .linear
            }
            startPoint = CursorTargetProjector.resizeHandlePoint(for: handle, in: currentFrame)

        case .direct:
            startPoint = endPoint
        }

        let approachDuration = CursorRuntime.approach(
            to: startPoint,
            attachedWindowNumber: windowNumber,
            cursorID: cursorID,
            pressed: !isFirstStep
        )
        CursorRuntime.waitUntilSettled(cursorID: cursorID, timeout: approachDuration + 0.35)

        if isFirstStep {
            CursorRuntime.setPressed(true, cursorID: cursorID, attachedWindowNumber: windowNumber)
            sleepRunLoop(CursorRuntime.pressLeadDuration())
        }

        let cursorMotion = CursorRuntime.move(
            to: endPoint,
            attachedWindowNumber: windowNumber,
            cursorID: cursorID,
            duration: step.duration,
            pressed: true
        )

        switch step.kind {
        case .drag:
            return .drag(cursorMotion: cursorMotion)
        case .resize:
            return .resize(handle: step.resizeHandle ?? .bottomRight, cursorMotion: cursorMotion)
        case .direct:
            return .linear
        }
    }

    private func mergeDiagnostics(_ diagnostics: [MotionProjectionDiagnosticsDTO]) -> MotionProjectionDiagnosticsDTO? {
        guard let first = diagnostics.first else {
            return nil
        }

        let frameWrites = diagnostics.reduce(0) { $0 + $1.frameWrites }
        let projectionElapsedMs = diagnostics.reduce(0.0) { $0 + $1.projectionElapsedMs }
        let effectiveFrameRate = projectionElapsedMs > 0
            ? Double(frameWrites) / (projectionElapsedMs / 1_000)
            : first.effectiveFrameRate

        return MotionProjectionDiagnosticsDTO(
            backendID: first.backendID,
            targetFrameRate: first.targetFrameRate,
            requestedSamples: diagnostics.reduce(0) { $0 + $1.requestedSamples },
            frameWrites: frameWrites,
            skippedSamples: diagnostics.reduce(0) { $0 + $1.skippedSamples },
            projectionElapsedMs: projectionElapsedMs,
            effectiveFrameRate: effectiveFrameRate,
            lateSamples: diagnostics.reduce(0) { $0 + $1.lateSamples },
            maxSampleSlipMs: diagnostics.map(\.maxSampleSlipMs).max() ?? first.maxSampleSlipMs,
            writeMs: diagnostics.reduce(0.0) { $0 + $1.writeMs },
            maxWriteMs: diagnostics.map(\.maxWriteMs).max() ?? first.maxWriteMs,
            midProjectionAXReads: diagnostics.reduce(0) { $0 + $1.midProjectionAXReads },
            observedEvents: diagnostics.reduce(0) { $0 + $1.observedEvents },
            observedFrameChanges: diagnostics.reduce(0) { $0 + $1.observedFrameChanges },
            observedEffectiveFrameRate: projectionElapsedMs > 0
                ? Double(diagnostics.reduce(0) { $0 + $1.observedFrameChanges }) / (projectionElapsedMs / 1_000)
                : first.observedEffectiveFrameRate,
            observedEchoes: diagnostics.reduce(0) { $0 + $1.observedEchoes },
            divergentObservedEvents: diagnostics.reduce(0) { $0 + $1.divergentObservedEvents },
            invalidObservedEvents: diagnostics.reduce(0) { $0 + $1.invalidObservedEvents },
            maxObservedGapMs: diagnostics.map(\.maxObservedGapMs).max() ?? first.maxObservedGapMs,
            firstObservedChangeDelayMs: diagnostics.map(\.firstObservedChangeDelayMs).first(where: { $0 > 0 }) ?? first.firstObservedChangeDelayMs,
            lastObservedChangeDelayMs: diagnostics.map(\.lastObservedChangeDelayMs).max() ?? first.lastObservedChangeDelayMs
        )
    }
}
