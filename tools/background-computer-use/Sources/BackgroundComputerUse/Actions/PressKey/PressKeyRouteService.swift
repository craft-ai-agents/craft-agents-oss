import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

struct PressKeyRouteService {
    private let executionOptions: ActionExecutionOptions
    private let targetResolver: AXActionTargetResolver
    private let nativeDispatchPrimitive = "SLPSPostEventRecordTo target-only focus + key-window records + CGEvent keyboard sequence + postToPid"
    private let settleDelay: TimeInterval = 0.35

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        targetResolver = AXActionTargetResolver(executionOptions: executionOptions)
    }

    func pressKey(request: PressKeyRequest) throws -> PressKeyResponse {
        let capture = try targetResolver.capture(
            windowID: request.window,
            includeMenuBar: request.includeMenuBar ?? true,
            maxNodes: request.maxNodes ?? 6500,
            imageMode: request.imageMode ?? .omit
        )
        var warnings = targetResolver.stateTokenWarnings(
            suppliedStateToken: request.stateToken,
            liveStateToken: capture.envelope.response.stateToken
        )
        var notes: [String] = []

        let parsed: ParsedPressKeyChord
        do {
            parsed = try PressKeyParser.parse(request.key)
        } catch {
            return response(
                classification: .unsupported,
                failureDomain: .unsupported,
                summary: String(describing: error),
                window: capture.envelope.response.window,
                parsedKey: nil,
                action: nil,
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the key syntax was rejected.",
                    options: executionOptions
                ),
                warnings: warnings,
                notes: notes,
                verification: nil
            )
        }

        switch parsed.intent {
        case .openFindOrSearch:
            if let semantic = try attemptSemanticFindOrSearch(request: request, capture: capture, parsed: parsed, warnings: &warnings, notes: &notes) {
                return semantic
            }
            notes.append("No semantic find/search control was verified; falling back to native key delivery.")

        case .selectAll:
            if let semantic = try attemptSemanticSelectAll(request: request, capture: capture, parsed: parsed, warnings: &warnings, notes: &notes) {
                return semantic
            }
            notes.append("No focused text-entry select-all semantic route was verified; falling back to native key delivery.")

        case .rawKey:
            break
        }

        return try attemptNativeKeyDelivery(
            request: request,
            capture: capture,
            parsed: parsed,
            warnings: warnings,
            notes: notes
        )
    }

    private func attemptSemanticFindOrSearch(
        request: PressKeyRequest,
        capture: AXActionStateCapture,
        parsed: ParsedPressKeyChord,
        warnings: inout [String],
        notes: inout [String]
    ) throws -> PressKeyResponse? {
        let appElement = AXUIElementCreateApplication(capture.envelope.response.window.pid)
        AXUIElementSetMessagingTimeout(appElement, 1.0)
        let beforeFrontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let beforeSearchCount = searchFieldSnapshots(in: capture).count

        guard let windowElement = resolveWindowElement(
            appElement: appElement,
            window: capture.envelope.response.window
        ) else {
            notes.append("Semantic find/search route could not resolve the live target window.")
            return nil
        }

        if let existingField = findSearchField(in: windowElement) {
            let cursor = preparePressKeyCursor(
                requested: request.cursor,
                window: capture.envelope.response.window,
                parsed: parsed,
                notes: &notes
            )
            let focusStatus = AXActionRuntimeSupport.setBoolAttributeResult(
                existingField,
                attribute: kAXFocusedAttribute as CFString,
                value: true
            )
            notes.append("Existing search field focus result: \(AXActionRuntimeSupport.rawStatusString(for: focusStatus)).")
            AXCursorTargeting.finishPressKey(cursor: cursor)
            sleepRunLoop(0.10)
            let liveFocusVerified = focusStatus == .success ||
                AXActionRuntimeSupport.boolAttribute(existingField, attribute: kAXFocusedAttribute as CFString) == true

            let postCapture = try? targetResolver.reread(after: capture, imageMode: request.imageMode ?? .omit)
            let verification = searchVerification(
                before: capture,
                after: postCapture,
                beforeSearchCount: beforeSearchCount,
                beforeFrontmost: beforeFrontmost,
                afterFrontmost: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                liveFocusedSearchFieldVerified: liveFocusVerified,
                notes: ["Focused an existing editable search/find field in the target window."]
            )

            if liveFocusVerified || verification.search?.focusedSearchFieldVerified == true {
                return response(
                    classification: .success,
                    failureDomain: nil,
                    summary: "Focused an existing search/find field in the target window.",
                    window: postCapture?.envelope.response.window ?? capture.envelope.response.window,
                    parsedKey: parsed.dto,
                    action: PressKeyActionDTO(
                        route: .semanticFocusExistingSearch,
                        transport: "AXFocused attribute",
                        dispatchPrimitive: "AXUIElementSetAttributeValue(kAXFocusedAttribute)",
                        nativeKeyDelivery: false,
                        dispatchSucceeded: focusStatus == .success,
                        rawStatus: AXActionRuntimeSupport.rawStatusString(for: focusStatus),
                        detail: "Focused an existing editable search/find field instead of posting Command-F."
                    ),
                    preStateToken: capture.envelope.response.stateToken,
                    postStateToken: postCapture?.envelope.response.stateToken,
                    cursor: cursor,
                    warnings: warnings,
                    notes: notes,
                    verification: verification
                )
            }
        }

        guard let searchControl = findSearchControl(in: windowElement) else {
            notes.append("No window-local search/find control was found for semantic Command-F.")
            return nil
        }

        let cursor = preparePressKeyCursor(
            requested: request.cursor,
            window: capture.envelope.response.window,
            parsed: parsed,
            notes: &notes
        )
        let pressStatus = AXActionRuntimeSupport.performAction(kAXPressAction as String, on: searchControl)
        notes.append("Search/find control AXPress result: \(AXActionRuntimeSupport.rawStatusString(for: pressStatus)).")
        AXCursorTargeting.finishPressKey(cursor: cursor)
        sleepRunLoop(settleDelay)

        let refreshedWindow = resolveWindowElement(appElement: appElement, window: capture.envelope.response.window) ?? windowElement
        var liveSearchFieldVerified = false
        var liveSearchFieldFocusStatus: AXError?
        if let openedField = findSearchField(in: refreshedWindow) {
            let focusStatus = AXActionRuntimeSupport.setBoolAttributeResult(
                openedField,
                attribute: kAXFocusedAttribute as CFString,
                value: true
            )
            liveSearchFieldFocusStatus = focusStatus
            notes.append("Opened search field focus result: \(AXActionRuntimeSupport.rawStatusString(for: focusStatus)).")
            sleepRunLoop(0.10)
            liveSearchFieldVerified = focusStatus == .success ||
                AXActionRuntimeSupport.boolAttribute(openedField, attribute: kAXFocusedAttribute as CFString) == true
        } else {
            warnings.append("The semantic search/find control was pressed, but no editable search field appeared in the live target window.")
        }

        let postCapture = try? targetResolver.reread(after: capture, imageMode: request.imageMode ?? .omit)
        let verification = searchVerification(
            before: capture,
            after: postCapture,
            beforeSearchCount: beforeSearchCount,
            beforeFrontmost: beforeFrontmost,
            afterFrontmost: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
            liveFocusedSearchFieldVerified: liveSearchFieldVerified,
            notes: ["Pressed a window-local search/find control and verified the target window afterward."]
        )

        let sameTargetWindow = verification.search?.targetWindowNumberBefore == verification.search?.targetWindowNumberAfter
        if sameTargetWindow == false {
            warnings.append("Semantic search/find control was pressed, but the target window number did not verify after reread.")
        }
        let projectedSearchAppeared = (verification.search?.afterSearchFieldCount ?? 0) > beforeSearchCount
        let projectedSearchFocused = verification.search?.focusedSearchFieldVerified == true
        let semanticEffectVerified = sameTargetWindow && (liveSearchFieldVerified || projectedSearchAppeared || projectedSearchFocused)

        return response(
            classification: semanticEffectVerified ? .success : .effectNotVerified,
            failureDomain: semanticEffectVerified ? nil : .verification,
            summary: semanticEffectVerified
                ? "Opened and focused a search/find field in the target window using a semantic window control."
                : "Opened a search/find field in the target window, but focused search state did not verify.",
            window: postCapture?.envelope.response.window ?? capture.envelope.response.window,
            parsedKey: parsed.dto,
            action: PressKeyActionDTO(
                route: .semanticOpenSearchInWindow,
                transport: "AXPress + AXFocused attribute",
                dispatchPrimitive: "AXUIElementPerformAction(kAXPressAction)",
                nativeKeyDelivery: false,
                dispatchSucceeded: pressStatus == .success,
                rawStatus: [
                    "press=\(AXActionRuntimeSupport.rawStatusString(for: pressStatus))",
                    liveSearchFieldFocusStatus.map { "focus=\(AXActionRuntimeSupport.rawStatusString(for: $0))" },
                ]
                .compactMap { $0 }
                .joined(separator: "; "),
                detail: "Pressed a window-local search/find control instead of posting Command-F."
            ),
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: postCapture?.envelope.response.stateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func attemptSemanticSelectAll(
        request: PressKeyRequest,
        capture: AXActionStateCapture,
        parsed: ParsedPressKeyChord,
        warnings: inout [String],
        notes: inout [String]
    ) throws -> PressKeyResponse? {
        let candidate: AXActionCandidate?
        if let focused = targetResolver.resolveFocusedTextEntryTarget(in: capture) {
            candidate = focused
        } else {
            candidate = targetResolver.resolveUnambiguousTextEntryTarget(in: capture)
            if candidate != nil {
                notes.append("Focused text select-all route fell back to the single unambiguous text-entry target in the requested window.")
            }
        }

        guard let candidate else {
            return nil
        }

        let liveElement: AXActionResolvedLiveElement
        do {
            liveElement = try targetResolver.resolveLiveElement(for: candidate.target, in: capture)
        } catch {
            notes.append("Focused text select-all route could not resolve live focused text element: \(error).")
            return nil
        }

        let beforeState = AXActionRuntimeSupport.readTextState(liveElement.element)
        guard let value = beforeState.valueString else {
            notes.append("Focused text select-all route found no string value to select.")
            return nil
        }
        guard AXActionRuntimeSupport.isAttributeSettable(liveElement.element, attribute: kAXSelectedTextRangeAttribute as CFString) else {
            notes.append("Focused text select-all route found a focused text element, but its selected text range is not settable.")
            return nil
        }

        let cursor = preparePressKeyCursor(
            requested: request.cursor,
            window: capture.envelope.response.window,
            parsed: parsed,
            notes: &notes
        )
        let expected = TypeTextSelectionRangeDTO(location: 0, length: (value as NSString).length)
        let status = AXActionRuntimeSupport.setSelectedTextRangeResult(
            liveElement.element,
            location: expected.location,
            length: expected.length
        )
        AXCursorTargeting.finishPressKey(cursor: cursor)
        sleepRunLoop(0.10)
        let afterState = AXActionRuntimeSupport.readTextState(liveElement.element)
        let exact = afterState.selectedTextRange == expected
        let postCapture = try? targetResolver.reread(after: capture, imageMode: request.imageMode ?? .omit)

        return response(
            classification: exact ? .success : .effectNotVerified,
            failureDomain: exact ? nil : .verification,
            summary: exact
                ? "Selected all text in the focused text-entry element using AX selected-range semantics."
                : "Attempted focused-text select-all semantics, but the selected range did not verify.",
            window: postCapture?.envelope.response.window ?? capture.envelope.response.window,
            parsedKey: parsed.dto,
            action: PressKeyActionDTO(
                route: .semanticSelectAllFocusedText,
                transport: "AXSelectedTextRange",
                dispatchPrimitive: "AXUIElementSetAttributeValue(kAXSelectedTextRangeAttribute)",
                nativeKeyDelivery: false,
                dispatchSucceeded: status == .success,
                rawStatus: AXActionRuntimeSupport.rawStatusString(for: status),
                detail: "Set the focused text element selection range instead of posting Command-A."
            ),
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: postCapture?.envelope.response.stateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: PressKeyVerificationEvidenceDTO(
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: postCapture?.envelope.response.stateToken,
                renderedTextChanged: postCapture.map { renderedTextChanged(before: capture, after: $0) },
                focusedElementChanged: postCapture.map { focusedElementChanged(before: capture, after: $0) },
                textStateChanged: nil,
                selectionSummaryChanged: postCapture.map { selectionSummaryChanged(before: capture, after: $0) },
                visualChangeRatio: nil,
                visualChanged: nil,
                search: nil,
                selection: PressKeySelectionVerificationDTO(
                    beforeSelection: beforeState.selectedTextRange,
                    afterSelection: afterState.selectedTextRange,
                    expectedSelection: expected,
                    exactSelectionMatch: exact
                ),
                verificationNotes: [
                    "Focused text entry target resolved via \(liveElement.resolution).",
                    "AX selected-range status: \(AXActionRuntimeSupport.rawStatusString(for: status)).",
                ]
            )
        )
    }

    private func attemptNativeKeyDelivery(
        request: PressKeyRequest,
        capture: AXActionStateCapture,
        parsed: ParsedPressKeyChord,
        warnings: [String],
        notes: [String]
    ) throws -> PressKeyResponse {
        var notes = notes
        var warnings = warnings
        let cursor = preparePressKeyCursor(
            requested: request.cursor,
            window: capture.envelope.response.window,
            parsed: parsed,
            notes: &notes
        )
        warnings.append(contentsOf: cursor.warnings)
        let liveTextElement = focusedLiveTextElement(in: capture)
        let beforeTextState = liveTextElement.map { AXActionRuntimeSupport.readTextState($0.element) }
        let beforeWindowImage = shouldCaptureVisualEvidence(for: parsed)
            ? CGWindowCaptureService.captureImage(window: capture.envelope.response.window)
            : nil
        let beforeFrontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let preparation = NativeWindowServerPreparation.targetOnlyFocusAndKeyWindow(
            pid: capture.envelope.response.window.pid,
            windowNumber: capture.envelope.response.window.windowNumber
        )
        notes.append(contentsOf: preparation.notes)
        warnings.append(contentsOf: preparation.warnings)
        guard preparation.preparedTargetWindow(requireKeyWindowRecords: true) else {
            let preflightFailureNote = "Native key dispatch was not attempted because WindowServer target-window preflight did not prepare the requested window; refusing to fall back to process-scoped key posting for a window-scoped press_key request."
            warnings.append(preflightFailureNote)
            notes.append(preflightFailureNote)
            AXCursorTargeting.finishPressKey(cursor: cursor)
            let afterFrontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
            return response(
                classification: .effectNotVerified,
                failureDomain: .transport,
                summary: "Native key delivery was not attempted because target-window preflight did not succeed.",
                window: capture.envelope.response.window,
                parsedKey: parsed.dto,
                action: PressKeyActionDTO(
                    route: .nativeKeyDelivery,
                    transport: "SLPS window preflight + CGEvent.postToPid",
                    dispatchPrimitive: nativeDispatchPrimitive,
                    nativeKeyDelivery: false,
                    dispatchSucceeded: false,
                    rawStatus: "preflight=\(preparation.rawStatus); dispatch=not_attempted",
                    detail: "Prepared target window \(capture.envelope.response.window.windowNumber) for pid \(capture.envelope.response.window.pid), but WindowServer preflight did not report success. No keyboard events were posted to avoid process-scoped delivery to the wrong app window."
                ),
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: cursor,
                warnings: warnings,
                notes: notes,
                verification: PressKeyVerificationEvidenceDTO(
                    preStateToken: capture.envelope.response.stateToken,
                    postStateToken: nil,
                    renderedTextChanged: nil,
                    focusedElementChanged: nil,
                    textStateChanged: nil,
                    selectionSummaryChanged: nil,
                    visualChangeRatio: nil,
                    visualChanged: nil,
                    search: nil,
                    selection: nil,
                    verificationNotes: [
                        "Frontmost bundle before native dispatch: \(beforeFrontmost ?? "unknown").",
                        "Frontmost bundle after native dispatch: \(afterFrontmost ?? "unknown").",
                        "Native window preflight: \(preparation.rawStatus).",
                        "Native key dispatch success flag: false.",
                        "No CGEvent keyboard sequence was posted because preflight failed closed.",
                    ]
                )
            )
        }
        let dispatchSucceeded = postKeySequence(parsed, to: capture.envelope.response.window.pid)
        AXCursorTargeting.finishPressKey(cursor: cursor)
        sleepRunLoop(settleDelay)
        let afterFrontmost = NSWorkspace.shared.frontmostApplication?.bundleIdentifier

        let postCapture = try? targetResolver.reread(after: capture, imageMode: request.imageMode ?? .omit)
        let renderedChanged = postCapture.map { renderedTextChanged(before: capture, after: $0) }
        let focusChanged = postCapture.map { focusedElementChanged(before: capture, after: $0) }
        let nativeTextStateChanged = beforeTextState.flatMap { before in
            liveTextElement.map { element in
                textStateChanged(before: before, after: AXActionRuntimeSupport.readTextState(element.element))
            }
        }
        let selectionChanged = postCapture.map { selectionSummaryChanged(before: capture, after: $0) }
        let afterWindowImage = beforeWindowImage == nil ? nil : CGWindowCaptureService.captureImage(window: postCapture?.envelope.response.window ?? capture.envelope.response.window)
        let visualChangeRatio = sampledDifferenceRatio(lhs: beforeWindowImage, rhs: afterWindowImage)
        let visualChanged = visualChangeRatio.map { $0 >= 0.018 }
        let searchEvidence = parsed.intent == .openFindOrSearch
            ? searchVerification(
                before: capture,
                after: postCapture,
                beforeSearchCount: searchFieldSnapshots(in: capture).count,
                beforeFrontmost: nil,
                afterFrontmost: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                liveFocusedSearchFieldVerified: false,
                notes: []
            ).search
            : nil
        let verifiedEffect = nativeEffectVerified(
            dispatchSucceeded: dispatchSucceeded,
            parsed: parsed,
            renderedChanged: renderedChanged,
            focusedChanged: focusChanged,
            textStateChanged: nativeTextStateChanged,
            selectionChanged: selectionChanged,
            visualChanged: visualChanged,
            search: searchEvidence
        )
        if verifiedEffect == false {
            let prepareSurfaceNote = "The key was delivered to the target app/window, but no visible effect was verified. Some custom, browser, or Electron surfaces require a prior safe click/focus inside the content area before shortcuts are accepted; try a safe click in the target content surface, then retry press_key."
            warnings.append(prepareSurfaceNote)
            notes.append(prepareSurfaceNote)
        }

        return response(
            classification: verifiedEffect ? .success : .effectNotVerified,
            failureDomain: verifiedEffect ? nil : .verification,
            summary: verifiedEffect
                ? "Native key delivery produced a route-specific verified effect in the target window."
                : "Native key delivery was attempted, but no route-specific target-window effect was verified.",
            window: postCapture?.envelope.response.window ?? capture.envelope.response.window,
            parsedKey: parsed.dto,
            action: PressKeyActionDTO(
                route: .nativeKeyDelivery,
                transport: "SLPS window preflight + CGEvent.postToPid",
                dispatchPrimitive: nativeDispatchPrimitive,
                nativeKeyDelivery: true,
                dispatchSucceeded: dispatchSucceeded,
                rawStatus: "preflight=\(preparation.rawStatus); dispatch=\(dispatchSucceeded ? "posted" : "post_failed")",
                detail: "Prepared target window \(capture.envelope.response.window.windowNumber) for pid \(capture.envelope.response.window.pid), then delivered \(parsed.dto.normalized) to the app pid. Keyboard events are still posted to the app process; the target window is selected by the WindowServer focus/key-window preflight."
            ),
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: postCapture?.envelope.response.stateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: PressKeyVerificationEvidenceDTO(
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: postCapture?.envelope.response.stateToken,
                renderedTextChanged: renderedChanged,
                focusedElementChanged: focusChanged,
                textStateChanged: nativeTextStateChanged,
                selectionSummaryChanged: selectionChanged,
                visualChangeRatio: visualChangeRatio,
                visualChanged: visualChanged,
                search: searchEvidence,
                selection: nil,
                verificationNotes: [
                    "Frontmost bundle before native dispatch: \(beforeFrontmost ?? "unknown").",
                    "Frontmost bundle after native dispatch: \(afterFrontmost ?? "unknown").",
                    "Native window preflight: \(preparation.rawStatus).",
                    "Native key dispatch success flag: \(dispatchSucceeded).",
                    "Native verification checks route-specific search state, focused text value/range changes, selection summary changes, and visual window changes where useful.",
                ]
            )
        )
    }

    private func searchVerification(
        before: AXActionStateCapture,
        after: AXActionStateCapture?,
        beforeSearchCount: Int,
        beforeFrontmost: String?,
        afterFrontmost: String?,
        liveFocusedSearchFieldVerified: Bool = false,
        notes: [String]
    ) -> PressKeyVerificationEvidenceDTO {
        let afterSearchFields = after.map(searchFieldSnapshots) ?? []
        let focusedSearch = liveFocusedSearchFieldVerified || afterSearchFields.contains { $0.isFocused } || after.map {
            focusedElementLooksLikeSearch($0)
        } == true

        return PressKeyVerificationEvidenceDTO(
            preStateToken: before.envelope.response.stateToken,
            postStateToken: after?.envelope.response.stateToken,
            renderedTextChanged: after.map { renderedTextChanged(before: before, after: $0) },
            focusedElementChanged: after.map { focusedElementChanged(before: before, after: $0) },
            textStateChanged: nil,
            selectionSummaryChanged: after.map { selectionSummaryChanged(before: before, after: $0) },
            visualChangeRatio: nil,
            visualChanged: nil,
            search: PressKeySearchVerificationDTO(
                beforeSearchFieldCount: beforeSearchCount,
                afterSearchFieldCount: afterSearchFields.count,
                focusedSearchFieldVerified: focusedSearch,
                targetWindowNumberBefore: before.envelope.response.window.windowNumber,
                targetWindowNumberAfter: after?.envelope.response.window.windowNumber,
                targetWindowTitleBefore: before.envelope.response.window.title,
                targetWindowTitleAfter: after?.envelope.response.window.title,
                frontmostBundleIDBefore: beforeFrontmost,
                frontmostBundleIDAfter: afterFrontmost
            ),
            selection: nil,
            verificationNotes: notes
        )
    }

    private func response(
        classification: ActionClassificationDTO,
        failureDomain: ActionFailureDomainDTO?,
        summary: String,
        window: ResolvedWindowDTO?,
        parsedKey: PressKeyParsedKeyDTO?,
        action: PressKeyActionDTO?,
        preStateToken: String?,
        postStateToken: String?,
        cursor: ActionCursorTargetResponseDTO,
        warnings: [String],
        notes: [String],
        verification: PressKeyVerificationEvidenceDTO?
    ) -> PressKeyResponse {
        PressKeyResponse(
            contractVersion: ContractVersion.current,
            ok: classification == .success,
            classification: classification,
            failureDomain: failureDomain,
            summary: summary,
            window: window,
            parsedKey: parsedKey,
            action: action,
            preStateToken: preStateToken,
            postStateToken: postStateToken,
            cursor: cursor,
            warnings: warnings,
            notes: notes,
            verification: verification
        )
    }

    private func preparePressKeyCursor(
        requested: CursorRequestDTO?,
        window: ResolvedWindowDTO,
        parsed: ParsedPressKeyChord,
        notes: inout [String]
    ) -> ActionCursorTargetResponseDTO {
        let keyLabel = cursorKeycapDisplayLabel(normalized: parsed.dto.normalized)
        notes.append("Press-key cursor choreography uses a stable titlebar keyboard anchor because press_key targets the resolved window, not a specific AX element.")
        return AXCursorTargeting.preparePressKey(
            requested: requested,
            window: window,
            keyLabel: keyLabel,
            options: executionOptions
        )
    }
}

struct ParsedPressKeyChord {
    let raw: String
    let key: String
    let keyCode: CGKeyCode
    let modifiers: [PressKeyModifier]
    let intent: PressKeyIntentDTO

    var dto: PressKeyParsedKeyDTO {
        PressKeyParsedKeyDTO(
            raw: raw,
            normalized: ([modifiers.map(\.label).joined(separator: "+"), key].filter { $0.isEmpty == false }).joined(separator: "+"),
            key: key,
            keyCode: Int(keyCode),
            modifiers: modifiers.map(\.label),
            intent: intent
        )
    }
}

struct PressKeyModifier {
    let label: String
    let flag: CGEventFlags
    let keyCode: CGKeyCode
}

enum PressKeyParserError: Error, CustomStringConvertible, Equatable {
    case emptyKey
    case unsupportedModifier(String)
    case unsupportedKey(String)

    var description: String {
        switch self {
        case .emptyKey:
            return "The key chord was empty."
        case let .unsupportedModifier(value):
            return "Unsupported key modifier '\(value)'."
        case let .unsupportedKey(value):
            return "Unsupported key token '\(value)'."
        }
    }
}

enum PressKeyParser {
    static func parse(_ raw: String) throws -> ParsedPressKeyChord {
        let parts = raw
            .split(separator: "+")
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.isEmpty == false }
        guard let keyPart = parts.last else {
            throw PressKeyParserError.emptyKey
        }

        let modifiers = try parts.dropLast().map(parseModifier)
        if keyPart.trimmingCharacters(in: .whitespacesAndNewlines) == "/" {
            throw PressKeyParserError.unsupportedKey(keyPart)
        }
        let key = try normalizeKeyToken(keyPart)
        guard let keyCode = keyCodeMap[key] else {
            throw PressKeyParserError.unsupportedKey(keyPart)
        }

        var seenModifierLabels = Set<String>()
        let uniqueModifiers = modifiers.filter { modifier in
            seenModifierLabels.insert(modifier.label).inserted
        }
        let modifierLabels = Set(uniqueModifiers.map(\.label))
        let intent: PressKeyIntentDTO
        if key == "f", modifierLabels == ["command"] {
            intent = .openFindOrSearch
        } else if key == "a", modifierLabels == ["command"] {
            intent = .selectAll
        } else {
            intent = .rawKey
        }

        return ParsedPressKeyChord(
            raw: raw,
            key: key,
            keyCode: keyCode,
            modifiers: uniqueModifiers,
            intent: intent
        )
    }

    private static func parseModifier(_ raw: String) throws -> PressKeyModifier {
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "super", "cmd", "command", "meta", "super_l", "super_r":
            return PressKeyModifier(label: "command", flag: .maskCommand, keyCode: 55)
        case "ctrl", "control", "control_l", "control_r":
            return PressKeyModifier(label: "control", flag: .maskControl, keyCode: 59)
        case "alt", "option", "alt_l", "alt_r":
            return PressKeyModifier(label: "option", flag: .maskAlternate, keyCode: 58)
        case "shift", "shift_l", "shift_r":
            return PressKeyModifier(label: "shift", flag: .maskShift, keyCode: 56)
        default:
            throw PressKeyParserError.unsupportedModifier(raw)
        }
    }

    private static func normalizeKeyToken(_ raw: String) throws -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed == "BackSpace" || trimmed.lowercased() == "back_space" {
            return "backspace"
        }
        if trimmed.lowercased() == "backspace" || trimmed == "/" {
            throw PressKeyParserError.unsupportedKey(raw)
        }
        switch trimmed.lowercased() {
        case "return", "kp_enter":
            return "return"
        case "tab", "kp_tab":
            return "tab"
        case "escape", "esc":
            return "escape"
        case "delete", "kp_delete":
            return "delete"
        case "space", "kp_space":
            return "space"
        case "left", "right", "up", "down", "home", "end":
            return trimmed.lowercased()
        case "kp_0":
            return "kp_0"
        case "kp_1":
            return "kp_1"
        case "kp_2":
            return "kp_2"
        case "kp_3":
            return "kp_3"
        case "kp_4":
            return "kp_4"
        case "kp_5":
            return "kp_5"
        case "kp_6":
            return "kp_6"
        case "kp_7":
            return "kp_7"
        case "kp_8":
            return "kp_8"
        case "kp_9":
            return "kp_9"
        case "prior", "page_up", "pageup", "kp_prior", "kp_page_up":
            return "pageup"
        case "next", "page_down", "pagedown", "kp_next", "kp_page_down":
            return "pagedown"
        case "slash":
            return "/"
        case "plus", "kp_add":
            return "+"
        case "minus", "kp_subtract":
            return "-"
        case "period", "kp_decimal":
            return "."
        case "comma":
            return ","
        default:
            return trimmed.lowercased()
        }
    }

    private static let keyCodeMap: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9,
        "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
        "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26,
        "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35,
        "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42, ",": 43, "/": 44, "n": 45,
        "m": 46, ".": 47, "`": 50, "+": 24,
        "return": 36, "tab": 48, "space": 49, "backspace": 51, "delete": 117,
        "escape": 53, "left": 123, "right": 124, "down": 125, "up": 126,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "kp_0": 82, "kp_1": 83, "kp_2": 84, "kp_3": 85, "kp_4": 86,
        "kp_5": 87, "kp_6": 88, "kp_7": 89, "kp_8": 91, "kp_9": 92,
    ]
}

private extension PressKeyRouteService {
    func postKeySequence(_ chord: ParsedPressKeyChord, to pid: pid_t) -> Bool {
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            return false
        }
        source.localEventsSuppressionInterval = 0

        var accumulatedFlags: CGEventFlags = []
        for modifier in chord.modifiers {
            accumulatedFlags.insert(modifier.flag)
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: modifier.keyCode, keyDown: true) else {
                return false
            }
            event.flags = accumulatedFlags
            event.postToPid(pid)
            sleepRunLoop(0.010)
        }

        guard let down = CGEvent(keyboardEventSource: source, virtualKey: chord.keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: chord.keyCode, keyDown: false) else {
            return false
        }
        down.flags = accumulatedFlags
        up.flags = accumulatedFlags
        down.postToPid(pid)
        up.postToPid(pid)
        sleepRunLoop(0.010)

        for modifier in chord.modifiers.reversed() {
            accumulatedFlags.remove(modifier.flag)
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: modifier.keyCode, keyDown: false) else {
                return false
            }
            event.flags = accumulatedFlags
            event.postToPid(pid)
            sleepRunLoop(0.010)
        }

        return true
    }

    func resolveWindowElement(appElement: AXUIElement, window: ResolvedWindowDTO) -> AXUIElement? {
        let windows = AXActionRuntimeSupport.elementArrayAttribute(appElement, attribute: kAXWindowsAttribute as CFString)
        guard let best = windows.max(by: { lhs, rhs in
            scoreWindow(lhs, target: window) < scoreWindow(rhs, target: window)
        }), scoreWindow(best, target: window) > 0 else {
            return nil
        }
        return best
    }

    func scoreWindow(_ element: AXUIElement, target: ResolvedWindowDTO) -> Int {
        var score = 0
        let title = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXTitleAttribute as CFString) ?? ""
        let frame = frameAttribute(element)
        let windowNumber = AXActionRuntimeSupport.intAttribute(element, attribute: "AXWindowNumber" as CFString)

        if windowNumber == target.windowNumber {
            score += 1000
        }
        if title == target.title {
            score += 200
        } else if target.title.isEmpty == false, title.contains(target.title) || target.title.contains(title) {
            score += 120
        }
        if let frame, approximatelyEqual(frame, rect(from: target.frameAppKit), tolerance: 4) {
            score += 100
        }
        if AXActionRuntimeSupport.boolAttribute(element, attribute: kAXMainAttribute as CFString) == true {
            score += 20
        }
        return score
    }

    func findSearchField(in root: AXUIElement) -> AXUIElement? {
        AXActionRuntimeSupport.descendants(of: root, limit: 2_000)
            .filter(isCommandFindOrSearchField)
            .max { searchFieldScore($0) < searchFieldScore($1) }
    }

    func findSearchControl(in root: AXUIElement) -> AXUIElement? {
        AXActionRuntimeSupport.descendants(of: root, limit: 2_000)
            .filter(isSearchControl)
            .max { searchControlScore($0) < searchControlScore($1) }
    }

    func searchFieldSnapshots(in capture: AXActionStateCapture) -> [AXActionTargetSnapshot] {
        capture.envelope.response.tree.nodes.compactMap { node in
            let target = targetResolver.targetSnapshot(for: node, in: capture)
            return targetLooksLikeCommandFindOrSearch(target) ? target : nil
        }
    }

    func focusedElementLooksLikeSearch(_ capture: AXActionStateCapture) -> Bool {
        let focusedIndex = capture.envelope.response.focusedElement.index
        let focusedTitle = capture.envelope.response.focusedElement.title
        let focusedDescription = capture.envelope.response.focusedElement.description
        let focusedRole = capture.envelope.response.focusedElement.displayRole
        let joined = [
            focusedTitle,
            focusedDescription,
            focusedRole,
        ]
        .compactMap { $0 }
        .joined(separator: " ")
        .lowercased()
        if joined.contains("search") || joined.contains("find") {
            return isAddressOrLocationSearchText(joined) == false
        }
        guard let focusedIndex else {
            return false
        }
        return capture.envelope.response.tree.nodes.contains { node in
            let displayIndex = node.displayIndex ?? capture.displayIndexByProjectedIndex[node.projectedIndex]
            guard displayIndex == focusedIndex || node.projectedIndex == focusedIndex else {
                return false
            }
            let target = targetResolver.targetSnapshot(for: node, in: capture)
            return targetLooksLikeCommandFindOrSearch(target)
        }
    }

    func targetLooksLikeCommandFindOrSearch(_ target: AXActionTargetSnapshot) -> Bool {
        let role = AXActionRuntimeSupport.normalize(target.rawRole)
        let subrole = AXActionRuntimeSupport.normalize(target.rawSubrole)
        let displayRole = AXActionRuntimeSupport.normalize(target.displayRole)
        let text = [
            target.title,
            target.description,
            target.identifier,
            target.placeholder,
            target.displayRole,
        ]
        .map(AXActionRuntimeSupport.normalize)
        .joined(separator: " ")

        let editable = target.isTextEntry == true ||
            role == "axtextfield" ||
            role == "axtextarea" ||
            role == "axcombobox" ||
            displayRole.contains("text field") ||
            displayRole.contains("combo box")
        return editable &&
            (subrole.contains("search") || displayRole.contains("search") || text.contains("search") || text.contains("find")) &&
            isAddressOrLocationSearchText(text) == false
    }

    func isEditableSearchField(_ element: AXUIElement) -> Bool {
        editableSearchFieldContext(element).isEditableSearch
    }

    func isCommandFindOrSearchField(_ element: AXUIElement) -> Bool {
        let context = editableSearchFieldContext(element)
        return context.isEditableSearch &&
            context.isAddressOrLocation == false &&
            (context.hasFindEvidence || context.hasSearchEvidence)
    }

    func editableSearchFieldContext(_ element: AXUIElement) -> (isEditableSearch: Bool, hasSearchEvidence: Bool, hasFindEvidence: Bool, isAddressOrLocation: Bool) {
        let signature = AXActionRuntimeSupport.signature(for: element)
        let role = AXActionRuntimeSupport.normalize(signature.role)
        let subrole = AXActionRuntimeSupport.normalize(signature.subrole)
        let roleDescription = AXActionRuntimeSupport.normalize(signature.roleDescription)

        let editable = role == "axtextfield" ||
            role == "axtextarea" ||
            role == "axcombobox" ||
            roleDescription.contains("text field") ||
            roleDescription.contains("search field")
        guard editable else {
            return (
                isEditableSearch: false,
                hasSearchEvidence: false,
                hasFindEvidence: false,
                isAddressOrLocation: false
            )
        }

        let directText = commandSearchDirectStructuralText(for: signature)
        let hasSearch = subrole.contains("search") || roleDescription.contains("search") || directText.contains("search")
        let hasFind = directText.contains("find")
        let structuralText = (hasSearch || hasFind) ? commandSearchStructuralText(for: element) : directText
        return (
            isEditableSearch: editable && (hasSearch || hasFind),
            hasSearchEvidence: hasSearch,
            hasFindEvidence: hasFind,
            isAddressOrLocation: isAddressOrLocationSearchText([directText, structuralText].joined(separator: " "))
        )
    }

    func isSearchControl(_ element: AXUIElement) -> Bool {
        let signature = AXActionRuntimeSupport.signature(for: element)
        let role = AXActionRuntimeSupport.normalize(signature.role)
        let subrole = AXActionRuntimeSupport.normalize(signature.subrole)
        let actions = Set(AXActionRuntimeSupport.actionNames(element))
        let roleCanPress = role == "axbutton" || role == "axmenubutton" || role == "axpopupbutton"
        let isWindowChrome = subrole.contains("close") || subrole.contains("minimize") || subrole.contains("fullscreen")
        guard roleCanPress,
              actions.contains(kAXPressAction as String),
              isWindowChrome == false else {
            return false
        }

        let directText = commandSearchDirectStructuralText(for: signature)
        guard directText.contains("search") || directText.contains("find") || subrole.contains("search") else {
            return false
        }

        let structuralText = commandSearchStructuralText(for: element)
        return isAddressOrLocationSearchText([directText, structuralText].joined(separator: " ")) == false &&
            isWithinWebContent(element) == false &&
            isLikelyWindowSearchControlContainer(element)
    }

    func commandSearchStructuralText(for element: AXUIElement) -> String {
        AXActionRuntimeSupport.walkAncestors(startingAt: element, maxDepth: 6)
            .flatMap { candidate -> [String?] in
                let signature = AXActionRuntimeSupport.signature(for: candidate)
                return Self.commandSearchStructuralFields(for: signature)
            }
            .map(AXActionRuntimeSupport.normalize)
            .joined(separator: " ")
    }

    func commandSearchDirectStructuralText(for signature: AXActionRefetchSignature) -> String {
        Self.commandSearchStructuralFields(for: signature)
            .map(AXActionRuntimeSupport.normalize)
            .joined(separator: " ")
    }

    private static func commandSearchStructuralFields(for signature: AXActionRefetchSignature) -> [String?] {
        [
            signature.role,
            signature.subrole,
            signature.roleDescription,
            signature.title,
            signature.description,
            signature.placeholder,
            signature.help,
            signature.identifier,
        ]
    }

    func isWithinWebContent(_ element: AXUIElement) -> Bool {
        AXActionRuntimeSupport.walkAncestors(startingAt: element, maxDepth: 8).contains { candidate in
            let signature = AXActionRuntimeSupport.signature(for: candidate)
            let role = AXActionRuntimeSupport.normalize(signature.role)
            let roleDescription = AXActionRuntimeSupport.normalize(signature.roleDescription)
            return role == "axwebarea" || roleDescription.contains("web area")
        }
    }

    func isLikelyWindowSearchControlContainer(_ element: AXUIElement) -> Bool {
        AXActionRuntimeSupport.walkAncestors(startingAt: element, maxDepth: 8).contains { candidate in
            let signature = AXActionRuntimeSupport.signature(for: candidate)
            let role = AXActionRuntimeSupport.normalize(signature.role)
            let subrole = AXActionRuntimeSupport.normalize(signature.subrole)
            let roleDescription = AXActionRuntimeSupport.normalize(signature.roleDescription)
            let identifier = AXActionRuntimeSupport.normalize(signature.identifier)
            let text = [role, subrole, roleDescription, identifier].joined(separator: " ")
            return text.contains("toolbar") ||
                text.contains("titlebar") ||
                text.contains("title bar") ||
                text.contains("sidebar") ||
                text.contains("side bar") ||
                text.contains("search field") ||
                subrole.contains("search")
        }
    }

    func isAddressOrLocationSearchText(_ text: String) -> Bool {
        let needles = [
            "address",
            "url",
            "website",
            "web site",
            "web address",
            "smart search",
            "search or enter",
            "search the web",
            "enter website",
            "location",
            "omnibox",
            "http://",
            "https://",
            "www.",
        ]
        return needles.contains { text.contains($0) }
    }

    func searchFieldScore(_ element: AXUIElement) -> Int {
        let signature = AXActionRuntimeSupport.signature(for: element)
        var score = 0
        if AXActionRuntimeSupport.normalize(signature.subrole).contains("search") {
            score += 100
        }
        if AXActionRuntimeSupport.boolAttribute(element, attribute: kAXFocusedAttribute as CFString) == true {
            score += 30
        }
        if AXActionRuntimeSupport.isAttributeSettable(element, attribute: kAXFocusedAttribute as CFString) {
            score += 10
        }
        return score
    }

    func searchControlScore(_ element: AXUIElement) -> Int {
        let signature = AXActionRuntimeSupport.signature(for: element)
        let text = [
            signature.title,
            signature.description,
            signature.help,
            signature.identifier,
            signature.subrole,
        ]
        .map(AXActionRuntimeSupport.normalize)
        .joined(separator: " ")
        var score = 0
        if text.contains("search") {
            score += 100
        }
        if text.contains("find") {
            score += 90
        }
        if AXActionRuntimeSupport.normalize(signature.subrole).contains("search") {
            score += 40
        }
        if AXActionRuntimeSupport.rectAttribute(element, attribute: "AXFrame" as CFString) != nil ||
            frameAttribute(element) != nil {
            score += 10
        }
        return score
    }

    func renderedTextChanged(before: AXActionStateCapture, after: AXActionStateCapture) -> Bool {
        normalizeRenderedText(before.envelope.response.tree.renderedText) != normalizeRenderedText(after.envelope.response.tree.renderedText)
    }

    func selectionSummaryChanged(before: AXActionStateCapture, after: AXActionStateCapture) -> Bool {
        before.envelope.response.selectionSummary?.focusedNodeID != after.envelope.response.selectionSummary?.focusedNodeID ||
            before.envelope.response.selectionSummary?.selectedText != after.envelope.response.selectionSummary?.selectedText ||
            before.envelope.response.selectionSummary?.selectedTextSource != after.envelope.response.selectionSummary?.selectedTextSource ||
            before.envelope.response.selectionSummary?.selectedCanonicalIndices != after.envelope.response.selectionSummary?.selectedCanonicalIndices ||
            before.envelope.response.selectionSummary?.selectedNodeIDs != after.envelope.response.selectionSummary?.selectedNodeIDs
    }

    func focusedElementChanged(before: AXActionStateCapture, after: AXActionStateCapture) -> Bool {
        before.envelope.response.focusedElement.index != after.envelope.response.focusedElement.index ||
            before.envelope.response.focusedElement.title != after.envelope.response.focusedElement.title ||
            before.envelope.response.focusedElement.description != after.envelope.response.focusedElement.description ||
            before.envelope.response.focusedElement.displayRole != after.envelope.response.focusedElement.displayRole
    }

    func focusedLiveTextElement(in capture: AXActionStateCapture) -> AXActionResolvedLiveElement? {
        guard let candidate = targetResolver.resolveFocusedTextEntryTarget(in: capture) else {
            return nil
        }
        return try? targetResolver.resolveLiveElement(for: candidate.target, in: capture)
    }

    func textStateChanged(before: TypeTextObservedStateDTO, after: TypeTextObservedStateDTO) -> Bool {
        before.valueString != after.valueString ||
            before.selectedTextRange != after.selectedTextRange ||
            before.length != after.length
    }

    func isCommandChord(_ parsed: ParsedPressKeyChord) -> Bool {
        parsed.modifiers.contains { $0.label == "command" }
    }

    func isTextEditingOrNavigationKey(_ parsed: ParsedPressKeyChord) -> Bool {
        guard parsed.modifiers.allSatisfy({ $0.label == "shift" }) else {
            return false
        }
        return [
            "return",
            "tab",
            "space",
            "backspace",
            "delete",
            "left",
            "right",
            "up",
            "down",
            "home",
            "end",
            "pageup",
            "pagedown",
        ].contains(parsed.key) || parsed.key.count == 1
    }

    func normalizeRenderedText(_ renderedText: String) -> String {
        renderedText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    func shouldCaptureVisualEvidence(for parsed: ParsedPressKeyChord) -> Bool {
        isCommandChord(parsed) || parsed.intent == .openFindOrSearch
    }

    func sampledDifferenceRatio(lhs: CGImage?, rhs: CGImage?) -> Double? {
        guard let lhs, let rhs,
              lhs.width == rhs.width,
              lhs.height == rhs.height,
              let lhsBytes = rgbaBytes(from: lhs),
              let rhsBytes = rgbaBytes(from: rhs) else {
            return nil
        }

        let pixelCount = lhs.width * lhs.height
        guard pixelCount > 0 else {
            return nil
        }

        let sampleStride = max(1, Int(sqrt(Double(pixelCount) / 18_000.0)))
        var changed = 0
        var sampled = 0
        let threshold = 32

        for y in Swift.stride(from: 0, to: lhs.height, by: sampleStride) {
            for x in Swift.stride(from: 0, to: lhs.width, by: sampleStride) {
                let index = ((y * lhs.width) + x) * 4
                guard index + 3 < lhsBytes.count, index + 3 < rhsBytes.count else {
                    continue
                }
                let diff =
                    abs(Int(lhsBytes[index]) - Int(rhsBytes[index])) +
                    abs(Int(lhsBytes[index + 1]) - Int(rhsBytes[index + 1])) +
                    abs(Int(lhsBytes[index + 2]) - Int(rhsBytes[index + 2]))
                if diff > threshold {
                    changed += 1
                }
                sampled += 1
            }
        }

        guard sampled > 0 else {
            return nil
        }
        return Double(changed) / Double(sampled)
    }

    func rgbaBytes(from image: CGImage) -> [UInt8]? {
        let width = image.width
        let height = image.height
        let bytesPerRow = width * 4
        var buffer = [UInt8](repeating: 0, count: bytesPerRow * height)

        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: &buffer,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              ) else {
            return nil
        }

        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        return buffer
    }

    func frameAttribute(_ element: AXUIElement) -> CGRect? {
        if let frame = AXActionRuntimeSupport.rectAttribute(element, attribute: "AXFrame" as CFString) {
            return frame
        }
        guard let positionValue = AXActionRuntimeSupport.copyAttributeValue(element, attribute: kAXPositionAttribute as CFString),
              let sizeValue = AXActionRuntimeSupport.copyAttributeValue(element, attribute: kAXSizeAttribute as CFString),
              CFGetTypeID(positionValue) == AXValueGetTypeID(),
              CFGetTypeID(sizeValue) == AXValueGetTypeID() else {
            return nil
        }
        let positionAX = unsafeDowncast(positionValue, to: AXValue.self)
        let sizeAX = unsafeDowncast(sizeValue, to: AXValue.self)
        var point = CGPoint.zero
        var size = CGSize.zero
        guard AXValueGetType(positionAX) == .cgPoint,
              AXValueGetType(sizeAX) == .cgSize,
              AXValueGetValue(positionAX, .cgPoint, &point),
              AXValueGetValue(sizeAX, .cgSize, &size) else {
            return nil
        }
        return CGRect(origin: point, size: size)
    }

    func approximatelyEqual(_ lhs: CGRect, _ rhs: CGRect, tolerance: CGFloat) -> Bool {
        abs(lhs.minX - rhs.minX) <= tolerance &&
            abs(lhs.minY - rhs.minY) <= tolerance &&
            abs(lhs.width - rhs.width) <= tolerance &&
            abs(lhs.height - rhs.height) <= tolerance
    }

    func rect(from dto: RectDTO) -> CGRect {
        CGRect(x: dto.x, y: dto.y, width: dto.width, height: dto.height)
    }
}

extension PressKeyRouteService {
    func nativeEffectVerified(
        dispatchSucceeded: Bool,
        parsed: ParsedPressKeyChord,
        renderedChanged: Bool?,
        focusedChanged: Bool?,
        textStateChanged: Bool?,
        selectionChanged: Bool?,
        visualChanged: Bool?,
        search: PressKeySearchVerificationDTO?
    ) -> Bool {
        guard dispatchSucceeded else {
            return false
        }

        if parsed.intent == .openFindOrSearch {
            return search?.focusedSearchFieldVerified == true ||
                (search?.afterSearchFieldCount ?? 0) > (search?.beforeSearchFieldCount ?? 0)
        }

        if parsed.intent == .selectAll {
            return textStateChanged == true || selectionChanged == true
        }

        if isTextEditingOrNavigationKey(parsed) {
            return textStateChanged == true || selectionChanged == true || renderedChanged == true
        }

        if isCommandChord(parsed) {
            return renderedChanged == true ||
                focusedChanged == true ||
                textStateChanged == true ||
                selectionChanged == true
        }

        return textStateChanged == true ||
            selectionChanged == true ||
            renderedChanged == true ||
            focusedChanged == true ||
            visualChanged == true
    }
}
