import ApplicationServices
import Foundation

struct TypeTextRouteService {
    private let executionOptions: ActionExecutionOptions
    private let targetResolver: AXActionTargetResolver
    private let dispatchPrimitive = "CGEvent.keyboardSetUnicodeString + postToPid"
    private let elementValueDispatchPrimitive = "AXUIElementSetAttributeValue(kAXValueAttribute) + AXUIElementSetAttributeValue(kAXSelectedTextRangeAttribute)"
    private let settleDelay: TimeInterval = 0.35

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        targetResolver = AXActionTargetResolver(executionOptions: executionOptions)
    }

    func typeText(request: TypeTextRequest) throws -> TypeTextResponse {
        let focusAssistMode = request.focusAssistMode ?? .none
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

        let candidate: AXActionCandidate?
        if let target = request.target {
            candidate = targetResolver.resolveTarget(
                target,
                in: capture,
                kind: .typeText
            )
        } else {
            candidate = targetResolver.resolveFocusedTextEntryTarget(in: capture)
            notes.append("No target was supplied; type_text used the focused text-entry target fallback.")
        }

        guard let candidate else {
            let summary = request.target.map {
                targetResolver.targetResolutionFailureDescription(for: $0, in: capture)
            } ?? "No focused text-entry target was available for type_text."
            return response(
                classification: .verifierAmbiguous,
                failureDomain: .targeting,
                summary: summary,
                window: capture.envelope.response.window,
                target: nil,
                text: request.text,
                focusAssistMode: focusAssistMode,
                dispatchPrimitive: nil,
                dispatchSucceeded: nil,
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
        let semantic = targetResolver.semanticSuitability(for: target, kind: .typeText)

        guard semantic.appropriate else {
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: "The resolved node does not look like a text-entry surface for type_text.",
                window: capture.envelope.response.window,
                target: target,
                text: request.text,
                focusAssistMode: focusAssistMode,
                dispatchPrimitive: dispatchPrimitive,
                dispatchSucceeded: nil,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: nil,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because type_text rejected the target as semantically unsupported.",
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
                text: request.text,
                focusAssistMode: focusAssistMode,
                dispatchPrimitive: dispatchPrimitive,
                dispatchSucceeded: nil,
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
        let beforeState = AXActionRuntimeSupport.readTextState(liveElement.element)

        let cursor = AXCursorTargeting.prepareTypeText(
            requested: request.cursor,
            target: target,
            window: capture.envelope.response.window,
            options: executionOptions
        )
        warnings.append(contentsOf: cursor.warnings)

        let preparedBeforeState = applyFocusAssistIfRequested(
            focusAssistMode,
            to: liveElement.element,
            from: beforeState,
            warnings: &warnings,
            notes: &notes
        )
        let expected = expectedOutcome(from: preparedBeforeState, text: request.text)

        let dispatchResult = dispatchText(
            request.text,
            expected: expected,
            to: liveElement.element,
            pid: capture.envelope.response.window.pid,
            warnings: &warnings,
            notes: &notes
        )
        if dispatchResult.succeeded == false {
            AXCursorTargeting.finishTypeText(cursor: cursor, text: request.text)
            return response(
                classification: .effectNotVerified,
                failureDomain: .transport,
                summary: "The text dispatch did not report success.",
                window: capture.envelope.response.window,
                target: target,
                text: request.text,
                focusAssistMode: focusAssistMode,
                dispatchPrimitive: dispatchResult.primitive,
                dispatchSucceeded: false,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                liveElementResolution: liveElement.resolution,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: cursor,
                warnings: warnings,
                notes: notes,
                verification: TypeTextVerificationEvidenceDTO(
                    preparedBeforeLiveState: preparedBeforeState,
                    expectedOutcome: expected,
                    afterSameElementState: nil,
                    afterResolvedLiveState: nil,
                    afterProjectedState: nil,
                    exactValueMatch: false,
                    exactValueMatchSource: nil,
                    exactSelectionMatch: nil,
                    exactSelectionMatchSource: nil,
                    targetRelocated: false,
                    refreshedTargetMatchStrategy: nil,
                    beforeFocusedNodeID: capture.envelope.response.selectionSummary?.focusedNodeID,
                    afterFocusedNodeID: nil,
                    beforeTargetFocused: target.isFocused,
                    afterTargetFocused: nil,
                    renderedTextChanged: false,
                    verificationNotes: ["Transport failed before a reread could verify text insertion."]
                )
            )
        }

        AXCursorTargeting.finishTypeText(cursor: cursor, text: request.text)
        sleepRunLoop(settleDelay)
        let afterSameElementState = AXActionRuntimeSupport.readTextState(liveElement.element)

        let postCapture: AXActionStateCapture?
        do {
            postCapture = try targetResolver.reread(after: capture)
        } catch {
            postCapture = nil
            notes.append("Post-type reread failed: \(error).")
        }

        let refreshedTargetResult = postCapture.flatMap {
            targetResolver.locateRefreshedTarget(in: $0, prior: target, kind: .typeText)
        }
        let refreshedTarget = refreshedTargetResult?.target
        let refreshedTargetStrategy = refreshedTargetResult?.strategy

        var afterResolvedLiveState: TypeTextObservedStateDTO?
        if let postCapture, let refreshedTarget,
           let resolved = try? targetResolver.resolveLiveElement(for: refreshedTarget, in: postCapture) {
            afterResolvedLiveState = AXActionRuntimeSupport.readTextState(resolved.element)
        }

        let afterProjectedState = projectedTextState(from: refreshedTarget)
        let exactValueMatchSource = exactValueMatchSource(
            expected: expected,
            afterSameElementState: afterSameElementState,
            afterResolvedLiveState: afterResolvedLiveState,
            afterProjectedState: afterProjectedState
        )
        let exactSelectionMatchSource = exactSelectionMatchSource(
            expected: expected,
            afterSameElementState: afterSameElementState,
            afterResolvedLiveState: afterResolvedLiveState
        )
        let renderedTextChanged = postCapture.map {
            normalizeRenderedText($0.envelope.response.tree.renderedText) != normalizeRenderedText(capture.envelope.response.tree.renderedText)
        } ?? false

        let verification = TypeTextVerificationEvidenceDTO(
            preparedBeforeLiveState: preparedBeforeState,
            expectedOutcome: expected,
            afterSameElementState: afterSameElementState,
            afterResolvedLiveState: afterResolvedLiveState,
            afterProjectedState: afterProjectedState,
            exactValueMatch: exactValueMatchSource != nil,
            exactValueMatchSource: exactValueMatchSource,
            exactSelectionMatch: expected?.selectionRange == nil ? nil : (exactSelectionMatchSource != nil),
            exactSelectionMatchSource: exactSelectionMatchSource,
            targetRelocated: refreshedTarget != nil,
            refreshedTargetMatchStrategy: refreshedTargetStrategy,
            beforeFocusedNodeID: capture.envelope.response.selectionSummary?.focusedNodeID,
            afterFocusedNodeID: postCapture?.envelope.response.selectionSummary?.focusedNodeID,
            beforeTargetFocused: target.isFocused,
            afterTargetFocused: refreshedTarget?.isFocused,
            renderedTextChanged: renderedTextChanged,
            verificationNotes: buildVerificationNotes(
                target: target,
                expected: expected,
                preparedBeforeState: preparedBeforeState,
                afterResolvedLiveState: afterResolvedLiveState,
                afterSameElementState: afterSameElementState
            )
        )

        return classifyResult(
            request: request,
            window: capture.envelope.response.window,
            target: target,
            semantic: semantic,
            liveElementResolution: liveElement.resolution,
            focusAssistMode: focusAssistMode,
            dispatchPrimitive: dispatchResult.primitive,
            dispatchSucceeded: dispatchResult.succeeded,
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: postCapture?.envelope.response.stateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private struct TextDispatchResult {
        let succeeded: Bool
        let primitive: String
    }

    private func dispatchText(
        _ text: String,
        expected: TypeTextExpectedOutcomeDTO?,
        to element: AXUIElement,
        pid: pid_t,
        warnings: inout [String],
        notes: inout [String]
    ) -> TextDispatchResult {
        if let expectedValue = expected?.valueString,
           AXActionRuntimeSupport.isAttributeSettable(element, attribute: kAXValueAttribute as CFString) {
            notes.append("Using element-bound AX value write for type_text to avoid process-scoped same-app window routing.")
            let valueResult = AXActionRuntimeSupport.setValue(.string(expectedValue), on: element)
            notes.append("AX value write result: \(AXActionRuntimeSupport.rawStatusString(for: valueResult)).")
            guard valueResult == .success else {
                warnings.append("AX value write returned \(AXActionRuntimeSupport.rawStatusString(for: valueResult)); type_text did not fall back to PID-scoped Unicode posting for this writable target.")
                return TextDispatchResult(succeeded: false, primitive: elementValueDispatchPrimitive)
            }

            if let selectionRange = expected?.selectionRange {
                if AXActionRuntimeSupport.isAttributeSettable(element, attribute: kAXSelectedTextRangeAttribute as CFString) {
                    let rangeResult = AXActionRuntimeSupport.setSelectedTextRangeResult(
                        element,
                        location: selectionRange.location,
                        length: selectionRange.length
                    )
                    notes.append("AX caret restore result: \(AXActionRuntimeSupport.rawStatusString(for: rangeResult)).")
                    if rangeResult != .success {
                        warnings.append("AX caret restore returned \(AXActionRuntimeSupport.rawStatusString(for: rangeResult)).")
                    }
                } else {
                    warnings.append("AX value write succeeded, but the selected text range is not writable for caret restoration.")
                }
            }

            return TextDispatchResult(succeeded: true, primitive: elementValueDispatchPrimitive)
        }

        if expected?.valueString == nil {
            notes.append("Exact inserted value could not be computed; type_text used PID-scoped Unicode posting.")
        } else {
            notes.append("Live AX value was not writable; type_text used PID-scoped Unicode posting.")
        }
        return TextDispatchResult(
            succeeded: AXActionRuntimeSupport.postUnicodeText(text, to: pid),
            primitive: dispatchPrimitive
        )
    }

    private func applyFocusAssistIfRequested(
        _ mode: TypeTextFocusAssistModeDTO,
        to element: AXUIElement,
        from beforeState: TypeTextObservedStateDTO,
        warnings: inout [String],
        notes: inout [String]
    ) -> TypeTextObservedStateDTO {
        guard mode != .none else {
            return beforeState
        }

        let focusResult = AXActionRuntimeSupport.setBoolAttributeResult(
            element,
            attribute: kAXFocusedAttribute as CFString,
            value: true
        )
        notes.append("AX focus assist result: \(AXActionRuntimeSupport.rawStatusString(for: focusResult)).")
        if focusResult != .success {
            warnings.append("Focus assist returned \(AXActionRuntimeSupport.rawStatusString(for: focusResult)).")
        }

        if mode == .focusAndCaretEnd {
            if let value = beforeState.valueString,
               AXActionRuntimeSupport.isAttributeSettable(element, attribute: kAXSelectedTextRangeAttribute as CFString) {
                let rangeResult = AXActionRuntimeSupport.setSelectedTextRangeResult(
                    element,
                    location: (value as NSString).length,
                    length: 0
                )
                notes.append("AX caret assist result: \(AXActionRuntimeSupport.rawStatusString(for: rangeResult)).")
                if rangeResult != .success {
                    warnings.append("Caret assist returned \(AXActionRuntimeSupport.rawStatusString(for: rangeResult)).")
                }
            } else {
                warnings.append("Caret assist was requested, but the selected text range was not writable.")
            }
        }

        sleepRunLoop(0.10)
        return AXActionRuntimeSupport.readTextState(element)
    }

    private func classifyResult(
        request: TypeTextRequest,
        window: ResolvedWindowDTO,
        target: AXActionTargetSnapshot,
        semantic: (appropriate: Bool, reasons: [String]),
        liveElementResolution: String,
        focusAssistMode: TypeTextFocusAssistModeDTO,
        dispatchPrimitive: String,
        dispatchSucceeded: Bool,
        preStateToken: String,
        postStateToken: String?,
        cursor: ActionCursorTargetResponseDTO,
        warnings: [String],
        notes: [String],
        verification: TypeTextVerificationEvidenceDTO
    ) -> TypeTextResponse {
        if verification.exactValueMatch {
            if verification.exactSelectionMatch == false {
                return response(
                    classification: .effectNotVerified,
                    failureDomain: .verification,
                    summary: "The text inserted exactly, but the expected caret or selection state did not verify.",
                    window: window,
                    target: target,
                    text: request.text,
                    focusAssistMode: focusAssistMode,
                    dispatchPrimitive: dispatchPrimitive,
                    dispatchSucceeded: dispatchSucceeded,
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
                classification: .success,
                failureDomain: nil,
                summary: "The targeted text dispatch matched the expected inserted value after reread.",
                window: window,
                target: target,
                text: request.text,
                focusAssistMode: focusAssistMode,
                dispatchPrimitive: dispatchPrimitive,
                dispatchSucceeded: dispatchSucceeded,
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
                summary: "The text dispatch was attempted, but the route could not confidently relocate the target on reread.",
                window: window,
                target: target,
                text: request.text,
                focusAssistMode: focusAssistMode,
                dispatchPrimitive: dispatchPrimitive,
                dispatchSucceeded: dispatchSucceeded,
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
            summary: "The text dispatch was attempted, but the refreshed target state did not match the expected inserted text.",
            window: window,
            target: target,
            text: request.text,
            focusAssistMode: focusAssistMode,
            dispatchPrimitive: dispatchPrimitive,
            dispatchSucceeded: dispatchSucceeded,
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
        text: String,
        focusAssistMode: TypeTextFocusAssistModeDTO,
        dispatchPrimitive: String?,
        dispatchSucceeded: Bool?,
        semanticAppropriate: Bool?,
        semanticReasons: [String],
        liveElementResolution: String?,
        preStateToken: String?,
        postStateToken: String?,
        cursor: ActionCursorTargetResponseDTO,
        warnings: [String],
        notes: [String],
        verification: TypeTextVerificationEvidenceDTO?
    ) -> TypeTextResponse {
        TypeTextResponse(
            contractVersion: ContractVersion.current,
            ok: classification == .success,
            classification: classification,
            failureDomain: failureDomain,
            summary: summary,
            window: window,
            target: target?.dto,
            text: text,
            focusAssistMode: focusAssistMode,
            dispatchPrimitive: dispatchPrimitive,
            dispatchSucceeded: dispatchSucceeded,
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

    private func expectedOutcome(
        from beforeState: TypeTextObservedStateDTO,
        text: String
    ) -> TypeTextExpectedOutcomeDTO? {
        guard let value = beforeState.valueString,
              let range = beforeState.selectedTextRange else {
            return nil
        }

        let string = value as NSString
        let nsRange = NSRange(location: range.location, length: range.length)
        guard nsRange.location >= 0,
              nsRange.length >= 0,
              nsRange.location + nsRange.length <= string.length else {
            return nil
        }

        let replaced = string.replacingCharacters(in: nsRange, with: text)
        let caret = TypeTextSelectionRangeDTO(
            location: nsRange.location + (text as NSString).length,
            length: 0
        )

        return TypeTextExpectedOutcomeDTO(
            valuePreview: replaced.replacingOccurrences(of: "\n", with: "\\n"),
            valueString: replaced,
            selectionRange: caret
        )
    }

    private func projectedTextState(from target: AXActionTargetSnapshot?) -> TypeTextObservedStateDTO? {
        guard let target else {
            return nil
        }

        return TypeTextObservedStateDTO(
            valuePreview: target.projectedValuePreview,
            valueString: target.projectedValueKind == "string"
                ? target.projectedValuePreview?.replacingOccurrences(of: "\\n", with: "\n")
                : nil,
            length: target.projectedValueLength,
            truncated: target.projectedValueTruncated,
            selectedTextRange: nil,
            isFocused: target.isFocused
        )
    }

    private func exactValueMatchSource(
        expected: TypeTextExpectedOutcomeDTO?,
        afterSameElementState: TypeTextObservedStateDTO?,
        afterResolvedLiveState: TypeTextObservedStateDTO?,
        afterProjectedState: TypeTextObservedStateDTO?
    ) -> String? {
        guard let expectedValue = expected?.valueString else {
            return nil
        }

        if afterResolvedLiveState?.valueString == expectedValue {
            return "refreshed_live_element"
        }
        if afterSameElementState?.valueString == expectedValue {
            return "same_live_element"
        }
        if afterProjectedState?.valueString == expectedValue, afterProjectedState?.truncated == false {
            return "refreshed_projected_target"
        }
        return nil
    }

    private func exactSelectionMatchSource(
        expected: TypeTextExpectedOutcomeDTO?,
        afterSameElementState: TypeTextObservedStateDTO?,
        afterResolvedLiveState: TypeTextObservedStateDTO?
    ) -> String? {
        guard let expectedRange = expected?.selectionRange else {
            return nil
        }

        if afterResolvedLiveState?.selectedTextRange == expectedRange {
            return "refreshed_live_element"
        }
        if afterSameElementState?.selectedTextRange == expectedRange {
            return "same_live_element"
        }
        return nil
    }

    private func buildVerificationNotes(
        target: AXActionTargetSnapshot,
        expected: TypeTextExpectedOutcomeDTO?,
        preparedBeforeState: TypeTextObservedStateDTO?,
        afterResolvedLiveState: TypeTextObservedStateDTO?,
        afterSameElementState: TypeTextObservedStateDTO?
    ) -> [String] {
        var notes = [
            "Resolved display role: \(target.displayRole).",
            "Resolved raw role: \(target.rawRole ?? "unknown").",
        ]

        if let expectedValue = expected?.valuePreview {
            notes.append("Expected value after insertion: \(expectedValue).")
        } else {
            notes.append("Expected value could not be computed exactly because the live selection range was unavailable.")
        }

        if let preparedBeforeState {
            notes.append("Prepared before-state value: \(preparedBeforeState.valuePreview ?? "nil").")
        }
        if let afterResolvedLiveState {
            notes.append("Refreshed live value: \(afterResolvedLiveState.valuePreview ?? "nil").")
        } else if let afterSameElementState {
            notes.append("Same-element post value: \(afterSameElementState.valuePreview ?? "nil").")
        }

        return notes
    }

    private func normalizeRenderedText(_ text: String) -> String {
        text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }
}
