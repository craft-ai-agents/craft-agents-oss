import Foundation

struct SetWindowFrameRouteService {
    private let executionOptions: ActionExecutionOptions
    private let snapshotService = WindowGeometrySnapshotService()
    private let planner = WindowMotionPlanner()
    private let engine: WindowMotionEngine

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        engine = WindowMotionEngine(executionOptions: executionOptions)
    }

    func setWindowFrame(request: SetWindowFrameRequest) throws -> SetWindowFrameResponse {
        let cursor = cursorSession(request.cursor)
        let totalStarted = DispatchTime.now().uptimeNanoseconds
        let resolveStarted = DispatchTime.now().uptimeNanoseconds
        let snapshot = try snapshotService.snapshot(windowID: request.window)
        let resolveFinished = DispatchTime.now().uptimeNanoseconds

        let animate = executionOptions.visualCursorEnabled ? (request.animate ?? true) : false
        let planningStarted = DispatchTime.now().uptimeNanoseconds
        let warnings = [
            "set_window_frame accepts one canonical AppKit-global frame and routes it through the shared motion planner.",
        ]

        guard request.x.isFinite, request.y.isFinite, request.width.isFinite, request.height.isFinite else {
            let planningFinished = DispatchTime.now().uptimeNanoseconds
            return SetWindowFrameResponse(
                contractVersion: ContractVersion.current,
                ok: false,
                cursor: cursor,
                action: SetWindowFrameActionDTO(
                    kind: "set_window_frame",
                    requested: SetWindowFrameRequestedDTO(
                        window: request.window,
                        x: request.x,
                        y: request.y,
                        width: request.width,
                        height: request.height,
                        animate: animate,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: "coordinate_validation",
                    presentationMode: .none,
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
                    message: "The supplied frame must use finite AppKit-global coordinates and dimensions."
                )
            )
        }

        let outcome = planner.plan(
            snapshot: snapshot,
            directive: .setFrame(
                targetFrame: CGRect(
                    x: request.x,
                    y: request.y,
                    width: request.width,
                    height: request.height
                ),
                animate: animate
            ),
            baseWarnings: warnings
        )
        let planningFinished = DispatchTime.now().uptimeNanoseconds

        switch outcome {
        case .rejected(let rejection):
            return SetWindowFrameResponse(
                contractVersion: ContractVersion.current,
                ok: false,
                cursor: cursor,
                action: SetWindowFrameActionDTO(
                    kind: "set_window_frame",
                    requested: SetWindowFrameRequestedDTO(
                        window: request.window,
                        x: request.x,
                        y: request.y,
                        width: request.width,
                        height: request.height,
                        animate: animate,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: rejection.strategyUsed,
                    presentationMode: rejection.presentationMode,
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
            var noopWarnings = plan.warnings
            noopWarnings.append("The requested frame already matched the live window frame; the runtime treated this as a no-op.")
            return SetWindowFrameResponse(
                contractVersion: ContractVersion.current,
                ok: true,
                cursor: cursor,
                action: SetWindowFrameActionDTO(
                    kind: "set_window_frame",
                    requested: SetWindowFrameRequestedDTO(
                        window: request.window,
                        x: request.x,
                        y: request.y,
                        width: request.width,
                        height: request.height,
                        animate: animate,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: "\(plan.strategyUsed)_noop",
                    presentationMode: .none,
                    rawStatus: "success",
                    effectVerified: true,
                    warnings: noopWarnings
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
            return SetWindowFrameResponse(
                contractVersion: ContractVersion.current,
                ok: execution.effectVerified,
                cursor: cursor,
                action: SetWindowFrameActionDTO(
                    kind: "set_window_frame",
                    requested: SetWindowFrameRequestedDTO(
                        window: request.window,
                        x: request.x,
                        y: request.y,
                        width: request.width,
                        height: request.height,
                        animate: animate,
                        coordinateSpace: .appKitGlobal
                    ),
                    strategyUsed: plan.strategyUsed,
                    presentationMode: plan.presentationMode,
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
                    message: "The runtime applied the requested frame projection, but the live window frame did not converge on the expected destination."
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
