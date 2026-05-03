import Foundation

struct WindowDragRouteService {
    private let executionOptions: ActionExecutionOptions
    private let snapshotService = WindowGeometrySnapshotService()
    private let planner = WindowMotionPlanner()
    private let engine: WindowMotionEngine

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        engine = WindowMotionEngine(executionOptions: executionOptions)
    }

    func drag(request: DragRequest) throws -> DragResponse {
        let cursor = cursorSession(request.cursor)
        let totalStarted = DispatchTime.now().uptimeNanoseconds
        let resolveStarted = DispatchTime.now().uptimeNanoseconds
        let snapshot = try snapshotService.snapshot(windowID: request.window)
        let resolveFinished = DispatchTime.now().uptimeNanoseconds

        let planningStarted = DispatchTime.now().uptimeNanoseconds
        var warnings = [
            "Drag targets desktop-global AppKit coordinates and moves the window origin through one canonical frame plan.",
        ]

        guard request.toX.isFinite, request.toY.isFinite else {
            let planningFinished = DispatchTime.now().uptimeNanoseconds
            return DragResponse(
                contractVersion: ContractVersion.current,
                ok: false,
                cursor: cursor,
                action: DragActionDTO(
                    kind: "drag",
                    requested: DragRequestedDTO(
                        window: request.window,
                        toX: request.toX,
                        toY: request.toY,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: "coordinate_validation",
                    rawStatus: "invalid_request",
                    effectVerified: false,
                    warnings: warnings
                ),
                window: MotionResponseFactory.motionWindow(snapshot: snapshot, afterFrame: snapshot.frameAppKit),
                backgroundSafety: MotionResponseFactory.backgroundSafety(
                    before: snapshot.frontmostBefore,
                    after: snapshot.frontmostBefore
                ),
                performance: MotionResponseFactory.performance(
                    resolveStarted: resolveStarted,
                    resolveFinished: resolveFinished,
                    planningStarted: planningStarted,
                    planningFinished: planningFinished,
                    projectionMs: 0,
                    settleMs: 0,
                    projectionDiagnostics: nil,
                    totalStarted: totalStarted
                ),
                error: ActionErrorDTO(
                    code: "invalid_request",
                    message: "The supplied drag destination must be finite AppKit-global coordinates."
                )
            )
        }

        let outcome = planner.plan(
            snapshot: snapshot,
            directive: .drag(destinationOrigin: CGPoint(x: request.toX, y: request.toY)),
            baseWarnings: warnings
        )
        let planningFinished = DispatchTime.now().uptimeNanoseconds

        switch outcome {
        case .rejected(let rejection):
            return DragResponse(
                contractVersion: ContractVersion.current,
                ok: false,
                cursor: cursor,
                action: DragActionDTO(
                    kind: "drag",
                    requested: DragRequestedDTO(
                        window: request.window,
                        toX: request.toX,
                        toY: request.toY,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: rejection.strategyUsed,
                    rawStatus: rejection.rawStatus,
                    effectVerified: false,
                    warnings: rejection.warnings
                ),
                window: MotionResponseFactory.motionWindow(snapshot: snapshot, afterFrame: snapshot.frameAppKit),
                backgroundSafety: MotionResponseFactory.backgroundSafety(
                    before: snapshot.frontmostBefore,
                    after: snapshot.frontmostBefore
                ),
                performance: MotionResponseFactory.performance(
                    resolveStarted: resolveStarted,
                    resolveFinished: resolveFinished,
                    planningStarted: planningStarted,
                    planningFinished: planningFinished,
                    projectionMs: 0,
                    settleMs: 0,
                    projectionDiagnostics: nil,
                    totalStarted: totalStarted
                ),
                error: rejection.error
            )

        case .noop(let plan):
            warnings = plan.warnings
            warnings.append("The supplied drag destination matched the current frame origin; the runtime treated this as a no-op.")
            return DragResponse(
                contractVersion: ContractVersion.current,
                ok: true,
                cursor: cursor,
                action: DragActionDTO(
                    kind: "drag",
                    requested: DragRequestedDTO(
                        window: request.window,
                        toX: request.toX,
                        toY: request.toY,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: "\(plan.strategyUsed)_noop",
                    rawStatus: "success",
                    effectVerified: true,
                    warnings: warnings
                ),
                window: MotionResponseFactory.motionWindow(snapshot: snapshot, afterFrame: snapshot.frameAppKit),
                backgroundSafety: MotionResponseFactory.backgroundSafety(
                    before: snapshot.frontmostBefore,
                    after: snapshot.frontmostBefore
                ),
                performance: MotionResponseFactory.performance(
                    resolveStarted: resolveStarted,
                    resolveFinished: resolveFinished,
                    planningStarted: planningStarted,
                    planningFinished: planningFinished,
                    projectionMs: 0,
                    settleMs: 0,
                    projectionDiagnostics: nil,
                    totalStarted: totalStarted
                ),
                error: nil
            )

        case .executable(let plan):
            let execution = engine.execute(
                plan: plan,
                target: snapshot.target,
                cursorID: cursor.id
            )
            return DragResponse(
                contractVersion: ContractVersion.current,
                ok: execution.effectVerified,
                cursor: cursor,
                action: DragActionDTO(
                    kind: "drag",
                    requested: DragRequestedDTO(
                        window: request.window,
                        toX: request.toX,
                        toY: request.toY,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: plan.strategyUsed,
                    rawStatus: execution.rawStatus,
                    effectVerified: execution.effectVerified,
                    warnings: plan.warnings
                ),
                window: MotionResponseFactory.motionWindow(snapshot: snapshot, afterFrame: execution.settledFrame),
                backgroundSafety: MotionResponseFactory.backgroundSafety(
                    before: snapshot.frontmostBefore,
                    after: execution.frontmostAfter
                ),
                performance: MotionResponseFactory.performance(
                    resolveStarted: resolveStarted,
                    resolveFinished: resolveFinished,
                    planningStarted: planningStarted,
                    planningFinished: planningFinished,
                    projectionMs: execution.projectionMs,
                    settleMs: execution.settleMs,
                    projectionDiagnostics: execution.projectionDiagnostics,
                    totalStarted: totalStarted
                ),
                error: execution.effectVerified ? nil : ActionErrorDTO(
                    code: "effect_not_verified",
                    message: "The runtime projected the drag path, but the live window frame did not converge on the expected destination."
                )
            )
        }
    }

    private func cursorSession(_ request: CursorRequestDTO?) -> CursorResponseDTO {
        executionOptions.visualCursorEnabled
            ? CursorRuntime.resolve(requested: request)
            : AXCursorTargeting.disabledSession(requested: request)
    }
}
