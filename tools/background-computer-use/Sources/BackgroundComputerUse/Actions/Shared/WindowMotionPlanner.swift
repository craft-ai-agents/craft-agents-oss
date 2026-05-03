import CoreGraphics
import Foundation

enum WindowMotionDirective {
    case drag(destinationOrigin: CGPoint)
    case resize(handle: ResizeHandleDTO, destination: CGPoint)
    case setFrame(targetFrame: CGRect, animate: Bool)
}

enum WindowMotionSegmentKind {
    case direct
    case drag
    case resize
}

struct WindowMotionSegmentPlan {
    let kind: WindowMotionSegmentKind
    let fromFrame: CGRect
    let toFrame: CGRect
    let resizeHandle: ResizeHandleDTO?
    let cursorStartPoint: CGPoint?
    let cursorEndPoint: CGPoint?
    let duration: TimeInterval
}

struct WindowMotionPlan {
    let requestedFrame: CGRect
    let targetFrame: CGRect
    let animate: Bool
    let presentationMode: MotionPresentationModeDTO
    let strategyUsed: String
    let warnings: [String]
    let segments: [WindowMotionSegmentPlan]
}

struct WindowMotionPlanningRejection {
    let rawStatus: String
    let error: ActionErrorDTO
    let warnings: [String]
    let strategyUsed: String
    let presentationMode: MotionPresentationModeDTO
}

enum WindowMotionPlanningOutcome {
    case rejected(WindowMotionPlanningRejection)
    case noop(WindowMotionPlan)
    case executable(WindowMotionPlan)
}

struct WindowMotionPlanner {
    func plan(
        snapshot: WindowGeometrySnapshot,
        directive: WindowMotionDirective,
        baseWarnings: [String]
    ) -> WindowMotionPlanningOutcome {
        let startFrame = snapshot.frameAppKit.standardized

        switch directive {
        case .drag(let destinationOrigin):
            return dragPlan(
                startFrame: startFrame,
                destinationOrigin: destinationOrigin,
                baseWarnings: baseWarnings
            )

        case .resize(let handle, let destination):
            return resizePlan(
                startFrame: startFrame,
                handle: handle,
                destination: destination,
                baseWarnings: baseWarnings
            )

        case .setFrame(let targetFrame, let animate):
            return framePlan(
                startFrame: startFrame,
                targetFrame: targetFrame,
                animate: animate,
                baseWarnings: baseWarnings
            )
        }
    }

    private func dragPlan(
        startFrame: CGRect,
        destinationOrigin: CGPoint,
        baseWarnings: [String]
    ) -> WindowMotionPlanningOutcome {
        let finalFrame = CGRect(
            x: destinationOrigin.x,
            y: destinationOrigin.y,
            width: startFrame.width,
            height: startFrame.height
        ).standardized

        var warnings = baseWarnings
        let anchor = CursorTargetProjector.titlebarAnchor(for: startFrame)
        warnings.append("Resolved titlebar anchor at AppKit-global (\(Int(anchor.x)), \(Int(anchor.y))).")

        return validateAndBuildPlan(
            startFrame: startFrame,
            targetFrame: finalFrame,
            animate: true,
            defaultPresentationMode: .drag,
            warnings: warnings,
            segmentsBuilder: {
                [
                    WindowMotionSegmentPlan(
                        kind: .drag,
                        fromFrame: startFrame,
                        toFrame: finalFrame,
                        resizeHandle: nil,
                        cursorStartPoint: CursorTargetProjector.titlebarAnchor(for: startFrame),
                        cursorEndPoint: CursorTargetProjector.titlebarAnchor(for: finalFrame),
                        duration: WindowMotionMath.projectionDuration(from: startFrame, to: finalFrame)
                    ),
                ]
            }
        )
    }

    private func resizePlan(
        startFrame: CGRect,
        handle: ResizeHandleDTO,
        destination: CGPoint,
        baseWarnings: [String]
    ) -> WindowMotionPlanningOutcome {
        var warnings = baseWarnings
        let handlePoint = CursorTargetProjector.resizeHandlePoint(for: handle, in: startFrame)
        warnings.append("Resolved resize handle: \(handle.rawValue) at AppKit-global (\(Int(handlePoint.x)), \(Int(handlePoint.y))).")

        let finalFrame = WindowMotionMath.frameByMovingHandle(
            from: startFrame,
            handle: handle,
            toPoint: destination
        ).standardized

        return validateAndBuildPlan(
            startFrame: startFrame,
            targetFrame: finalFrame,
            animate: true,
            defaultPresentationMode: .resize,
            warnings: warnings,
            segmentsBuilder: {
                [
                    WindowMotionSegmentPlan(
                        kind: .resize,
                        fromFrame: startFrame,
                        toFrame: finalFrame,
                        resizeHandle: handle,
                        cursorStartPoint: CursorTargetProjector.resizeHandlePoint(for: handle, in: startFrame),
                        cursorEndPoint: CursorTargetProjector.resizeHandlePoint(for: handle, in: finalFrame),
                        duration: WindowMotionMath.projectionDuration(from: startFrame, to: finalFrame)
                    ),
                ]
            }
        )
    }

    private func framePlan(
        startFrame: CGRect,
        targetFrame: CGRect,
        animate: Bool,
        baseWarnings: [String]
    ) -> WindowMotionPlanningOutcome {
        let finalFrame = targetFrame.standardized
        let presentationMode = classifyPresentationMode(startFrame: startFrame, finalFrame: finalFrame, animate: animate)

        return validateAndBuildPlan(
            startFrame: startFrame,
            targetFrame: finalFrame,
            animate: animate,
            defaultPresentationMode: presentationMode,
            warnings: baseWarnings,
            segmentsBuilder: {
                switch presentationMode {
                case .none:
                    return [
                        WindowMotionSegmentPlan(
                            kind: .direct,
                            fromFrame: startFrame,
                            toFrame: finalFrame,
                            resizeHandle: nil,
                            cursorStartPoint: nil,
                            cursorEndPoint: nil,
                            duration: 0
                        ),
                    ]

                case .drag:
                    return [
                        WindowMotionSegmentPlan(
                            kind: .drag,
                            fromFrame: startFrame,
                            toFrame: finalFrame,
                            resizeHandle: nil,
                            cursorStartPoint: CursorTargetProjector.titlebarAnchor(for: startFrame),
                            cursorEndPoint: CursorTargetProjector.titlebarAnchor(for: finalFrame),
                            duration: WindowMotionMath.projectionDuration(from: startFrame, to: finalFrame)
                        ),
                    ]

                case .resize:
                    let handle = preferredResizeHandle(from: startFrame, to: finalFrame)
                    return [
                        WindowMotionSegmentPlan(
                            kind: .resize,
                            fromFrame: startFrame,
                            toFrame: finalFrame,
                            resizeHandle: handle,
                            cursorStartPoint: CursorTargetProjector.resizeHandlePoint(for: handle, in: startFrame),
                            cursorEndPoint: CursorTargetProjector.resizeHandlePoint(for: handle, in: finalFrame),
                            duration: WindowMotionMath.projectionDuration(from: startFrame, to: finalFrame)
                        ),
                    ]

                case .dragThenResize:
                    let compositePlan = bestDragIntermediate(from: startFrame, to: finalFrame)
                    let resizeHandle = compositePlan?.handle ?? preferredResizeHandle(from: startFrame, to: finalFrame)
                    let firstInterim = compositePlan?.frame ?? CGRect(
                        x: finalFrame.minX,
                        y: finalFrame.minY,
                        width: startFrame.width,
                        height: startFrame.height
                    ).standardized

                    return [
                        WindowMotionSegmentPlan(
                            kind: .drag,
                            fromFrame: startFrame,
                            toFrame: firstInterim,
                            resizeHandle: nil,
                            cursorStartPoint: CursorTargetProjector.titlebarAnchor(for: startFrame),
                            cursorEndPoint: CursorTargetProjector.titlebarAnchor(for: firstInterim),
                            duration: WindowMotionMath.projectionDuration(from: startFrame, to: firstInterim)
                        ),
                        WindowMotionSegmentPlan(
                            kind: .resize,
                            fromFrame: firstInterim,
                            toFrame: finalFrame,
                            resizeHandle: resizeHandle,
                            cursorStartPoint: CursorTargetProjector.resizeHandlePoint(for: resizeHandle, in: firstInterim),
                            cursorEndPoint: CursorTargetProjector.resizeHandlePoint(for: resizeHandle, in: finalFrame),
                            duration: WindowMotionMath.projectionDuration(from: firstInterim, to: finalFrame)
                        ),
                    ]
                }
            }
        )
    }

    private func validateAndBuildPlan(
        startFrame: CGRect,
        targetFrame: CGRect,
        animate: Bool,
        defaultPresentationMode: MotionPresentationModeDTO,
        warnings: [String],
        segmentsBuilder: () -> [WindowMotionSegmentPlan]
    ) -> WindowMotionPlanningOutcome {
        let strategyUsed = animate ? "ax_window_frame_projection" : "ax_window_frame_direct"

        guard AXHelpers.isRenderableFrame(targetFrame) else {
            return .rejected(
                WindowMotionPlanningRejection(
                    rawStatus: "invalid_target_frame",
                    error: ActionErrorDTO(
                        code: "invalid_target_frame",
                        message: "The projected frame is too small or otherwise invalid."
                    ),
                    warnings: warnings,
                    strategyUsed: strategyUsed,
                    presentationMode: .none
                )
            )
        }

        guard AXHelpers.isOnScreen(targetFrame) else {
            return .rejected(
                WindowMotionPlanningRejection(
                    rawStatus: "offscreen_target_frame",
                    error: ActionErrorDTO(
                        code: "offscreen_target_frame",
                        message: "The projected frame would leave the visible screen area."
                    ),
                    warnings: warnings,
                    strategyUsed: strategyUsed,
                    presentationMode: .none
                )
            )
        }

        if WindowMotionMath.approximatelyMatches(expected: targetFrame, actual: startFrame) {
            return .noop(
                WindowMotionPlan(
                    requestedFrame: targetFrame,
                    targetFrame: targetFrame,
                    animate: animate,
                    presentationMode: .none,
                    strategyUsed: strategyUsed,
                    warnings: warnings,
                    segments: []
                )
            )
        }

        return .executable(
            WindowMotionPlan(
                requestedFrame: targetFrame,
                targetFrame: targetFrame,
                animate: animate,
                presentationMode: defaultPresentationMode,
                strategyUsed: strategyUsed,
                warnings: warnings,
                segments: segmentsBuilder()
            )
        )
    }

    private func classifyPresentationMode(
        startFrame: CGRect,
        finalFrame: CGRect,
        animate: Bool
    ) -> MotionPresentationModeDTO {
        guard animate else { return .none }

        let positionChanged =
            abs(startFrame.minX - finalFrame.minX) > 1 ||
            abs(startFrame.minY - finalFrame.minY) > 1
        let sizeChanged =
            abs(startFrame.width - finalFrame.width) > 1 ||
            abs(startFrame.height - finalFrame.height) > 1

        switch (positionChanged, sizeChanged) {
        case (false, false):
            return .none
        case (true, false):
            return .drag
        case (false, true):
            return .resize
        case (true, true):
            return .dragThenResize
        }
    }

    private func bestDragIntermediate(from startFrame: CGRect, to finalFrame: CGRect) -> (frame: CGRect, handle: ResizeHandleDTO)? {
        let candidates: [ResizeHandleDTO] = [.bottomRight, .bottomLeft, .topRight, .topLeft]
        for handle in candidates {
            let frame = dragIntermediate(
                startFrame: startFrame,
                finalFrame: finalFrame,
                preservingOppositeOf: handle
            )
            if AXHelpers.isRenderableFrame(frame), AXHelpers.isOnScreen(frame) {
                return (frame.standardized, handle)
            }
        }
        return nil
    }

    private func preferredResizeHandle(from startFrame: CGRect, to finalFrame: CGRect) -> ResizeHandleDTO {
        let leftChanged = abs(startFrame.minX - finalFrame.minX) > 1
        let rightChanged = abs(startFrame.maxX - finalFrame.maxX) > 1
        let topChanged = abs(startFrame.maxY - finalFrame.maxY) > 1
        let bottomChanged = abs(startFrame.minY - finalFrame.minY) > 1

        switch (leftChanged, rightChanged, topChanged, bottomChanged) {
        case (true, false, true, false):
            return .topLeft
        case (false, true, true, false):
            return .topRight
        case (true, false, false, true):
            return .bottomLeft
        case (false, true, false, true):
            return .bottomRight
        case (true, false, false, false):
            return .left
        case (false, true, false, false):
            return .right
        case (false, false, true, false):
            return .top
        case (false, false, false, true):
            return .bottom
        default:
            return .bottomRight
        }
    }

    private func dragIntermediate(
        startFrame: CGRect,
        finalFrame: CGRect,
        preservingOppositeOf handle: ResizeHandleDTO
    ) -> CGRect {
        let origin: CGPoint
        switch handle {
        case .bottomRight:
            origin = CGPoint(
                x: finalFrame.minX,
                y: finalFrame.maxY - startFrame.height
            )
        case .bottomLeft:
            origin = CGPoint(
                x: finalFrame.maxX - startFrame.width,
                y: finalFrame.maxY - startFrame.height
            )
        case .topRight:
            origin = CGPoint(
                x: finalFrame.minX,
                y: finalFrame.minY
            )
        case .topLeft:
            origin = CGPoint(
                x: finalFrame.maxX - startFrame.width,
                y: finalFrame.minY
            )
        case .left, .right, .top, .bottom:
            origin = CGPoint(x: finalFrame.minX, y: finalFrame.minY)
        }

        return CGRect(
            x: origin.x,
            y: origin.y,
            width: startFrame.width,
            height: startFrame.height
        ).standardized
    }
}
