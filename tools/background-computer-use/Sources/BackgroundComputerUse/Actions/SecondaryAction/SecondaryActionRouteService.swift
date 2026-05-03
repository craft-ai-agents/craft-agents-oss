import AppKit
import ApplicationServices
import Foundation

private struct SecondaryActionResolvedBinding {
    let actionID: String?
    let label: String
    let source: SecondaryActionBindingSourceDTO
    let rawName: String
    let dispatchCanonicalIndex: Int
    let risk: String?
    let exposure: String?
    let executionDisposition: String?
    let evidence: [String]
}

private struct SecondaryActionExternalFileOpenEvidence: Equatable {
    let appName: String
    let bundleID: String?
    let pid: pid_t
    let windowTitle: String?
    let matchedAttribute: String
    let matchedText: String

    var summary: String {
        let app = bundleID.map { "\(appName) (\($0))" } ?? appName
        if let windowTitle, windowTitle.isEmpty == false {
            return "\(app) window '\(windowTitle)' via \(matchedAttribute)"
        }
        return "\(app) via \(matchedAttribute)"
    }
}

struct SecondaryActionRouteService {
    private let executionOptions: ActionExecutionOptions
    private let targetResolver: AXActionTargetResolver
    private let settleDelay: TimeInterval = 0.35

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        targetResolver = AXActionTargetResolver(executionOptions: executionOptions)
    }

    func performSecondaryAction(request: PerformSecondaryActionRequest) throws -> PerformSecondaryActionResponse {
        let capture = try targetResolver.capture(
            windowID: request.window,
            includeMenuBar: request.includeMenuBar ?? true,
            menuPathComponents: request.menuPath ?? [],
            webTraversal: request.webTraversal ?? .visible,
            maxNodes: request.maxNodes ?? 6500
        )
        let requested = SecondaryActionRequestedDTO(
            target: request.target,
            label: request.action,
            actionID: request.actionID
        )
        var warnings = targetResolver.stateTokenWarnings(
            suppliedStateToken: request.stateToken,
            liveStateToken: capture.envelope.response.stateToken
        )
        let notes = [
            "perform_secondary_action dispatches only labels present in the projected public secondaryActions array.",
            "Dispatch uses AXUIElementPerformAction against the bound AX source. It does not use LaunchServices, shell open, typed keys, primary click, or file-open fallbacks."
        ]

        guard let surfaceNode = targetResolver.resolveSurfaceNode(
            target: request.target,
            in: capture
        ) else {
            let failureSummary = targetResolver.targetResolutionFailureDescription(
                for: request.target,
                in: capture
            )
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: failureSummary,
                window: capture.envelope.response.window,
                requestedAction: requested,
                action: nil,
                outcome: outcome(
                    status: .targetUnresolved,
                    reason: .liveTargetUnresolved,
                    detail: failureSummary
                ),
                target: nil,
                dispatchTarget: nil,
                binding: nil,
                transports: [],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                postState: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the secondary-action target was not resolved.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let target = targetResolver.targetSnapshot(
            for: surfaceNode,
            in: capture
        )

        let actionExposed =
            surfaceNode.secondaryActions.contains(request.action) ||
            surfaceNode.secondaryActionBindings?.contains(where: {
                $0.actionID == request.actionID && $0.label == request.action && $0.modelVisible
            }) == true
        guard actionExposed else {
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: "The projected node does not expose secondary action '\(request.action)' in the current state.",
                window: capture.envelope.response.window,
                requestedAction: requested,
                action: nil,
                outcome: outcome(
                    status: .labelNotExposed,
                    reason: .labelNotExposed,
                    detail: "The exact public secondary-action label was not exposed on the target in the current state."
                ),
                target: target,
                dispatchTarget: nil,
                binding: nil,
                transports: [],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                postState: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the requested action label is not exposed on the target.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        guard let binding = resolveBinding(
            request: request,
            surfaceNode: surfaceNode,
            capture: capture
        ) else {
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: "The projected label '\(request.action)' is exposed, but no AX dispatch binding was found in the captured state.",
                window: capture.envelope.response.window,
                requestedAction: requested,
                action: nil,
                outcome: outcome(
                    status: .bindingUnavailable,
                    reason: .bindingNotFound,
                    detail: "The label was exposed, but the route could not resolve a dispatchable AX binding from the captured state."
                ),
                target: target,
                dispatchTarget: nil,
                binding: nil,
                transports: [],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                postState: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the secondary-action binding was not dispatchable.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        guard let dispatchTarget = targetResolver.targetSnapshot(
            forRawCanonicalIndex: binding.dispatchCanonicalIndex,
            in: capture
        ) else {
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: "The secondary-action binding pointed at raw canonical index \(binding.dispatchCanonicalIndex), but that node was not present.",
                window: capture.envelope.response.window,
                requestedAction: requested,
                action: nil,
                outcome: outcome(
                    status: .targetUnresolved,
                    reason: .dispatchTargetNotFound,
                    detail: "The captured binding pointed at raw canonical index \(binding.dispatchCanonicalIndex), but the dispatch target was not present."
                ),
                target: target,
                dispatchTarget: nil,
                binding: bindingDTO(binding, capture: capture),
                transports: [],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                postState: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the dispatch target was not resolved.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let liveElement: AXActionResolvedLiveElement
        do {
            liveElement = try targetResolver.resolveLiveElement(
                forRawCanonicalIndex: binding.dispatchCanonicalIndex,
                in: capture
            )
        } catch {
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: String(describing: error),
                window: capture.envelope.response.window,
                requestedAction: requested,
                action: nil,
                outcome: outcome(
                    status: .targetUnresolved,
                    reason: .liveTargetUnresolved,
                    detail: "The live AX dispatch target could not be resolved: \(error)."
                ),
                target: target,
                dispatchTarget: dispatchTarget,
                binding: bindingDTO(binding, capture: capture),
                transports: [],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                postState: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the live AX dispatch target could not be resolved.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let externalFileOpenTargetURL = isOpenRepresentedResourceLabel(request.action)
            ? representedRegularFileURL(target: target, dispatchTarget: dispatchTarget, beforeNode: surfaceNode)
            : nil
        let externalFileOpenBefore = externalFileOpenTargetURL.map {
            externalFileOpenEvidence(
                for: $0,
                excludingPID: capture.envelope.response.window.pid
            )
        } ?? []

        let cursor = AXCursorTargeting.prepareSecondaryAction(
            requested: request.cursor,
            target: target,
            window: capture.envelope.response.window,
            options: executionOptions
        )
        warnings.append(contentsOf: cursor.warnings)

        let axResult = AXActionRuntimeSupport.performAction(binding.rawName, on: liveElement.element)
        let rawStatus = AXActionRuntimeSupport.rawStatusString(for: axResult)
        AXCursorTargeting.finishSecondaryAction(cursor: cursor)
        sleepRunLoop(settleDelay)

        let postCapture: AXActionStateCapture?
        do {
            postCapture = try targetResolver.reread(after: capture, imageMode: request.imageMode ?? .omit)
        } catch {
            postCapture = nil
            warnings.append("Post-action reread failed: \(error).")
        }

        let externalFileOpenAfter = externalFileOpenTargetURL.map {
            waitForExternalFileOpenEvidence(
                for: $0,
                excludingPID: capture.envelope.response.window.pid,
                before: externalFileOpenBefore
            )
        } ?? []

        let verification = verify(
            label: request.action,
            target: target,
            dispatchTarget: dispatchTarget,
            beforeNode: surfaceNode,
            capture: capture,
            postCapture: postCapture,
            externalFileOpenTargetURL: externalFileOpenTargetURL,
            externalFileOpenBefore: externalFileOpenBefore,
            externalFileOpenAfter: externalFileOpenAfter
        )
        let transport = SecondaryActionTransportAttemptDTO(
            dispatchMethod: .axPerformAction,
            rawName: binding.rawName,
            rawAXStatus: rawStatus,
            transportDisposition: axResult == .success ? .accepted : .returnedError,
            transportSuccess: axResult == .success,
            liveElementResolution: liveElement.resolution,
            notes: binding.evidence
        )
        let publicBinding = bindingDTO(binding, capture: capture)

        return classifyResult(
            requestedAction: requested,
            window: capture.envelope.response.window,
            target: target,
            dispatchTarget: dispatchTarget,
            binding: binding,
            bindingDTO: publicBinding,
            transport: transport,
            axResult: axResult,
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: postCapture?.envelope.response.stateToken,
            postState: postCapture?.envelope.response,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func classifyResult(
        requestedAction: SecondaryActionRequestedDTO,
        window: ResolvedWindowDTO,
        target: AXActionTargetSnapshot,
        dispatchTarget: AXActionTargetSnapshot,
        binding: SecondaryActionResolvedBinding,
        bindingDTO: SecondaryActionBindingDTO,
        transport: SecondaryActionTransportAttemptDTO,
        axResult: AXError,
        preStateToken: String,
        postStateToken: String?,
        postState: AXPipelineV2Response?,
        cursor: ActionCursorTargetResponseDTO,
        warnings: [String],
        notes: [String],
        verification: SecondaryActionVerificationDTO
    ) -> PerformSecondaryActionResponse {
        var responseWarnings = warnings
        let action = actionDTO(
            requestedAction: requestedAction,
            binding: binding,
            transport: transport
        )

        if verification.observedEffect {
            if axResult != .success {
                responseWarnings.append("AX returned \(transport.rawAXStatus), but post-state verification observed the requested effect.")
            }
            return response(
                classification: .success,
                failureDomain: nil,
                summary: "The secondary action '\(requestedAction.label)' produced the expected post-state effect.",
                window: window,
                requestedAction: requestedAction,
                action: action,
                outcome: outcome(
                    status: .effectVerified,
                    reason: .expectedEffectObserved,
                    detail: "Post-state verification observed the requested secondary-action effect.",
                    screenshotRecommended: false
                ),
                target: target,
                dispatchTarget: dispatchTarget,
                binding: bindingDTO,
                transports: [transport],
                preStateToken: preStateToken,
                postStateToken: postStateToken,
                postState: postState,
                cursor: cursor,
                warnings: responseWarnings,
                notes: notes,
                verification: verification
            )
        }

        if axResult == .success {
            return response(
                classification: .success,
                failureDomain: nil,
                summary: "The secondary action '\(requestedAction.label)' was accepted by AX. No stronger effect-specific verifier was available.",
                window: window,
                requestedAction: requestedAction,
                action: action,
                outcome: outcome(
                    status: .acceptedWithoutVerifier,
                    reason: .axAcceptedNoVerifier,
                    detail: "AX accepted the dispatch, but no effect-specific verifier proved the visible outcome. Review the returned post-state or request a screenshot when visual state matters."
                ),
                target: target,
                dispatchTarget: dispatchTarget,
                binding: bindingDTO,
                transports: [transport],
                preStateToken: preStateToken,
                postStateToken: postStateToken,
                postState: postState,
                cursor: cursor,
                warnings: warnings,
                notes: notes,
                verification: verification
            )
        }

        if axResult == .attributeUnsupported || axResult == .actionUnsupported {
            return response(
                classification: .effectNotVerified,
                failureDomain: .transport,
                summary: "The action was attempted with AX action '\(binding.rawName)', AX returned \(transport.rawAXStatus), and no verified effect was observed. Review the returned post-state or request a screenshot to inspect the visible UI state.",
                window: window,
                requestedAction: requestedAction,
                action: action,
                outcome: outcome(
                    status: .noEffectVerified,
                    reason: .rawTransportErrorNoEffect,
                    detail: "The bound AX action returned \(transport.rawAXStatus), and post-state verification did not observe the requested effect."
                ),
                target: target,
                dispatchTarget: dispatchTarget,
                binding: bindingDTO,
                transports: [transport],
                preStateToken: preStateToken,
                postStateToken: postStateToken,
                postState: postState,
                cursor: cursor,
                warnings: warnings,
                notes: notes,
                verification: verification
            )
        }

        return response(
            classification: .effectNotVerified,
            failureDomain: .transport,
            summary: "The action was attempted with AX action '\(binding.rawName)', AX returned \(transport.rawAXStatus), and no verified effect was observed. Review the returned post-state or request a screenshot to inspect the visible UI state.",
            window: window,
            requestedAction: requestedAction,
            action: action,
            outcome: outcome(
                status: .noEffectVerified,
                reason: .rawTransportErrorNoEffect,
                detail: "The bound AX action returned \(transport.rawAXStatus), and post-state verification did not observe the requested effect."
            ),
            target: target,
            dispatchTarget: dispatchTarget,
            binding: bindingDTO,
            transports: [transport],
            preStateToken: preStateToken,
            postStateToken: postStateToken,
            postState: postState,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func actionDTO(
        requestedAction: SecondaryActionRequestedDTO,
        binding: SecondaryActionResolvedBinding,
        transport: SecondaryActionTransportAttemptDTO
    ) -> SecondaryActionActionDTO {
        SecondaryActionActionDTO(
            semanticKind: semanticKind(for: requestedAction.label),
            route: route(for: binding.source),
            dispatchPrimitive: "AXUIElementPerformAction(\(binding.rawName))",
            dispatchSucceeded: transport.transportSuccess,
            rawAXStatus: transport.rawAXStatus,
            detail: "Dispatched public secondary-action label '\(requestedAction.label)' through AX action '\(binding.rawName)' using \(route(for: binding.source).rawValue)."
        )
    }

    private func route(for source: SecondaryActionBindingSourceDTO) -> SecondaryActionRouteDTO {
        switch source {
        case .directPublicAction:
            return .directPublicAction
        case .foldedAffordance:
            return .foldedAffordance
        case .inferredAffordance:
            return .inferredAffordance
        case .stateBinding:
            return .stateBinding
        }
    }

    private func semanticKind(for label: String) -> SecondaryActionSemanticKindDTO {
        if expectedAfterAction(for: label) != nil {
            return .stateToggle
        }
        if label == "Cancel" {
            return .cancel
        }
        if label == "close tab" {
            return .close
        }
        if isOpenRepresentedResourceLabel(label) || label.lowercased().contains("open") {
            return .openRepresentedResource
        }
        return .genericAXAction
    }

    private func outcome(
        status: SecondaryActionOutcomeStatusDTO,
        reason: SecondaryActionOutcomeReasonDTO,
        detail: String,
        screenshotRecommended: Bool = true
    ) -> SecondaryActionOutcomeDTO {
        SecondaryActionOutcomeDTO(
            status: status,
            reason: reason,
            detail: detail,
            screenshotRecommended: screenshotRecommended
        )
    }

    private func response(
        classification: ActionClassificationDTO,
        failureDomain: ActionFailureDomainDTO?,
        summary: String,
        window: ResolvedWindowDTO?,
        requestedAction: SecondaryActionRequestedDTO,
        action: SecondaryActionActionDTO?,
        outcome: SecondaryActionOutcomeDTO,
        target: AXActionTargetSnapshot?,
        dispatchTarget: AXActionTargetSnapshot?,
        binding: SecondaryActionBindingDTO?,
        transports: [SecondaryActionTransportAttemptDTO],
        preStateToken: String?,
        postStateToken: String?,
        postState: AXPipelineV2Response?,
        cursor: ActionCursorTargetResponseDTO,
        warnings: [String],
        notes: [String],
        verification: SecondaryActionVerificationDTO?
    ) -> PerformSecondaryActionResponse {
        PerformSecondaryActionResponse(
            contractVersion: ContractVersion.current,
            ok: classification == .success,
            classification: classification,
            failureDomain: failureDomain,
            summary: summary,
            window: window,
            requestedAction: requestedAction,
            action: action,
            outcome: outcome,
            target: target?.dto,
            dispatchTarget: dispatchTarget?.dto,
            binding: binding,
            transports: transports,
            preStateToken: preStateToken,
            postStateToken: postStateToken,
            postState: postState,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func resolveBinding(
        request: PerformSecondaryActionRequest,
        surfaceNode: AXPipelineV2SurfaceNodeDTO,
        capture: AXActionStateCapture
    ) -> SecondaryActionResolvedBinding? {
        if let actionID = request.actionID {
            guard let descriptor = surfaceNode.secondaryActionBindings?.first(where: { $0.actionID == actionID }),
                  descriptor.label == request.action,
                  descriptor.modelVisible,
                  descriptor.canDispatch,
                  descriptor.dispatchMethod == "AXPerformAction",
                  let rawName = descriptor.rawName else {
                return nil
            }
            return SecondaryActionResolvedBinding(
                actionID: descriptor.actionID,
                label: descriptor.label,
                source: .stateBinding,
                rawName: rawName,
                dispatchCanonicalIndex: descriptor.dispatchTarget?.sourceCanonicalIndex ?? descriptor.target.primaryCanonicalIndex ?? surfaceNode.primaryCanonicalIndex,
                risk: descriptor.risk,
                exposure: descriptor.exposure,
                executionDisposition: descriptor.executionDisposition,
                evidence: descriptor.evidence.notes + ["Resolved by production secondaryActionBindings actionID."]
            )
        }

        let label = request.action
        if let descriptor = surfaceNode.secondaryActionBindings?.first(where: {
            $0.label == label && $0.modelVisible && $0.canDispatch && $0.dispatchMethod == "AXPerformAction" && $0.rawName != nil
        }) {
            return SecondaryActionResolvedBinding(
                actionID: descriptor.actionID,
                label: descriptor.label,
                source: .stateBinding,
                rawName: descriptor.rawName!,
                dispatchCanonicalIndex: descriptor.dispatchTarget?.sourceCanonicalIndex ?? descriptor.target.primaryCanonicalIndex ?? surfaceNode.primaryCanonicalIndex,
                risk: descriptor.risk,
                exposure: descriptor.exposure,
                executionDisposition: descriptor.executionDisposition,
                evidence: descriptor.evidence.notes + ["Resolved by production secondaryActionBindings label match."]
            )
        }

        if let rawAction = publicRawAction(label: label, on: rawNode(surfaceNode.primaryCanonicalIndex, capture: capture)) {
            return SecondaryActionResolvedBinding(
                actionID: nil,
                label: label,
                source: .directPublicAction,
                rawName: rawAction,
                dispatchCanonicalIndex: surfaceNode.primaryCanonicalIndex,
                risk: nil,
                exposure: nil,
                executionDisposition: nil,
                evidence: ["Matched public AX action label on the projected node's primary raw source."]
            )
        }

        for affordance in surfaceNode.affordances ?? [] {
            guard let binding = bindingForAffordance(label: label, affordance: affordance, capture: capture) else {
                continue
            }
            return binding
        }

        return nil
    }

    private func bindingForAffordance(
        label: String,
        affordance: AXAffordanceDTO,
        capture: AXActionStateCapture
    ) -> SecondaryActionResolvedBinding? {
        switch label {
        case "Expand", "Collapse":
            guard affordance.kind == "disclosure_state",
                  affordance.label == label || disclosureLabel(for: affordance.value) == label else {
                return nil
            }
            let rawActionEvidence = rawAction(
                forCanonicalIndex: affordance.sourceCanonicalIndex,
                preferred: ["AXPress"],
                capture: capture
            )
            let rawName = rawActionEvidence ?? (affordance.sourceRole == "AXDisclosureTriangle" ? "AXPress" : nil)
            guard let rawName else {
                return nil
            }
            return SecondaryActionResolvedBinding(
                actionID: nil,
                label: label,
                source: rawActionEvidence == nil ? .inferredAffordance : .foldedAffordance,
                rawName: rawName,
                dispatchCanonicalIndex: affordance.sourceCanonicalIndex,
                risk: nil,
                exposure: nil,
                executionDisposition: nil,
                evidence: [
                    "Mapped \(label) to disclosure-state source \(affordance.sourceNodeID ?? String(affordance.sourceCanonicalIndex)).",
                    "Dispatch is AX-only and uses \(rawName)."
                ]
            )

        case "Open Finder item":
            guard affordance.kind == "represented_url",
                  (affordance.value ?? affordance.sourceURL ?? "").lowercased().hasPrefix("file://") else {
                return nil
            }
            let rawActionEvidence = rawAction(
                forCanonicalIndex: affordance.sourceCanonicalIndex,
                preferred: ["AXOpen"],
                capture: capture
            )
            let rawName = rawActionEvidence ?? "AXOpen"
            return SecondaryActionResolvedBinding(
                actionID: nil,
                label: label,
                source: rawActionEvidence == nil ? .inferredAffordance : .foldedAffordance,
                rawName: rawName,
                dispatchCanonicalIndex: affordance.sourceCanonicalIndex,
                risk: nil,
                exposure: nil,
                executionDisposition: nil,
                evidence: [
                    "Mapped Open Finder item to represented file URL source \(affordance.sourceNodeID ?? String(affordance.sourceCanonicalIndex)).",
                    "No LaunchServices, shell open, click, keypress, or AXConfirm fallback is used."
                ]
            )

        default:
            guard let rawName = affordance.rawAction,
                  affordance.label == label || rawActionLabel(rawName) == label else {
                return nil
            }
            return SecondaryActionResolvedBinding(
                actionID: nil,
                label: label,
                source: .foldedAffordance,
                rawName: rawName,
                dispatchCanonicalIndex: affordance.sourceCanonicalIndex,
                risk: nil,
                exposure: nil,
                executionDisposition: nil,
                evidence: ["Mapped public label \(label) to folded raw AX action \(rawName)."]
            )
        }
    }

    private func verify(
        label: String,
        target: AXActionTargetSnapshot,
        dispatchTarget: AXActionTargetSnapshot,
        beforeNode: AXPipelineV2SurfaceNodeDTO,
        capture: AXActionStateCapture,
        postCapture: AXActionStateCapture?,
        externalFileOpenTargetURL: URL?,
        externalFileOpenBefore: [SecondaryActionExternalFileOpenEvidence],
        externalFileOpenAfter: [SecondaryActionExternalFileOpenEvidence]
    ) -> SecondaryActionVerificationDTO {
        let refreshed = postCapture.map {
            targetResolver.locateRefreshedTarget(in: $0, prior: target, kind: .secondaryAction)
        }
        let refreshedTarget = refreshed?.target
        let refreshedNode = refreshedTarget.flatMap { target in
            postCapture?.envelope.response.tree.nodes.first {
                $0.projectedIndex == target.projectedIndex || $0.nodeID == target.nodeID
            }
        }
        let expectedAfter = expectedAfterAction(for: label)
        let beforeRendered = normalizeRenderedText(capture.envelope.response.tree.renderedText)
        let afterRendered = postCapture.map { normalizeRenderedText($0.envelope.response.tree.renderedText) }
        let renderedChanged = afterRendered.map { $0 != beforeRendered }
        let menuVisibleBefore = capture.envelope.menuPresentation?.isOpenMenuLikelyVisible
        let menuVisibleAfter = postCapture?.envelope.menuPresentation?.isOpenMenuLikelyVisible

        var evidence: [String] = []
        var observedEffect = false

        if let expectedAfter, refreshedNode?.secondaryActions.contains(expectedAfter) == true {
            observedEffect = true
            evidence.append("Refreshed target exposes expected follow-up action \(expectedAfter).")
        }
        if label == "Cancel", menuVisibleBefore == true, menuVisibleAfter != true {
            observedEffect = true
            evidence.append("Active menu was visible before dispatch and not visible after reread.")
        }
        if label == "close tab", refreshedTarget == nil, renderedChanged == true {
            observedEffect = true
            evidence.append("The tab target disappeared from the refreshed projection and rendered state changed.")
        }
        if isOpenRepresentedResourceLabel(label),
           let directory = representedDirectoryURL(target: target, dispatchTarget: dispatchTarget, beforeNode: beforeNode),
           let postWindowTitle = postCapture?.envelope.response.window.title,
           normalizeRenderedText(postWindowTitle) == normalizeRenderedText(directory.lastPathComponent),
           normalizeRenderedText(postWindowTitle) != normalizeRenderedText(capture.envelope.response.window.title),
           renderedChanged == true {
            observedEffect = true
            evidence.append("The represented directory opened; the post-state window title changed to \(postWindowTitle).")
        }
        if isOpenRepresentedResourceLabel(label), let externalFileOpenTargetURL {
            if externalFileOpenBefore.isEmpty, let firstAfter = externalFileOpenAfter.first {
                observedEffect = true
                evidence.append("The represented file \(externalFileOpenTargetURL.lastPathComponent) became visible/open outside the source app in \(firstAfter.summary).")
            } else if externalFileOpenBefore.isEmpty == false {
                evidence.append("The represented file \(externalFileOpenTargetURL.lastPathComponent) already appeared open outside the source app before dispatch; the external-file verifier did not claim a new effect.")
            } else {
                evidence.append("No external app window/document evidence appeared for represented file \(externalFileOpenTargetURL.lastPathComponent).")
            }
        }
        if renderedChanged == true, expectedAfter != nil {
            evidence.append("Rendered tree text changed after the secondary action.")
        }
        if refreshedTarget == nil {
            evidence.append("Target was not confidently relocated in the refreshed projection.")
        }
        if evidence.isEmpty {
            evidence.append("No effect-specific verifier fired for this secondary action label.")
        }

        return SecondaryActionVerificationDTO(
            beforeTargetSecondaryActions: beforeNode.secondaryActions,
            afterTargetSecondaryActions: refreshedNode?.secondaryActions,
            expectedAfterSecondaryAction: expectedAfter,
            targetRelocated: refreshedTarget != nil,
            refreshedTargetMatchStrategy: refreshed?.strategy,
            renderedTextChanged: renderedChanged,
            menuVisibleBefore: menuVisibleBefore,
            menuVisibleAfter: menuVisibleAfter,
            observedEffect: observedEffect,
            evidence: evidence
        )
    }

    private func isOpenRepresentedResourceLabel(_ label: String) -> Bool {
        label == "Open Finder item" || label == "open"
    }

    private func representedRegularFileURL(
        target: AXActionTargetSnapshot,
        dispatchTarget: AXActionTargetSnapshot,
        beforeNode: AXPipelineV2SurfaceNodeDTO
    ) -> URL? {
        for url in representedFileURLCandidates(target: target, dispatchTarget: dispatchTarget, beforeNode: beforeNode) {
            var isDirectory = ObjCBool(false)
            guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory),
                  isDirectory.boolValue == false else {
                continue
            }
            return url
        }
        return nil
    }

    private func representedDirectoryURL(
        target: AXActionTargetSnapshot,
        dispatchTarget: AXActionTargetSnapshot,
        beforeNode: AXPipelineV2SurfaceNodeDTO
    ) -> URL? {
        for url in representedFileURLCandidates(target: target, dispatchTarget: dispatchTarget, beforeNode: beforeNode) {
            var isDirectory = ObjCBool(false)
            if FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) {
                if isDirectory.boolValue {
                    return url
                }
                continue
            }
            if url.absoluteString.hasSuffix("/") {
                return url
            }
        }
        return nil
    }

    private func representedFileURLCandidates(
        target: AXActionTargetSnapshot,
        dispatchTarget: AXActionTargetSnapshot,
        beforeNode: AXPipelineV2SurfaceNodeDTO
    ) -> [URL] {
        let candidates = [
            dispatchTarget.url,
            target.url,
            beforeNode.affordances?.first(where: { $0.kind == "represented_url" })?.sourceURL,
            beforeNode.affordances?.first(where: { $0.kind == "represented_url" })?.value
        ].compactMap { $0 }

        var urls: [URL] = []
        var seen = Set<String>()
        for candidate in candidates {
            guard let url = fileURL(from: candidate) else {
                continue
            }
            let key = url.standardizedFileURL.path
            if seen.insert(key).inserted {
                urls.append(url.standardizedFileURL)
            }
        }
        return urls
    }

    private func fileURL(from raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.isEmpty == false else {
            return nil
        }
        if let url = URL(string: trimmed), url.isFileURL {
            return url
        }
        if trimmed.hasPrefix("/") {
            return URL(fileURLWithPath: trimmed)
        }
        return nil
    }

    private func waitForExternalFileOpenEvidence(
        for fileURL: URL,
        excludingPID: Int32,
        before: [SecondaryActionExternalFileOpenEvidence]
    ) -> [SecondaryActionExternalFileOpenEvidence] {
        if before.isEmpty == false {
            return externalFileOpenEvidence(for: fileURL, excludingPID: excludingPID)
        }

        let deadline = Date().addingTimeInterval(1.5)
        var latest: [SecondaryActionExternalFileOpenEvidence] = []
        repeat {
            latest = externalFileOpenEvidence(for: fileURL, excludingPID: excludingPID)
            if latest.isEmpty == false {
                return latest
            }
            sleepRunLoop(0.10)
        } while Date() < deadline
        return latest
    }

    private func externalFileOpenEvidence(
        for fileURL: URL,
        excludingPID: Int32
    ) -> [SecondaryActionExternalFileOpenEvidence] {
        let targetURL = fileURL.standardizedFileURL
        var evidence: [SecondaryActionExternalFileOpenEvidence] = []
        var seen = Set<String>()

        for app in NSWorkspace.shared.runningApplications {
            guard app.isFinishedLaunching,
                  app.activationPolicy == .regular,
                  app.processIdentifier != excludingPID,
                  app.bundleIdentifier != "com.apple.finder" else {
                continue
            }

            let appElement = AXUIElementCreateApplication(app.processIdentifier)
            AXUIElementSetMessagingTimeout(appElement, 0.15)
            let windows = AXActionRuntimeSupport.elementArrayAttribute(appElement, attribute: kAXWindowsAttribute as CFString)
            for window in windows.prefix(12) {
                guard let match = externalFileOpenEvidence(
                    in: window,
                    app: app,
                    fileURL: targetURL
                ) else {
                    continue
                }
                let key = "\(match.pid)|\(match.windowTitle ?? "")|\(match.matchedAttribute)|\(match.matchedText)"
                if seen.insert(key).inserted {
                    evidence.append(match)
                }
                if evidence.count >= 4 {
                    return evidence
                }
            }
        }
        return evidence
    }

    private func externalFileOpenEvidence(
        in window: AXUIElement,
        app: NSRunningApplication,
        fileURL: URL
    ) -> SecondaryActionExternalFileOpenEvidence? {
        let appName = app.localizedName ?? app.bundleIdentifier ?? "pid \(app.processIdentifier)"
        let windowTitle = AXActionRuntimeSupport.stringAttribute(window, attribute: kAXTitleAttribute as CFString)
        if let windowTitle, windowTitleMatchesFileName(windowTitle, fileURL: fileURL) {
            return SecondaryActionExternalFileOpenEvidence(
                appName: appName,
                bundleID: app.bundleIdentifier,
                pid: app.processIdentifier,
                windowTitle: windowTitle,
                matchedAttribute: "AXTitle",
                matchedText: windowTitle
            )
        }

        if let match = exactFileReferenceMatch(in: window, fileURL: fileURL) {
            return SecondaryActionExternalFileOpenEvidence(
                appName: appName,
                bundleID: app.bundleIdentifier,
                pid: app.processIdentifier,
                windowTitle: windowTitle,
                matchedAttribute: match.attribute,
                matchedText: match.value
            )
        }
        return nil
    }

    private func exactFileReferenceMatch(in element: AXUIElement, fileURL: URL) -> (attribute: String, value: String)? {
        let attributes: [(String, CFString)] = [
            ("AXDocument", kAXDocumentAttribute as CFString),
            ("AXURL", kAXURLAttribute as CFString),
            ("AXFilename", "AXFilename" as CFString)
        ]
        for (name, attribute) in attributes {
            guard let value = AXActionRuntimeSupport.stringAttribute(element, attribute: attribute),
                  fileReference(value, matches: fileURL) else {
                continue
            }
            return (name, value)
        }
        return nil
    }

    private func fileReference(_ raw: String, matches fileURL: URL) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let target = fileURL.standardizedFileURL
        if trimmed == target.path || trimmed == target.absoluteString {
            return true
        }
        if let url = URL(string: trimmed), url.isFileURL {
            return url.standardizedFileURL.path == target.path
        }
        if trimmed.hasPrefix("/") {
            return URL(fileURLWithPath: trimmed).standardizedFileURL.path == target.path
        }
        return false
    }

    private func windowTitleMatchesFileName(_ title: String, fileURL: URL) -> Bool {
        let normalizedTitle = normalizeRenderedText(title)
        let normalizedName = normalizeRenderedText(fileURL.lastPathComponent)
        guard normalizedTitle.isEmpty == false, normalizedName.isEmpty == false else {
            return false
        }
        if normalizedTitle == normalizedName {
            return true
        }
        return [" ", "-", "|", "(", "["].contains { normalizedTitle.hasPrefix(normalizedName + $0) }
    }

    private func bindingDTO(
        _ binding: SecondaryActionResolvedBinding,
        capture: AXActionStateCapture?
    ) -> SecondaryActionBindingDTO {
        let rawNode = capture.flatMap { self.rawNode(binding.dispatchCanonicalIndex, capture: $0) }
        return SecondaryActionBindingDTO(
            actionID: binding.actionID,
            label: binding.label,
            source: binding.source,
            dispatchMethod: .axPerformAction,
            rawName: binding.rawName,
            dispatchCanonicalIndex: binding.dispatchCanonicalIndex,
            dispatchNodeID: rawNode?.identity?.nodeID,
            dispatchRole: rawNode?.role,
            dispatchSubrole: rawNode?.subrole,
            dispatchTitle: rawNode?.title ?? rawNode?.value.preview,
            dispatchURL: rawNode?.url,
            risk: binding.risk,
            exposure: binding.exposure,
            executionDisposition: binding.executionDisposition,
            evidence: binding.evidence
        )
    }

    private func publicRawAction(label: String, on rawNode: AXRawNodeDTO?) -> String? {
        rawNode?.availableActions?.first {
            $0.label == label && $0.hiddenFromSecondaryActions == false
        }?.rawName
    }

    private func rawAction(
        forCanonicalIndex canonicalIndex: Int,
        preferred: [String],
        capture: AXActionStateCapture
    ) -> String? {
        let actionNames = rawNode(canonicalIndex, capture: capture)?.availableActions?.map(\.rawName) ?? []
        for candidate in preferred where actionNames.contains(candidate) {
            return candidate
        }
        return nil
    }

    private func rawNode(_ canonicalIndex: Int, capture: AXActionStateCapture) -> AXRawNodeDTO? {
        capture.envelope.rawCapture.nodes[safe: canonicalIndex]
    }

    private func disclosureLabel(for value: String?) -> String? {
        switch value {
        case "collapsed":
            return "Expand"
        case "expanded":
            return "Collapse"
        default:
            return nil
        }
    }

    private func expectedAfterAction(for label: String) -> String? {
        switch label {
        case "Expand":
            return "Collapse"
        case "Collapse":
            return "Expand"
        default:
            return nil
        }
    }

    private func rawActionLabel(_ action: String) -> String? {
        switch action {
        case "AXShowDefaultUI":
            return "Show Default UI"
        case "AXShowAlternateUI":
            return "Show Alternate UI"
        case "AXCancel":
            return "Cancel"
        default:
            return ProjectionTextSupport.actionLabel(action)
        }
    }

    private func normalizeRenderedText(_ renderedText: String) -> String {
        renderedText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else {
            return nil
        }
        return self[index]
    }
}
