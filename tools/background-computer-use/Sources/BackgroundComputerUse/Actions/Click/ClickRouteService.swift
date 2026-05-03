import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

private struct ClickCoordinatePlan {
    let mapping: ClickCoordinateMappingDTO
    let appKitPoint: CGPoint
    let eventTapPointTopLeft: CGPoint
}

private struct ClickCoordinateOutcome {
    let classification: ActionClassificationDTO
    let failureDomain: ActionFailureDomainDTO?
    let summary: String
    let finalRoute: ClickFinalRouteDTO
    let fallbackReason: ClickFallbackReasonDTO
    let coordinate: ClickCoordinateMappingDTO?
    let transports: [ClickTransportAttemptDTO]
    let routeSteps: [ClickRouteStepDTO]
    let postCapture: AXActionStateCapture?
    let cursor: ActionCursorTargetResponseDTO
    let frontmostBundleBeforeDispatch: String?
    let frontmostBundleAfter: String?
    let warnings: [String]
    let notes: [String]
    let verification: ClickVerificationEvidenceDTO?
}

private struct ClickSemanticOutcome {
    let classification: ActionClassificationDTO
    let failureDomain: ActionFailureDomainDTO?
    let summary: String
    let axAttempt: ClickAXAttemptDTO
    let dispatchSuccess: Bool
    let verificationSuccess: Bool
    let intentSuccess: Bool
    let coordinateFallbackAllowed: Bool
    let transport: ClickTransportAttemptDTO?
    let postCapture: AXActionStateCapture?
    let refreshedTarget: AXActionTargetSnapshot?
    let refreshedTargetStrategy: String?
    let cursor: ActionCursorTargetResponseDTO
    let frontmostBundleBeforeDispatch: String?
    let frontmostBundleAfter: String?
    let warnings: [String]
    let notes: [String]
    let verification: ClickVerificationEvidenceDTO?
}

struct ClickRouteService {
    private let executionOptions: ActionExecutionOptions
    private let targetResolver: AXActionTargetResolver
    private let settleDelay: TimeInterval = 0.35
    private let coordinateTransport = NativeBackgroundClickTransport()

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        targetResolver = AXActionTargetResolver(executionOptions: executionOptions)
    }

    func click(request: ClickRequest) throws -> ClickResponse {
        let requestedTarget = requestedTargetDTO(request)
        let mouseButton = request.mouseButton ?? .left
        let frontmostBefore = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let notes = [
            "click uses the production waterfall: semantic AX for eligible targets, then target-derived or direct coordinate dispatch through native target-only SLPS/SLEvent background click transport.",
            "perform_secondary_action remains a separate semantic route; click does not hide secondary/default-action fallbacks as pointer clicks."
        ]

        let capture = try targetResolver.capture(
            windowID: request.window,
            includeMenuBar: request.includeMenuBar ?? true,
            maxNodes: request.maxNodes ?? 6500,
            imageMode: request.imageMode ?? .omit
        )
        let stateTokenStale = suppliedStateTokenIsStale(
            supplied: request.stateToken,
            live: capture.envelope.response.stateToken
        )
        let warnings = stateTokenStale
            ? ["Supplied stateToken did not match the live pre-action recapture; click was rejected by the stale-coordinate guard."]
            : []

        if stateTokenStale {
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: "Supplied stateToken did not match the live pre-action recapture; refusing to click a potentially stale target.",
                window: capture.envelope.response.window,
                requestedTarget: requestedTarget,
                target: nil,
                clickCount: request.clickCount,
                mouseButton: mouseButton,
                finalRoute: .rejected,
                fallbackReason: .staleCoordinateGuard,
                axAttempt: nil,
                coordinate: nil,
                transports: [],
                routeSteps: [rejectedStep("State token mismatch rejected before dispatch.")],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the request stateToken was stale.",
                    options: executionOptions
                ),
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        guard mouseButton == .left else {
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: "Only left-button background click is currently implemented. Use perform_secondary_action for exposed semantic secondary actions.",
                window: capture.envelope.response.window,
                requestedTarget: requestedTarget,
                target: nil,
                clickCount: request.clickCount,
                mouseButton: mouseButton,
                finalRoute: .rejected,
                fallbackReason: .unsupportedMouseButton,
                axAttempt: nil,
                coordinate: nil,
                transports: [],
                routeSteps: [rejectedStep("mouseButton \(mouseButton.rawValue) is unsupported by the production background click transport.")],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the requested mouse button is unsupported.",
                    options: executionOptions
                ),
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let hasTarget = request.target != nil
        let hasCompleteCoordinate = request.x != nil && request.y != nil
        let hasPartialCoordinate = (request.x != nil) != (request.y != nil)
        guard hasPartialCoordinate == false, hasTarget != hasCompleteCoordinate else {
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: "Supply exactly one target form: target or both x and y.",
                window: capture.envelope.response.window,
                requestedTarget: requestedTarget,
                target: nil,
                clickCount: request.clickCount,
                mouseButton: mouseButton,
                finalRoute: .rejected,
                fallbackReason: .invalidTarget,
                axAttempt: nil,
                coordinate: nil,
                transports: [],
                routeSteps: [rejectedStep("The request target was ambiguous or incomplete.")],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the click target was ambiguous or incomplete.",
                    options: executionOptions
                ),
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        if let target = request.target {
            guard let clickCount = normalizedTargetClickCount(request) else {
                return invalidClickCountResponse(
                    request: request,
                    capture: capture,
                    requestedTarget: requestedTarget,
                    mouseButton: mouseButton,
                    frontmostBefore: frontmostBefore,
                    warnings: warnings,
                    notes: notes,
                    summary: "Target clickCount must be 1 or 2."
                )
            }
            return try clickTarget(
                request: request,
                capture: capture,
                requestedActionTarget: target,
                clickCount: clickCount,
                mouseButton: mouseButton,
                frontmostBefore: frontmostBefore,
                warnings: warnings,
                notes: notes
            )
        }

        guard let x = request.x, let y = request.y else {
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: "No click target was supplied.",
                window: capture.envelope.response.window,
                requestedTarget: requestedTarget,
                target: nil,
                clickCount: request.clickCount,
                mouseButton: mouseButton,
                finalRoute: .rejected,
                fallbackReason: .invalidTarget,
                axAttempt: nil,
                coordinate: nil,
                transports: [],
                routeSteps: [rejectedStep("No target or x/y coordinate was supplied.")],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because no click target was supplied.",
                    options: executionOptions
                ),
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let clickCount: Int
        do {
            clickCount = try normalizedClickCount(request)
        } catch {
            return invalidClickCountResponse(
                request: request,
                capture: capture,
                requestedTarget: requestedTarget,
                mouseButton: mouseButton,
                frontmostBefore: frontmostBefore,
                warnings: warnings,
                notes: notes,
                summary: String(describing: error)
            )
        }

        let outcome = executeCoordinateClick(
            request: request,
            capture: capture,
            target: nil,
            x: x,
            y: y,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: .coordinateXY,
            fallbackReason: .none,
            source: "direct_model_facing_coordinate",
            inheritedTransports: [],
            inheritedSteps: [],
            warnings: warnings,
            notes: notes
        )

        return response(
            classification: outcome.classification,
            failureDomain: outcome.failureDomain,
            summary: outcome.summary,
            window: outcome.postCapture?.envelope.response.window ?? capture.envelope.response.window,
            requestedTarget: requestedTarget,
            target: nil,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: outcome.finalRoute,
            fallbackReason: outcome.fallbackReason,
            axAttempt: nil,
            coordinate: outcome.coordinate,
            transports: outcome.transports,
            routeSteps: outcome.routeSteps,
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: outcome.postCapture?.envelope.response.stateToken,
            cursor: outcome.cursor,
            frontmostBundleBefore: frontmostBefore,
            frontmostBundleBeforeDispatch: outcome.frontmostBundleBeforeDispatch,
            frontmostBundleAfter: outcome.frontmostBundleAfter,
            warnings: outcome.warnings,
            notes: outcome.notes,
            verification: outcome.verification
        )
    }

    private func clickTarget(
        request: ClickRequest,
        capture: AXActionStateCapture,
        requestedActionTarget: ActionTargetRequestDTO,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        frontmostBefore: String?,
        warnings: [String],
        notes: [String]
    ) throws -> ClickResponse {
        guard let candidate = targetResolver.resolveTarget(
            requestedActionTarget,
            in: capture,
            kind: .click
        ) else {
            let failureSummary = targetResolver.targetResolutionFailureDescription(
                for: requestedActionTarget,
                in: capture
            )
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: failureSummary,
                window: capture.envelope.response.window,
                requestedTarget: ClickRequestedTargetDTO(
                    kind: .semanticTarget,
                    target: requestedActionTarget,
                    x: nil,
                    y: nil,
                    coordinateSpace: nil
                ),
                target: nil,
                clickCount: clickCount,
                mouseButton: mouseButton,
                finalRoute: .rejected,
                fallbackReason: .invalidTarget,
                axAttempt: nil,
                coordinate: nil,
                transports: [],
                routeSteps: [rejectedStep(failureSummary)],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the semantic target was not resolved.",
                    options: executionOptions
                ),
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let target = candidate.target
        if clickCount > 1 {
            let outcome = executeExplicitElementPointerClick(
                request: request,
                capture: capture,
                target: target,
                clickCount: clickCount,
                mouseButton: mouseButton,
                warnings: warnings,
                notes: notes
            )
            return response(
                classification: outcome.classification,
                failureDomain: outcome.failureDomain,
                summary: outcome.summary,
                window: outcome.postCapture?.envelope.response.window ?? capture.envelope.response.window,
                requestedTarget: ClickRequestedTargetDTO(
                    kind: .semanticTarget,
                    target: requestedActionTarget,
                    x: nil,
                    y: nil,
                    coordinateSpace: nil
                ),
                target: target,
                clickCount: clickCount,
                mouseButton: mouseButton,
                finalRoute: outcome.finalRoute,
                fallbackReason: outcome.fallbackReason,
                axAttempt: .coordinateRequired,
                coordinate: outcome.coordinate,
                transports: outcome.transports,
                routeSteps: outcome.routeSteps,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: outcome.postCapture?.envelope.response.stateToken,
                cursor: outcome.cursor,
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: outcome.frontmostBundleBeforeDispatch,
                frontmostBundleAfter: outcome.frontmostBundleAfter,
                warnings: outcome.warnings,
                notes: outcome.notes,
                verification: outcome.verification
            )
        }

        let semantic = attemptSemanticAX(
            request: request,
            capture: capture,
            target: target,
            clickCount: clickCount,
            mouseButton: mouseButton,
            warnings: warnings,
            notes: notes
        )

        if clickCount == 1 {
            if semantic.intentSuccess {
                return semanticResponse(
                    semantic,
                    request: request,
                    capture: capture,
                    target: target,
                    clickCount: clickCount,
                    mouseButton: mouseButton,
                    frontmostBefore: frontmostBefore
                )
            }

            if semantic.coordinateFallbackAllowed {
                let fallback = executeElementPointerFallback(
                    request: request,
                    capture: capture,
                    target: semantic.refreshedTarget ?? target,
                    clickCount: 1,
                    mouseButton: mouseButton,
                    finalRoute: .axElementPointerXY,
                    fallbackReason: .axCoordinateRequired,
                    semantic: semantic,
                    warnings: semantic.warnings,
                    notes: semantic.notes
                )
                return coordinateFallbackResponse(
                    fallback,
                    semantic: semantic,
                    request: request,
                    capture: capture,
                    target: target,
                    clickCount: clickCount,
                    mouseButton: mouseButton,
                    frontmostBefore: frontmostBefore
                )
            }

            return semanticResponse(
                semantic,
                request: request,
                capture: capture,
                target: target,
                clickCount: clickCount,
                mouseButton: mouseButton,
                frontmostBefore: frontmostBefore
            )
        }

        preconditionFailure("normalized single/double click count escaped click routing")
    }

    private func attemptSemanticAX(
        request: ClickRequest,
        capture: AXActionStateCapture,
        target: AXActionTargetSnapshot,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        warnings: [String],
        notes: [String]
    ) -> ClickSemanticOutcome {
        var warnings = warnings
        var notes = notes
        notes.append("Semantic target click attempted the AX lane before pointer fallback.")

        let liveElement: AXActionResolvedLiveElement
        do {
            liveElement = try targetResolver.resolveLiveElement(for: target, in: capture)
        } catch {
            return ClickSemanticOutcome(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: String(describing: error),
                axAttempt: .unsupportedPrimaryClick,
                dispatchSuccess: false,
                verificationSuccess: false,
                intentSuccess: false,
                coordinateFallbackAllowed: targetHasUsablePoint(target, window: capture.envelope.response.window),
                transport: nil,
                postCapture: nil,
                refreshedTarget: nil,
                refreshedTargetStrategy: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the live AX click target could not be resolved.",
                    options: executionOptions
                ),
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let plan = planSemanticAXClick(target: target, liveElement: liveElement.element)
        guard plan.dispatches else {
            let summary: String
            switch plan.attempt {
            case .coordinateRequired:
                summary = "The target requires a target-derived pointer click; no exact semantic AX primary-click strategy applied."
            case .ambiguousDescendantClick:
                summary = "The element contained multiple possible primary-click descendants, so semantic AX retargeting was rejected."
            default:
                summary = "No generic semantic AX primary-click strategy applied to the target."
            }
            return ClickSemanticOutcome(
                classification: .effectNotVerified,
                failureDomain: .unsupported,
                summary: summary,
                axAttempt: plan.attempt,
                dispatchSuccess: false,
                verificationSuccess: false,
                intentSuccess: false,
                coordinateFallbackAllowed: targetHasUsablePoint(target, window: capture.envelope.response.window),
                transport: nil,
                postCapture: nil,
                refreshedTarget: nil,
                refreshedTargetStrategy: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was deferred to the pointer fallback because the semantic AX lane did not dispatch.",
                    options: executionOptions
                ),
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes + plan.notes,
                verification: nil
            )
        }

        let cursor = AXCursorTargeting.prepareClick(
            requested: request.cursor,
            target: target,
            window: capture.envelope.response.window,
            options: executionOptions
        )
        warnings.append(contentsOf: cursor.warnings)
        let frontmostBeforeDispatch = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let dispatch = dispatchSemanticPlan(plan)
        let rawStatus = dispatch.rawStatus
        AXCursorTargeting.finishClick(cursor: cursor)
        sleepRunLoop(settleDelay)

        let postCapture: AXActionStateCapture?
        do {
            postCapture = try targetResolver.reread(after: capture, imageMode: request.imageMode ?? .omit)
        } catch {
            postCapture = nil
            warnings.append("Post-click reread failed after semantic AX dispatch: \(error).")
        }
        let refreshed = postCapture.flatMap {
            targetResolver.locateRefreshedTarget(in: $0, prior: target, kind: .click)
        }
        let verification = verifyClick(
            before: capture,
            after: postCapture,
            target: target,
            refreshedTarget: refreshed?.target,
            refreshedTargetStrategy: refreshed?.strategy,
            foregroundBeforeDispatch: frontmostBeforeDispatch,
            foregroundAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
            extraNotes: dispatch.notes + plan.notes
        )
        let verified = semanticVerified(plan: plan, dispatchSuccess: dispatch.success, verification: verification)
        let classification: ActionClassificationDTO = verified ? .success : .effectNotVerified
        let failureDomain: ActionFailureDomainDTO? = verified ? nil : (dispatch.success ? .verification : .transport)
        let transport = ClickTransportAttemptDTO(
            route: plan.transportRoute,
            axAttempt: plan.attempt,
            dispatchPrimitive: plan.dispatchPrimitive,
            rawStatus: rawStatus,
            transportSuccess: dispatch.success,
            didDispatch: true,
            clickCount: min(clickCount, 1),
            mouseButton: mouseButton,
            targetPointAppKit: cursor.targetPointAppKit,
            eventTapPointTopLeft: cursor.targetPointAppKit.map { PointDTO(x: $0.x, y: DesktopGeometry.desktopTop() - $0.y) },
            eventsPrepared: nil,
            targetPID: capture.envelope.response.window.pid,
            targetWindowNumber: capture.envelope.response.window.windowNumber,
            liveElementResolution: liveElement.resolution,
            notes: dispatch.notes + plan.notes
        )

        return ClickSemanticOutcome(
            classification: classification,
            failureDomain: failureDomain,
            summary: verified
                ? "The semantic AX click lane produced a verified primary-click effect using \(plan.attempt.rawValue)."
                : "The semantic AX click lane dispatched \(plan.attempt.rawValue), but the requested effect was not verified.",
            axAttempt: plan.attempt,
            dispatchSuccess: dispatch.success,
            verificationSuccess: verified,
            intentSuccess: verified,
            coordinateFallbackAllowed: plan.attempt == .exactPrimaryAXAction
                ? dispatch.success == false && targetHasUsablePoint(target, window: capture.envelope.response.window)
                : targetHasUsablePoint(target, window: capture.envelope.response.window),
            transport: transport,
            postCapture: postCapture,
            refreshedTarget: refreshed?.target,
            refreshedTargetStrategy: refreshed?.strategy,
            cursor: cursor,
            frontmostBundleBeforeDispatch: frontmostBeforeDispatch,
            frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func executeElementPointerFallback(
        request: ClickRequest,
        capture: AXActionStateCapture,
        target: AXActionTargetSnapshot,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        finalRoute: ClickFinalRouteDTO,
        fallbackReason: ClickFallbackReasonDTO,
        semantic: ClickSemanticOutcome,
        warnings: [String],
        notes: [String]
    ) -> ClickCoordinateOutcome {
        guard let plan = coordinatePlan(for: target, window: capture.envelope.response.window) else {
            let cursor = AXCursorTargeting.notAttempted(
                requested: request.cursor,
                reason: "Cursor movement was not attempted because the target had no stable element-derived coordinate.",
                    options: executionOptions
            )
            return ClickCoordinateOutcome(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: "The AX target did not include a stable visible frame or activation point for element-derived pointer fallback.",
                finalRoute: .rejected,
                fallbackReason: .missingStableAXCoordinate,
                coordinate: nil,
                transports: semantic.transport.map { [$0] } ?? [],
                routeSteps: semanticStep(semantic) + [rejectedStep("Missing stable AX coordinate for pointer fallback.")],
                postCapture: nil,
                cursor: cursor,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings + cursor.warnings,
                notes: notes,
                verification: semantic.verification
            )
        }

        return executeCoordinateClick(
            request: request,
            capture: capture,
            target: target,
            plan: plan,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: finalRoute,
            fallbackReason: fallbackReason,
            source: "element_derived_pointer_coordinate",
            inheritedTransports: semantic.transport.map { [$0] } ?? [],
            inheritedSteps: semanticStep(semantic),
            warnings: warnings,
            notes: notes
        )
    }

    private func executeCoordinateClick(
        request: ClickRequest,
        capture: AXActionStateCapture,
        target: AXActionTargetSnapshot?,
        x: Double,
        y: Double,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        finalRoute: ClickFinalRouteDTO,
        fallbackReason: ClickFallbackReasonDTO,
        source: String,
        inheritedTransports: [ClickTransportAttemptDTO],
        inheritedSteps: [ClickRouteStepDTO],
        warnings: [String],
        notes: [String]
    ) -> ClickCoordinateOutcome {
        let modelSize = modelPixelSize(for: capture.envelope.response)
        guard let plan = coordinatePlan(
            x: x,
            y: y,
            modelSize: modelSize,
            window: capture.envelope.response.window,
            source: source
        ) else {
            let cursor = AXCursorTargeting.notAttempted(
                requested: request.cursor,
                reason: "Cursor movement was not attempted because the model-facing coordinate was invalid or outside the current window screenshot bounds.",
                    options: executionOptions
            )
            return ClickCoordinateOutcome(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: "The model-facing coordinate was invalid or outside the current window screenshot bounds.",
                finalRoute: .rejected,
                fallbackReason: .invalidTarget,
                coordinate: nil,
                transports: inheritedTransports,
                routeSteps: inheritedSteps + [rejectedStep("Invalid model-facing x/y coordinate.")],
                postCapture: nil,
                cursor: cursor,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings + cursor.warnings,
                notes: notes,
                verification: nil
            )
        }
        return executeCoordinateClick(
            request: request,
            capture: capture,
            target: target,
            plan: plan,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: finalRoute,
            fallbackReason: fallbackReason,
            source: source,
            inheritedTransports: inheritedTransports,
            inheritedSteps: inheritedSteps,
            warnings: warnings,
            notes: notes
        )
    }

    private func executeCoordinateClick(
        request: ClickRequest,
        capture: AXActionStateCapture,
        target: AXActionTargetSnapshot?,
        plan: ClickCoordinatePlan,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        finalRoute: ClickFinalRouteDTO,
        fallbackReason: ClickFallbackReasonDTO,
        source: String,
        inheritedTransports: [ClickTransportAttemptDTO],
        inheritedSteps: [ClickRouteStepDTO],
        warnings: [String],
        notes: [String]
    ) -> ClickCoordinateOutcome {
        var warnings = warnings + plan.mapping.warnings
        var notes = notes
        let cursor = AXCursorTargeting.prepareClick(
            requested: request.cursor,
            pointAppKit: plan.appKitPoint,
            targetPointSource: plan.mapping.targetPointSource,
            window: capture.envelope.response.window,
            options: executionOptions
        )
        warnings.append(contentsOf: cursor.warnings)

        let frontmostBeforeDispatch = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let transportResult: NativeBackgroundClickTransportResult
        do {
            let routing = try NativeWindowServerRoutingResolver().resolve(windowNumber: capture.envelope.response.window.windowNumber)
            notes.append(contentsOf: routing.notes)
            transportResult = try coordinateTransport.dispatch(
                NativeBackgroundClickDispatchRequest(
                    target: RoutedClickTarget(window: capture.envelope.response.window, routing: routing),
                    eventTapPointTopLeft: plan.eventTapPointTopLeft,
                    appKitPoint: plan.appKitPoint,
                    clickCount: clickCount,
                    mouseButton: mouseButton
                )
            )
        } catch {
            AXCursorTargeting.finishClick(cursor: cursor)
            let transport = ClickTransportAttemptDTO(
                route: .nativeBackgroundCoordinate,
                axAttempt: nil,
                dispatchPrimitive: "SLPSPostEventRecordTo target-only focus + SLEventPostToPid mouse sequence",
                rawStatus: String(describing: error),
                transportSuccess: false,
                didDispatch: false,
                clickCount: clickCount,
                mouseButton: mouseButton,
                targetPointAppKit: plan.mapping.targetPointAppKit,
                eventTapPointTopLeft: plan.mapping.eventTapPointTopLeft,
                eventsPrepared: nil,
                targetPID: capture.envelope.response.window.pid,
                targetWindowNumber: capture.envelope.response.window.windowNumber,
                liveElementResolution: nil,
                notes: ["Coordinate click transport failed before dispatch: \(error)."]
            )
            return ClickCoordinateOutcome(
                classification: .effectNotVerified,
                failureDomain: .transport,
                summary: "The coordinate click transport failed before it could dispatch.",
                finalRoute: finalRoute,
                fallbackReason: .transportFailed,
                coordinate: plan.mapping,
                transports: inheritedTransports + [transport],
                routeSteps: inheritedSteps + [
                    ClickRouteStepDTO(
                        route: finalRoute,
                        dispatchSuccess: false,
                        verificationSuccess: false,
                        intentSuccess: false,
                        note: "Coordinate transport failed before dispatch."
                    )
                ],
                postCapture: nil,
                cursor: cursor,
                frontmostBundleBeforeDispatch: frontmostBeforeDispatch,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        AXCursorTargeting.finishClick(cursor: cursor)
        sleepRunLoop(settleDelay)
        let postCapture: AXActionStateCapture?
        do {
            postCapture = try targetResolver.reread(after: capture, imageMode: request.imageMode ?? .omit)
        } catch {
            postCapture = nil
            warnings.append("Post-click reread failed after coordinate dispatch: \(error).")
        }
        let refreshed = target.flatMap { prior in
            postCapture.flatMap {
                targetResolver.locateRefreshedTarget(in: $0, prior: prior, kind: .click)
            }
        }
        let frontmostAfter = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let verification = verifyClick(
            before: capture,
            after: postCapture,
            target: target,
            refreshedTarget: refreshed?.target,
            refreshedTargetStrategy: refreshed?.strategy,
            foregroundBeforeDispatch: frontmostBeforeDispatch,
            foregroundAfter: frontmostAfter,
            extraNotes: transportResult.notes
        )
        let verified = transportResult.dispatchSuccess && effectVerified(verification)
        let classification: ActionClassificationDTO = verified ? .success : .effectNotVerified
        let failureDomain: ActionFailureDomainDTO? = verified ? nil : (transportResult.dispatchSuccess ? .verification : .transport)
        let transport = ClickTransportAttemptDTO(
            route: .nativeBackgroundCoordinate,
            axAttempt: nil,
            dispatchPrimitive: "SLPSPostEventRecordTo target-only focus + SLEventPostToPid mouse sequence",
            rawStatus: transportResult.dispatchSuccess ? "posted" : "not_posted",
            transportSuccess: transportResult.dispatchSuccess,
            didDispatch: transportResult.dispatchSuccess,
            clickCount: clickCount,
            mouseButton: mouseButton,
            targetPointAppKit: plan.mapping.targetPointAppKit,
            eventTapPointTopLeft: plan.mapping.eventTapPointTopLeft,
            eventsPrepared: transportResult.eventsPrepared,
            targetPID: transportResult.targetPID,
            targetWindowNumber: transportResult.targetWindowNumber,
            liveElementResolution: nil,
            notes: transportResult.notes
        )
        let step = ClickRouteStepDTO(
            route: finalRoute,
            dispatchSuccess: transportResult.dispatchSuccess,
            verificationSuccess: verified,
            intentSuccess: verified,
            note: verified
                ? "Coordinate click produced a verified post-state effect."
                : "Coordinate click dispatched, but post-state verification did not prove an effect."
        )

        return ClickCoordinateOutcome(
            classification: classification,
            failureDomain: failureDomain,
            summary: verified
                ? "The coordinate click produced a verified post-state effect."
                : "The coordinate click dispatched through the native background click transport, but the requested effect was not verified.",
            finalRoute: finalRoute,
            fallbackReason: fallbackReason,
            coordinate: plan.mapping,
            transports: inheritedTransports + [transport],
            routeSteps: inheritedSteps + [step],
            postCapture: postCapture,
            cursor: cursor,
            frontmostBundleBeforeDispatch: frontmostBeforeDispatch,
            frontmostBundleAfter: frontmostAfter,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func executeExplicitElementPointerClick(
        request: ClickRequest,
        capture: AXActionStateCapture,
        target: AXActionTargetSnapshot,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        warnings: [String],
        notes: [String]
    ) -> ClickCoordinateOutcome {
        var notes = notes
        notes.append("Explicit target multi-click bypassed semantic AX so native pointer events can dispatch back-to-back with no verification gap.")
        guard let plan = coordinatePlan(for: target, window: capture.envelope.response.window) else {
            let cursor = AXCursorTargeting.notAttempted(
                requested: request.cursor,
                reason: "Cursor movement was not attempted because the target had no stable element-derived coordinate.",
                    options: executionOptions
            )
            return ClickCoordinateOutcome(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: "The AX target did not include a stable visible frame or activation point for explicit element multi-click.",
                finalRoute: .rejected,
                fallbackReason: .missingStableAXCoordinate,
                coordinate: nil,
                transports: [],
                routeSteps: [
                    ClickRouteStepDTO(
                        route: .axElementPointerXY,
                        dispatchSuccess: false,
                        verificationSuccess: false,
                        intentSuccess: false,
                        note: "Explicit element multi-click could not resolve a stable pointer coordinate."
                    )
                ],
                postCapture: nil,
                cursor: cursor,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings + cursor.warnings,
                notes: notes,
                verification: nil
            )
        }

        return executeCoordinateClick(
            request: request,
            capture: capture,
            target: target,
            plan: plan,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: .axElementPointerXY,
            fallbackReason: .axMultiClickRequiresXY,
            source: "element_derived_pointer_coordinate_explicit_multi_click",
            inheritedTransports: [],
            inheritedSteps: [],
            warnings: warnings,
            notes: notes
        )
    }

    private struct SemanticPlan {
        let attempt: ClickAXAttemptDTO
        let dispatches: Bool
        let dispatchElement: AXUIElement?
        let containerElement: AXUIElement?
        let actionName: String?
        let transportRoute: ClickTransportRouteDTO
        let dispatchPrimitive: String
        let notes: [String]
    }

    private func planSemanticAXClick(
        target: AXActionTargetSnapshot,
        liveElement: AXUIElement
    ) -> SemanticPlan {
        if let action = exactPrimaryAction(for: liveElement) {
            return SemanticPlan(
                attempt: .exactPrimaryAXAction,
                dispatches: true,
                dispatchElement: liveElement,
                containerElement: nil,
                actionName: action,
                transportRoute: .axPerformAction,
                dispatchPrimitive: "AXUIElementPerformAction(\(action))",
                notes: ["Target itself exposes eligible primary AX action \(action)."]
            )
        }

        if let row = rowElement(startingAt: liveElement),
           isInsideWebArea(row) == false {
            if let container = selectableRowsContainer(for: row) {
                return SemanticPlan(
                    attempt: .setContainerSelectedRows,
                    dispatches: true,
                    dispatchElement: row,
                    containerElement: container,
                    actionName: nil,
                    transportRoute: .axSetSelectedRows,
                    dispatchPrimitive: "AXUIElementSetAttributeValue(AXSelectedRows)",
                    notes: ["Using native collection selection through AXSelectedRows on the row container."]
                )
            }
            if AXActionRuntimeSupport.isAttributeSettable(row, attribute: kAXSelectedAttribute as CFString) {
                return SemanticPlan(
                    attempt: .setRowSelectedTrue,
                    dispatches: true,
                    dispatchElement: row,
                    containerElement: nil,
                    actionName: nil,
                    transportRoute: .axSetSelected,
                    dispatchPrimitive: "AXUIElementSetAttributeValue(kAXSelectedAttribute)",
                    notes: ["Using row AXSelected=true because no AXSelectedRows container was available."]
                )
            }
        }

        let descendant = safeUniqueDescendantRetarget(target: target, liveElement: liveElement)
        if let descendant {
            return SemanticPlan(
                attempt: .safeUniqueDescendantRetarget,
                dispatches: true,
                dispatchElement: descendant,
                containerElement: nil,
                actionName: kAXPressAction as String,
                transportRoute: .axPerformAction,
                dispatchPrimitive: "AXUIElementPerformAction(kAXPressAction)",
                notes: ["Retargeted wrapper to one safe actionable descendant."]
            )
        }

        if ambiguousActionableDescendantCount(liveElement) > 1 {
            return SemanticPlan(
                attempt: .ambiguousDescendantClick,
                dispatches: false,
                dispatchElement: nil,
                containerElement: nil,
                actionName: nil,
                transportRoute: .axPerformAction,
                dispatchPrimitive: "none",
                notes: ["Rejected semantic descendant retargeting because multiple actionable descendants were present."]
            )
        }

        if targetHasUsablePoint(target, window: nil) {
            return SemanticPlan(
                attempt: .coordinateRequired,
                dispatches: false,
                dispatchElement: nil,
                containerElement: nil,
                actionName: nil,
                transportRoute: .nativeBackgroundCoordinate,
                dispatchPrimitive: "none",
                notes: ["Returning coordinate_required rather than using app-specific, secondary, menu, or default-action fallback."]
            )
        }

        return SemanticPlan(
            attempt: .unsupportedPrimaryClick,
            dispatches: false,
            dispatchElement: nil,
            containerElement: nil,
            actionName: nil,
            transportRoute: .axPerformAction,
            dispatchPrimitive: "none",
            notes: ["No generic primary AX click strategy applies."]
        )
    }

    private func dispatchSemanticPlan(_ plan: SemanticPlan) -> (success: Bool, rawStatus: String, notes: [String]) {
        switch plan.attempt {
        case .exactPrimaryAXAction, .safeUniqueDescendantRetarget:
            guard let actionName = plan.actionName, let element = plan.dispatchElement else {
                return (false, "missing_dispatch_target", ["Missing AX action or dispatch element."])
            }
            let result = AXActionRuntimeSupport.performAction(actionName, on: element)
            return (
                result == .success,
                AXActionRuntimeSupport.rawStatusString(for: result),
                ["AXUIElementPerformAction(\(actionName)) returned \(AXActionRuntimeSupport.rawStatusString(for: result))."]
            )

        case .setContainerSelectedRows:
            guard let row = plan.dispatchElement, let container = plan.containerElement else {
                return (false, "missing_dispatch_target", ["Missing row/container for AXSelectedRows."])
            }
            let rows = [row] as CFArray
            let result = AXUIElementSetAttributeValue(container, "AXSelectedRows" as CFString, rows)
            return (
                result == .success,
                AXActionRuntimeSupport.rawStatusString(for: result),
                ["AXUIElementSetAttributeValue(container, AXSelectedRows=[targetRow]) returned \(AXActionRuntimeSupport.rawStatusString(for: result))."]
            )

        case .setRowSelectedTrue:
            guard let row = plan.dispatchElement else {
                return (false, "missing_dispatch_target", ["Missing row for AXSelected=true."])
            }
            let result = AXUIElementSetAttributeValue(row, kAXSelectedAttribute as CFString, kCFBooleanTrue)
            return (
                result == .success,
                AXActionRuntimeSupport.rawStatusString(for: result),
                ["AXUIElementSetAttributeValue(row, AXSelected=true) returned \(AXActionRuntimeSupport.rawStatusString(for: result))."]
            )

        case .ambiguousDescendantClick, .coordinateRequired, .unsupportedPrimaryClick, .none:
            return (false, "not_dispatched", ["Semantic AX planner produced \(plan.attempt.rawValue); no AX mutation was sent."])
        }
    }

    private func exactPrimaryAction(for element: AXUIElement) -> String? {
        let actions = Set(AXActionRuntimeSupport.actionNames(element))
        let role = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXRoleAttribute as CFString)
        let enabled = AXActionRuntimeSupport.boolAttribute(element, attribute: kAXEnabledAttribute as CFString)
        if enabled == false {
            return nil
        }
        if actions.contains(kAXPressAction as String), isExactPressRole(role) {
            return kAXPressAction as String
        }
        if actions.contains(kAXPickAction as String), ["AXPopUpButton", "AXMenuButton"].contains(role ?? "") {
            return kAXPickAction as String
        }
        return nil
    }

    private func isExactPressRole(_ role: String?) -> Bool {
        [
            "AXButton",
            "AXLink",
            "AXCheckBox",
            "AXRadioButton",
            "AXPopUpButton",
            "AXDisclosureTriangle",
            "AXSlider",
            "AXSwitch",
        ].contains(role ?? "")
    }

    private func rowElement(startingAt element: AXUIElement) -> AXUIElement? {
        for candidate in AXActionRuntimeSupport.walkAncestors(startingAt: element, maxDepth: 8) {
            let role = AXActionRuntimeSupport.stringAttribute(candidate, attribute: kAXRoleAttribute as CFString)
            let subrole = AXActionRuntimeSupport.stringAttribute(candidate, attribute: kAXSubroleAttribute as CFString)
            if ["AXRow", "AXOutlineRow", "AXTableRow"].contains(role ?? "") ||
                ["AXOutlineRow", "AXTableRow"].contains(subrole ?? "") {
                return candidate
            }
        }
        return nil
    }

    private func isInsideWebArea(_ element: AXUIElement) -> Bool {
        AXActionRuntimeSupport.walkAncestors(startingAt: element, maxDepth: 12).contains { candidate in
            AXActionRuntimeSupport.stringAttribute(candidate, attribute: kAXRoleAttribute as CFString) == "AXWebArea"
        }
    }

    private func selectableRowsContainer(for row: AXUIElement) -> AXUIElement? {
        for candidate in AXActionRuntimeSupport.walkAncestors(startingAt: row, maxDepth: 10).dropFirst() {
            let role = AXActionRuntimeSupport.stringAttribute(candidate, attribute: kAXRoleAttribute as CFString)
            if ["AXOutline", "AXTable", "AXList", "AXBrowser"].contains(role ?? ""),
               AXActionRuntimeSupport.isAttributeSettable(candidate, attribute: "AXSelectedRows" as CFString) {
                return candidate
            }
        }
        return nil
    }

    private func safeUniqueDescendantRetarget(
        target: AXActionTargetSnapshot,
        liveElement: AXUIElement
    ) -> AXUIElement? {
        guard isSafeDescendantRetargetContainer(liveElement) else {
            return nil
        }
        let actionable = actionableDescendants(liveElement)
        guard actionable.isEmpty == false else {
            return nil
        }

        let targetLabels = [
            target.title,
            target.description,
            target.projectedValuePreview,
            target.url,
        ]
        .compactMap { normalizeText($0) }
        .filter { $0.isEmpty == false }

        let matching = actionable.filter { element in
            let label = normalizeText(label(for: element))
            guard label.isEmpty == false else {
                return false
            }
            return targetLabels.contains { targetLabel in
                targetLabel.contains(label) || label.contains(targetLabel)
            }
        }
        if matching.count == 1 {
            return matching[0]
        }
        if actionable.count == 1, matching.isEmpty, targetLabels.isEmpty == false {
            return nil
        }
        return actionable.count == 1 ? actionable[0] : nil
    }

    private func ambiguousActionableDescendantCount(_ element: AXUIElement) -> Int {
        actionableDescendants(element).count
    }

    private func actionableDescendants(_ element: AXUIElement) -> [AXUIElement] {
        var results: [AXUIElement] = []
        var queue = AXActionRuntimeSupport.childElements(element).map { ($0, 1) }
        while queue.isEmpty == false {
            let (candidate, depth) = queue.removeFirst()
            let role = AXActionRuntimeSupport.stringAttribute(candidate, attribute: kAXRoleAttribute as CFString)
            let actions = AXActionRuntimeSupport.actionNames(candidate)
            let enabled = AXActionRuntimeSupport.boolAttribute(candidate, attribute: kAXEnabledAttribute as CFString)
            if actions.contains(kAXPressAction as String),
               ["AXLink", "AXButton", "AXCheckBox", "AXRadioButton", "AXGroup"].contains(role ?? ""),
               enabled != false {
                results.append(candidate)
            }
            if depth < 5 {
                queue.append(contentsOf: AXActionRuntimeSupport.childElements(candidate).map { ($0, depth + 1) })
            }
        }
        return results
    }

    private func isSafeDescendantRetargetContainer(_ element: AXUIElement) -> Bool {
        let role = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXRoleAttribute as CFString)
        guard ["AXGroup", "AXRow", "AXOutlineRow", "AXTableRow"].contains(role ?? "") else {
            return false
        }
        guard let frame = AXActionRuntimeSupport.rectAttribute(element, attribute: "AXFrame" as CFString) else {
            return false
        }
        let area = max(frame.width, 0) * max(frame.height, 0)
        return frame.width > 1 && frame.height > 1 && area <= 500_000 && frame.width <= 1_200 && frame.height <= 320
    }

    private func label(for element: AXUIElement) -> String {
        [
            AXActionRuntimeSupport.stringAttribute(element, attribute: kAXTitleAttribute as CFString),
            AXActionRuntimeSupport.stringAttribute(element, attribute: kAXValueAttribute as CFString),
            AXActionRuntimeSupport.stringAttribute(element, attribute: kAXDescriptionAttribute as CFString),
            AXActionRuntimeSupport.stringAttribute(element, attribute: kAXHelpAttribute as CFString),
        ]
        .compactMap { $0 }
        .joined(separator: " ")
    }

    private func verifyClick(
        before: AXActionStateCapture,
        after: AXActionStateCapture?,
        target: AXActionTargetSnapshot?,
        refreshedTarget: AXActionTargetSnapshot?,
        refreshedTargetStrategy: String?,
        foregroundBeforeDispatch: String?,
        foregroundAfter: String?,
        extraNotes: [String]
    ) -> ClickVerificationEvidenceDTO {
        let renderedTextChanged: Bool?
        let selectionSummaryChanged: Bool?
        let focusedElementChanged: Bool?
        let windowTitleChanged: Bool?
        if let after {
            renderedTextChanged = self.renderedTextChanged(before: before, after: after)
            selectionSummaryChanged = self.selectionSummaryChanged(before: before, after: after)
            focusedElementChanged = self.focusedElementChanged(before: before, after: after)
            windowTitleChanged = before.envelope.response.window.title != after.envelope.response.window.title
        } else {
            renderedTextChanged = nil
            selectionSummaryChanged = nil
            focusedElementChanged = nil
            windowTitleChanged = nil
        }
        let beforeSelected = target?.isSelected
        let afterSelected = refreshedTarget?.isSelected
        let beforeFocused = target?.isFocused
        let afterFocused = refreshedTarget?.isFocused
        let beforeValue = target?.projectedValuePreview
        let afterValue = refreshedTarget?.projectedValuePreview
        let targetStateChanged =
            target == nil ? nil :
            beforeSelected != afterSelected ||
            beforeFocused != afterFocused ||
            beforeValue != afterValue
        var verificationNotes = extraNotes
        if after == nil {
            verificationNotes.append("No post-click state was available for verification.")
        }
        if renderedTextChanged == true {
            verificationNotes.append("Rendered text changed after click.")
        }
        if selectionSummaryChanged == true {
            verificationNotes.append("Selection summary changed after click.")
        }
        if focusedElementChanged == true {
            verificationNotes.append("Focused element changed after click.")
        }
        if targetStateChanged == true {
            verificationNotes.append("Target selected/focused/value evidence changed after click.")
        }
        if foregroundBeforeDispatch != foregroundAfter {
            verificationNotes.append("Foreground changed from \(foregroundBeforeDispatch ?? "nil") to \(foregroundAfter ?? "nil").")
        }

        return ClickVerificationEvidenceDTO(
            preStateToken: before.envelope.response.stateToken,
            postStateToken: after?.envelope.response.stateToken,
            targetRelocated: refreshedTarget != nil,
            refreshedTargetMatchStrategy: refreshedTargetStrategy,
            beforeTargetSelected: beforeSelected,
            afterTargetSelected: afterSelected,
            beforeTargetFocused: beforeFocused,
            afterTargetFocused: afterFocused,
            beforeTargetValuePreview: beforeValue,
            afterTargetValuePreview: afterValue,
            beforeFocusedNodeID: before.envelope.response.selectionSummary?.focusedNodeID,
            afterFocusedNodeID: after?.envelope.response.selectionSummary?.focusedNodeID,
            renderedTextChanged: renderedTextChanged,
            selectionSummaryChanged: selectionSummaryChanged,
            focusedElementChanged: focusedElementChanged,
            windowTitleChanged: windowTitleChanged,
            targetStateChanged: targetStateChanged,
            foregroundPreserved: foregroundBeforeDispatch == nil || foregroundAfter == nil
                ? nil
                : foregroundBeforeDispatch == foregroundAfter,
            verificationNotes: verificationNotes
        )
    }

    private func semanticVerified(
        plan: SemanticPlan,
        dispatchSuccess: Bool,
        verification: ClickVerificationEvidenceDTO
    ) -> Bool {
        guard dispatchSuccess else {
            return false
        }
        switch plan.attempt {
        case .setContainerSelectedRows, .setRowSelectedTrue:
            return verification.afterTargetSelected == true ||
                verification.selectionSummaryChanged == true ||
                verification.targetStateChanged == true
        case .exactPrimaryAXAction, .safeUniqueDescendantRetarget:
            return effectVerified(verification)
        case .ambiguousDescendantClick, .coordinateRequired, .unsupportedPrimaryClick, .none:
            return false
        }
    }

    private func effectVerified(_ verification: ClickVerificationEvidenceDTO?) -> Bool {
        guard let verification else {
            return false
        }
        return verification.renderedTextChanged == true ||
            verification.selectionSummaryChanged == true ||
            verification.focusedElementChanged == true ||
            verification.windowTitleChanged == true ||
            verification.targetStateChanged == true
    }

    private func coordinatePlan(
        for target: AXActionTargetSnapshot,
        window: ResolvedWindowDTO
    ) -> ClickCoordinatePlan? {
        let resolved = AXCursorTargeting.targetPoint(for: target, window: window)
        guard let point = resolved.point else {
            return nil
        }
        return coordinatePlan(
            appKitPoint: point,
            window: window,
            source: resolved.source ?? "element_target_point",
            warnings: resolved.warnings
        )
    }

    private func coordinatePlan(
        x: Double,
        y: Double,
        modelSize: PixelSize,
        window: ResolvedWindowDTO,
        source: String
    ) -> ClickCoordinatePlan? {
        guard x.isFinite, y.isFinite,
              modelSize.width > 0, modelSize.height > 0,
              x >= -0.5, y >= -0.5,
              x <= Double(modelSize.width) + 0.5,
              y <= Double(modelSize.height) + 0.5 else {
            return nil
        }
        let frame = rect(from: window.frameAppKit).standardized
        guard frame.width > 0, frame.height > 0 else {
            return nil
        }
        let scaleX = Double(modelSize.width) / frame.width
        let scaleY = Double(modelSize.height) / frame.height
        let appKitPoint = CGPoint(
            x: frame.minX + (x / scaleX),
            y: frame.maxY - (y / scaleY)
        )
        return coordinatePlan(
            appKitPoint: appKitPoint,
            window: window,
            source: source,
            warnings: []
        )
    }

    private func coordinatePlan(
        appKitPoint: CGPoint,
        window: ResolvedWindowDTO,
        source: String,
        warnings: [String]
    ) -> ClickCoordinatePlan? {
        let frame = rect(from: window.frameAppKit).standardized
        guard frame.width > 0, frame.height > 0 else {
            return nil
        }
        let modelSize = modelPixelSize(for: window)
        let scale = Scale2D(
            x: Double(modelSize.width) / frame.width,
            y: Double(modelSize.height) / frame.height
        )
        let modelPoint = CGPoint(
            x: (appKitPoint.x - frame.minX) * scale.x,
            y: (frame.maxY - appKitPoint.y) * scale.y
        )
        let eventTapPoint = CGPoint(
            x: appKitPoint.x,
            y: DesktopGeometry.desktopTop() - appKitPoint.y
        )
        let mapping = ClickCoordinateMappingDTO(
            inputPoint: PointDTO(x: modelPoint.x, y: modelPoint.y),
            inputCoordinateSpace: .modelFacingScreenshot,
            modelPixelSize: modelSize,
            scaleToWindowLogical: scale,
            targetPointAppKit: PointDTO(x: appKitPoint.x, y: appKitPoint.y),
            eventTapPointTopLeft: PointDTO(x: eventTapPoint.x, y: eventTapPoint.y),
            targetPointSource: source,
            warnings: warnings
        )
        return ClickCoordinatePlan(
            mapping: mapping,
            appKitPoint: appKitPoint,
            eventTapPointTopLeft: eventTapPoint
        )
    }

    private func targetHasUsablePoint(_ target: AXActionTargetSnapshot, window: ResolvedWindowDTO?) -> Bool {
        guard let window else {
            return target.suggestedInteractionPointAppKit != nil ||
                target.activationPointAppKit != nil ||
                target.frameAppKit != nil
        }
        return AXCursorTargeting.targetPoint(for: target, window: window).point != nil
    }

    private func modelPixelSize(for response: AXPipelineV2Response) -> PixelSize {
        if let size = response.screenshot.coordinateContract?.modelFacingScreenshot.pixelSize {
            return size
        }
        return modelPixelSize(for: response.window)
    }

    private func modelPixelSize(for window: ResolvedWindowDTO) -> PixelSize {
        let fitRule = ScreenshotFitRule()
        return fitRule.predictedModelSize(
            for: GlobalEventTapTopLeftRect(
                x: window.frameAppKit.x,
                y: window.frameAppKit.y,
                width: window.frameAppKit.width,
                height: window.frameAppKit.height
            )
        )
    }

    private func normalizedTargetClickCount(_ request: ClickRequest) -> Int? {
        try? normalizedClickCount(request)
    }

    private func suppliedStateTokenIsStale(supplied: String?, live: String) -> Bool {
        guard let supplied,
              supplied.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return false
        }
        return supplied != live
    }

    private func normalizedClickCount(_ request: ClickRequest) throws -> Int {
        let modeCount = explicitClickCount(from: request.mode)
        if let clickCount = request.clickCount {
            guard clickCount == 1 || clickCount == 2 else {
                throw ClickClickCountError.invalid("clickCount must be 1 or 2.")
            }
            if let modeCount, modeCount != clickCount {
                throw ClickClickCountError.invalid("mode and clickCount disagree; supply one explicit click-count control.")
            }
            return clickCount
        }
        if let modeCount {
            return modeCount
        }
        return 1
    }

    private func explicitClickCount(from mode: ClickModeDTO?) -> Int? {
        switch mode {
        case .single:
            return 1
        case .double:
            return 2
        case nil:
            return nil
        }
    }

    private func invalidClickCountResponse(
        request: ClickRequest,
        capture: AXActionStateCapture,
        requestedTarget: ClickRequestedTargetDTO,
        mouseButton: MouseButtonDTO,
        frontmostBefore: String?,
        warnings: [String],
        notes: [String],
        summary: String
    ) -> ClickResponse {
        response(
            classification: .unsupported,
            failureDomain: .unsupported,
            summary: summary,
            window: capture.envelope.response.window,
            requestedTarget: requestedTarget,
            target: nil,
            clickCount: request.clickCount,
            mouseButton: mouseButton,
            finalRoute: .rejected,
            fallbackReason: .invalidClickCount,
            axAttempt: nil,
            coordinate: nil,
            transports: [],
            routeSteps: [rejectedStep(summary)],
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: nil,
            cursor: AXCursorTargeting.notAttempted(
                requested: request.cursor,
                reason: "Cursor movement was not attempted because the request click count was invalid.",
                    options: executionOptions
            ),
            frontmostBundleBefore: frontmostBefore,
            frontmostBundleBeforeDispatch: nil,
            frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
            warnings: warnings,
            notes: notes,
            verification: nil
        )
    }

    private func requestedTargetDTO(_ request: ClickRequest) -> ClickRequestedTargetDTO {
        if let target = request.target {
            return ClickRequestedTargetDTO(
                kind: .semanticTarget,
                target: target,
                x: nil,
                y: nil,
                coordinateSpace: nil
            )
        }
        return ClickRequestedTargetDTO(
            kind: .coordinate,
            target: nil,
            x: request.x.map(sanitizedJSONDouble),
            y: request.y.map(sanitizedJSONDouble),
            coordinateSpace: request.x != nil || request.y != nil ? .modelFacingScreenshot : nil
        )
    }

    private func semanticResponse(
        _ semantic: ClickSemanticOutcome,
        request: ClickRequest,
        capture: AXActionStateCapture,
        target: AXActionTargetSnapshot,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        frontmostBefore: String?
    ) -> ClickResponse {
        response(
            classification: semantic.classification,
            failureDomain: semantic.failureDomain,
            summary: semantic.summary,
            window: semantic.postCapture?.envelope.response.window ?? capture.envelope.response.window,
            requestedTarget: requestedTargetDTO(request),
            target: target,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: .semanticAX,
            fallbackReason: .none,
            axAttempt: semantic.axAttempt,
            coordinate: nil,
            transports: semantic.transport.map { [$0] } ?? [],
            routeSteps: semanticStep(semantic),
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: semantic.postCapture?.envelope.response.stateToken,
            cursor: semantic.cursor,
            frontmostBundleBefore: frontmostBefore,
            frontmostBundleBeforeDispatch: semantic.frontmostBundleBeforeDispatch,
            frontmostBundleAfter: semantic.frontmostBundleAfter,
            warnings: semantic.warnings,
            notes: semantic.notes,
            verification: semantic.verification
        )
    }

    private func coordinateFallbackResponse(
        _ fallback: ClickCoordinateOutcome,
        semantic: ClickSemanticOutcome,
        request: ClickRequest,
        capture: AXActionStateCapture,
        target: AXActionTargetSnapshot,
        clickCount: Int,
        mouseButton: MouseButtonDTO,
        frontmostBefore: String?
    ) -> ClickResponse {
        response(
            classification: fallback.classification,
            failureDomain: fallback.failureDomain,
            summary: fallback.summary,
            window: fallback.postCapture?.envelope.response.window ??
                semantic.postCapture?.envelope.response.window ??
                capture.envelope.response.window,
            requestedTarget: requestedTargetDTO(request),
            target: target,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: fallback.finalRoute,
            fallbackReason: fallback.fallbackReason,
            axAttempt: semantic.axAttempt,
            coordinate: fallback.coordinate,
            transports: fallback.transports,
            routeSteps: fallback.routeSteps,
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: fallback.postCapture?.envelope.response.stateToken ??
                semantic.postCapture?.envelope.response.stateToken,
            cursor: fallback.cursor,
            frontmostBundleBefore: frontmostBefore,
            frontmostBundleBeforeDispatch: fallback.frontmostBundleBeforeDispatch ??
                semantic.frontmostBundleBeforeDispatch,
            frontmostBundleAfter: fallback.frontmostBundleAfter ?? semantic.frontmostBundleAfter,
            warnings: fallback.warnings,
            notes: fallback.notes,
            verification: fallback.verification ?? semantic.verification
        )
    }

    private func response(
        classification: ActionClassificationDTO,
        failureDomain: ActionFailureDomainDTO?,
        summary: String,
        window: ResolvedWindowDTO?,
        requestedTarget: ClickRequestedTargetDTO,
        target: AXActionTargetSnapshot?,
        clickCount: Int?,
        mouseButton: MouseButtonDTO?,
        finalRoute: ClickFinalRouteDTO,
        fallbackReason: ClickFallbackReasonDTO,
        axAttempt: ClickAXAttemptDTO?,
        coordinate: ClickCoordinateMappingDTO?,
        transports: [ClickTransportAttemptDTO],
        routeSteps: [ClickRouteStepDTO],
        preStateToken: String?,
        postStateToken: String?,
        cursor: ActionCursorTargetResponseDTO,
        frontmostBundleBefore: String?,
        frontmostBundleBeforeDispatch: String?,
        frontmostBundleAfter: String?,
        warnings: [String],
        notes: [String],
        verification: ClickVerificationEvidenceDTO?
    ) -> ClickResponse {
        ClickResponse(
            contractVersion: ContractVersion.current,
            ok: classification == .success,
            classification: classification,
            failureDomain: failureDomain,
            summary: summary,
            window: window,
            requestedTarget: requestedTarget,
            target: target?.dto,
            clickCount: clickCount,
            mouseButton: mouseButton,
            finalRoute: finalRoute,
            fallbackReason: fallbackReason,
            axAttempt: axAttempt,
            coordinate: coordinate,
            transports: transports,
            routeSteps: routeSteps,
            preStateToken: preStateToken,
            postStateToken: postStateToken,
            cursor: cursor,
            frontmostBundleBefore: frontmostBundleBefore,
            frontmostBundleBeforeDispatch: frontmostBundleBeforeDispatch,
            frontmostBundleAfter: frontmostBundleAfter,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func semanticStep(_ semantic: ClickSemanticOutcome) -> [ClickRouteStepDTO] {
        [
            ClickRouteStepDTO(
                route: .semanticAX,
                dispatchSuccess: semantic.dispatchSuccess,
                verificationSuccess: semantic.verificationSuccess,
                intentSuccess: semantic.intentSuccess,
                note: "semantic AX attempt \(semantic.axAttempt.rawValue)"
            )
        ]
    }

    private func rejectedStep(_ note: String) -> ClickRouteStepDTO {
        ClickRouteStepDTO(
            route: .rejected,
            dispatchSuccess: false,
            verificationSuccess: false,
            intentSuccess: false,
            note: note
        )
    }

    private func renderedTextChanged(before: AXActionStateCapture, after: AXActionStateCapture) -> Bool {
        normalizeText(before.envelope.response.tree.renderedText) != normalizeText(after.envelope.response.tree.renderedText)
    }

    private func selectionSummaryChanged(before: AXActionStateCapture, after: AXActionStateCapture) -> Bool {
        before.envelope.response.selectionSummary?.focusedNodeID != after.envelope.response.selectionSummary?.focusedNodeID ||
            before.envelope.response.selectionSummary?.selectedText != after.envelope.response.selectionSummary?.selectedText ||
            before.envelope.response.selectionSummary?.selectedTextSource != after.envelope.response.selectionSummary?.selectedTextSource ||
            before.envelope.response.selectionSummary?.selectedCanonicalIndices != after.envelope.response.selectionSummary?.selectedCanonicalIndices ||
            before.envelope.response.selectionSummary?.selectedNodeIDs != after.envelope.response.selectionSummary?.selectedNodeIDs
    }

    private func focusedElementChanged(before: AXActionStateCapture, after: AXActionStateCapture) -> Bool {
        before.envelope.response.focusedElement.index != after.envelope.response.focusedElement.index ||
            before.envelope.response.focusedElement.title != after.envelope.response.focusedElement.title ||
            before.envelope.response.focusedElement.description != after.envelope.response.focusedElement.description ||
            before.envelope.response.focusedElement.displayRole != after.envelope.response.focusedElement.displayRole
    }

    private func normalizeText(_ text: String?) -> String {
        (text ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    private func rect(from dto: RectDTO) -> CGRect {
        CGRect(x: dto.x, y: dto.y, width: dto.width, height: dto.height)
    }
}

private enum ClickClickCountError: Error, CustomStringConvertible {
    case invalid(String)

    var description: String {
        switch self {
        case .invalid(let message):
            return message
        }
    }
}
