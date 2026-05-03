import ApplicationServices
import Foundation

struct SetValueRouteService {
    private let executionOptions: ActionExecutionOptions
    private let targetResolver: AXActionTargetResolver
    private let writePrimitive = "AXUIElementSetAttributeValue(kAXValueAttribute)"
    private let settleDelay: TimeInterval = 0.35

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        targetResolver = AXActionTargetResolver(executionOptions: executionOptions)
    }

    func setValue(request: SetValueRequest) throws -> SetValueResponse {
        let capture = try targetResolver.capture(
            windowID: request.window,
            includeMenuBar: request.includeMenuBar ?? true,
            maxNodes: request.maxNodes ?? 6500
        )
        var warnings = targetResolver.stateTokenWarnings(
            suppliedStateToken: request.stateToken,
            liveStateToken: capture.envelope.response.stateToken
        )
        var notes: [String] = []

        guard let candidate = targetResolver.resolveTarget(
            request.target,
            in: capture,
            kind: .setValue
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
                target: nil,
                requestedValue: SetValueRequestedValueDTO(
                    original: request.value,
                    coercedKind: nil,
                    coercedPreview: nil
                ),
                rawAXStatus: nil,
                writePrimitive: nil,
                semanticAppropriate: nil,
                semanticReasons: [],
                liveElementResolution: nil,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the action target was not resolved.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let target = candidate.target
        let semantic = targetResolver.semanticSuitability(for: target, kind: .setValue)

        guard target.isValueSettable == true || target.supportsValueSet == true else {
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: "The projected node is not value-settable in the current state pipeline output.",
                window: capture.envelope.response.window,
                target: target,
                requestedValue: SetValueRequestedValueDTO(
                    original: request.value,
                    coercedKind: nil,
                    coercedPreview: nil
                ),
                rawAXStatus: nil,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: nil,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because set_value rejected the target as unsupported.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        guard semantic.appropriate else {
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: "The node is value-settable, but it does not look like a semantic replacement surface for set_value.",
                window: capture.envelope.response.window,
                target: target,
                requestedValue: SetValueRequestedValueDTO(
                    original: request.value,
                    coercedKind: nil,
                    coercedPreview: nil
                ),
                rawAXStatus: nil,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: nil,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because set_value rejected the target as semantically unsupported.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let liveElement: AXActionResolvedLiveElement
        do {
            liveElement = try targetResolver.resolveLiveElement(for: target, in: capture)
        } catch {
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: String(describing: error),
                window: capture.envelope.response.window,
                target: target,
                requestedValue: SetValueRequestedValueDTO(
                    original: request.value,
                    coercedKind: nil,
                    coercedPreview: nil
                ),
                rawAXStatus: nil,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: nil,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the live AX element could not be resolved.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }
        let beforeLiveValue = AXActionRuntimeSupport.readValueEvidence(liveElement.element)

        guard AXActionRuntimeSupport.isAttributeSettable(liveElement.element, attribute: kAXValueAttribute as CFString) else {
            warnings.append("The projected node was settable, but the live AX element rejected a direct settable check.")
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: "The live AX element does not currently report kAXValueAttribute as settable.",
                window: capture.envelope.response.window,
                target: target,
                requestedValue: SetValueRequestedValueDTO(
                    original: request.value,
                    coercedKind: nil,
                    coercedPreview: nil
                ),
                rawAXStatus: nil,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: liveElement.resolution,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the live AX value attribute was not settable.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let targetKind = effectiveTargetKind(for: target) ?? beforeLiveValue?.kind
        let coercedValue: AXActionCoercedValue
        do {
            coercedValue = try AXActionCoercedValue.coerce(requested: request.value, targetKind: targetKind)
        } catch {
            return response(
                classification: .unsupported,
                failureDomain: .coercion,
                summary: String(describing: error),
                window: capture.envelope.response.window,
                target: target,
                requestedValue: SetValueRequestedValueDTO(
                    original: request.value,
                    coercedKind: nil,
                    coercedPreview: nil
                ),
                rawAXStatus: nil,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: liveElement.resolution,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because value coercion failed.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        let cursor = AXCursorTargeting.prepareSetValue(
            requested: request.cursor,
            target: target,
            window: capture.envelope.response.window,
            options: executionOptions
        )
        warnings.append(contentsOf: cursor.warnings)

        let axResult = AXActionRuntimeSupport.setValue(coercedValue, on: liveElement.element)
        let rawStatus = AXActionRuntimeSupport.rawStatusString(for: axResult)
        AXCursorTargeting.finishSetValue(cursor: cursor)

        sleepRunLoop(settleDelay)

        let afterSameElementValue = AXActionRuntimeSupport.readValueEvidence(liveElement.element)
        let postCapture: AXActionStateCapture?
        do {
            postCapture = try targetResolver.reread(after: capture)
        } catch {
            postCapture = nil
            notes.append("Post-write reread failed: \(error).")
        }

        let refreshedTargetResult = postCapture.flatMap {
            targetResolver.locateRefreshedTarget(in: $0, prior: target, kind: .setValue)
        }
        let refreshedTarget = refreshedTargetResult?.target
        let refreshedTargetStrategy = refreshedTargetResult?.strategy

        var afterResolvedLiveValue: SetValueObservedValueDTO?
        if let postCapture, let refreshedTarget,
           let resolved = try? targetResolver.resolveLiveElement(for: refreshedTarget, in: postCapture) {
            afterResolvedLiveValue = AXActionRuntimeSupport.readValueEvidence(resolved.element)
        }

        let afterProjectedValue = projectedValueEvidence(from: refreshedTarget)
        let exactMatchSource = exactMatchSource(
            coercedValue: coercedValue,
            afterSameElementValue: afterSameElementValue,
            afterResolvedLiveValue: afterResolvedLiveValue,
            afterProjectedValue: afterProjectedValue
        )
        let renderedTextChanged = postCapture.map {
            normalizeRenderedText($0.envelope.response.tree.renderedText) != normalizeRenderedText(capture.envelope.response.tree.renderedText)
        } ?? false
        let renderedTextChangedBeyondValue = postCapture.map {
            renderedTextChangedBeyondTargetValue(
                before: capture.envelope.response.tree.renderedText,
                after: $0.envelope.response.tree.renderedText,
                beforeValue: beforeLiveValue?.stringValue ?? target.projectedValuePreview,
                afterValue: request.value
            )
        } ?? false

        let verification = SetValueVerificationEvidenceDTO(
            beforeLiveValue: beforeLiveValue,
            afterSameElementValue: afterSameElementValue,
            afterResolvedLiveValue: afterResolvedLiveValue,
            afterProjectedValue: afterProjectedValue,
            exactValueMatch: exactMatchSource != nil,
            exactValueMatchSource: exactMatchSource,
            targetRelocated: refreshedTarget != nil,
            refreshedTargetMatchStrategy: refreshedTargetStrategy,
            beforeFocusedNodeID: capture.envelope.response.selectionSummary?.focusedNodeID,
            afterFocusedNodeID: postCapture?.envelope.response.selectionSummary?.focusedNodeID,
            beforeTargetFocused: target.isFocused,
            afterTargetFocused: refreshedTarget?.isFocused,
            beforeTargetSelected: target.isSelected,
            afterTargetSelected: refreshedTarget?.isSelected,
            renderedTextChanged: renderedTextChanged,
            renderedTextChangedBeyondTargetValue: renderedTextChangedBeyondValue,
            verificationNotes: buildVerificationNotes(
                target: target,
                refreshedTarget: refreshedTarget,
                axStatus: rawStatus
            )
        )

        if verification.exactValueMatch, axResult != .success {
            warnings.append("AX returned \(rawStatus), but the verified value matched the request after reread.")
        }

        return classifyResult(
            request: request,
            window: capture.envelope.response.window,
            target: target,
            semantic: semantic,
            liveElementResolution: liveElement.resolution,
            coercedValue: coercedValue,
            rawAXStatus: rawStatus,
            axResult: axResult,
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: postCapture?.envelope.response.stateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func classifyResult(
        request: SetValueRequest,
        window: ResolvedWindowDTO,
        target: AXActionTargetSnapshot,
        semantic: (appropriate: Bool, reasons: [String]),
        liveElementResolution: String,
        coercedValue: AXActionCoercedValue,
        rawAXStatus: String,
        axResult: AXError,
        preStateToken: String,
        postStateToken: String?,
        cursor: ActionCursorTargetResponseDTO,
        warnings: [String],
        notes: [String],
        verification: SetValueVerificationEvidenceDTO
    ) -> SetValueResponse {
        let requested = SetValueRequestedValueDTO(
            original: request.value,
            coercedKind: coercedValue.kind,
            coercedPreview: coercedValue.preview
        )

        if verification.exactValueMatch {
            return response(
                classification: .success,
                failureDomain: nil,
                summary: "The direct AX value write matched the requested value after reread.",
                window: window,
                target: target,
                requestedValue: requested,
                rawAXStatus: rawAXStatus,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: liveElementResolution,
                preStateToken: preStateToken,
                postStateToken: postStateToken,
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
                summary: "The value write was attempted, AX returned \(rawAXStatus), and reread verification did not match the requested value.",
                window: window,
                target: target,
                requestedValue: requested,
                rawAXStatus: rawAXStatus,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: liveElementResolution,
                preStateToken: preStateToken,
                postStateToken: postStateToken,
                cursor: cursor,
                warnings: warnings,
                notes: notes,
                verification: verification
            )
        }

        if verification.targetRelocated == false || postStateToken == nil {
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .verification,
                summary: "The write was attempted, but the route could not confidently relocate the target on reread.",
                window: window,
                target: target,
                requestedValue: requested,
                rawAXStatus: rawAXStatus,
                writePrimitive: writePrimitive,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: liveElementResolution,
                preStateToken: preStateToken,
                postStateToken: postStateToken,
                cursor: cursor,
                warnings: warnings,
                notes: notes,
                verification: verification
            )
        }

        return response(
            classification: .effectNotVerified,
            failureDomain: .verification,
            summary: "The write was attempted, but the refreshed state did not match the requested value.",
            window: window,
            target: target,
            requestedValue: requested,
            rawAXStatus: rawAXStatus,
            writePrimitive: writePrimitive,
            semanticAppropriate: semantic.appropriate,
            semanticReasons: semantic.reasons,
            liveElementResolution: liveElementResolution,
            preStateToken: preStateToken,
            postStateToken: postStateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func response(
        classification: ActionClassificationDTO,
        failureDomain: ActionFailureDomainDTO?,
        summary: String,
        window: ResolvedWindowDTO?,
        target: AXActionTargetSnapshot?,
        requestedValue: SetValueRequestedValueDTO,
        rawAXStatus: String?,
        writePrimitive: String?,
        semanticAppropriate: Bool?,
        semanticReasons: [String],
        liveElementResolution: String?,
        preStateToken: String?,
        postStateToken: String?,
        cursor: ActionCursorTargetResponseDTO,
        warnings: [String],
        notes: [String],
        verification: SetValueVerificationEvidenceDTO?
    ) -> SetValueResponse {
        SetValueResponse(
            contractVersion: ContractVersion.current,
            ok: classification == .success,
            classification: classification,
            failureDomain: failureDomain,
            summary: summary,
            window: window,
            target: target?.dto,
            requestedValue: requestedValue,
            rawAXStatus: rawAXStatus,
            writePrimitive: writePrimitive,
            semanticAppropriate: semanticAppropriate,
            semanticReasons: semanticReasons,
            liveElementResolution: liveElementResolution,
            preStateToken: preStateToken,
            postStateToken: postStateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func effectiveTargetKind(for target: AXActionTargetSnapshot) -> String? {
        if let kind = target.projectedValueKind {
            return kind
        }
        if target.isTextEntry == true {
            return "string"
        }
        return nil
    }

    private func projectedValueEvidence(from target: AXActionTargetSnapshot?) -> SetValueObservedValueDTO? {
        guard let target else {
            return nil
        }

        switch target.projectedValueKind {
        case "string":
            return SetValueObservedValueDTO(
                kind: "string",
                preview: target.projectedValuePreview,
                stringValue: target.projectedValuePreview?.replacingOccurrences(of: "\\n", with: "\n"),
                boolValue: nil,
                integerValue: nil,
                doubleValue: nil,
                truncated: target.projectedValueTruncated
            )
        case "boolean":
            let normalized = target.projectedValuePreview?.lowercased()
            let boolValue = normalized == "on" || normalized == "true" || normalized == "1"
            return SetValueObservedValueDTO(
                kind: "boolean",
                preview: target.projectedValuePreview,
                stringValue: nil,
                boolValue: boolValue,
                integerValue: nil,
                doubleValue: nil,
                truncated: target.projectedValueTruncated
            )
        case "integer":
            return SetValueObservedValueDTO(
                kind: "integer",
                preview: target.projectedValuePreview,
                stringValue: nil,
                boolValue: nil,
                integerValue: target.projectedValuePreview.flatMap(Int.init),
                doubleValue: target.projectedValuePreview.flatMap(Double.init),
                truncated: target.projectedValueTruncated
            )
        case "float":
            return SetValueObservedValueDTO(
                kind: "float",
                preview: target.projectedValuePreview,
                stringValue: nil,
                boolValue: nil,
                integerValue: nil,
                doubleValue: target.projectedValuePreview.flatMap(Double.init),
                truncated: target.projectedValueTruncated
            )
        default:
            return nil
        }
    }

    private func exactMatchSource(
        coercedValue: AXActionCoercedValue,
        afterSameElementValue: SetValueObservedValueDTO?,
        afterResolvedLiveValue: SetValueObservedValueDTO?,
        afterProjectedValue: SetValueObservedValueDTO?
    ) -> String? {
        if coercedValue.matches(afterResolvedLiveValue) {
            return "refreshed_live_element"
        }
        if coercedValue.matches(afterSameElementValue) {
            return "same_live_element"
        }
        if coercedValue.matches(afterProjectedValue), afterProjectedValue?.truncated == false {
            return "refreshed_projected_target"
        }
        return nil
    }

    private func renderedTextChangedBeyondTargetValue(
        before: String,
        after: String,
        beforeValue: String?,
        afterValue: String?
    ) -> Bool {
        let scrubbedBefore = scrubRenderedText(before, targetValue: beforeValue)
        let scrubbedAfter = scrubRenderedText(after, targetValue: afterValue)
        return normalizeRenderedText(scrubbedBefore) != normalizeRenderedText(scrubbedAfter)
    }

    private func scrubRenderedText(_ renderedText: String, targetValue: String?) -> String {
        guard let targetValue, targetValue.isEmpty == false else {
            return renderedText
        }
        return renderedText.replacingOccurrences(of: targetValue, with: "<target-value>")
    }

    private func normalizeRenderedText(_ renderedText: String) -> String {
        renderedText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    private func buildVerificationNotes(
        target: AXActionTargetSnapshot,
        refreshedTarget: AXActionTargetSnapshot?,
        axStatus: String
    ) -> [String] {
        var notes = [
            "Initial projected value kind: \(target.projectedValueKind ?? "unknown").",
            "Initial projected settable flag: \(String(describing: target.isValueSettable)).",
            "AX write status: \(axStatus).",
        ]
        if let refreshedTarget {
            notes.append("Refreshed target matched via \(refreshedTarget.displayRole) / \(refreshedTarget.identifier ?? refreshedTarget.title ?? "unnamed").")
        } else {
            notes.append("The target was not confidently relocated in the refreshed projection.")
        }
        return notes
    }
}
