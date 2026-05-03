import AppKit
import ApplicationServices
import Foundation

struct AXActionStateCapture {
    let windowID: String
    let includeMenuBar: Bool
    let includeCursorOverlay: Bool
    let menuPathComponents: [String]
    let webTraversal: AXWebTraversalMode
    let maxNodes: Int
    let resolved: ResolvedWindowTarget
    let envelope: AXPipelineV2Envelope
    let liveElementsByCanonicalIndex: [Int: AXUIElement]
    let displayIndexByProjectedIndex: [Int: Int]
}

struct AXActionTargetSnapshot {
    let displayIndex: Int?
    let projectedIndex: Int
    let primaryCanonicalIndex: Int
    let canonicalIndices: [Int]
    let displayRole: String
    let rawRole: String?
    let rawSubrole: String?
    let title: String?
    let description: String?
    let identifier: String?
    let placeholder: String?
    let url: String?
    let nodeID: String?
    let refetchFingerprint: String?
    let refetchLocator: AXNodeRefetchLocatorDTO?
    let projectedValueKind: String?
    let projectedValuePreview: String?
    let projectedValueLength: Int?
    let projectedValueTruncated: Bool
    let isValueSettable: Bool?
    let supportsValueSet: Bool?
    let isTextEntry: Bool?
    let isFocused: Bool
    let isSelected: Bool
    let parameterizedAttributes: [String]
    let frameAppKit: RectDTO?
    let activationPointAppKit: PointDTO?
    let suggestedInteractionPointAppKit: PointDTO?

    var dto: AXActionTargetSnapshotDTO {
        AXActionTargetSnapshotDTO(
            displayIndex: displayIndex,
            projectedIndex: projectedIndex,
            primaryCanonicalIndex: primaryCanonicalIndex,
            canonicalIndices: canonicalIndices,
            displayRole: displayRole,
            rawRole: rawRole,
            rawSubrole: rawSubrole,
            title: title,
            description: description,
            identifier: identifier,
            placeholder: placeholder,
            url: url,
            nodeID: nodeID,
            refetchFingerprint: refetchFingerprint,
            projectedValueKind: projectedValueKind,
            projectedValuePreview: projectedValuePreview,
            projectedValueLength: projectedValueLength,
            projectedValueTruncated: projectedValueTruncated,
            isValueSettable: isValueSettable,
            supportsValueSet: supportsValueSet,
            isTextEntry: isTextEntry,
            isFocused: isFocused,
            isSelected: isSelected,
            parameterizedAttributes: parameterizedAttributes,
            frameAppKit: frameAppKit,
            activationPointAppKit: activationPointAppKit,
            suggestedInteractionPointAppKit: suggestedInteractionPointAppKit
        )
    }
}

struct AXActionCandidate {
    let score: Int
    let semanticAppropriate: Bool
    let semanticReasons: [String]
    let target: AXActionTargetSnapshot
}

struct AXActionResolvedLiveElement {
    let element: AXUIElement
    let resolution: String
}

enum AXActionTargetResolverError: Error, CustomStringConvertible {
    case unresolvedTarget(String)

    var description: String {
        switch self {
        case let .unresolvedTarget(message):
            return message
        }
    }
}

enum AXActionTargetKind {
    case setValue
    case typeText
    case scroll
    case secondaryAction
    case click
}

struct AXActionTargetResolver {
    private let executionOptions: ActionExecutionOptions
    private let windowResolver = WindowTargetResolver()
    private let statePipeline = StatePipelineExperiment()

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
    }

    func capture(
        windowID: String,
        includeMenuBar: Bool,
        menuPathComponents: [String] = [],
        webTraversal: AXWebTraversalMode = .visible,
        maxNodes: Int,
        imageMode: ImageMode = .omit,
        includeCursorOverlay: Bool? = nil
    ) throws -> AXActionStateCapture {
        let shouldIncludeCursorOverlay = includeCursorOverlay ?? executionOptions.visualCursorEnabled
        let resolved = try windowResolver.resolve(windowID: windowID)
        let capture = try statePipeline.captureResolvedWindow(
            resolved: resolved,
            includeMenuBar: includeMenuBar,
            menuPathComponents: menuPathComponents,
            webTraversal: webTraversal,
            maxNodes: maxNodes,
            imageMode: imageMode,
            includeCursorOverlay: shouldIncludeCursorOverlay
        )

        return AXActionStateCapture(
            windowID: windowID,
            includeMenuBar: includeMenuBar,
            includeCursorOverlay: shouldIncludeCursorOverlay,
            menuPathComponents: menuPathComponents,
            webTraversal: webTraversal,
            maxNodes: maxNodes,
            resolved: resolved,
            envelope: capture.envelope,
            liveElementsByCanonicalIndex: capture.liveElementsByCanonicalIndex,
            displayIndexByProjectedIndex: Dictionary(
                uniqueKeysWithValues: capture.envelope.response.tree.lineMappings.map {
                    ($0.projectedIndex, $0.displayIndex)
                }
            )
        )
    }

    func reread(after capture: AXActionStateCapture, imageMode: ImageMode = .omit) throws -> AXActionStateCapture {
        try self.capture(
            windowID: capture.windowID,
            includeMenuBar: capture.includeMenuBar,
            menuPathComponents: [],
            webTraversal: capture.webTraversal,
            maxNodes: capture.maxNodes,
            imageMode: imageMode,
            includeCursorOverlay: capture.includeCursorOverlay
        )
    }

    func stateTokenWarnings(suppliedStateToken: String?, liveStateToken: String) -> [String] {
        guard let suppliedStateToken,
              suppliedStateToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            return []
        }
        guard suppliedStateToken != liveStateToken else {
            return []
        }
        return [
            "Supplied stateToken did not match the live pre-action recapture; targeting continued against the current AXPipelineV2 state."
        ]
    }

    func resolveTarget(
        _ requestedTarget: ActionTargetRequestDTO,
        in capture: AXActionStateCapture,
        kind: AXActionTargetKind
    ) -> AXActionCandidate? {
        guard let surfaceNode = resolveSurfaceNode(target: requestedTarget, in: capture) else {
            return nil
        }
        let target = makeTargetSnapshot(surfaceNode: surfaceNode, capture: capture)
        let semantic = semanticSuitability(for: target, kind: kind)
        return AXActionCandidate(
            score: 10_000,
            semanticAppropriate: semantic.appropriate,
            semanticReasons: semantic.reasons,
            target: target
        )
    }

    func resolveSurfaceNode(
        target requestedTarget: ActionTargetRequestDTO,
        in capture: AXActionStateCapture
    ) -> AXPipelineV2SurfaceNodeDTO? {
        switch requestedTarget.kind {
        case .displayIndex:
            guard let displayIndex = requestedTarget.displayIndex else {
                return nil
            }
            return surfaceNode(displayIndex: displayIndex, in: capture)
        case .nodeID:
            let matches = capture.envelope.response.tree.nodes.filter { $0.nodeID == requestedTarget.value }
            return matches.only
        case .refetchFingerprint:
            let matches = capture.envelope.response.tree.nodes.filter { $0.refetchFingerprint == requestedTarget.value }
            return matches.only
        }
    }

    func resolveSurfaceNode(
        projectedIndex: Int,
        in capture: AXActionStateCapture
    ) -> AXPipelineV2SurfaceNodeDTO? {
        surfaceNode(projectedIndex: projectedIndex, in: capture)
    }

    func targetResolutionFailureDescription(
        for requestedTarget: ActionTargetRequestDTO,
        in capture: AXActionStateCapture
    ) -> String {
        switch requestedTarget.kind {
        case .displayIndex:
            return "No rendered target matched \(requestedTarget.summary)."
        case .nodeID:
            let matchCount = capture.envelope.response.tree.nodes.filter { $0.nodeID == requestedTarget.value }.count
            if matchCount > 1 {
                return "\(requestedTarget.summary) matched \(matchCount) projected nodes; use display_index from the current rendered tree."
            }
            return "No projected target matched \(requestedTarget.summary)."
        case .refetchFingerprint:
            let matchCount = capture.envelope.response.tree.nodes.filter { $0.refetchFingerprint == requestedTarget.value }.count
            if matchCount > 1 {
                return "\(requestedTarget.summary) matched \(matchCount) projected nodes; use display_index or node_id from the current rendered tree."
            }
            return "No projected target matched \(requestedTarget.summary)."
        }
    }

    func targetSnapshot(
        for surfaceNode: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture
    ) -> AXActionTargetSnapshot {
        makeTargetSnapshot(surfaceNode: surfaceNode, capture: capture)
    }

    func targetSnapshot(
        forRawCanonicalIndex canonicalIndex: Int,
        in capture: AXActionStateCapture
    ) -> AXActionTargetSnapshot? {
        guard let rawNode = capture.envelope.rawCapture.nodes[safe: canonicalIndex] else {
            return nil
        }
        return makeTargetSnapshot(rawNode: rawNode)
    }

    func resolveLiveElement(
        forRawCanonicalIndex canonicalIndex: Int,
        in capture: AXActionStateCapture
    ) throws -> AXActionResolvedLiveElement {
        guard let target = targetSnapshot(forRawCanonicalIndex: canonicalIndex, in: capture) else {
            throw AXActionTargetResolverError.unresolvedTarget(
                "No raw AX node matched canonical index \(canonicalIndex)."
            )
        }
        return try resolveLiveElement(for: target, in: capture)
    }

    func ancestorTargetSnapshots(
        startingAt surfaceNode: AXPipelineV2SurfaceNodeDTO,
        in capture: AXActionStateCapture,
        limit: Int = 16
    ) -> [(node: AXPipelineV2SurfaceNodeDTO, target: AXActionTargetSnapshot)] {
        var results: [(node: AXPipelineV2SurfaceNodeDTO, target: AXActionTargetSnapshot)] = []
        var cursor: AXPipelineV2SurfaceNodeDTO? = surfaceNode
        var remaining = max(limit, 1)

        while remaining > 0, let resolved = cursor {
            results.append((
                node: resolved,
                target: makeTargetSnapshot(surfaceNode: resolved, capture: capture)
            ))
            cursor = resolved.parentIndex.flatMap { self.surfaceNode(projectedIndex: $0, in: capture) }
            remaining -= 1
        }

        return results
    }

    func resolveFocusedTextEntryTarget(in capture: AXActionStateCapture) -> AXActionCandidate? {
        let focusedNodeID = capture.envelope.response.selectionSummary?.focusedNodeID
        let focusedProjectedIndex = capture.envelope.diagnostics.focusedProjectedIndex
        let focusedDisplayIndex = capture.envelope.diagnostics.focusedDisplayIndex ?? capture.envelope.response.focusedElement.index
        let focusedCanonicalIndex = capture.envelope.diagnostics.focusedCanonicalIndex

        let candidates = capture.envelope.response.tree.nodes.compactMap { surfaceNode -> AXActionCandidate? in
            let target = makeTargetSnapshot(surfaceNode: surfaceNode, capture: capture)
            let isFocused =
                target.isFocused ||
                (focusedNodeID != nil && target.nodeID == focusedNodeID) ||
                (focusedProjectedIndex != nil && target.projectedIndex == focusedProjectedIndex) ||
                (focusedDisplayIndex != nil && target.displayIndex == focusedDisplayIndex) ||
                (focusedCanonicalIndex != nil && target.canonicalIndices.contains(focusedCanonicalIndex!))
            guard isFocused else {
                return nil
            }

            let semantic = semanticSuitability(for: target, kind: .typeText)
            guard semantic.appropriate else {
                return nil
            }

            var score = 100
            if target.nodeID == focusedNodeID {
                score += 80
            }
            if target.projectedIndex == focusedProjectedIndex {
                score += 70
            }
            if target.displayIndex == focusedDisplayIndex {
                score += 60
            }
            if target.isTextEntry == true {
                score += 30
            }

            return AXActionCandidate(
                score: score,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                target: target
            )
        }

        return candidates.max { lhs, rhs in
            if lhs.score != rhs.score {
                return lhs.score < rhs.score
            }
            return lhs.target.projectedIndex > rhs.target.projectedIndex
        }
    }

    func resolveUnambiguousTextEntryTarget(in capture: AXActionStateCapture) -> AXActionCandidate? {
        let candidates = capture.envelope.response.tree.nodes.compactMap { surfaceNode -> AXActionCandidate? in
            let target = makeTargetSnapshot(surfaceNode: surfaceNode, capture: capture)
            let semantic = semanticSuitability(for: target, kind: .typeText)
            guard semantic.appropriate else {
                return nil
            }
            guard target.isTextEntry == true ||
                target.rawRole == "AXTextArea" ||
                target.displayRole == "text entry area" else {
                return nil
            }

            var score = 50
            if target.isTextEntry == true {
                score += 30
            }
            if target.isValueSettable == true || target.supportsValueSet == true {
                score += 20
            }
            if target.rawRole == "AXTextArea" {
                score += 15
            }

            return AXActionCandidate(
                score: score,
                semanticAppropriate: semantic.appropriate,
                semanticReasons: semantic.reasons,
                target: target
            )
        }

        guard candidates.count == 1 else {
            return nil
        }
        return candidates[0]
    }

    func locateRefreshedTarget(
        in capture: AXActionStateCapture,
        prior: AXActionTargetSnapshot,
        kind: AXActionTargetKind
    ) -> (target: AXActionTargetSnapshot?, strategy: String?) {
        if let nodeID = prior.nodeID,
           let matched = capture.envelope.response.tree.nodes.first(where: { $0.nodeID == nodeID }) {
            return (makeTargetSnapshot(surfaceNode: matched, capture: capture), "node_id")
        }

        if let fingerprint = prior.refetchFingerprint {
            let matches = capture.envelope.response.tree.nodes.filter { $0.refetchFingerprint == fingerprint }
            if let unique = matches.only {
                return (makeTargetSnapshot(surfaceNode: unique, capture: capture), "refetch_fingerprint")
            }
            if let best = matches.max(by: { lhs, rhs in
                refreshedSimilarityScore(lhs, prior: prior, kind: kind) < refreshedSimilarityScore(rhs, prior: prior, kind: kind)
            }), refreshedSimilarityScore(best, prior: prior, kind: kind) >= 120 {
                return (makeTargetSnapshot(surfaceNode: best, capture: capture), "refetch_fingerprint_signature")
            }
        }

        if let displayIndex = prior.displayIndex,
           let mapping = capture.envelope.response.tree.lineMappings.first(where: { $0.displayIndex == displayIndex }),
           let matched = surfaceNode(projectedIndex: mapping.projectedIndex, in: capture),
           refreshedSimilarityScore(matched, prior: prior, kind: kind) >= 80 {
            return (makeTargetSnapshot(surfaceNode: matched, capture: capture), "display_index_signature")
        }

        if let matched = surfaceNode(projectedIndex: prior.projectedIndex, in: capture),
           refreshedSimilarityScore(matched, prior: prior, kind: kind) >= 100 {
            return (makeTargetSnapshot(surfaceNode: matched, capture: capture), "projected_index_signature")
        }

        return (nil, nil)
    }

    func resolveLiveElement(
        for target: AXActionTargetSnapshot,
        in capture: AXActionStateCapture
    ) throws -> AXActionResolvedLiveElement {
        let appElement = AXUIElementCreateApplication(capture.envelope.response.window.pid)
        AXUIElementSetMessagingTimeout(appElement, 1.0)
        if isMenuTarget(target),
           let matched = resolveMenuLiveElement(for: target, appElement: appElement) {
            return matched
        }

        if target.rawRole != String(kAXWindowRole),
           let captured = resolveCapturedLiveElement(for: target, in: capture) {
            return captured
        }

        let windowElement = try resolveWindowElement(
            appElement: appElement,
            window: capture.envelope.response.window
        )
        if target.rawRole == String(kAXWindowRole) {
            return AXActionResolvedLiveElement(element: windowElement, resolution: "resolved_window")
        }

        if let locator = target.refetchLocator,
           let matched = resolveByLocator(locator, under: windowElement, target: target) {
            return AXActionResolvedLiveElement(element: matched, resolution: "refetch_locator")
        }

        if let matched = resolveByLooseMatch(target, under: windowElement) {
            return AXActionResolvedLiveElement(element: matched, resolution: "loose_role_title_frame_match")
        }

        if let matched = resolveByHitTest(target, appElement: appElement, window: capture.envelope.response.window) {
            return matched
        }

        throw AXActionTargetResolverError.unresolvedTarget(
            "No live AX element matched projected node \(target.projectedIndex) in window \(capture.envelope.response.window.windowID)."
        )
    }

    private func resolveCapturedLiveElement(
        for target: AXActionTargetSnapshot,
        in capture: AXActionStateCapture
    ) -> AXActionResolvedLiveElement? {
        var visited = Set<Int>()
        for canonicalIndex in [target.primaryCanonicalIndex] + target.canonicalIndices where visited.insert(canonicalIndex).inserted {
            guard let element = capture.liveElementsByCanonicalIndex[canonicalIndex] else {
                continue
            }
            return AXActionResolvedLiveElement(
                element: element,
                resolution: canonicalIndex == target.primaryCanonicalIndex
                    ? "captured_primary_canonical_index"
                    : "captured_canonical_index"
            )
        }
        return nil
    }

    private func isMenuTarget(_ target: AXActionTargetSnapshot) -> Bool {
        if let role = target.rawRole,
           [
               String(kAXMenuBarRole),
               String(kAXMenuBarItemRole),
               String(kAXMenuRole),
               String(kAXMenuItemRole)
           ].contains(role) {
            return true
        }
        if target.refetchLocator?.rolePath.contains(where: {
            [
                String(kAXMenuBarRole),
                String(kAXMenuBarItemRole),
                String(kAXMenuRole),
                String(kAXMenuItemRole)
            ].contains($0)
        }) == true {
            return true
        }
        return target.displayRole == "menu" || target.displayRole == "menu item"
    }

    private func resolveMenuLiveElement(
        for target: AXActionTargetSnapshot,
        appElement: AXUIElement
    ) -> AXActionResolvedLiveElement? {
        let roots = menuRootCandidates(appElement: appElement)
        guard roots.isEmpty == false else {
            return nil
        }

        if let locator = target.refetchLocator {
            for root in roots {
                if let matched = resolveByLocator(locator, under: root, target: target) {
                    return AXActionResolvedLiveElement(element: matched, resolution: "menu_refetch_locator")
                }
            }
        }

        for root in roots {
            if let matched = resolveByLooseMatch(target, under: root) {
                return AXActionResolvedLiveElement(element: matched, resolution: "menu_loose_role_title_frame_match")
            }
        }

        if let matched = resolveMenuByHitTest(target, appElement: appElement) {
            return matched
        }

        return nil
    }

    private func menuRootCandidates(appElement: AXUIElement) -> [AXUIElement] {
        var roots: [AXUIElement] = []
        if let focused = AXActionRuntimeSupport.elementAttribute(appElement, attribute: kAXFocusedUIElementAttribute as CFString) {
            roots.append(focused)
            roots.append(contentsOf: AXActionRuntimeSupport.walkAncestors(startingAt: focused))
        }
        if let menuBar = AXHelpers.menuBar(appElement) {
            roots.append(menuBar)
            roots.append(contentsOf: AXActionRuntimeSupport.childElements(menuBar))
        }

        var seen = Set<UInt>()
        return roots.filter { element in
            seen.insert(CFHash(element)).inserted
        }
    }

    private func resolveMenuByHitTest(
        _ target: AXActionTargetSnapshot,
        appElement: AXUIElement
    ) -> AXActionResolvedLiveElement? {
        let pointCandidates: [(CGPoint, String)] = [
            target.activationPointAppKit.map { (point(from: $0), "activation_point") },
            target.suggestedInteractionPointAppKit.map { (point(from: $0), "suggested_interaction_point") },
            target.frameAppKit.map { (rect(from: $0).center, "frame_center") },
        ]
        .compactMap { $0 }

        guard pointCandidates.isEmpty == false else {
            return nil
        }

        let systemWideElement = AXUIElementCreateSystemWide()
        var bestScore = Int.min
        var bestElement: AXUIElement?
        var bestResolution = "menu_ax_hit_test"

        for (point, source) in pointCandidates {
            let hitElement =
                AXActionRuntimeSupport.hitTest(appElement, point: point) ??
                AXActionRuntimeSupport.hitTest(systemWideElement, point: point)

            guard let hitElement else {
                continue
            }

            for candidate in AXActionRuntimeSupport.walkAncestors(startingAt: hitElement) {
                let score = hitTestScore(candidate, target: target)
                if score > bestScore {
                    bestScore = score
                    bestElement = candidate
                    bestResolution = "menu_ax_hit_test_\(source)"
                }
            }
        }

        guard let bestElement, bestScore >= 80 else {
            return nil
        }

        return AXActionResolvedLiveElement(element: bestElement, resolution: bestResolution)
    }

    func semanticSuitability(
        for target: AXActionTargetSnapshot,
        kind: AXActionTargetKind
    ) -> (appropriate: Bool, reasons: [String]) {
        switch kind {
        case .setValue:
            return setValueSemanticSuitability(for: target)
        case .typeText:
            return typeTextSemanticSuitability(for: target)
        case .scroll:
            return scrollSemanticSuitability(for: target)
        case .secondaryAction:
            return (true, ["secondary_action_uses_projected_public_label"])
        case .click:
            return (true, ["click_uses_primary_ax_or_element_pointer_waterfall"])
        }
    }

    private func surfaceNode(displayIndex: Int, in capture: AXActionStateCapture) -> AXPipelineV2SurfaceNodeDTO? {
        if let mapping = capture.envelope.response.tree.lineMappings.first(where: { $0.displayIndex == displayIndex }),
           let matched = surfaceNode(projectedIndex: mapping.projectedIndex, in: capture) {
            return matched
        }

        return capture.envelope.response.tree.nodes.first { $0.displayIndex == displayIndex }
    }

    private func surfaceNode(projectedIndex: Int, in capture: AXActionStateCapture) -> AXPipelineV2SurfaceNodeDTO? {
        capture.envelope.response.tree.nodes.first(where: { $0.projectedIndex == projectedIndex || $0.index == projectedIndex })
    }

    private func makeTargetSnapshot(
        surfaceNode: AXPipelineV2SurfaceNodeDTO,
        capture: AXActionStateCapture
    ) -> AXActionTargetSnapshot {
        let rawNode = capture.envelope.rawCapture.nodes[safe: surfaceNode.primaryCanonicalIndex]
        let focusedNodeID = capture.envelope.response.selectionSummary?.focusedNodeID
        let selectedNodeIDs = Set(capture.envelope.response.selectionSummary?.selectedNodeIDs ?? [])
        let displayIndex = capture.displayIndexByProjectedIndex[surfaceNode.projectedIndex] ?? surfaceNode.displayIndex

        return AXActionTargetSnapshot(
            displayIndex: displayIndex,
            projectedIndex: surfaceNode.projectedIndex,
            primaryCanonicalIndex: surfaceNode.primaryCanonicalIndex,
            canonicalIndices: surfaceNode.canonicalIndices,
            displayRole: surfaceNode.displayRole,
            rawRole: surfaceNode.rawRole,
            rawSubrole: surfaceNode.rawSubrole,
            title: surfaceNode.title,
            description: surfaceNode.description,
            identifier: surfaceNode.identifier,
            placeholder: surfaceNode.refetch?.signature.placeholder ?? rawNode?.identity?.refetch?.signature.placeholder,
            url: surfaceNode.url,
            nodeID: surfaceNode.nodeID,
            refetchFingerprint: surfaceNode.refetchFingerprint,
            refetchLocator: surfaceNode.refetch ?? rawNode?.identity?.refetch,
            projectedValueKind: rawNode?.value.kind ?? surfaceNode.valueKind,
            projectedValuePreview: rawNode?.value.preview ?? surfaceNode.value?.preview,
            projectedValueLength: rawNode?.value.length ?? surfaceNode.value?.length,
            projectedValueTruncated: rawNode?.value.truncated ?? surfaceNode.value?.truncated ?? false,
            isValueSettable: surfaceNode.isValueSettable,
            supportsValueSet: surfaceNode.interactionTraits?.supportsValueSet,
            isTextEntry: surfaceNode.interactionTraits?.isTextEntry,
            isFocused: surfaceNode.nodeID == focusedNodeID || capture.envelope.diagnostics.focusedDisplayIndex == displayIndex,
            isSelected: surfaceNode.nodeID.map(selectedNodeIDs.contains) ?? false,
            parameterizedAttributes: surfaceNode.parameterizedAttributes ?? [],
            frameAppKit: surfaceNode.frameAppKit,
            activationPointAppKit: surfaceNode.activationPointAppKit,
            suggestedInteractionPointAppKit: surfaceNode.suggestedInteractionPointAppKit
        )
    }

    private func makeTargetSnapshot(rawNode: AXRawNodeDTO) -> AXActionTargetSnapshot {
        AXActionTargetSnapshot(
            displayIndex: nil,
            projectedIndex: rawNode.index,
            primaryCanonicalIndex: rawNode.index,
            canonicalIndices: [rawNode.index],
            displayRole: displayRole(for: rawNode),
            rawRole: rawNode.role,
            rawSubrole: rawNode.subrole,
            title: rawNode.title ?? rawNode.value.preview ?? rawNode.description,
            description: rawNode.description,
            identifier: rawNode.identifier,
            placeholder: rawNode.placeholder,
            url: rawNode.url,
            nodeID: rawNode.identity?.nodeID,
            refetchFingerprint: rawNode.identity?.refetch?.fingerprint,
            refetchLocator: rawNode.identity?.refetch,
            projectedValueKind: rawNode.value.kind,
            projectedValuePreview: rawNode.value.preview,
            projectedValueLength: rawNode.value.length,
            projectedValueTruncated: rawNode.value.truncated,
            isValueSettable: rawNode.isValueSettable,
            supportsValueSet: rawNode.interactionTraits?.supportsValueSet,
            isTextEntry: rawNode.interactionTraits?.isTextEntry,
            isFocused: rawNode.isFocused == true,
            isSelected: rawNode.selected == true,
            parameterizedAttributes: rawNode.parameterizedAttributes ?? [],
            frameAppKit: rawNode.frameAppKit,
            activationPointAppKit: rawNode.activationPointAppKit,
            suggestedInteractionPointAppKit: rawNode.activationPointAppKit
        )
    }

    private func displayRole(for rawNode: AXRawNodeDTO) -> String {
        if let roleDescription = rawNode.roleDescription, roleDescription.isEmpty == false {
            return roleDescription
        }
        if let role = rawNode.role, role.hasPrefix("AX") {
            return String(role.dropFirst(2))
                .replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
                .lowercased()
        }
        return rawNode.role ?? "unknown"
    }

    private func resolveWindowElement(appElement: AXUIElement, window: ResolvedWindowDTO) throws -> AXUIElement {
        let directWindows = AXActionRuntimeSupport.elementArrayAttribute(appElement, attribute: kAXWindowsAttribute as CFString)
        let windows = directWindows.isEmpty
            ? AXActionRuntimeSupport.elementAttribute(appElement, attribute: kAXFocusedWindowAttribute as CFString).map { [$0] } ?? []
            : directWindows
        guard windows.isEmpty == false else {
            throw AXActionTargetResolverError.unresolvedTarget("The target app exposed no AX windows.")
        }

        let best = windows.max { lhs, rhs in
            scoreWindow(lhs, target: window) < scoreWindow(rhs, target: window)
        }

        guard let best, scoreWindow(best, target: window) > 0 else {
            throw AXActionTargetResolverError.unresolvedTarget(
                "No live AX window matched title '\(window.title)' and windowNumber \(window.windowNumber)."
            )
        }

        return best
    }

    private func scoreWindow(_ element: AXUIElement, target: ResolvedWindowDTO) -> Int {
        var score = 0
        let title = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXTitleAttribute as CFString) ?? ""
        let frame = AXActionRuntimeSupport.rectAttribute(element, attribute: "AXFrame" as CFString)
        let windowNumber = AXActionRuntimeSupport.intAttribute(element, attribute: "AXWindowNumber" as CFString)

        if windowNumber == target.windowNumber {
            score += 1000
        }
        if title == target.title {
            score += 200
        } else if target.title.isEmpty == false, title.contains(target.title) || target.title.contains(title) {
            score += 120
        }
        if let frame, approximatelyEqual(frame, rect(from: target.frameAppKit), tolerance: 3) {
            score += 80
        }
        if AXActionRuntimeSupport.boolAttribute(element, attribute: kAXMainAttribute as CFString) == true {
            score += 20
        }
        if AXActionRuntimeSupport.boolAttribute(element, attribute: kAXFocusedAttribute as CFString) == true {
            score += 10
        }

        return score
    }

    private func resolveByLocator(
        _ locator: AXNodeRefetchLocatorDTO,
        under root: AXUIElement,
        target: AXActionTargetSnapshot
    ) -> AXUIElement? {
        var bestScore = Int.min
        var bestElement: AXUIElement?

        func walk(
            element: AXUIElement,
            parentFingerprint: String?,
            ancestorFingerprints: [String],
            rolePath: [String],
            ordinalWithinParent: Int
        ) {
            let signature = AXActionRuntimeSupport.signature(for: element)
            let fingerprint = AXActionRuntimeSupport.fingerprint(for: signature)
            let currentRolePath = rolePath + [signature.role ?? "unknown"]

            var score = 0
            if fingerprint == locator.fingerprint {
                score += 1000
            }
            if parentFingerprint == locator.parentFingerprint {
                score += 180
            }
            if currentRolePath == locator.rolePath {
                score += 120
            } else {
                score += suffixMatchScore(lhs: currentRolePath, rhs: locator.rolePath, perMatch: 18)
            }
            score += suffixMatchScore(lhs: ancestorFingerprints, rhs: locator.ancestorFingerprints, perMatch: 30)
            if ordinalWithinParent == locator.ordinalWithinParent {
                score += 40
            }
            score += signatureMatchScore(lhs: signature, rhs: locator.signature)
            score += targetSpecificMatchScore(element, target: target)

            if score > bestScore {
                bestScore = score
                bestElement = element
            }

            let nextAncestors = ancestorFingerprints + [fingerprint]
            let children = AXActionRuntimeSupport.childElements(element)
            for (offset, child) in children.enumerated() {
                walk(
                    element: child,
                    parentFingerprint: fingerprint,
                    ancestorFingerprints: nextAncestors,
                    rolePath: currentRolePath,
                    ordinalWithinParent: offset
                )
            }
        }

        walk(
            element: root,
            parentFingerprint: nil,
            ancestorFingerprints: [],
            rolePath: [],
            ordinalWithinParent: 0
        )

        guard bestScore >= 350 else {
            return nil
        }
        return bestElement
    }

    private func targetSpecificMatchScore(_ element: AXUIElement, target: AXActionTargetSnapshot) -> Int {
        var score = 0
        let liveURL = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXURLAttribute as CFString)
        let liveTitle = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXTitleAttribute as CFString)
        let liveValue = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXValueAttribute as CFString)
        let targetURL = AXActionRuntimeSupport.normalize(target.url)
        let targetTitle = AXActionRuntimeSupport.normalize(target.title)
        let targetValue = AXActionRuntimeSupport.normalize(target.projectedValuePreview)

        if targetURL.isEmpty == false {
            if AXActionRuntimeSupport.normalize(liveURL) == targetURL {
                score += 1000
            } else if liveURL != nil {
                score -= 250
            }
        }
        if targetTitle.isEmpty == false {
            if AXActionRuntimeSupport.normalize(liveTitle) == targetTitle {
                score += 160
            }
            if AXActionRuntimeSupport.normalize(liveValue) == targetTitle {
                score += 180
            }
        }
        if targetValue.isEmpty == false,
           AXActionRuntimeSupport.normalize(liveValue) == targetValue {
            score += 220
        }
        if let frame = AXActionRuntimeSupport.rectAttribute(element, attribute: "AXFrame" as CFString),
           let targetFrame = target.frameAppKit.map(rect(from:)),
           approximatelyEqual(frame, targetFrame, tolerance: 4) {
            score += 120
        }
        return score
    }

    private func resolveByLooseMatch(_ target: AXActionTargetSnapshot, under root: AXUIElement) -> AXUIElement? {
        var bestScore = Int.min
        var bestElement: AXUIElement?

        func walk(_ element: AXUIElement) {
            let role = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXRoleAttribute as CFString)
            let subrole = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXSubroleAttribute as CFString)
            let title = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXTitleAttribute as CFString)
            let identifier = AXActionRuntimeSupport.stringAttribute(element, attribute: kAXIdentifierAttribute as CFString)
            let frame = AXActionRuntimeSupport.rectAttribute(element, attribute: "AXFrame" as CFString)

            var score = 0
            if role == target.rawRole {
                score += 120
            }
            if subrole == target.rawSubrole {
                score += 80
            }
            if title == target.title, title?.isEmpty == false {
                score += 160
            }
            if identifier == target.identifier, identifier?.isEmpty == false {
                score += 160
            }
            if let frame, let targetFrame = target.frameAppKit.map(rect(from:)),
               approximatelyEqual(frame, targetFrame, tolerance: 4) {
                score += 120
            }

            if score > bestScore {
                bestScore = score
                bestElement = element
            }

            for child in AXActionRuntimeSupport.childElements(element) {
                walk(child)
            }
        }

        walk(root)
        guard bestScore >= 220 else {
            return nil
        }
        return bestElement
    }

    private func resolveByHitTest(
        _ target: AXActionTargetSnapshot,
        appElement: AXUIElement,
        window: ResolvedWindowDTO
    ) -> AXActionResolvedLiveElement? {
        let windowFrame = rect(from: window.frameAppKit).standardized.insetBy(dx: -2, dy: -2)
        let pointCandidates: [(CGPoint, String)] = [
            target.activationPointAppKit.map { (point(from: $0), "activation_point") },
            target.suggestedInteractionPointAppKit.map { (point(from: $0), "suggested_interaction_point") },
            target.frameAppKit.map { (rect(from: $0).center, "frame_center") },
        ]
        .compactMap { $0 }
        .filter { windowFrame.contains($0.0) }

        guard pointCandidates.isEmpty == false else {
            return nil
        }

        let systemWideElement = AXUIElementCreateSystemWide()
        var bestScore = Int.min
        var bestElement: AXUIElement?
        var bestResolution = "ax_hit_test"

        for (point, source) in pointCandidates {
            let hitElement =
                AXActionRuntimeSupport.hitTest(appElement, point: point) ??
                AXActionRuntimeSupport.hitTest(systemWideElement, point: point)

            guard let hitElement else {
                continue
            }

            for candidate in AXActionRuntimeSupport.walkAncestors(startingAt: hitElement) {
                let score = hitTestScore(candidate, target: target)
                if score > bestScore {
                    bestScore = score
                    bestElement = candidate
                    bestResolution = "ax_hit_test_\(source)"
                }
            }
        }

        guard let bestElement, bestScore >= 80 else {
            return nil
        }

        return AXActionResolvedLiveElement(element: bestElement, resolution: bestResolution)
    }

    private func setValueSemanticSuitability(for target: AXActionTargetSnapshot) -> (appropriate: Bool, reasons: [String]) {
        var reasons: [String] = []

        if target.isValueSettable == true || target.supportsValueSet == true {
            reasons.append("state_pipeline_marks_target_as_value_settable")
        } else {
            reasons.append("state_pipeline_does_not_mark_target_as_value_settable")
            return (false, reasons)
        }

        if target.isTextEntry == true {
            reasons.append("target_is_text_entry")
            return (true, reasons)
        }

        switch target.displayRole {
        case "text field", "search text field", "text entry area", "combo box":
            reasons.append("display_role_is_semantic_replacement_surface")
            return (true, reasons)
        case "checkbox", "radio button":
            if target.projectedValueKind == "boolean" {
                reasons.append("boolean_control_exposes_boolean_value")
                return (true, reasons)
            }
        case "slider", "scroll bar", "value indicator":
            if target.projectedValueKind == "integer" || target.projectedValueKind == "float" {
                reasons.append("numeric_control_exposes_numeric_value")
                return (true, reasons)
            }
        default:
            break
        }

        reasons.append("target_is_settable_but_not_a_clear_semantic_replacement_surface")
        return (false, reasons)
    }

    private func typeTextSemanticSuitability(for target: AXActionTargetSnapshot) -> (appropriate: Bool, reasons: [String]) {
        var reasons: [String] = []

        if target.isTextEntry == true {
            reasons.append("state_pipeline_marks_target_as_text_entry")
            return (true, reasons)
        }

        switch target.displayRole {
        case "text field", "search text field", "text entry area", "combo box":
            reasons.append("display_role_is_text_entry_surface")
            return (true, reasons)
        default:
            break
        }

        switch target.rawRole {
        case "AXTextField", "AXTextArea", "AXComboBox":
            reasons.append("raw_role_is_text_entry_surface")
            return (true, reasons)
        default:
            break
        }

        reasons.append("target_is_not_a_clear_text_entry_surface")
        return (false, reasons)
    }

    private func scrollSemanticSuitability(for target: AXActionTargetSnapshot) -> (appropriate: Bool, reasons: [String]) {
        var reasons: [String] = ["scroll_route_uses_requested_node_plus_ranked_ancestors"]
        let actionNames = Set(target.parameterizedAttributes)

        if actionNames.contains("AXScrollToShowDescendant") {
            reasons.append("target_exposes_AXScrollToShowDescendant")
            return (true, reasons)
        }

        switch target.rawRole {
        case "AXScrollArea", "AXOutline", "AXTable", "AXTextArea", "AXWebArea",
             "AXCollection", "AXList", "AXListBox", "AXContentList", "AXGroup":
            reasons.append("raw_role_can_participate_in_scroll_candidate_ranking")
            return (true, reasons)
        default:
            break
        }

        switch target.displayRole {
        case "scroll area", "outline", "table", "text entry area", "web area", "list", "collection", "group":
            reasons.append("display_role_can_participate_in_scroll_candidate_ranking")
            return (true, reasons)
        default:
            reasons.append("target_itself_is_not_a_clear_scroll_container_but_ancestors_may_be")
            return (true, reasons)
        }
    }

    private func refreshedSimilarityScore(
        _ surfaceNode: AXPipelineV2SurfaceNodeDTO,
        prior: AXActionTargetSnapshot,
        kind: AXActionTargetKind
    ) -> Int {
        var score = 0
        if surfaceNode.rawRole == prior.rawRole {
            score += 60
        }
        if surfaceNode.rawSubrole == prior.rawSubrole {
            score += 30
        }
        if surfaceNode.identifier == prior.identifier, prior.identifier?.isEmpty == false {
            score += 80
        }
        if surfaceNode.title == prior.title, prior.title?.isEmpty == false {
            score += 80
        }
        if surfaceNode.displayRole == prior.displayRole {
            score += 25
        }
        if kind == .setValue, surfaceNode.isValueSettable == prior.isValueSettable {
            score += 15
        }
        if kind == .scroll, surfaceNode.interactionTraits?.isPotentialScrollContainer == true {
            score += 20
        }
        return score
    }

    private func signatureMatchScore(lhs: AXActionRefetchSignature, rhs: AXNodeRefetchSignatureDTO) -> Int {
        var score = 0
        if AXActionRuntimeSupport.normalize(lhs.role) == AXActionRuntimeSupport.normalize(rhs.role) {
            score += 25
        }
        if AXActionRuntimeSupport.normalize(lhs.subrole) == AXActionRuntimeSupport.normalize(rhs.subrole) {
            score += 20
        }
        if AXActionRuntimeSupport.normalize(lhs.title) == AXActionRuntimeSupport.normalize(rhs.title),
           AXActionRuntimeSupport.normalize(lhs.title).isEmpty == false {
            score += 40
        }
        if AXActionRuntimeSupport.normalize(lhs.identifier) == AXActionRuntimeSupport.normalize(rhs.identifier),
           AXActionRuntimeSupport.normalize(lhs.identifier).isEmpty == false {
            score += 40
        }
        if AXActionRuntimeSupport.normalize(lhs.description) == AXActionRuntimeSupport.normalize(rhs.description),
           AXActionRuntimeSupport.normalize(lhs.description).isEmpty == false {
            score += 20
        }
        if AXActionRuntimeSupport.normalize(lhs.urlHost) == AXActionRuntimeSupport.normalize(rhs.urlHost),
           AXActionRuntimeSupport.normalize(lhs.urlHost).isEmpty == false {
            score += 15
        }
        return score
    }

    private func suffixMatchScore(lhs: [String], rhs: [String], perMatch: Int) -> Int {
        var score = 0
        var left = lhs.reversed().makeIterator()
        var right = rhs.reversed().makeIterator()
        while let leftValue = left.next(), let rightValue = right.next() {
            guard leftValue == rightValue else {
                break
            }
            score += perMatch
        }
        return score
    }

    private func hitTestScore(_ element: AXUIElement, target: AXActionTargetSnapshot) -> Int {
        let signature = AXActionRuntimeSupport.signature(for: element)
        let role = AXActionRuntimeSupport.normalize(signature.role)
        let subrole = AXActionRuntimeSupport.normalize(signature.subrole)
        let title = AXActionRuntimeSupport.normalize(signature.title)
        let identifier = AXActionRuntimeSupport.normalize(signature.identifier)
        let targetRole = AXActionRuntimeSupport.normalize(target.rawRole)
        let targetSubrole = AXActionRuntimeSupport.normalize(target.rawSubrole)
        let targetTitle = AXActionRuntimeSupport.normalize(target.title)
        let targetIdentifier = AXActionRuntimeSupport.normalize(target.identifier)
        let actions = Set(AXActionRuntimeSupport.actionNames(element))

        var score = 0
        if role == targetRole, role.isEmpty == false {
            score += 30
        }
        if subrole == targetSubrole, subrole.isEmpty == false {
            score += 20
        }
        if title == targetTitle, title.isEmpty == false {
            score += 35
        }
        if identifier == targetIdentifier, identifier.isEmpty == false {
            score += 35
        }
        if let frame = AXActionRuntimeSupport.rectAttribute(element, attribute: "AXFrame" as CFString),
           let targetFrame = target.frameAppKit.map(rect(from:)),
           approximatelyEqual(frame, targetFrame, tolerance: 8) {
            score += 20
        }
        if actions.contains("AXConfirm") || actions.contains("AXShowMenu") || target.isTextEntry == true {
            score += 8
        }

        return score
    }

    private func approximatelyEqual(_ lhs: CGRect, _ rhs: CGRect, tolerance: CGFloat) -> Bool {
        abs(lhs.minX - rhs.minX) <= tolerance &&
            abs(lhs.minY - rhs.minY) <= tolerance &&
            abs(lhs.width - rhs.width) <= tolerance &&
            abs(lhs.height - rhs.height) <= tolerance
    }

    private func rect(from dto: RectDTO) -> CGRect {
        CGRect(x: dto.x, y: dto.y, width: dto.width, height: dto.height)
    }

    private func point(from dto: PointDTO) -> CGPoint {
        CGPoint(x: dto.x, y: dto.y)
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard indices.contains(index) else {
            return nil
        }
        return self[index]
    }

    var only: Element? {
        count == 1 ? first : nil
    }
}

private extension CGRect {
    var center: CGPoint {
        CGPoint(x: midX, y: midY)
    }
}
