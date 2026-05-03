import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

private let axScrollToShowDescendantAttribute = "AXScrollToShowDescendant"

private struct ScrollCandidate {
    let rank: Int
    let node: AXPipelineV2SurfaceNodeDTO
    let target: AXActionTargetSnapshot
    let score: Int
    let reasons: [String]

    var dto: ScrollCandidateDTO {
        ScrollCandidateDTO(rank: rank, score: score, reasons: reasons, target: target.dto)
    }
}

private struct LiveContainerSnapshot {
    let verticalScrollBarValue: Double?
    let horizontalScrollBarValue: Double?
    let visibleCharacterRange: CFRange?
}

private struct ScrollContainerMetrics {
    let visibleLabels: [String]
    let visibleTextDigest: String?
    let verticalScrollBarValue: Double?
    let horizontalScrollBarValue: Double?
    let visibleCharacterRangeLocation: Int?
}

private struct ScrollFrameDelta {
    let label: String
    let role: String?
    let deltaX: Double
    let deltaY: Double
}

private struct VerificationViewport {
    let rect: CGRect?
    let source: String?
    let sourceNode: AXPipelineV2SurfaceNodeDTO?
}

private struct OffscreenDescendantPick {
    let element: AXUIElement
    let overflow: Double
    let note: String
}

private struct StrategyAttemptOutcome {
    let transport: ScrollTransportAttemptDTO
    let didDispatch: Bool
}

private struct ScrollImageChangeSnapshot {
    let regionChangeRatio: Double?
    let fullImageChangeRatio: Double?
}

private enum ScrollSurfaceClass: String {
    case nativeTransparent = "native_transparent"
    case opaqueWeb = "opaque_web"
    case opaqueWindowOnly = "opaque_window_only"
    case staticOrBoundary = "static_or_boundary"
    case unresolved
}

private struct CandidateExecutionResult {
    let candidate: ScrollCandidate
    let cursor: ActionCursorTargetResponseDTO
    let transports: [ScrollTransportAttemptDTO]
    let verificationReads: [ScrollVerificationReadDTO]
    let verification: ScrollVerificationSummaryDTO
    let postStateToken: String?
    let frontmostBundleBeforeDispatch: String?
    let frontmostBundleAfter: String?
    let notes: [String]
}

struct ScrollRouteService {
    private let executionOptions: ActionExecutionOptions
    private let targetResolver: AXActionTargetResolver
    private let rereadDelaysMilliseconds = [80, 180, 320]

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
        targetResolver = AXActionTargetResolver(executionOptions: executionOptions)
    }

    func scroll(request: ScrollRequest) throws -> ScrollResponse {
        let capture = try targetResolver.capture(
            windowID: request.window,
            includeMenuBar: request.includeMenuBar ?? true,
            maxNodes: request.maxNodes ?? 6500
        )
        var warnings = targetResolver.stateTokenWarnings(
            suppliedStateToken: request.stateToken,
            liveStateToken: capture.envelope.response.stateToken
        )
        var notes = [
            "Scroll uses AXPipelineV2 state with screenshots omitted for pre/post reads.",
            "Runtime order uses early surface classification: native AX/scrollbar first; opaque targeted scroll-wheel before process-scoped post_to_pid paging."
        ]

        let pages = normalizedPages(request.pages, warnings: &warnings)
        let frontmostBefore = NSWorkspace.shared.frontmostApplication?.bundleIdentifier

        guard let requestedNode = targetResolver.resolveSurfaceNode(
            target: request.target,
            in: capture
        ) else {
            let failureSummary = targetResolver.targetResolutionFailureDescription(
                for: request.target,
                in: capture
            )
            return response(
                classification: .unresolved,
                failureDomain: .targeting,
                issueBucket: .targeting,
                summary: failureSummary,
                window: capture.envelope.response.window,
                requestedTarget: nil,
                chosenContainer: nil,
                direction: request.direction,
                pages: pages,
                planCandidates: [],
                transports: [],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because the scroll target was not resolved.",
                    options: executionOptions
                ),
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil,
                verificationReads: []
            )
        }

        let requestedTarget = targetResolver.targetSnapshot(
            for: requestedNode,
            in: capture
        )
        let candidates = scoreContainerCandidates(for: requestedNode, in: capture)
        let surfaceClass = classifySurface(
            requestedNode: requestedNode,
            candidates: candidates,
            capture: capture,
            window: capture.envelope.response.window
        )
        notes.append("Classified scroll surface as \(surfaceClass.rawValue).")
        guard candidates.isEmpty == false else {
            return response(
                classification: .unresolved,
                failureDomain: .targeting,
                issueBucket: .targeting,
                summary: "No projected ancestor looked like a viable scroll container for \(request.target.summary).",
                window: capture.envelope.response.window,
                requestedTarget: requestedTarget,
                chosenContainer: nil,
                direction: request.direction,
                pages: pages,
                planCandidates: [],
                transports: [],
                preStateToken: capture.envelope.response.stateToken,
                postStateToken: nil,
                cursor: AXCursorTargeting.notAttempted(
                    requested: request.cursor,
                    reason: "Cursor movement was not attempted because no scroll container candidate was ranked.",
                    options: executionOptions
                ),
                frontmostBundleBefore: frontmostBefore,
                frontmostBundleBeforeDispatch: nil,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                warnings: warnings,
                notes: notes,
                verification: nil,
                verificationReads: []
            )
        }

        var allTransports: [ScrollTransportAttemptDTO] = []
        var allVerificationReads: [ScrollVerificationReadDTO] = []
        var latestCursor = AXCursorTargeting.notAttempted(
            requested: request.cursor,
            reason: "Cursor movement was not attempted before scroll dispatch.",
            options: executionOptions
        )
        var latestPostStateToken: String?
        var latestFrontmostBeforeDispatch: String?
        var latestFrontmostAfter: String?
        var finalCandidate = candidates.first
        let axStrategies = axStrategyOrder(for: surfaceClass)

        if axStrategies.isEmpty == false {
            for candidate in candidates.prefix(3) {
                let result = executeCandidate(
                    candidate,
                    mode: .backgroundSafeAXLadder,
                    strategies: axStrategies,
                    capture: capture,
                    requestedNode: requestedNode,
                    direction: request.direction,
                    pages: pages,
                    cursorRequest: request.cursor
                )
                allTransports.append(contentsOf: result.transports)
                allVerificationReads.append(contentsOf: result.verificationReads)
                latestCursor = result.cursor
                latestPostStateToken = result.postStateToken ?? latestPostStateToken
                latestFrontmostBeforeDispatch = result.frontmostBundleBeforeDispatch ?? latestFrontmostBeforeDispatch
                latestFrontmostAfter = result.frontmostBundleAfter ?? latestFrontmostAfter
                finalCandidate = result.candidate
                notes.append(contentsOf: result.notes)

                if result.verification.classification == .success {
                    return response(
                        classification: .success,
                        failureDomain: nil,
                        issueBucket: .none,
                        summary: "Scroll succeeded using \(successfulStrategyName(in: result.transports) ?? "the AX ladder") on candidate rank \(candidate.rank).",
                        window: capture.envelope.response.window,
                        requestedTarget: requestedTarget,
                        chosenContainer: candidate.target,
                        direction: request.direction,
                        pages: pages,
                        planCandidates: candidates.map(\.dto),
                        transports: allTransports,
                        preStateToken: capture.envelope.response.stateToken,
                        postStateToken: latestPostStateToken,
                        cursor: latestCursor,
                        frontmostBundleBefore: frontmostBefore,
                        frontmostBundleBeforeDispatch: latestFrontmostBeforeDispatch,
                        frontmostBundleAfter: latestFrontmostAfter,
                        warnings: warnings + latestCursor.warnings,
                        notes: notes,
                        verification: result.verification,
                        verificationReads: allVerificationReads
                    )
                }
            }
        } else {
            notes.append("AX ladder was skipped for \(surfaceClass.rawValue) surface.")
        }

        if shouldAttemptOpaqueFallback(
            surfaceClass: surfaceClass,
            direction: request.direction,
            requestedNode: requestedNode,
            candidates: candidates,
            window: capture.envelope.response.window
        ), let opaqueCandidate = preferredOpaqueFallbackCandidate(from: candidates, window: capture.envelope.response.window) {
            let wheelResult = executeCandidate(
                opaqueCandidate,
                mode: .targetedScrollWheelPostToPID,
                strategies: [.targetedScrollWheelPostToPID],
                capture: capture,
                requestedNode: requestedNode,
                direction: request.direction,
                pages: pages,
                cursorRequest: request.cursor
            )
            allTransports.append(contentsOf: wheelResult.transports)
            allVerificationReads.append(contentsOf: wheelResult.verificationReads)
            latestCursor = wheelResult.cursor
            latestPostStateToken = wheelResult.postStateToken ?? latestPostStateToken
            latestFrontmostBeforeDispatch = wheelResult.frontmostBundleBeforeDispatch ?? latestFrontmostBeforeDispatch
            latestFrontmostAfter = wheelResult.frontmostBundleAfter ?? latestFrontmostAfter
            finalCandidate = wheelResult.candidate
            notes.append(contentsOf: wheelResult.notes)

            if wheelResult.verification.classification == .success {
                return response(
                    classification: .success,
                    failureDomain: nil,
                    issueBucket: .none,
                    summary: "Scroll succeeded using targeted scroll-wheel post_to_pid on \(surfaceClass.rawValue) candidate rank \(opaqueCandidate.rank).",
                    window: capture.envelope.response.window,
                    requestedTarget: requestedTarget,
                    chosenContainer: opaqueCandidate.target,
                    direction: request.direction,
                    pages: pages,
                    planCandidates: candidates.map(\.dto),
                    transports: allTransports,
                    preStateToken: capture.envelope.response.stateToken,
                    postStateToken: latestPostStateToken,
                    cursor: latestCursor,
                    frontmostBundleBefore: frontmostBefore,
                    frontmostBundleBeforeDispatch: latestFrontmostBeforeDispatch,
                    frontmostBundleAfter: latestFrontmostAfter,
                    warnings: warnings + latestCursor.warnings,
                    notes: notes,
                    verification: wheelResult.verification,
                    verificationReads: allVerificationReads
                )
            }

            let result = executeCandidate(
                opaqueCandidate,
                mode: .postToPIDPaging,
                strategies: [.postToPIDPaging],
                capture: capture,
                requestedNode: requestedNode,
                direction: request.direction,
                pages: pages,
                cursorRequest: request.cursor
            )
            allTransports.append(contentsOf: result.transports)
            allVerificationReads.append(contentsOf: result.verificationReads)
            latestCursor = result.cursor
            latestPostStateToken = result.postStateToken ?? latestPostStateToken
            latestFrontmostBeforeDispatch = result.frontmostBundleBeforeDispatch ?? latestFrontmostBeforeDispatch
            latestFrontmostAfter = result.frontmostBundleAfter ?? latestFrontmostAfter
            finalCandidate = result.candidate
            notes.append(contentsOf: result.notes)

            if result.verification.classification == .success {
                return response(
                    classification: .success,
                    failureDomain: nil,
                    issueBucket: .none,
                    summary: "Scroll succeeded using post_to_pid paging on \(surfaceClass.rawValue) candidate rank \(opaqueCandidate.rank).",
                    window: capture.envelope.response.window,
                    requestedTarget: requestedTarget,
                    chosenContainer: opaqueCandidate.target,
                    direction: request.direction,
                    pages: pages,
                    planCandidates: candidates.map(\.dto),
                    transports: allTransports,
                    preStateToken: capture.envelope.response.stateToken,
                    postStateToken: latestPostStateToken,
                    cursor: latestCursor,
                    frontmostBundleBefore: frontmostBefore,
                    frontmostBundleBeforeDispatch: latestFrontmostBeforeDispatch,
                    frontmostBundleAfter: latestFrontmostAfter,
                    warnings: warnings + latestCursor.warnings,
                    notes: notes,
                    verification: result.verification,
                    verificationReads: allVerificationReads
                )
            }
        } else {
            notes.append("Opaque fallback was skipped because the request was horizontal or the surface was not classified as opaque.")
        }

        let fallbackContainer = finalCandidate?.node ?? requestedNode
        let verification = summarizeVerification(
            transports: allTransports,
            verificationReads: allVerificationReads,
            boundaryReasons: allTransports.compactMap(\.boundaryReason),
            container: fallbackContainer
        )
        return response(
            classification: verification.classification,
            failureDomain: failureDomain(for: verification),
            issueBucket: verification.issueBucket,
            summary: summaryText(for: verification),
            window: capture.envelope.response.window,
            requestedTarget: requestedTarget,
            chosenContainer: finalCandidate?.target,
            direction: request.direction,
            pages: pages,
            planCandidates: candidates.map(\.dto),
            transports: allTransports,
            preStateToken: capture.envelope.response.stateToken,
            postStateToken: latestPostStateToken,
            cursor: latestCursor,
            frontmostBundleBefore: frontmostBefore,
            frontmostBundleBeforeDispatch: latestFrontmostBeforeDispatch,
            frontmostBundleAfter: latestFrontmostAfter ?? NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
            warnings: warnings + latestCursor.warnings,
            notes: notes,
            verification: verification,
            verificationReads: allVerificationReads
        )
    }

    private func executeCandidate(
        _ candidate: ScrollCandidate,
        mode: ScrollTransportModeDTO,
        strategies: [ScrollStrategyDTO],
        capture: AXActionStateCapture,
        requestedNode: AXPipelineV2SurfaceNodeDTO,
        direction: ScrollDirectionDTO,
        pages: Int,
        cursorRequest: CursorRequestDTO?
    ) -> CandidateExecutionResult {
        let cursor = AXCursorTargeting.prepareScroll(
            requested: cursorRequest,
            target: candidate.target,
            window: capture.envelope.response.window,
            direction: direction,
            options: executionOptions
        )
        let finishCursor = {
            if cursor.moved {
                AXCursorTargeting.finishScroll(cursor: cursor)
            }
        }
        let frontmostBeforeDispatch = NSWorkspace.shared.frontmostApplication?.bundleIdentifier

        let resolvedContainer: AXActionResolvedLiveElement
        do {
            resolvedContainer = try targetResolver.resolveLiveElement(for: candidate.target, in: capture)
        } catch {
            let transport = ScrollTransportAttemptDTO(
                mode: mode,
                strategy: strategies.first ?? .axPageAction,
                candidateRank: candidate.rank,
                actedOnTarget: candidate.target.dto,
                liveElementResolution: nil,
                rawStatus: "live_container_unresolved",
                transportSuccess: false,
                didDispatch: false,
                boundaryReason: nil,
                notes: ["Live AX container resolution failed: \(error)."]
            )
            let verification = summarizeVerification(
                transports: [transport],
                verificationReads: [],
                boundaryReasons: [],
                container: candidate.node
            )
            finishCursor()
            return CandidateExecutionResult(
                candidate: candidate,
                cursor: cursor,
                transports: [transport],
                verificationReads: [],
                verification: verification,
                postStateToken: nil,
                frontmostBundleBeforeDispatch: frontmostBeforeDispatch,
                frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                notes: ["Candidate rank \(candidate.rank) could not resolve a live scroll container."]
            )
        }

        let beforeLiveSnapshot = captureLiveContainerSnapshot(for: resolvedContainer.element)
        let beforeWindowImage = CGWindowCaptureService.captureImage(window: capture.envelope.response.window)
        var transports: [ScrollTransportAttemptDTO] = []
        var reads: [ScrollVerificationReadDTO] = []
        var postStateToken: String?
        var notes = ["Trying scroll candidate rank \(candidate.rank): \(candidate.reasons.joined(separator: "; "))."]

        for strategy in strategies {
            let attempt = attempt(
                strategy: strategy,
                mode: mode,
                candidate: candidate,
                direction: direction,
                pages: pages,
                window: capture.envelope.response.window,
                resolvedContainer: resolvedContainer
            )
            transports.append(attempt.transport)

            guard attempt.didDispatch else {
                continue
            }

            let verificationReads = rereadAndVerify(
                mode: mode,
                beforeCapture: capture,
                beforeLiveSnapshot: beforeLiveSnapshot,
                beforeWindowImage: beforeWindowImage,
                requestedNode: requestedNode,
                containerNode: candidate.node,
                direction: direction,
                pages: pages
            )
            reads.append(contentsOf: verificationReads)
            postStateToken = verificationReads.last?.stateToken ?? postStateToken

            let verification = summarizeVerification(
                transports: transports,
                verificationReads: reads,
                boundaryReasons: transports.compactMap(\.boundaryReason),
                container: candidate.node
            )
            if verification.classification == .success {
                notes.append("Candidate rank \(candidate.rank) verified after \(strategy.rawValue).")
                finishCursor()
                return CandidateExecutionResult(
                    candidate: candidate,
                    cursor: cursor,
                    transports: transports,
                    verificationReads: reads,
                    verification: verification,
                    postStateToken: postStateToken,
                    frontmostBundleBeforeDispatch: frontmostBeforeDispatch,
                    frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
                    notes: notes
                )
            }
        }

        let verification = summarizeVerification(
            transports: transports,
            verificationReads: reads,
            boundaryReasons: transports.compactMap(\.boundaryReason),
            container: candidate.node
        )
        finishCursor()
        return CandidateExecutionResult(
            candidate: candidate,
            cursor: cursor,
            transports: transports,
            verificationReads: reads,
            verification: verification,
            postStateToken: postStateToken,
            frontmostBundleBeforeDispatch: frontmostBeforeDispatch,
            frontmostBundleAfter: NSWorkspace.shared.frontmostApplication?.bundleIdentifier,
            notes: notes
        )
    }

    private func attempt(
        strategy: ScrollStrategyDTO,
        mode: ScrollTransportModeDTO,
        candidate: ScrollCandidate,
        direction: ScrollDirectionDTO,
        pages: Int,
        window: ResolvedWindowDTO,
        resolvedContainer: AXActionResolvedLiveElement
    ) -> StrategyAttemptOutcome {
        switch strategy {
        case .axScrollToShowDescendant:
            return attemptShowDescendant(
                mode: mode,
                candidate: candidate,
                direction: direction,
                pages: pages,
                resolvedContainer: resolvedContainer
            )
        case .scrollbarValue:
            return attemptScrollbarMutation(
                mode: mode,
                candidate: candidate,
                direction: direction,
                pages: pages,
                resolvedContainer: resolvedContainer
            )
        case .axPageAction:
            return attemptPageAction(
                mode: mode,
                candidate: candidate,
                direction: direction,
                pages: pages,
                resolvedContainer: resolvedContainer
            )
        case .postToPIDPaging:
            return attemptPostToPIDPaging(
                mode: mode,
                candidate: candidate,
                direction: direction,
                pages: pages,
                window: window,
                resolvedContainer: resolvedContainer
            )
        case .targetedScrollWheelPostToPID:
            return attemptTargetedScrollWheelPostToPID(
                mode: mode,
                candidate: candidate,
                direction: direction,
                pages: pages,
                window: window,
                resolvedContainer: resolvedContainer
            )
        }
    }

    private func attemptShowDescendant(
        mode: ScrollTransportModeDTO,
        candidate: ScrollCandidate,
        direction: ScrollDirectionDTO,
        pages: Int,
        resolvedContainer: AXActionResolvedLiveElement
    ) -> StrategyAttemptOutcome {
        guard let containerFrame = AXHelpers.frame(resolvedContainer.element) else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .axScrollToShowDescendant,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "missing_container_frame",
                boundaryReason: nil,
                notes: ["Live container had no AX frame, so descendant reveal was skipped."]
            )
        }

        guard AXActionRuntimeSupport.parameterizedAttributeNames(resolvedContainer.element).contains(axScrollToShowDescendantAttribute) else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .axScrollToShowDescendant,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "attribute_unsupported",
                boundaryReason: nil,
                notes: ["Live container did not expose AXScrollToShowDescendant."]
            )
        }

        let offscreen = selectOffscreenDescendant(
            container: resolvedContainer.element,
            containerFrame: containerFrame,
            direction: direction,
            pages: pages
        )
        guard let offscreen else {
            let boundaryReason = "No offscreen descendant existed in direction \(direction.rawValue); this is a boundary if no later fallback moves the same pane."
            return nonDispatchTransport(
                mode: mode,
                strategy: .axScrollToShowDescendant,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "no_offscreen_descendant",
                boundaryReason: boundaryReason,
                notes: [
                    "AXScrollToShowDescendant requires an offscreen descendant in the requested direction."
                ]
            )
        }

        let error = AXActionRuntimeSupport.performParameterizedAttribute(
            axScrollToShowDescendantAttribute,
            on: resolvedContainer.element,
            parameter: offscreen.element
        )
        sleepRunLoop(0.06)
        return StrategyAttemptOutcome(
            transport: ScrollTransportAttemptDTO(
                mode: mode,
                strategy: .axScrollToShowDescendant,
                candidateRank: candidate.rank,
                actedOnTarget: candidate.target.dto,
                liveElementResolution: resolvedContainer.resolution,
                rawStatus: AXActionRuntimeSupport.rawStatusString(for: error),
                transportSuccess: error == .success,
                didDispatch: error == .success,
                boundaryReason: nil,
                notes: [
                    "Selected offscreen descendant: \(offscreen.note).",
                    "Live container resolution was \(resolvedContainer.resolution)."
                ]
            ),
            didDispatch: error == .success
        )
    }

    private func attemptScrollbarMutation(
        mode: ScrollTransportModeDTO,
        candidate: ScrollCandidate,
        direction: ScrollDirectionDTO,
        pages: Int,
        resolvedContainer: AXActionResolvedLiveElement
    ) -> StrategyAttemptOutcome {
        let bars = findScrollBars(in: resolvedContainer.element)
        let bar: AXUIElement?
        switch axis(for: direction) {
        case .vertical:
            bar = bars.vertical
        case .horizontal:
            bar = bars.horizontal
        }

        guard let bar else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .scrollbarValue,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "no_scrollbar",
                boundaryReason: nil,
                notes: ["No live scrollbar matched the requested axis."]
            )
        }

        guard let currentValue = AXActionRuntimeSupport.numberAttribute(bar, attribute: kAXValueAttribute as CFString) else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .scrollbarValue,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "missing_scrollbar_value",
                boundaryReason: nil,
                notes: ["The matched live scrollbar had no numeric AXValue."]
            )
        }

        let delta = suggestedScrollBarStep(for: resolvedContainer.element) * Double(pages)
        let signedDelta: Double = (direction == .down || direction == .right) ? delta : -delta
        let targetValue = min(max(currentValue + signedDelta, 0), 1)
        if abs(targetValue - currentValue) < 0.0001 {
            let boundaryReason = "The scrollbar was already at the \(direction.rawValue) boundary."
            return nonDispatchTransport(
                mode: mode,
                strategy: .scrollbarValue,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "scrollbar_boundary",
                boundaryReason: boundaryReason,
                notes: ["Scrollbar value was already \(format(currentValue))."]
            )
        }

        let error = AXActionRuntimeSupport.setNumberAttributeResult(
            bar,
            attribute: kAXValueAttribute as CFString,
            value: targetValue
        )
        sleepRunLoop(0.05)
        return StrategyAttemptOutcome(
            transport: ScrollTransportAttemptDTO(
                mode: mode,
                strategy: .scrollbarValue,
                candidateRank: candidate.rank,
                actedOnTarget: candidate.target.dto,
                liveElementResolution: resolvedContainer.resolution,
                rawStatus: AXActionRuntimeSupport.rawStatusString(for: error),
                transportSuccess: error == .success,
                didDispatch: error == .success,
                boundaryReason: nil,
                notes: ["Scrollbar value \(format(currentValue)) -> \(format(targetValue))."]
            ),
            didDispatch: error == .success
        )
    }

    private func attemptPageAction(
        mode: ScrollTransportModeDTO,
        candidate: ScrollCandidate,
        direction: ScrollDirectionDTO,
        pages: Int,
        resolvedContainer: AXActionResolvedLiveElement
    ) -> StrategyAttemptOutcome {
        let actionName = rawPageAction(for: direction)
        var performedCount = 0
        var lastError: AXError = .success

        for _ in 0..<max(pages, 1) {
            let error = AXActionRuntimeSupport.performAction(actionName, on: resolvedContainer.element)
            lastError = error
            guard error == .success else {
                break
            }
            performedCount += 1
            sleepRunLoop(0.05)
        }

        sleepRunLoop(0.05)
        return StrategyAttemptOutcome(
            transport: ScrollTransportAttemptDTO(
                mode: mode,
                strategy: .axPageAction,
                candidateRank: candidate.rank,
                actedOnTarget: candidate.target.dto,
                liveElementResolution: resolvedContainer.resolution,
                rawStatus: AXActionRuntimeSupport.rawStatusString(for: lastError),
                transportSuccess: performedCount > 0,
                didDispatch: performedCount > 0,
                boundaryReason: nil,
                notes: ["Attempted \(actionName) \(performedCount)x/\(max(pages, 1))x on the chosen live container."]
            ),
            didDispatch: performedCount > 0
        )
    }

    private func attemptPostToPIDPaging(
        mode: ScrollTransportModeDTO,
        candidate: ScrollCandidate,
        direction: ScrollDirectionDTO,
        pages: Int,
        window: ResolvedWindowDTO,
        resolvedContainer: AXActionResolvedLiveElement
    ) -> StrategyAttemptOutcome {
        guard let keyCode = pagingKeyCode(for: direction) else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .postToPIDPaging,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "direction_unsupported",
                boundaryReason: nil,
                notes: ["post_to_pid_paging currently supports only PageUp and PageDown."]
            )
        }

        guard let source = CGEventSource(stateID: .hidSystemState) else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .postToPIDPaging,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "event_source_unavailable",
                boundaryReason: nil,
                notes: ["CGEventSource(.hidSystemState) could not be created."]
            )
        }

        var postedCount = 0
        var lastStatus = "not_posted"
        for _ in 0..<max(pages, 1) {
            guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
                  let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
                lastStatus = "event_create_failed"
                break
            }

            keyDown.postToPid(window.pid)
            keyUp.postToPid(window.pid)
            postedCount += 1
            lastStatus = "posted"
            sleepRunLoop(0.05)
        }

        return StrategyAttemptOutcome(
            transport: ScrollTransportAttemptDTO(
                mode: mode,
                strategy: .postToPIDPaging,
                candidateRank: candidate.rank,
                actedOnTarget: candidate.target.dto,
                liveElementResolution: resolvedContainer.resolution,
                rawStatus: lastStatus,
                transportSuccess: postedCount > 0,
                didDispatch: postedCount > 0,
                boundaryReason: nil,
                notes: [
                    "Posted \(postedCount)x \(pagingKeyLabel(for: keyCode)) key events directly to pid \(window.pid).",
                    "post_to_pid_paging is process-scoped; verification must prove the captured window moved."
                ]
            ),
            didDispatch: postedCount > 0
        )
    }

    private func attemptTargetedScrollWheelPostToPID(
        mode: ScrollTransportModeDTO,
        candidate: ScrollCandidate,
        direction: ScrollDirectionDTO,
        pages: Int,
        window: ResolvedWindowDTO,
        resolvedContainer: AXActionResolvedLiveElement
    ) -> StrategyAttemptOutcome {
        guard axis(for: direction) == .vertical else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .targetedScrollWheelPostToPID,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "direction_unsupported",
                boundaryReason: nil,
                notes: ["targeted_scroll_wheel_post_to_pid currently supports only vertical directions."]
            )
        }

        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            return nonDispatchTransport(
                mode: mode,
                strategy: .targetedScrollWheelPostToPID,
                candidate: candidate,
                liveResolution: resolvedContainer.resolution,
                rawStatus: "event_source_unavailable",
                boundaryReason: nil,
                notes: ["CGEventSource(.combinedSessionState) could not be created."]
            )
        }

        let point = targetedScrollWheelPoint(for: candidate, window: window)
        let deltaY = scrollWheelDeltaY(for: direction)
        var postedCount = 0
        var lastStatus = "not_posted"

        for _ in 0..<max(pages, 1) {
            guard let event = CGEvent(
                scrollWheelEvent2Source: source,
                units: .pixel,
                wheelCount: 2,
                wheel1: deltaY,
                wheel2: 0,
                wheel3: 0
            ) else {
                lastStatus = "event_create_failed"
                break
            }

            event.location = point.point
            applyScrollEventRoutingFields(event, pid: window.pid, windowNumber: window.windowNumber)
            event.postToPid(window.pid)
            postedCount += 1
            lastStatus = "posted"
            sleepRunLoop(0.055)
        }

        return StrategyAttemptOutcome(
            transport: ScrollTransportAttemptDTO(
                mode: mode,
                strategy: .targetedScrollWheelPostToPID,
                candidateRank: candidate.rank,
                actedOnTarget: candidate.target.dto,
                liveElementResolution: resolvedContainer.resolution,
                rawStatus: lastStatus,
                transportSuccess: postedCount > 0,
                didDispatch: postedCount > 0,
                boundaryReason: nil,
                notes: [
                    "Posted \(postedCount)x routed CGEvent scroll-wheel events directly to pid \(window.pid), windowNumber \(window.windowNumber).",
                    "Scroll-wheel point source: \(point.source) at (\(format(point.point.x)), \(format(point.point.y))); deltaY=\(deltaY).",
                    "This fallback uses postToPid with routed window fields; it does not activate the target app, warp the cursor, or post to a global HID event tap.",
                    "Verification must prove the captured window moved."
                ] + point.notes
            ),
            didDispatch: postedCount > 0
        )
    }

    private func rereadAndVerify(
        mode: ScrollTransportModeDTO,
        beforeCapture: AXActionStateCapture,
        beforeLiveSnapshot: LiveContainerSnapshot,
        beforeWindowImage: CGImage?,
        requestedNode: AXPipelineV2SurfaceNodeDTO,
        containerNode: AXPipelineV2SurfaceNodeDTO,
        direction: ScrollDirectionDTO,
        pages _: Int
    ) -> [ScrollVerificationReadDTO] {
        var reads: [ScrollVerificationReadDTO] = []
        let verificationViewport = verificationViewport(for: containerNode, in: beforeCapture)

        for (offset, delay) in rereadDelaysMilliseconds.enumerated() {
            sleepRunLoop(Double(delay) / 1_000.0)
            let afterCapture = try? targetResolver.reread(after: beforeCapture)
            let afterWindowImage = CGWindowCaptureService.captureImage(window: beforeCapture.envelope.response.window)
            let matchedContainer = afterCapture.flatMap { locateVerificationNode(containerNode, in: $0) }
            let matchedTarget = afterCapture.flatMap { locateVerificationNode(requestedNode, in: $0) }
            let liveAfter = matchedContainer.flatMap { node -> LiveContainerSnapshot? in
                guard let afterCapture,
                      let resolved = try? targetResolver.resolveLiveElement(
                        for: targetResolver.targetSnapshot(for: node, in: afterCapture),
                        in: afterCapture
                      ) else {
                    return nil
                }
                return captureLiveContainerSnapshot(for: resolved.element)
            }

            reads.append(
                verifyRead(
                    readOrdinal: offset + 1,
                    delayMilliseconds: delay,
                    stateToken: afterCapture?.envelope.response.stateToken,
                    beforeCapture: beforeCapture,
                    afterCapture: afterCapture,
                    beforeWindowImage: beforeWindowImage,
                    afterWindowImage: afterWindowImage,
                    mode: mode,
                    requestedNode: requestedNode,
                    beforeContainer: containerNode,
                    verificationViewport: verificationViewport,
                    matchedContainer: matchedContainer,
                    matchedTarget: matchedTarget,
                    beforeLiveSnapshot: beforeLiveSnapshot,
                    afterLiveSnapshot: liveAfter,
                    direction: direction
                )
            )

            if reads.last?.strongEvidence == true {
                break
            }
        }

        return reads
    }

    private func verifyRead(
        readOrdinal: Int,
        delayMilliseconds: Int,
        stateToken: String?,
        beforeCapture: AXActionStateCapture,
        afterCapture: AXActionStateCapture?,
        beforeWindowImage: CGImage?,
        afterWindowImage: CGImage?,
        mode: ScrollTransportModeDTO,
        requestedNode _: AXPipelineV2SurfaceNodeDTO,
        beforeContainer: AXPipelineV2SurfaceNodeDTO,
        verificationViewport: VerificationViewport,
        matchedContainer: AXPipelineV2SurfaceNodeDTO?,
        matchedTarget _: AXPipelineV2SurfaceNodeDTO?,
        beforeLiveSnapshot: LiveContainerSnapshot,
        afterLiveSnapshot: LiveContainerSnapshot?,
        direction: ScrollDirectionDTO
    ) -> ScrollVerificationReadDTO {
        let beforeMetrics = metrics(
            for: beforeContainer,
            in: beforeCapture,
            liveSnapshot: beforeLiveSnapshot,
            visibleViewport: verificationViewport.rect
        )
        let afterMetrics = metrics(
            for: matchedContainer ?? beforeContainer,
            in: afterCapture ?? beforeCapture,
            liveSnapshot: afterLiveSnapshot,
            visibleViewport: verificationViewport.rect
        )

        let directWindowChange = compareWindowImages(
            before: beforeWindowImage,
            after: afterWindowImage,
            windowFrame: rect(from: beforeCapture.envelope.response.window.frameAppKit),
            regionInWindowCoordinates: verificationViewport.rect
        )
        let effectiveRegionChange = directWindowChange.regionChangeRatio
        let effectiveFullWindowChange = directWindowChange.fullImageChangeRatio

        let sameLabelDeltas = sameLabelFrameDeltas(
            before: beforeContainer,
            beforeCapture: beforeCapture,
            after: matchedContainer,
            afterCapture: afterCapture,
            visibleViewport: verificationViewport.rect
        )
        let sameLabelShift = sameLabelDeltas.map { axis(for: direction) == .vertical ? abs($0.deltaY) : abs($0.deltaX) }.max()
        let sameLabelDirectionMatched = directionMatches(direction, frameDeltas: sameLabelDeltas)

        let barDelta: Double?
        let rangeDelta: Int?
        switch axis(for: direction) {
        case .vertical:
            barDelta = delta(afterMetrics.verticalScrollBarValue, beforeMetrics.verticalScrollBarValue)
            rangeDelta = delta(afterMetrics.visibleCharacterRangeLocation, beforeMetrics.visibleCharacterRangeLocation)
        case .horizontal:
            barDelta = delta(afterMetrics.horizontalScrollBarValue, beforeMetrics.horizontalScrollBarValue)
            rangeDelta = nil
        }

        let visibleTextChanged = beforeMetrics.visibleTextDigest != afterMetrics.visibleTextDigest
        let visibleLabelSetChanged = beforeMetrics.visibleLabels != afterMetrics.visibleLabels
        let wrongPaneMovementLikely =
            (effectiveFullWindowChange ?? 0) > 0.03 &&
            (effectiveRegionChange ?? 0) < 0.012 &&
            barDelta == nil &&
            rangeDelta == nil &&
            sameLabelDirectionMatched == false &&
            visibleLabelSetChanged == false

        let observedDirection = inferObservedDirection(
            request: direction,
            scrollBarDelta: barDelta,
            visibleCharacterRangeDelta: rangeDelta,
            sameLabelDirectionMatched: sameLabelDirectionMatched,
            sameLabelDeltas: sameLabelDeltas,
            visibleLabelSetChanged: visibleLabelSetChanged,
            targetRegionChangeRatio: effectiveRegionChange
        )

        var evidence: [String] = []
        if let barDelta {
            evidence.append("scrollbar delta \(format(barDelta))")
        }
        if let rangeDelta {
            evidence.append("visible character range delta \(rangeDelta)")
        }
        if sameLabelDirectionMatched, let sameLabelShift {
            evidence.append("same labels moved by \(format(sameLabelShift)) px on the requested axis")
        }
        if visibleTextChanged {
            evidence.append("visible text digest changed")
        }
        if visibleLabelSetChanged {
            evidence.append("visible label set changed")
        }
        if let ratio = directWindowChange.regionChangeRatio {
            evidence.append("direct window target-region change ratio \(format(ratio))")
        }
        if let ratio = directWindowChange.fullImageChangeRatio {
            evidence.append("direct window full-image change ratio \(format(ratio))")
        }
        if let source = verificationViewport.source, source != "requested_container" {
            evidence.append("verification viewport source \(source)")
        }
        if wrongPaneMovementLikely {
            evidence.append("full window changed more than the target region, so wrong-pane movement is likely")
        }
        if evidence.isEmpty {
            evidence.append("no strong movement signal was observed on this reread")
        }

        let opaqueVisualMovementConfirmed =
            mode == .postToPIDPaging &&
            (effectiveRegionChange ?? 0) >= 0.05 &&
            (effectiveFullWindowChange ?? 0) >= 0.05 &&
            wrongPaneMovementLikely == false
        let directVisualMovementConfirmed =
            (effectiveRegionChange ?? 0) >= 0.05 &&
            (effectiveFullWindowChange ?? 0) >= 0.02 &&
            wrongPaneMovementLikely == false

        let strongEvidence =
            directionMatches(direction, scrollBarDelta: barDelta) ||
            directionMatches(direction, visibleCharacterRangeDelta: rangeDelta) ||
            (sameLabelDirectionMatched && (sameLabelShift ?? 0) >= 2) ||
            ((visibleTextChanged || visibleLabelSetChanged) && (effectiveRegionChange ?? 0) >= 0.02 && !wrongPaneMovementLikely) ||
            opaqueVisualMovementConfirmed ||
            directVisualMovementConfirmed

        if opaqueVisualMovementConfirmed {
            evidence.append("opaque transport confirmed by direct window movement without foreground activation")
        }

        return ScrollVerificationReadDTO(
            readOrdinal: readOrdinal,
            delayMilliseconds: delayMilliseconds,
            stateToken: stateToken,
            observedDirection: observedDirection,
            targetedScrollBarDelta: barDelta,
            visibleCharacterRangeDelta: rangeDelta,
            visibleTextChanged: visibleTextChanged,
            visibleLabelSetChanged: visibleLabelSetChanged,
            sameLabelFrameShift: sameLabelShift,
            sameLabelFrameDirectionMatched: sameLabelDirectionMatched,
            targetRegionChangeRatio: nil,
            fullWindowChangeRatio: nil,
            directTargetRegionChangeRatio: directWindowChange.regionChangeRatio,
            directFullWindowChangeRatio: directWindowChange.fullImageChangeRatio,
            wrongPaneMovementLikely: wrongPaneMovementLikely,
            strongEvidence: strongEvidence,
            evidence: evidence
        )
    }

    private func summarizeVerification(
        transports: [ScrollTransportAttemptDTO],
        verificationReads: [ScrollVerificationReadDTO],
        boundaryReasons: [String],
        container: AXPipelineV2SurfaceNodeDTO
    ) -> ScrollVerificationSummaryDTO {
        if let matchedRead = verificationReads.first(where: { $0.strongEvidence }) {
            return ScrollVerificationSummaryDTO(
                classification: .success,
                issueBucket: .none,
                matchedOnReadOrdinal: matchedRead.readOrdinal,
                finalObservedDirection: matchedRead.observedDirection,
                evidence: matchedRead.evidence
            )
        }

        if let wrongPane = verificationReads.first(where: { $0.wrongPaneMovementLikely }) {
            return ScrollVerificationSummaryDTO(
                classification: .verifierAmbiguous,
                issueBucket: .targeting,
                matchedOnReadOrdinal: wrongPane.readOrdinal,
                finalObservedDirection: wrongPane.observedDirection,
                evidence: wrongPane.evidence
            )
        }

        if boundaryReasons.isEmpty == false, verificationReads.allSatisfy({ $0.strongEvidence == false }) {
            return ScrollVerificationSummaryDTO(
                classification: .boundary,
                issueBucket: .none,
                matchedOnReadOrdinal: nil,
                finalObservedDirection: verificationReads.last?.observedDirection ?? "no_change",
                evidence: boundaryReasons
            )
        }

        let hasOpaqueSurface = isOpaqueHintNode(container)
        let anyTransportSuccess = transports.contains { $0.transportSuccess }
        let anyDispatch = transports.contains { $0.didDispatch }
        let latestEvidence = verificationReads.last?.evidence ?? ["No post-scroll evidence was recorded."]
        let latestDirection = verificationReads.last?.observedDirection ?? "no_change"
        let definitelyNoMovement = verificationReads.isEmpty == false && verificationReads.allSatisfy { read in
            read.targetedScrollBarDelta == nil &&
                read.visibleCharacterRangeDelta == nil &&
                read.visibleTextChanged == false &&
                read.visibleLabelSetChanged == false &&
                (read.sameLabelFrameShift ?? 0) < 1 &&
                (read.targetRegionChangeRatio ?? 0) < 0.018 &&
                (read.fullWindowChangeRatio ?? 0) < 0.018 &&
                (read.directTargetRegionChangeRatio ?? 0) < 0.018 &&
                (read.directFullWindowChangeRatio ?? 0) < 0.018
        }

        if anyTransportSuccess && verificationReads.isEmpty == false {
            if definitelyNoMovement {
                return ScrollVerificationSummaryDTO(
                    classification: .unsupported,
                    issueBucket: .transport,
                    matchedOnReadOrdinal: nil,
                    finalObservedDirection: "no_change",
                    evidence: latestEvidence + ["Multiple rereads and direct window checks stayed effectively static after an AX-reported success."]
                )
            }
            return ScrollVerificationSummaryDTO(
                classification: .verifierAmbiguous,
                issueBucket: hasOpaqueSurface ? .opacity : .verification,
                matchedOnReadOrdinal: nil,
                finalObservedDirection: latestDirection,
                evidence: latestEvidence
            )
        }

        if anyDispatch {
            return ScrollVerificationSummaryDTO(
                classification: .unsupported,
                issueBucket: hasOpaqueSurface ? .opacity : .transport,
                matchedOnReadOrdinal: nil,
                finalObservedDirection: latestDirection,
                evidence: latestEvidence
            )
        }

        return ScrollVerificationSummaryDTO(
            classification: .unresolved,
            issueBucket: .targeting,
            matchedOnReadOrdinal: nil,
            finalObservedDirection: latestDirection,
            evidence: ["No ladder rung could issue a dispatch against the resolved container."]
        )
    }

    private func classifySurface(
        requestedNode: AXPipelineV2SurfaceNodeDTO,
        candidates: [ScrollCandidate],
        capture: AXActionStateCapture,
        window: ResolvedWindowDTO
    ) -> ScrollSurfaceClass {
        guard candidates.isEmpty == false else {
            return .unresolved
        }

        if isOpaqueWindowOnlySurface(
            requestedNode: requestedNode,
            candidates: candidates,
            capture: capture,
            window: window
        ) {
            return .opaqueWindowOnly
        }

        let candidateNodes = [requestedNode] + candidates.map(\.node)
        if candidateNodes.contains(where: isOpaqueHintNode(_:)) {
            return .opaqueWeb
        }

        if candidateNodes.contains(where: isNativeTransparentScrollNode(_:)) {
            return .nativeTransparent
        }

        if candidateNodes.contains(where: hasScrollDispatchSignal(_:)) {
            return .nativeTransparent
        }

        return .staticOrBoundary
    }

    private func axStrategyOrder(for surfaceClass: ScrollSurfaceClass) -> [ScrollStrategyDTO] {
        switch surfaceClass {
        case .nativeTransparent:
            return [.axScrollToShowDescendant, .scrollbarValue, .axPageAction]
        case .opaqueWeb:
            return [.scrollbarValue]
        case .staticOrBoundary:
            return [.axScrollToShowDescendant, .scrollbarValue]
        case .opaqueWindowOnly, .unresolved:
            return []
        }
    }

    private func isOpaqueWindowOnlySurface(
        requestedNode: AXPipelineV2SurfaceNodeDTO,
        candidates: [ScrollCandidate],
        capture: AXActionStateCapture,
        window: ResolvedWindowDTO
    ) -> Bool {
        let hasWindowCandidate = ([requestedNode] + candidates.map(\.node)).contains { $0.rawRole == kAXWindowRole as String }
        guard hasWindowCandidate else {
            return false
        }
        guard let strongest = candidates.first?.node,
              strongest.rawRole == kAXWindowRole as String ||
              requestedNode.rawRole == kAXWindowRole as String else {
            return false
        }
        guard isLargeVisibleContentSurface(strongest, window: window) || isLargeVisibleContentSurface(requestedNode, window: window) else {
            return false
        }

        let usefulDescendants = capture.envelope.response.tree.nodes.contains { node in
            guard node.projectedIndex != requestedNode.projectedIndex,
                  node.rawRole != kAXWindowRole as String,
                  isSubstantialVisibleNode(node) else {
                return false
            }
            return isNativeTransparentScrollNode(node) || isOpaqueHintNode(node)
        }
        return usefulDescendants == false
    }

    private func isNativeTransparentScrollNode(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        let role = node.rawRole ?? ""
        if role == "AXScrollArea" ||
            role == "AXOutline" ||
            role == "AXTable" ||
            role == "AXTextArea" ||
            role == "AXCollection" ||
            role == "AXList" ||
            role == "AXListBox" ||
            role == "AXContentList" {
            return true
        }
        if node.interactionTraits?.isPotentialScrollContainer == true && isOpaqueHintNode(node) == false {
            return true
        }
        return false
    }

    private func hasScrollDispatchSignal(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        let actionNames = Set(actionNames(for: node))
        if actionNames.contains("AXScrollDownByPage") ||
            actionNames.contains("AXScrollUpByPage") ||
            actionNames.contains("AXScrollLeftByPage") ||
            actionNames.contains("AXScrollRightByPage") {
            return true
        }
        if node.parameterizedAttributes?.contains(axScrollToShowDescendantAttribute) == true {
            return true
        }
        return false
    }

    private func isLargeVisibleContentSurface(_ node: AXPipelineV2SurfaceNodeDTO, window: ResolvedWindowDTO) -> Bool {
        guard let frame = node.frameAppKit.map(rect(from:)) else {
            return node.rawRole == kAXWindowRole as String
        }
        let windowFrame = rect(from: window.frameAppKit)
        let areaRatio = (frame.width * frame.height) / max(windowFrame.width * windowFrame.height, 1)
        return areaRatio >= 0.55 && frame.width >= 240 && frame.height >= 180
    }

    private func isSubstantialVisibleNode(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        guard let frame = node.frameAppKit.map(rect(from:)) else {
            return false
        }
        return frame.width >= 80 && frame.height >= 80
    }

    private func scoreContainerCandidates(
        for target: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture
    ) -> [ScrollCandidate] {
        let lineage = targetResolver.ancestorTargetSnapshots(startingAt: target, in: capture)
        let scored = lineage.compactMap { entry -> (node: AXPipelineV2SurfaceNodeDTO, target: AXActionTargetSnapshot, score: Int, reasons: [String])? in
            let score = score(candidate: entry.node, requestTarget: target)
            guard score.score > 0 else {
                return nil
            }
            return (entry.node, entry.target, score.score, score.reasons)
        }
        .sorted { lhs, rhs in
            if lhs.score != rhs.score {
                return lhs.score > rhs.score
            }
            if lhs.node.projectedIndex != rhs.node.projectedIndex {
                return lhs.node.projectedIndex == target.projectedIndex
            }
            return lhs.node.depth > rhs.node.depth
        }

        return scored.enumerated().map { offset, entry in
            ScrollCandidate(
                rank: offset + 1,
                node: entry.node,
                target: entry.target,
                score: entry.score,
                reasons: entry.reasons
            )
        }
    }

    private func score(
        candidate: AXPipelineV2SurfaceNodeDTO,
        requestTarget target: AXPipelineV2SurfaceNodeDTO
    ) -> (score: Int, reasons: [String]) {
        var score = 0
        var reasons: [String] = []
        let role = candidate.rawRole ?? ""
        let traits = candidate.interactionTraits
        let actionNames = Set(actionNames(for: candidate))
        let parameterizedAttributes = Set(candidate.parameterizedAttributes ?? [])

        if candidate.projectedIndex == target.projectedIndex {
            score += 20
            reasons.append("requested node")
        } else {
            let distance = max(1, abs(candidate.depth - target.depth))
            let bonus = max(6, 18 - abs(distance * 3))
            score += bonus
            reasons.append("ancestor distance bonus +\(bonus)")
        }

        if traits?.supportsScrollToShowDescendant == true {
            score += 95
            reasons.append("supports AXScrollToShowDescendant")
        }
        if traits?.isPotentialScrollContainer == true {
            score += 65
            reasons.append("interaction traits mark a scroll container")
        }
        if traits?.isPotentialScrollBar == true {
            score -= 80
            reasons.append("scroll bar is not preferred as the primary container")
        }
        if traits?.supportsValueSet == true {
            score += 12
            reasons.append("value-settable")
        }

        switch role {
        case "AXScrollArea":
            score += 48
            reasons.append("AXScrollArea")
        case "AXOutline":
            score += 42
            reasons.append("AXOutline")
        case "AXTable":
            score += 40
            reasons.append("AXTable")
        case "AXTextArea":
            score += 34
            reasons.append("AXTextArea")
        case "AXWebArea":
            score += 28
            reasons.append("AXWebArea")
        case "AXCollection", "AXList", "AXListBox", "AXContentList":
            score += 24
            reasons.append("list-like container role")
        case "AXGroup", "AXUnknown":
            score += 6
            reasons.append("weak role match only")
        default:
            break
        }

        if actionNames.contains("AXScrollDownByPage") || actionNames.contains("AXScrollUpByPage") ||
            actionNames.contains("AXScrollLeftByPage") || actionNames.contains("AXScrollRightByPage") {
            score += 16
            reasons.append("advertises raw AX page scroll actions")
        }
        if parameterizedAttributes.contains(axScrollToShowDescendantAttribute) {
            score += 12
            reasons.append("parameterized attribute inventory includes AXScrollToShowDescendant")
        }
        if candidate.childIndices.isEmpty == false {
            score += 8
            reasons.append("has projected children")
        }
        if candidate.value?.preview?.isEmpty == false || candidate.title?.isEmpty == false || candidate.description?.isEmpty == false {
            score += 6
            reasons.append("has visible label/value content")
        }
        if let frame = candidate.frameAppKit.map(rect(from:)), frame.width >= 80, frame.height >= 80 {
            score += 6
            reasons.append("substantial visible frame")
        }

        return (score, reasons)
    }

    private func shouldAttemptOpaqueFallback(
        surfaceClass: ScrollSurfaceClass,
        direction: ScrollDirectionDTO,
        requestedNode: AXPipelineV2SurfaceNodeDTO,
        candidates: [ScrollCandidate],
        window: ResolvedWindowDTO
    ) -> Bool {
        guard axis(for: direction) == .vertical else {
            return false
        }
        if surfaceClass == .opaqueWeb || surfaceClass == .opaqueWindowOnly {
            return true
        }
        if ([requestedNode] + candidates.map(\.node)).contains(where: isOpaqueHintNode(_:)) {
            return true
        }
        guard let strongest = candidates.first?.node else {
            return false
        }
        let lacksStrongAXTraits =
            strongest.interactionTraits?.supportsScrollToShowDescendant != true &&
            strongest.interactionTraits?.isPotentialScrollContainer != true &&
            actionNames(for: strongest).contains("AXScrollDownByPage") == false &&
            actionNames(for: strongest).contains("AXScrollUpByPage") == false

        return lacksStrongAXTraits &&
            strongest.rawRole == kAXGroupRole as String &&
            opaqueCandidateScore(for: strongest, window: window.frameAppKit) >= 40
    }

    private func preferredOpaqueFallbackCandidate(
        from candidates: [ScrollCandidate],
        window: ResolvedWindowDTO
    ) -> ScrollCandidate? {
        candidates.max { lhs, rhs in
            opaqueCandidateScore(for: lhs.node, window: window.frameAppKit) <
                opaqueCandidateScore(for: rhs.node, window: window.frameAppKit)
        }
    }

    private func opaqueCandidateScore(for node: AXPipelineV2SurfaceNodeDTO, window: RectDTO?) -> Int {
        var score = 0
        if let frame = node.frameAppKit.map(rect(from:)), let windowFrame = window.map(rect(from:)) {
            let areaRatio = (frame.width * frame.height) / max(windowFrame.width * windowFrame.height, 1)
            score += Int(areaRatio * 100)
        }
        if node.rawRole == "AXWebArea" {
            score += 24
        }
        if node.rawRole == kAXGroupRole as String {
            score += 20
        }
        if node.rawRole == kAXWindowRole as String {
            score -= 40
        }
        if isOpaqueHintNode(node) {
            score += 18
        }
        return score
    }

    private func isOpaqueHintNode(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        if node.rawRole == "AXWebArea" {
            return true
        }
        if node.profileHint?.localizedCaseInsensitiveContains("web") == true {
            return true
        }
        if node.url?.isEmpty == false {
            return true
        }
        return false
    }

    private func metrics(
        for container: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture,
        liveSnapshot: LiveContainerSnapshot?,
        visibleViewport: CGRect?
    ) -> ScrollContainerMetrics {
        let visibleLabels = subtreeVisibleLabels(for: container, in: capture, visibleViewport: visibleViewport)
        let visibleTextDigest =
            container.value?.preview ??
            container.title ??
            container.description ??
            (visibleLabels.isEmpty ? nil : visibleLabels.prefix(12).joined(separator: " | "))

        return ScrollContainerMetrics(
            visibleLabels: visibleLabels,
            visibleTextDigest: visibleTextDigest,
            verticalScrollBarValue: liveSnapshot?.verticalScrollBarValue,
            horizontalScrollBarValue: liveSnapshot?.horizontalScrollBarValue,
            visibleCharacterRangeLocation: liveSnapshot?.visibleCharacterRange?.location
        )
    }

    private func subtreeVisibleLabels(
        for container: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture,
        visibleViewport: CGRect?
    ) -> [String] {
        let subtree = capture.envelope.response.tree.nodes.filter { isDescendant($0, of: container, in: capture) }
        let clipRect = visibleViewport ?? container.frameAppKit.map(rect(from:))
        var entries: [(label: String, frame: CGRect)] = []

        for node in subtree {
            guard let label = label(for: node),
                  let frame = node.frameAppKit.map(rect(from:)) else {
                continue
            }
            if let clipRect, clipRect.intersects(frame) == false {
                continue
            }
            entries.append((label, frame))
        }

        var seen = Set<String>()
        return entries
            .sorted { lhs, rhs in
                if lhs.frame.minY != rhs.frame.minY {
                    return lhs.frame.minY < rhs.frame.minY
                }
                return lhs.frame.minX < rhs.frame.minX
            }
            .compactMap { entry in
                let key = AXActionRuntimeSupport.normalize(entry.label)
                guard key.isEmpty == false, seen.insert(key).inserted else {
                    return nil
                }
                return entry.label
            }
    }

    private func sameLabelFrameDeltas(
        before beforeContainer: AXPipelineV2SurfaceNodeDTO,
        beforeCapture: AXActionStateCapture,
        after afterContainer: AXPipelineV2SurfaceNodeDTO?,
        afterCapture: AXActionStateCapture?,
        visibleViewport: CGRect?
    ) -> [ScrollFrameDelta] {
        guard let afterCapture else {
            return []
        }
        let afterContainer = afterContainer ?? beforeContainer
        let beforeFrames = frameMap(for: beforeContainer, in: beforeCapture, visibleViewport: visibleViewport)
        let afterFrames = frameMap(for: afterContainer, in: afterCapture, visibleViewport: visibleViewport)

        return beforeFrames.compactMap { key, beforeEntry in
            guard let afterEntry = afterFrames[key] else {
                return nil
            }
            return ScrollFrameDelta(
                label: beforeEntry.label,
                role: beforeEntry.role,
                deltaX: afterEntry.frame.minX - beforeEntry.frame.minX,
                deltaY: afterEntry.frame.minY - beforeEntry.frame.minY
            )
        }
    }

    private func frameMap(
        for container: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture,
        visibleViewport: CGRect?
    ) -> [String: (label: String, role: String?, frame: CGRect)] {
        let subtree = capture.envelope.response.tree.nodes.filter { isDescendant($0, of: container, in: capture) }
        let clipRect = visibleViewport ?? container.frameAppKit.map(rect(from:))
        var result: [String: (label: String, role: String?, frame: CGRect)] = [:]

        for node in subtree {
            guard let label = label(for: node),
                  let frame = node.frameAppKit.map(rect(from:)) else {
                continue
            }
            if let clipRect, clipRect.intersects(frame) == false {
                continue
            }
            let key = "\(AXActionRuntimeSupport.normalize(label))|\(AXActionRuntimeSupport.normalize(node.rawRole))"
            guard result[key] == nil else {
                continue
            }
            result[key] = (label, node.rawRole, frame)
        }
        return result
    }

    private func verificationViewport(
        for container: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture
    ) -> VerificationViewport {
        let windowFrame = rect(from: capture.envelope.response.window.frameAppKit)
        let containerRect = verificationRegionCandidate(for: container, in: capture, windowFrame: windowFrame)

        if isUsableVerificationRect(containerRect, within: windowFrame) {
            return VerificationViewport(rect: containerRect, source: "requested_container", sourceNode: container)
        }

        var cursor = container.parentIndex.flatMap { projectedIndex in
            capture.envelope.response.tree.nodes.first { $0.projectedIndex == projectedIndex || $0.index == projectedIndex }
        }
        var remaining = 12
        while remaining > 0, let ancestor = cursor {
            let ancestorRect = verificationRegionCandidate(for: ancestor, in: capture, windowFrame: windowFrame)
            if isUsableVerificationRect(ancestorRect, within: windowFrame) {
                return VerificationViewport(rect: ancestorRect, source: "ancestor_index_\(ancestor.projectedIndex)", sourceNode: ancestor)
            }
            cursor = ancestor.parentIndex.flatMap { projectedIndex in
                capture.envelope.response.tree.nodes.first { $0.projectedIndex == projectedIndex || $0.index == projectedIndex }
            }
            remaining -= 1
        }

        if let containerRect {
            return VerificationViewport(rect: containerRect, source: "requested_container_clipped", sourceNode: container)
        }

        return VerificationViewport(rect: windowFrame, source: "window_fallback", sourceNode: nil)
    }

    private func verificationRegionCandidate(
        for container: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture,
        windowFrame: CGRect
    ) -> CGRect? {
        var union = clippedVisibleRect(container.frameAppKit.map(rect(from:)), within: windowFrame)

        for node in capture.envelope.response.tree.nodes where isDescendant(node, of: container, in: capture) {
            guard node.projectedIndex != container.projectedIndex,
                  let clipped = clippedVisibleRect(node.frameAppKit.map(rect(from:)), within: windowFrame) else {
                continue
            }
            union = union.map { $0.union(clipped) } ?? clipped
        }

        guard let union else {
            return nil
        }
        let clippedUnion = union.intersection(windowFrame)
        guard clippedUnion.isNull == false, clippedUnion.isEmpty == false else {
            return nil
        }
        return clippedUnion
    }

    private func captureLiveContainerSnapshot(for element: AXUIElement) -> LiveContainerSnapshot {
        let bars = findScrollBars(in: element)
        return LiveContainerSnapshot(
            verticalScrollBarValue: bars.vertical.flatMap { AXActionRuntimeSupport.numberAttribute($0, attribute: kAXValueAttribute as CFString) },
            horizontalScrollBarValue: bars.horizontal.flatMap { AXActionRuntimeSupport.numberAttribute($0, attribute: kAXValueAttribute as CFString) },
            visibleCharacterRange: AXActionRuntimeSupport.visibleCharacterRange(element)
        )
    }

    private func findScrollBars(in element: AXUIElement) -> (vertical: AXUIElement?, horizontal: AXUIElement?) {
        var vertical = AXActionRuntimeSupport.elementAttribute(element, attribute: kAXVerticalScrollBarAttribute as CFString)
        var horizontal = AXActionRuntimeSupport.elementAttribute(element, attribute: kAXHorizontalScrollBarAttribute as CFString)
        if vertical != nil && horizontal != nil {
            return (vertical, horizontal)
        }

        for child in AXActionRuntimeSupport.descendants(of: element, limit: 120) {
            guard AXActionRuntimeSupport.stringAttribute(child, attribute: kAXRoleAttribute as CFString) == (kAXScrollBarRole as String) else {
                continue
            }
            let orientation = AXActionRuntimeSupport.stringAttribute(child, attribute: kAXOrientationAttribute as CFString)
            if vertical == nil, orientation == (kAXVerticalOrientationValue as String) {
                vertical = child
            }
            if horizontal == nil, orientation == (kAXHorizontalOrientationValue as String) {
                horizontal = child
            }
        }

        return (vertical, horizontal)
    }

    private func selectOffscreenDescendant(
        container: AXUIElement,
        containerFrame: CGRect,
        direction: ScrollDirectionDTO,
        pages: Int
    ) -> OffscreenDescendantPick? {
        let desired = desiredOverflowDistance(direction: direction, containerFrame: containerFrame, pages: pages)

        return AXActionRuntimeSupport.descendants(of: container, limit: 8_000)
            .compactMap { descendant -> OffscreenDescendantPick? in
                guard let frame = AXHelpers.frame(descendant) else {
                    return nil
                }
                let offscreen: Bool
                switch direction {
                case .down:
                    offscreen = frame.maxY < containerFrame.minY
                case .up:
                    offscreen = frame.minY > containerFrame.maxY
                case .left:
                    offscreen = frame.minX > containerFrame.maxX
                case .right:
                    offscreen = frame.maxX < containerFrame.minX
                }
                guard offscreen else {
                    return nil
                }

                let overflow = offscreenDistance(direction: direction, container: containerFrame, frame: frame)
                let role = AXActionRuntimeSupport.stringAttribute(descendant, attribute: kAXRoleAttribute as CFString) ?? "?"
                let label = AXActionRuntimeSupport.label(descendant) ?? "unlabelled"
                return OffscreenDescendantPick(
                    element: descendant,
                    overflow: overflow,
                    note: "overflow=\(Int(overflow)) role=\(role) label=\(label)"
                )
            }
            .min(by: { abs($0.overflow - desired) < abs($1.overflow - desired) })
    }

    private func locateVerificationNode(
        _ target: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture
    ) -> AXPipelineV2SurfaceNodeDTO? {
        if let nodeID = target.nodeID,
           let match = capture.envelope.response.tree.nodes.first(where: { $0.nodeID == nodeID }) {
            return match
        }
        if let fingerprint = target.refetchFingerprint,
           let match = capture.envelope.response.tree.nodes.first(where: { $0.refetchFingerprint == fingerprint }) {
            return match
        }
        if let match = capture.envelope.response.tree.nodes.first(where: {
            AXActionRuntimeSupport.normalize($0.title) == AXActionRuntimeSupport.normalize(target.title) &&
                AXActionRuntimeSupport.normalize($0.identifier) == AXActionRuntimeSupport.normalize(target.identifier) &&
                AXActionRuntimeSupport.normalize($0.rawRole) == AXActionRuntimeSupport.normalize(target.rawRole)
        }) {
            return match
        }
        return targetResolver.resolveSurfaceNode(projectedIndex: target.projectedIndex, in: capture)
    }

    private func isDescendant(
        _ candidate: AXPipelineV2SurfaceNodeDTO,
        of ancestor: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture
    ) -> Bool {
        if candidate.projectedIndex == ancestor.projectedIndex {
            return true
        }
        var cursor = candidate.parentIndex.flatMap { targetResolver.resolveSurfaceNode(projectedIndex: $0, in: capture) }
        var remaining = 18
        while remaining > 0, let resolved = cursor {
            if resolved.projectedIndex == ancestor.projectedIndex {
                return true
            }
            cursor = resolved.parentIndex.flatMap { targetResolver.resolveSurfaceNode(projectedIndex: $0, in: capture) }
            remaining -= 1
        }
        return false
    }

    private func label(for node: AXPipelineV2SurfaceNodeDTO) -> String? {
        AXActionRuntimeSupport.sanitizedLabel(node.title) ??
            AXActionRuntimeSupport.sanitizedLabel(node.description) ??
            AXActionRuntimeSupport.sanitizedLabel(node.identifier)
    }

    private func nonDispatchTransport(
        mode: ScrollTransportModeDTO,
        strategy: ScrollStrategyDTO,
        candidate: ScrollCandidate,
        liveResolution: String?,
        rawStatus: String,
        boundaryReason: String?,
        notes: [String]
    ) -> StrategyAttemptOutcome {
        StrategyAttemptOutcome(
            transport: ScrollTransportAttemptDTO(
                mode: mode,
                strategy: strategy,
                candidateRank: candidate.rank,
                actedOnTarget: candidate.target.dto,
                liveElementResolution: liveResolution,
                rawStatus: rawStatus,
                transportSuccess: false,
                didDispatch: false,
                boundaryReason: boundaryReason,
                notes: notes
            ),
            didDispatch: false
        )
    }

    private func response(
        classification: ScrollActionClassificationDTO,
        failureDomain: ActionFailureDomainDTO?,
        issueBucket: ScrollIssueBucketDTO,
        summary: String,
        window: ResolvedWindowDTO?,
        requestedTarget: AXActionTargetSnapshot?,
        chosenContainer: AXActionTargetSnapshot?,
        direction: ScrollDirectionDTO,
        pages: Int,
        planCandidates: [ScrollCandidateDTO],
        transports: [ScrollTransportAttemptDTO],
        preStateToken: String?,
        postStateToken: String?,
        cursor: ActionCursorTargetResponseDTO,
        frontmostBundleBefore: String?,
        frontmostBundleBeforeDispatch: String?,
        frontmostBundleAfter: String?,
        warnings: [String],
        notes: [String],
        verification: ScrollVerificationSummaryDTO?,
        verificationReads: [ScrollVerificationReadDTO]
    ) -> ScrollResponse {
        ScrollResponse(
            contractVersion: ContractVersion.current,
            ok: classification == .success,
            classification: classification,
            failureDomain: failureDomain,
            issueBucket: issueBucket,
            summary: summary,
            window: window,
            requestedTarget: requestedTarget?.dto,
            chosenContainer: chosenContainer?.dto,
            direction: direction,
            pages: pages,
            winningMode: winningTransport(in: transports, classification: classification)?.mode,
            winningStrategy: winningTransport(in: transports, classification: classification)?.strategy,
            planCandidates: planCandidates,
            transports: transports,
            preStateToken: preStateToken,
            postStateToken: postStateToken,
            cursor: cursor,
            frontmostBundleBefore: frontmostBundleBefore,
            frontmostBundleBeforeDispatch: frontmostBundleBeforeDispatch,
            frontmostBundleAfter: frontmostBundleAfter,
            warnings: Array(Set(warnings)).sorted(),
            notes: notes,
            verification: verification,
            verificationReads: verificationReads
        )
    }

    private func failureDomain(for verification: ScrollVerificationSummaryDTO) -> ActionFailureDomainDTO? {
        switch verification.classification {
        case .success, .boundary:
            return nil
        case .unresolved:
            return .targeting
        case .unsupported:
            return verification.issueBucket == .targeting ? .targeting : .transport
        case .verifierAmbiguous:
            return verification.issueBucket == .targeting ? .targeting : .verification
        }
    }

    private func summaryText(for verification: ScrollVerificationSummaryDTO) -> String {
        switch verification.classification {
        case .success:
            return "Scroll succeeded and reread verification found movement in the requested surface."
        case .boundary:
            return "Scroll did not dispatch because the target appears to be at the requested boundary."
        case .unsupported:
            return "Scroll was attempted, but the route could not verify movement after rereads."
        case .unresolved:
            return "Scroll could not resolve a dispatchable scroll container."
        case .verifierAmbiguous:
            return "Scroll produced some movement signal, but verification could not prove the intended pane moved."
        }
    }

    private func normalizedPages(_ requested: Int?, warnings: inout [String]) -> Int {
        let raw = requested ?? 1
        if raw < 1 {
            warnings.append("Requested pages was below 1 and was clamped to 1.")
            return 1
        }
        if raw > 10 {
            warnings.append("Requested pages was above 10 and was clamped to 10 for safety.")
            return 10
        }
        return raw
    }

    private func actionNames(for node: AXPipelineV2SurfaceNodeDTO) -> [String] {
        if let available = node.availableActions, available.isEmpty == false {
            return available.map(\.rawName)
        }
        if let curated = node.curatedAvailableActions, curated.isEmpty == false {
            return curated.map(\.rawName)
        }
        return node.secondaryActions + (node.curatedSecondaryActions ?? [])
    }

    private enum Axis {
        case vertical
        case horizontal
    }

    private func axis(for direction: ScrollDirectionDTO) -> Axis {
        switch direction {
        case .up, .down:
            return .vertical
        case .left, .right:
            return .horizontal
        }
    }

    private func directionMatches(_ request: ScrollDirectionDTO, scrollBarDelta: Double?) -> Bool {
        guard let scrollBarDelta, abs(scrollBarDelta) > 0.0001 else {
            return false
        }
        switch request {
        case .down, .right:
            return scrollBarDelta > 0
        case .up, .left:
            return scrollBarDelta < 0
        }
    }

    private func directionMatches(_ request: ScrollDirectionDTO, visibleCharacterRangeDelta: Int?) -> Bool {
        guard let visibleCharacterRangeDelta, visibleCharacterRangeDelta != 0 else {
            return false
        }
        switch request {
        case .down, .right:
            return visibleCharacterRangeDelta > 0
        case .up, .left:
            return visibleCharacterRangeDelta < 0
        }
    }

    private func directionMatches(_ request: ScrollDirectionDTO, frameDeltas: [ScrollFrameDelta]) -> Bool {
        guard frameDeltas.isEmpty == false else {
            return false
        }
        switch axis(for: request) {
        case .vertical:
            let average = frameDeltas.map(\.deltaY).reduce(0, +) / Double(frameDeltas.count)
            switch request {
            case .down:
                return average > 1.5
            case .up:
                return average < -1.5
            default:
                return false
            }
        case .horizontal:
            let average = frameDeltas.map(\.deltaX).reduce(0, +) / Double(frameDeltas.count)
            switch request {
            case .right:
                return average < -1.5
            case .left:
                return average > 1.5
            default:
                return false
            }
        }
    }

    private func inferObservedDirection(
        request: ScrollDirectionDTO,
        scrollBarDelta: Double?,
        visibleCharacterRangeDelta: Int?,
        sameLabelDirectionMatched: Bool,
        sameLabelDeltas: [ScrollFrameDelta],
        visibleLabelSetChanged: Bool,
        targetRegionChangeRatio: Double?
    ) -> String {
        if directionMatches(request, scrollBarDelta: scrollBarDelta) {
            return request.rawValue
        }
        if directionMatches(request, visibleCharacterRangeDelta: visibleCharacterRangeDelta) {
            return request.rawValue
        }
        if sameLabelDirectionMatched {
            return request.rawValue
        }
        if sameLabelDeltas.isEmpty == false {
            return "changed_unknown"
        }
        if visibleLabelSetChanged || (targetRegionChangeRatio ?? 0) > 0.02 {
            return "changed_unknown"
        }
        return "no_change"
    }

    private func desiredOverflowDistance(direction: ScrollDirectionDTO, containerFrame: CGRect, pages: Int) -> Double {
        let distance: Double
        switch direction {
        case .up, .down:
            distance = max(80, containerFrame.height * 0.85)
        case .left, .right:
            distance = max(80, containerFrame.width * 0.85)
        }
        return distance * Double(max(pages, 1))
    }

    private func offscreenDistance(direction: ScrollDirectionDTO, container: CGRect, frame: CGRect) -> Double {
        switch direction {
        case .down:
            return container.minY - frame.maxY
        case .up:
            return frame.minY - container.maxY
        case .left:
            return frame.minX - container.maxX
        case .right:
            return container.minX - frame.maxX
        }
    }

    private func suggestedScrollBarStep(for container: AXUIElement) -> Double {
        guard let frame = AXHelpers.frame(container) else {
            return 0.18
        }
        let base = frame.height >= 900 ? 0.24 : (frame.height >= 540 ? 0.18 : 0.13)
        return min(max(base, 0.08), 0.30)
    }

    private func rawPageAction(for direction: ScrollDirectionDTO) -> String {
        switch direction {
        case .up:
            return "AXScrollUpByPage"
        case .down:
            return "AXScrollDownByPage"
        case .left:
            return "AXScrollLeftByPage"
        case .right:
            return "AXScrollRightByPage"
        }
    }

    private func pagingKeyCode(for direction: ScrollDirectionDTO) -> CGKeyCode? {
        switch direction {
        case .up:
            return CGKeyCode(116)
        case .down:
            return CGKeyCode(121)
        case .left, .right:
            return nil
        }
    }

    private func pagingKeyLabel(for keyCode: CGKeyCode) -> String {
        switch keyCode {
        case 116:
            return "PageUp"
        case 121:
            return "PageDown"
        default:
            return "keyCode \(keyCode)"
        }
    }

    private func scrollWheelDeltaY(for direction: ScrollDirectionDTO) -> Int32 {
        switch direction {
        case .up:
            return 650
        case .down:
            return -650
        case .left, .right:
            return 0
        }
    }

    private func applyScrollEventRoutingFields(_ event: CGEvent, pid: pid_t, windowNumber: Int) {
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(pid))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(windowNumber))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(windowNumber))
        event.setIntegerValueField(CGEventField(rawValue: 51)!, value: Int64(windowNumber))
        event.setIntegerValueField(CGEventField(rawValue: 91)!, value: Int64(windowNumber))
        event.setIntegerValueField(CGEventField(rawValue: 92)!, value: Int64(windowNumber))
        event.setIntegerValueField(CGEventField(rawValue: 58)!, value: 337_523)
        event.flags = []
    }

    private func targetedScrollWheelPoint(
        for candidate: ScrollCandidate,
        window: ResolvedWindowDTO
    ) -> (point: CGPoint, source: String, notes: [String]) {
        if let quartzBounds = quartzWindowBounds(windowNumber: window.windowNumber),
           quartzBounds.width > 1,
           quartzBounds.height > 1 {
            let xRatio = scrollWheelXRatio(for: candidate, window: window)
            return (
                CGPoint(
                    x: quartzBounds.minX + quartzBounds.width * xRatio,
                    y: quartzBounds.minY + quartzBounds.height * 0.5
                ),
                "quartz_window_bounds_x\(format(xRatio))_midY",
                []
            )
        }

        let targetPoint = AXCursorTargeting.targetPoint(for: candidate.target, window: window)
        if let point = targetPoint.point {
            return (
                point,
                "action_target_\(targetPoint.source ?? "unknown")",
                targetPoint.warnings
            )
        }

        let windowFrame = rect(from: window.frameAppKit).standardized
        return (
            CGPoint(x: windowFrame.midX, y: windowFrame.midY),
            "window_frame_center_fallback",
            ["No CG window bounds or candidate target point was available for targeted scroll-wheel dispatch."]
        )
    }

    private func scrollWheelXRatio(for candidate: ScrollCandidate, window: ResolvedWindowDTO) -> Double {
        guard let candidateFrame = candidate.target.frameAppKit.map(rect(from:)) else {
            return 0.5
        }
        let windowFrame = rect(from: window.frameAppKit).standardized
        guard windowFrame.width > 1, windowFrame.height > 1 else {
            return 0.5
        }

        let widthRatio = candidateFrame.width / windowFrame.width
        let heightRatio = candidateFrame.height / windowFrame.height
        return widthRatio >= 0.75 && heightRatio >= 0.75 ? 0.35 : 0.5
    }

    private func quartzWindowBounds(windowNumber: Int) -> CGRect? {
        guard let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        for window in windows {
            guard (window[kCGWindowNumber as String] as? Int) == windowNumber,
                  let bounds = window[kCGWindowBounds as String] as? NSDictionary else {
                continue
            }
            return CGRect(dictionaryRepresentation: bounds)
        }
        return nil
    }

    private func successfulStrategyName(in transports: [ScrollTransportAttemptDTO]) -> String? {
        transports.last(where: { $0.didDispatch })?.strategy.rawValue
    }

    private func winningTransport(
        in transports: [ScrollTransportAttemptDTO],
        classification: ScrollActionClassificationDTO
    ) -> ScrollTransportAttemptDTO? {
        guard classification == .success else {
            return nil
        }
        return transports.last { $0.didDispatch && $0.transportSuccess }
    }

    private func clippedVisibleRect(_ rect: CGRect?, within windowFrame: CGRect) -> CGRect? {
        guard let rect else {
            return nil
        }
        let clipped = rect.intersection(windowFrame)
        guard clipped.isNull == false, clipped.isEmpty == false else {
            return nil
        }
        return clipped
    }

    private func isUsableVerificationRect(_ rect: CGRect?, within windowFrame: CGRect) -> Bool {
        guard let rect, windowFrame.width > 1, windowFrame.height > 1 else {
            return false
        }

        let widthRatio = rect.width / windowFrame.width
        let heightRatio = rect.height / windowFrame.height
        let areaRatio = (rect.width * rect.height) / (windowFrame.width * windowFrame.height)

        if rect.width >= 120, rect.height >= 120 {
            return true
        }
        if widthRatio >= 0.18, heightRatio >= 0.18 {
            return true
        }
        return areaRatio >= 0.08
    }

    private func compareWindowImages(
        before: CGImage?,
        after: CGImage?,
        windowFrame: CGRect,
        regionInWindowCoordinates: CGRect?
    ) -> ScrollImageChangeSnapshot {
        guard let before, let after else {
            return ScrollImageChangeSnapshot(regionChangeRatio: nil, fullImageChangeRatio: nil)
        }

        let fullChange = sampledDifferenceRatio(lhs: before, rhs: after)
        guard let regionInWindowCoordinates,
              regionInWindowCoordinates.isNull == false,
              regionInWindowCoordinates.isEmpty == false else {
            return ScrollImageChangeSnapshot(regionChangeRatio: nil, fullImageChangeRatio: fullChange)
        }

        guard let cropRect = cropRectForImage(
            regionInWindowCoordinates: regionInWindowCoordinates,
            windowFrame: windowFrame,
            imageWidth: before.width,
            imageHeight: before.height
        ),
            let beforeCrop = before.cropping(to: cropRect),
            let afterCrop = after.cropping(to: cropRect) else {
            return ScrollImageChangeSnapshot(regionChangeRatio: nil, fullImageChangeRatio: fullChange)
        }

        return ScrollImageChangeSnapshot(
            regionChangeRatio: sampledDifferenceRatio(lhs: beforeCrop, rhs: afterCrop),
            fullImageChangeRatio: fullChange
        )
    }

    private func cropRectForImage(
        regionInWindowCoordinates: CGRect,
        windowFrame: CGRect,
        imageWidth: Int,
        imageHeight: Int
    ) -> CGRect? {
        guard windowFrame.width > 1, windowFrame.height > 1 else {
            return nil
        }

        let relative = CGRect(
            x: regionInWindowCoordinates.minX - windowFrame.minX,
            y: regionInWindowCoordinates.minY - windowFrame.minY,
            width: regionInWindowCoordinates.width,
            height: regionInWindowCoordinates.height
        )
        let scaleX = Double(imageWidth) / windowFrame.width
        let scaleY = Double(imageHeight) / windowFrame.height
        let rawCrop = CGRect(
            x: relative.minX * scaleX,
            y: relative.minY * scaleY,
            width: relative.width * scaleX,
            height: relative.height * scaleY
        ).integral

        let imageBounds = CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight)
        let clipped = rawCrop.intersection(imageBounds)
        guard clipped.isNull == false, clipped.width >= 8, clipped.height >= 8 else {
            return nil
        }
        return clipped
    }

    private func sampledDifferenceRatio(lhs: CGImage, rhs: CGImage) -> Double? {
        guard lhs.width == rhs.width,
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

    private func rgbaBytes(from image: CGImage) -> [UInt8]? {
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

    private func delta(_ lhs: Double?, _ rhs: Double?) -> Double? {
        guard let lhs, let rhs else {
            return nil
        }
        let computed = lhs - rhs
        return abs(computed) > 0.0001 ? computed : nil
    }

    private func delta(_ lhs: Int?, _ rhs: Int?) -> Int? {
        guard let lhs, let rhs else {
            return nil
        }
        let computed = lhs - rhs
        return computed == 0 ? nil : computed
    }

    private func rect(from dto: RectDTO) -> CGRect {
        CGRect(x: dto.x, y: dto.y, width: dto.width, height: dto.height)
    }

    private func format(_ value: Double) -> String {
        String(format: "%.4f", value)
    }
}
