import ApplicationServices
import Foundation

enum AXProjectionProfile: String, Codable {
    case compactNative = "compact-native"
    case richWeb = "rich-web-electron"
}

struct AXProjectionPolicy {
    let profile: AXProjectionProfile
    let includeMenuBar: Bool
    let collapseTransparentWrappers: Bool
    let maxProjectedNodes: Int
    let passiveBranchPreviewLimit: Int
    let menuMode: AXMenuMode
    let activeMenuTopLevelTitle: String?

    static func webElectronRich(
        includeMenuBar: Bool,
        menuMode: AXMenuMode = .none,
        activeMenuTopLevelTitle: String? = nil
    ) -> AXProjectionPolicy {
        AXProjectionPolicy(
            profile: .richWeb,
            includeMenuBar: includeMenuBar,
            collapseTransparentWrappers: true,
            maxProjectedNodes: 6500,
            passiveBranchPreviewLimit: 8,
            menuMode: menuMode,
            activeMenuTopLevelTitle: activeMenuTopLevelTitle
        )
    }

    static func compactNative(
        includeMenuBar: Bool,
        menuMode: AXMenuMode = .none,
        activeMenuTopLevelTitle: String? = nil
    ) -> AXProjectionPolicy {
        AXProjectionPolicy(
            profile: .compactNative,
            includeMenuBar: includeMenuBar,
            collapseTransparentWrappers: true,
            maxProjectedNodes: 2800,
            passiveBranchPreviewLimit: 6,
            menuMode: menuMode,
            activeMenuTopLevelTitle: activeMenuTopLevelTitle
        )
    }
}

struct AXProjectedTreeBuilder {
    func build(
        rawCapture: AXRawCaptureResult,
        semanticTree: AXSemanticTreeDTO,
        policy: AXProjectionPolicy
    ) -> AXProjectedTreeDTO {
        ProjectionContext(rawCapture: rawCapture, semanticTree: semanticTree, policy: policy).build()
    }
}

private final class ProjectionContext {
    private let rawCapture: AXRawCaptureResult
    private let semanticTree: AXSemanticTreeDTO
    private let policy: AXProjectionPolicy
    private let rawNodes: [AXRawNodeDTO]
    private let semanticNodes: [AXSemanticNodeDTO]
    private let activeBranchCanonicalIndices: Set<Int>

    private var states: [NodeProjectionState]
    private var appliedTransforms: [AXProjectionPassLogDTO] = []

    private var projectedNodes: [WorkingProjectedNode] = []
    private var rootProjectedIndices: [Int] = []
    private var canonicalToProjected: [Int: Int] = [:]

    init(rawCapture: AXRawCaptureResult, semanticTree: AXSemanticTreeDTO, policy: AXProjectionPolicy) {
        self.rawCapture = rawCapture
        self.semanticTree = semanticTree
        self.policy = policy
        self.rawNodes = rawCapture.nodes
        self.semanticNodes = semanticTree.nodes
        self.activeBranchCanonicalIndices = Self.makeActiveBranchCanonicalIndices(
            rawNodes: rawCapture.nodes,
            focusSelection: rawCapture.focusSelection,
            focusedCanonicalIndex: semanticTree.focusedCanonicalIndex
        )
        self.states = rawCapture.nodes.enumerated().map { index, rawNode in
            NodeProjectionState(
                canonicalIndex: index,
                label: semanticTree.nodes[index].intrinsicLabel,
                metadata: ProjectionContext.initialMetadata(
                    rawNode: rawNode,
                    semanticNode: semanticTree.nodes[index],
                    profile: policy.profile
                ),
                flags: semanticTree.nodes[index].flags,
                affordances: ProjectionContext.localAffordances(
                    rawNode: rawNode,
                    semanticNode: semanticTree.nodes[index]
                ),
                disposition: .normal,
                summaryStyle: nil,
                transformNotes: [],
                profileHint: semanticTree.nodes[index].projectionProfileHint
            )
        }
    }

    func build() -> AXProjectedTreeDTO {
        applyPass(name: "associateRelationshipLabels") {
            passAssociateRelationshipLabels()
        }
        applyPass(name: "flattenIntoSelectableAncestor") {
            passFlattenSelectableAncestors()
        }
        applyPass(name: "flattenRedundantHierarchy") {
            passFlattenRedundantHierarchy()
        }
        applyPass(name: "pruneNonDescriptiveSubtrees") {
            passPruneNonDescriptiveSubtrees()
        }
        applyPass(name: "pruneTransparentWrappers") {
            passPruneTransparentWrappers()
        }
        applyPass(name: "compactNativeSurfaces") {
            passCompactNativeSurfaces()
        }
        applyPass(name: "foldHiddenDescendantAffordances") {
            passFoldHiddenDescendantAffordances()
        }
        applyPass(name: "summarizePassiveMenuBranches") {
            passSummarizePassiveMenus()
        }

        for rootIndex in rawCapture.rootIndices {
            projectCanonicalNode(rootIndex, parentProjectedIndex: nil, depth: 0)
        }

        let render = AXTextRenderer().render(
            nodes: projectedNodes.map(\.dto),
            rootProjectedIndices: rootProjectedIndices,
            focusedCanonicalIndex: semanticTree.focusedCanonicalIndex,
            canonicalToProjected: canonicalToProjected,
            selectionSummary: rawCapture.focusSelection
        )

        return AXProjectedTreeDTO(
            rootProjectedIndices: rootProjectedIndices,
            nodes: projectedNodes.map(\.dto),
            lineMappings: render.lineMappings,
            renderedText: render.renderedText,
            focusedCanonicalIndex: semanticTree.focusedCanonicalIndex,
            focusedProjectedIndex: semanticTree.focusedCanonicalIndex.flatMap { canonicalToProjected[$0] },
            focusedDisplayIndex: render.focusedDisplayIndex,
            profile: policy.profile.rawValue,
            appliedTransforms: appliedTransforms,
            selectionSummary: rawCapture.focusSelection
        )
    }

    private func projectCanonicalNode(_ canonicalIndex: Int, parentProjectedIndex: Int?, depth: Int) {
        guard rawNodes.indices.contains(canonicalIndex), semanticNodes.indices.contains(canonicalIndex) else {
            return
        }
        if projectedNodes.count >= policy.maxProjectedNodes {
            return
        }

        let rawNode = rawNodes[canonicalIndex]
        let semanticNode = semanticNodes[canonicalIndex]
        let state = states[canonicalIndex]

        if shouldSkipEntireSubtree(semanticNode: semanticNode, state: state) {
            return
        }

        switch state.disposition {
        case .hiddenSubtree:
            return
        case .skipKeepChildren:
            for childIndex in rawNode.childIndices {
                projectCanonicalNode(childIndex, parentProjectedIndex: parentProjectedIndex, depth: depth)
            }
            return
        case .normal:
            break
        }

        let projectedIndex = projectedNodes.count
        let bindings = secondaryActionBindings(
            projectedIndex: projectedIndex,
            rawNode: rawNode,
            semanticNode: semanticNode,
            state: state
        )
        let node = WorkingProjectedNode(
            projectedIndex: projectedIndex,
            parentProjectedIndex: parentProjectedIndex,
            depth: depth,
            primaryCanonicalIndex: canonicalIndex,
            canonicalIndices: [canonicalIndex],
            displayRole: semanticNode.displayRole,
            label: state.label,
            metadata: state.metadata,
            flags: state.flags,
            secondaryActions: publicSecondaryActionLabels(from: bindings),
            secondaryActionBindings: bindings,
            affordances: state.affordances,
            frameAppKit: rawNode.frameAppKit,
            childProjectedIndices: [],
            profileHint: state.profileHint,
            transformNotes: uniqueOrdered(state.transformNotes)
        )
        projectedNodes.append(node)
        if let parentProjectedIndex {
            projectedNodes[parentProjectedIndex].childProjectedIndices.append(projectedIndex)
        } else {
            rootProjectedIndices.append(projectedIndex)
        }
        canonicalToProjected[canonicalIndex] = projectedIndex

        if state.summaryStyle != nil {
            return
        }

        for childIndex in rawNode.childIndices {
            projectCanonicalNode(childIndex, parentProjectedIndex: projectedIndex, depth: depth + 1)
        }
    }

    private func shouldSkipEntireSubtree(semanticNode: AXSemanticNodeDTO, state: NodeProjectionState) -> Bool {
        if semanticNode.isMenuChrome && policy.includeMenuBar == false {
            return true
        }
        if state.disposition == .hiddenSubtree {
            return true
        }
        return false
    }

    private func applyPass(name: String, _ block: () -> Int) {
        let changedNodeCount = block()
        appliedTransforms.append(
            AXProjectionPassLogDTO(
                name: name,
                changedNodeCount: changedNodeCount,
                notes: changedNodeCount == 0 ? ["No node state changes."] : []
            )
        )
    }

    private func passAssociateRelationshipLabels() -> Int {
        var changed = 0
        for semanticNode in semanticNodes where semanticNode.ownedLabelIndices.isEmpty == false {
            for labelIndex in semanticNode.ownedLabelIndices where rawNodes.indices.contains(labelIndex) {
                let labelSemantic = semanticNodes[labelIndex]
                guard labelSemantic.isInteractive == false else {
                    continue
                }
                if labelSemantic.relationshipOwnerIndex == semanticNode.index ||
                    ["text", "image"].contains(labelSemantic.displayRole) {
                    changed += mutateState(labelIndex) { state in
                        state.disposition = .hiddenSubtree
                        state.transformNotes.append("absorbed-by-owner")
                    }
                    changed += mutateState(semanticNode.index) { state in
                        state.transformNotes.append("relationship-label")
                    }
                }
            }
        }
        return changed
    }

    private func passFlattenSelectableAncestors() -> Int {
        var changed = 0
        for semanticNode in semanticNodes where shouldFlattenIntoAncestor(semanticNode) {
            let fragments = descendantTextFragments(for: semanticNode.index, depthRemaining: 3)
            guard fragments.isEmpty == false else {
                continue
            }

            let flattenedLabel = fragments.joined(separator: " | ")
            changed += mutateState(semanticNode.index) { state in
                if state.label == nil || state.label?.count ?? 0 < 3 {
                    state.label = truncate(flattenedLabel, limit: 180)
                } else if state.label.map({ normalized($0) != normalized(flattenedLabel) }) == true {
                    state.metadata.append("Contents: " + truncate(flattenedLabel, limit: 220))
                }
                state.transformNotes.append("selectable-ancestor-flatten")
            }

            for descendant in flattenableDescendants(of: semanticNode.index, depthRemaining: 2) {
                guard semanticNodes[descendant].isInteractive == false else {
                    continue
                }
                changed += mutateState(descendant) { state in
                    state.disposition = .hiddenSubtree
                    state.transformNotes.append("flattened-into-ancestor")
                }
            }
        }
        return changed
    }

    private func passPruneTransparentWrappers() -> Int {
        guard policy.collapseTransparentWrappers else {
            return 0
        }

        var changed = 0
        for semanticNode in semanticNodes where semanticNode.isTransparentWrapper {
            changed += mutateState(semanticNode.index) { state in
                state.disposition = .skipKeepChildren
                state.transformNotes.append("transparent-wrapper")
            }
        }
        return changed
    }

    private func passFlattenRedundantHierarchy() -> Int {
        var changed = 0
        for semanticNode in semanticNodes where shouldFlattenRedundantHierarchy(semanticNode) {
            changed += mutateState(semanticNode.index) { state in
                state.disposition = .skipKeepChildren
                state.transformNotes.append("redundant-hierarchy")
            }
        }
        return changed
    }

    private func passPruneNonDescriptiveSubtrees() -> Int {
        var changed = 0
        for semanticNode in semanticNodes where shouldPruneNonDescriptiveLeaf(semanticNode) {
            changed += mutateState(semanticNode.index) { state in
                state.disposition = .hiddenSubtree
                state.transformNotes.append("non-descriptive-leaf-prune")
            }
        }
        return changed
    }

    private func passCompactNativeSurfaces() -> Int {
        guard policy.profile == .compactNative else {
            return 0
        }

        var changed = 0
        for semanticNode in semanticNodes {
            let rawNode = rawNodes[semanticNode.index]
            let parentDisplayRole = rawNode.parentIndex.flatMap { parentIndex in
                semanticNodes.indices.contains(parentIndex) ? semanticNodes[parentIndex].displayRole : nil
            }
            switch semanticNode.displayRole {
            case "container", "section", "scroll area", "list", "collection", "content list", "split group", "browser":
                if states[semanticNode.index].label == nil,
                   states[semanticNode.index].metadata.isEmpty,
                   semanticNode.flags.isEmpty,
                   rawNode.secondaryActions.isEmpty {
                    changed += mutateState(semanticNode.index) { state in
                        state.disposition = .skipKeepChildren
                        state.transformNotes.append("native-compaction-wrapper")
                    }
                }
            case "cell", "column":
                if parentDisplayRole == "row" || parentDisplayRole == "outline" {
                    changed += mutateState(semanticNode.index) { state in
                        state.disposition = .hiddenSubtree
                        state.transformNotes.append("native-row-cell-compaction")
                    }
                }
            case "text":
                if states[semanticNode.index].label == nil {
                    changed += mutateState(semanticNode.index) { state in
                        state.disposition = .hiddenSubtree
                        state.transformNotes.append("native-compaction-text")
                    }
                }
            case "image":
                if states[semanticNode.index].label == nil && states[semanticNode.index].metadata.isEmpty {
                    changed += mutateState(semanticNode.index) { state in
                        state.disposition = .hiddenSubtree
                        state.transformNotes.append("native-compaction-image")
                    }
                }
            default:
                break
            }

            if semanticNode.displayRole != "HTML content" && semanticNode.displayRole != "link" {
                changed += mutateState(semanticNode.index) { state in
                    let filtered = state.metadata.filter { entry in
                        entry.hasPrefix("URL: ") == false && entry.hasPrefix("ID: ") == false
                    }
                    if filtered != state.metadata {
                        state.metadata = filtered
                        state.transformNotes.append("native-metadata-trim")
                    }
                }
            }
        }
        return changed
    }

    private func passFoldHiddenDescendantAffordances() -> Int {
        var changed = 0

        for index in states.indices {
            let affordances = states[index].affordances
            guard affordances.isEmpty == false,
                  isEffectivelyProjected(index) == false,
                  let ownerIndex = nearestProjectedAffordanceOwner(forHiddenIndex: index),
                  ownerIndex != index else {
                continue
            }

            let folded = affordances.map { affordance in
                foldedAffordance(affordance, ownerIndex: ownerIndex)
            }

            changed += mutateState(ownerIndex) { state in
                appendUniqueAffordances(folded, to: &state.affordances)
                state.transformNotes.append("folded-descendant-affordance")
            }
        }

        return changed
    }

    private func passSummarizePassiveMenus() -> Int {
        var changed = 0
        for semanticNode in semanticNodes {
            guard semanticNode.displayRole == "menu bar item",
                  policy.includeMenuBar,
                  rawNodes[semanticNode.index].childCount > 0 else {
                continue
            }
            if activeBranchCanonicalIndices.contains(semanticNode.index) {
                continue
            }
            if policy.menuMode == .openMenuOnly,
               let rawActiveTitle = policy.activeMenuTopLevelTitle,
               let currentLabel = states[semanticNode.index].label,
               normalized(rawActiveTitle) == normalized(currentLabel) {
                continue
            }

            let previewLabels = menuPreviewLabels(for: semanticNode.index, limit: policy.passiveBranchPreviewLimit)
            let itemCount = menuItemCount(in: semanticNode.index)
            changed += mutateState(semanticNode.index) { state in
                if itemCount > 0 {
                    state.metadata.append("Menu Items: \(itemCount)")
                }
                if previewLabels.isEmpty == false {
                    state.metadata.append("Preview: " + previewLabels.joined(separator: " | "))
                }
                state.summaryStyle = .menuBarItemPreview
                state.transformNotes.append("passive-menu-summary")
            }
        }
        return changed
    }

    private func secondaryActionBindings(
        projectedIndex: Int,
        rawNode: AXRawNodeDTO,
        semanticNode: AXSemanticNodeDTO,
        state: NodeProjectionState
    ) -> [AXSecondaryActionBindingDescriptorDTO] {
        let rawActions = rawNode.availableActions ?? []
        let enabled = rawNode.enabled != false && state.flags.contains("disabled") == false
        let menuPath = inferredMenuPath(for: rawNode)
        let activeMenu = policy.activeMenuTopLevelTitle?.isEmpty == false
        let activeMenuObscured = activeMenu && isMenuRole(rawNode.role) == false
        let projectedLabels = projectedSecondaryActions(rawNode: rawNode, semanticNode: semanticNode, state: state)
        let visibleRawLabels = Set(rawActions.compactMap { action -> String? in
            guard let label = action.label,
                  action.hiddenFromSecondaryActions == false,
                  shouldExposeVisibleRawAction(label: label, rawNode: rawNode, semanticNode: semanticNode, state: state) else {
                return nil
            }
            return label
        })

        var bindings: [AXSecondaryActionBindingDescriptorDTO] = []
        var seen = Set<String>()

        func append(_ binding: AXSecondaryActionBindingDescriptorDTO) {
            let key = [
                binding.exposure,
                binding.source,
                binding.label,
                binding.rawName ?? "",
                String(binding.target.projectedIndex),
                binding.dispatchTarget?.sourceNodeID ?? "",
                binding.dispatchTarget?.sourceCanonicalIndex.map(String.init) ?? ""
            ].joined(separator: "|")
            guard seen.insert(key).inserted else {
                return
            }
            bindings.append(binding)
        }

        for label in projectedLabels where visibleRawLabels.contains(label) == false {
            let affordance = bestAffordance(for: label, affordances: state.affordances)
            let dispatch = dispatchForProjectedSecondaryAction(
                label: label,
                rawNode: rawNode,
                affordance: affordance
            )
            append(makeSecondaryActionBinding(
                projectedIndex: projectedIndex,
                rawNode: rawNode,
                semanticNode: semanticNode,
                state: state,
                label: label,
                source: affordance.map { "affordance:\($0.kind)" } ?? "projected_secondary_action",
                kind: actionKind(category: nil, label: label),
                dispatchMethod: dispatch.method,
                rawName: dispatch.rawName,
                menuPath: menuPath,
                enabled: enabled,
                risk: classifyRisk(label),
                exposure: "model_visible",
                confidence: dispatch.confidence,
                verificationHint: verificationHint(category: nil, label: label),
                notes: ["Projected by production secondaryActions output."] + dispatch.notes,
                rawActions: rawActions,
                dispatchTarget: dispatch.target,
                sourceAffordance: affordance,
                activeMenuObscured: activeMenuObscured
            ))
        }

        for action in rawActions {
            guard let label = action.label,
                  label.isEmpty == false else {
                continue
            }

            if action.hiddenFromSecondaryActions == false {
                let expose = shouldExposeVisibleRawAction(label: label, rawNode: rawNode, semanticNode: semanticNode, state: state)
                append(makeSecondaryActionBinding(
                    projectedIndex: projectedIndex,
                    rawNode: rawNode,
                    semanticNode: semanticNode,
                    state: state,
                    label: label,
                    source: "raw_ax",
                    kind: actionKind(category: action.category, label: label),
                    dispatchMethod: "AXPerformAction",
                    rawName: action.rawName,
                    menuPath: menuPath,
                    enabled: enabled,
                    risk: classifyRisk(label),
                    exposure: expose ? "model_visible" : "transport_only",
                    confidence: "high",
                    verificationHint: verificationHint(category: action.category, label: label),
                    notes: expose
                        ? ["Projected from visible raw AX action label."]
                        : ["Raw action retained as transport evidence but hidden from public secondaryActions for API consistency."],
                    rawActions: rawActions,
                    dispatchTarget: nil,
                    sourceAffordance: nil,
                    activeMenuObscured: activeMenuObscured
                ))
                continue
            }

            if activeMenu,
               rawNode.role == String(kAXMenuRole),
               action.rawName == "AXCancel" {
                append(makeSecondaryActionBinding(
                    projectedIndex: projectedIndex,
                    rawNode: rawNode,
                    semanticNode: semanticNode,
                    state: state,
                    label: "Cancel",
                    source: "hidden_raw",
                    kind: "lifecycle",
                    dispatchMethod: "AXPerformAction",
                    rawName: "AXCancel",
                    menuPath: menuPath,
                    enabled: true,
                    risk: "reversible",
                    exposure: "model_visible",
                    confidence: "medium",
                    verificationHint: "menu_closed",
                    notes: ["Promoted only because an active menu presentation was captured."],
                    rawActions: rawActions,
                    dispatchTarget: nil,
                    sourceAffordance: nil,
                    activeMenuObscured: false
                ))
            } else if action.rawName == "AXShowMenu" {
                append(makeSecondaryActionBinding(
                    projectedIndex: projectedIndex,
                    rawNode: rawNode,
                    semanticNode: semanticNode,
                    state: state,
                    label: "Show Menu",
                    source: "hidden_raw",
                    kind: "menu",
                    dispatchMethod: "AXPerformAction",
                    rawName: "AXShowMenu",
                    menuPath: menuPath,
                    enabled: enabled,
                    risk: "reversible",
                    exposure: "transport_only",
                    confidence: "medium",
                    verificationHint: "state_changed",
                    notes: ["Transport evidence for context/menu capture; not promoted to a model-facing secondary action."],
                    rawActions: rawActions,
                    dispatchTarget: nil,
                    sourceAffordance: nil,
                    activeMenuObscured: activeMenuObscured
                ))
            } else if action.rawName == "AXPick" || action.rawName == "AXPress" {
                append(makeSecondaryActionBinding(
                    projectedIndex: projectedIndex,
                    rawNode: rawNode,
                    semanticNode: semanticNode,
                    state: state,
                    label: Self.sourceTitle(rawNode: rawNode, semanticNode: semanticNode) ?? debugActionLabel(action.rawName),
                    source: isMenuRole(rawNode.role) ? "menu_item" : "hidden_raw",
                    kind: isMenuRole(rawNode.role) ? "menu" : "primary",
                    dispatchMethod: "AXPerformAction",
                    rawName: action.rawName,
                    menuPath: menuPath,
                    enabled: enabled,
                    risk: classifyRisk(Self.sourceTitle(rawNode: rawNode, semanticNode: semanticNode) ?? debugActionLabel(action.rawName)),
                    exposure: "transport_only",
                    confidence: "medium",
                    verificationHint: "state_changed",
                    notes: ["Primary/menu action retained as transport evidence; it is not automatically promoted to a public secondary-action label."],
                    rawActions: rawActions,
                    dispatchTarget: nil,
                    sourceAffordance: nil,
                    activeMenuObscured: activeMenuObscured
                ))
            } else if action.rawName == "AXShowDefaultUI" || action.rawName == "AXShowAlternateUI" {
                let label = debugActionLabel(action.rawName)
                let promoted = projectedLabels.contains(label)
                append(makeSecondaryActionBinding(
                    projectedIndex: projectedIndex,
                    rawNode: rawNode,
                    semanticNode: semanticNode,
                    state: state,
                    label: label,
                    source: promoted ? "projected_secondary_action" : "hidden_raw",
                    kind: "unknown",
                    dispatchMethod: "AXPerformAction",
                    rawName: action.rawName,
                    menuPath: menuPath,
                    enabled: enabled,
                    risk: "unknown",
                    exposure: promoted ? "model_visible" : "debug_only",
                    confidence: promoted ? "medium" : "low",
                    verificationHint: "state_changed",
                    notes: promoted
                        ? ["Promoted because production exposed the exact label as a secondary action."]
                        : ["Raw default/alternate UI action retained as debug evidence only."],
                    rawActions: rawActions,
                    dispatchTarget: nil,
                    sourceAffordance: nil,
                    activeMenuObscured: activeMenuObscured
                ))
            }
        }

        return bindings
    }

    private func makeSecondaryActionBinding(
        projectedIndex: Int,
        rawNode: AXRawNodeDTO,
        semanticNode: AXSemanticNodeDTO,
        state: NodeProjectionState,
        label: String,
        source: String,
        kind: String,
        dispatchMethod: String,
        rawName: String?,
        menuPath: [String],
        enabled: Bool,
        risk: String,
        exposure: String,
        confidence: String,
        verificationHint: String,
        notes: [String],
        rawActions: [AXActionDescriptorDTO],
        dispatchTarget: AXSecondaryActionDispatchTargetDTO?,
        sourceAffordance: AXAffordanceDTO?,
        activeMenuObscured: Bool
    ) -> AXSecondaryActionBindingDescriptorDTO {
        let execution = executionPolicy(
            enabled: enabled,
            risk: risk,
            exposure: exposure,
            dispatchMethod: dispatchMethod,
            rawName: rawName,
            activeMenuObscured: activeMenuObscured
        )
        let visibility = exposure == "model_visible" ? "public" : (exposure == "debug_only" ? "debug_only" : "internal")
        let target = AXSecondaryActionBindingTargetDTO(
            displayIndex: nil,
            projectedIndex: projectedIndex,
            primaryCanonicalIndex: rawNode.index,
            canonicalIndices: [rawNode.index],
            nodeID: rawNode.identity?.nodeID,
            refetchFingerprint: rawNode.identity?.refetch?.fingerprint,
            role: semanticNode.displayRole,
            rawRole: rawNode.role,
            rawSubrole: rawNode.subrole,
            title: Self.sourceTitle(rawNode: rawNode, semanticNode: semanticNode),
            frameAppKit: rawNode.frameAppKit
        )
        let actionID = stableActionID([
            target.nodeID ?? target.refetchFingerprint ?? String(rawNode.index),
            dispatchTarget?.sourceNodeID ?? dispatchTarget?.sourceCanonicalIndex.map(String.init) ?? "",
            label,
            rawName ?? "",
            source,
            menuPath.joined(separator: ">")
        ])
        return AXSecondaryActionBindingDescriptorDTO(
            actionID: actionID,
            label: label,
            source: source,
            kind: kind,
            dispatchMethod: dispatchMethod,
            rawName: rawName,
            menuPath: menuPath.isEmpty ? nil : menuPath,
            target: target,
            dispatchTarget: dispatchTarget,
            enabled: enabled,
            risk: risk,
            exposure: exposure,
            visibility: visibility,
            modelVisible: exposure == "model_visible",
            canDispatch: execution.canDispatch,
            executionDisposition: execution.disposition,
            callabilityReasons: execution.reasons,
            confidence: confidence,
            verificationHint: verificationHint,
            evidence: AXSecondaryActionBindingEvidenceDTO(
                rawActions: rawActions.map(\.rawName),
                availableActions: rawActions.isEmpty ? nil : rawActions,
                nodeRole: rawNode.role ?? semanticNode.displayRole,
                nodeTitle: Self.sourceTitle(rawNode: rawNode, semanticNode: semanticNode),
                nodeFlags: state.flags,
                menuPath: menuPath.isEmpty ? nil : menuPath,
                activeMenuObscured: activeMenuObscured,
                sourceAffordance: sourceAffordance,
                notes: uniqueOrderedStrings(notes)
            )
        )
    }

    private func publicSecondaryActionLabels(from bindings: [AXSecondaryActionBindingDescriptorDTO]) -> [String] {
        uniqueOrderedStrings(
            bindings
                .filter { $0.modelVisible && $0.exposure == "model_visible" }
                .map(\.label)
        )
    }

    private func executionPolicy(
        enabled: Bool,
        risk: String,
        exposure: String,
        dispatchMethod: String,
        rawName: String?,
        activeMenuObscured: Bool
    ) -> (canDispatch: Bool, disposition: String, reasons: [String]) {
        if exposure == "debug_only" {
            return (false, "unsupported", ["debug_only_raw_action"])
        }
        if exposure == "transport_only" {
            return (false, "transport_only", ["transport_evidence_not_model_action"])
        }
        if enabled == false {
            return (false, "disabled", ["target_disabled"])
        }
        guard dispatchMethod == "AXPerformAction", rawName?.isEmpty == false else {
            return (false, "unsupported", ["no_validated_dispatch_method"])
        }
        var reasons = ["enabled_with_dispatch_method", "risk_\(risk)"]
        if activeMenuObscured {
            reasons.append("active_menu_obscures_background_target")
        }
        return (true, "callable", reasons)
    }

    private func dispatchForProjectedSecondaryAction(
        label: String,
        rawNode: AXRawNodeDTO,
        affordance: AXAffordanceDTO?
    ) -> (method: String, rawName: String?, target: AXSecondaryActionDispatchTargetDTO?, confidence: String, notes: [String]) {
        if let affordance, let rawAction = affordance.rawAction {
            return (
                "AXPerformAction",
                rawAction,
                dispatchTarget(from: affordance),
                affordance.confidence,
                ["Dispatch target comes from the matched folded affordance rawAction."]
            )
        }

        if (label == "Expand" || label == "Collapse"), let affordance {
            let evidencedRawName = rawAction(forCanonicalIndex: affordance.sourceCanonicalIndex, preferred: ["AXPress"])
            let rawName = evidencedRawName ?? (affordance.sourceRole == String(kAXDisclosureTriangleRole) ? "AXPress" : nil)
            return (
                rawName == nil ? "unsupported" : "AXPerformAction",
                rawName,
                dispatchTarget(from: affordance),
                evidencedRawName == nil ? "low" : "medium",
                rawName == nil
                    ? ["Disclosure label has state evidence but no raw AXPress dispatch source."]
                    : ["Mapped disclosure label to AXPress on the disclosure source."]
            )
        }

        if label == "Open Finder item",
           let affordance,
           affordance.kind == "represented_url" {
            let evidencedRawName = rawAction(forCanonicalIndex: affordance.sourceCanonicalIndex, preferred: ["AXOpen"])
            let isFileURL = (affordance.value ?? affordance.sourceURL ?? "").lowercased().hasPrefix("file://")
            let rawName = evidencedRawName ?? (isFileURL ? "AXOpen" : nil)
            return (
                rawName == nil ? "unsupported" : "AXPerformAction",
                rawName,
                dispatchTarget(from: affordance),
                evidencedRawName == nil ? "medium" : "high",
                rawName == nil
                    ? ["Represented URL is present, but no AXOpen dispatch source was found."]
                    : [
                        "Mapped represented file URL label to AXOpen on the folded source.",
                        "No AXConfirm, LaunchServices, shell open, click, or keypress fallback is part of plugin-parity dispatch."
                    ]
            )
        }

        if let visibleAction = (rawNode.availableActions ?? []).first(where: {
            $0.label == label && $0.hiddenFromSecondaryActions == false
        }) {
            return (
                "AXPerformAction",
                visibleAction.rawName,
                nil,
                "high",
                ["Dispatch target is the visible projected node."]
            )
        }

        return (
            "unsupported",
            nil,
            nil,
            "low",
            ["No dispatch source has been validated for this projected label."]
        )
    }

    private func dispatchTarget(from affordance: AXAffordanceDTO) -> AXSecondaryActionDispatchTargetDTO {
        AXSecondaryActionDispatchTargetDTO(
            sourceCanonicalIndex: affordance.sourceCanonicalIndex,
            sourceNodeID: affordance.sourceNodeID,
            sourceRole: affordance.sourceRole,
            sourceSubrole: affordance.sourceSubrole,
            sourceTitle: affordance.sourceTitle,
            sourceURL: affordance.sourceURL,
            foldedFromHiddenDescendant: affordance.foldedFromHiddenDescendant
        )
    }

    private func bestAffordance(for label: String, affordances: [AXAffordanceDTO]) -> AXAffordanceDTO? {
        let candidates = affordances.filter { bindingLabel(for: $0) == label }
        guard candidates.isEmpty == false else {
            return nil
        }
        if label == "Open Finder item" {
            return candidates.first(where: { $0.kind == "represented_url" }) ?? candidates[0]
        }
        if label == "Expand" || label == "Collapse" {
            return candidates.first(where: { $0.kind == "disclosure_state" }) ?? candidates[0]
        }
        return candidates.first(where: { $0.rawAction != nil }) ?? candidates[0]
    }

    private func bindingLabel(for affordance: AXAffordanceDTO) -> String? {
        switch affordance.kind {
        case "disclosure_state":
            if affordance.value == "collapsed" {
                return "Expand"
            }
            if affordance.value == "expanded" {
                return "Collapse"
            }
        case "represented_url":
            if (affordance.value ?? affordance.sourceURL ?? "").lowercased().hasPrefix("file://") {
                return "Open Finder item"
            }
        default:
            break
        }
        if affordance.rawAction == "AXShowDefaultUI" {
            return "Show Default UI"
        }
        if affordance.rawAction == "AXShowAlternateUI" {
            return "Show Alternate UI"
        }
        if affordance.rawAction == "AXCancel" {
            return "Cancel"
        }
        return affordance.label
    }

    private func mutateState(_ index: Int, _ body: (inout NodeProjectionState) -> Void) -> Int {
        guard states.indices.contains(index) else {
            return 0
        }
        let original = states[index]
        var updated = original
        body(&updated)
        guard updated != original else {
            return 0
        }
        states[index] = updated
        return 1
    }

    private func projectedSecondaryActions(
        rawNode: AXRawNodeDTO,
        semanticNode: AXSemanticNodeDTO,
        state: NodeProjectionState
    ) -> [String] {
        var labels = rawNode.secondaryActions.filter {
            shouldExposeVisibleRawAction(label: $0, rawNode: rawNode, semanticNode: semanticNode, state: state)
        }

        for affordance in state.affordances {
            switch affordance.kind {
            case "disclosure_state":
                guard shouldExposeDisclosureAction(affordance, owner: semanticNode, ownerState: state) else {
                    break
                }
                if affordance.value == "collapsed" {
                    labels.append("Expand")
                } else if affordance.value == "expanded" {
                    labels.append("Collapse")
                }
            case "represented_url":
                if shouldExposeOpenItemAction(for: affordance, owner: semanticNode) {
                    labels.append("Open Finder item")
                }
            case "raw_action":
                if shouldExposeRawUIAction(affordance, owner: semanticNode, ownerState: state) {
                    if affordance.rawAction == "AXShowDefaultUI" {
                        labels.append("Show Default UI")
                    } else if affordance.rawAction == "AXShowAlternateUI" {
                        labels.append("Show Alternate UI")
                    }
                } else if shouldExposeActiveMenuCancel(affordance, owner: semanticNode) {
                    labels.append("Cancel")
                }
            default:
                break
            }
        }

        return uniqueOrderedStrings(labels)
    }

    private func shouldExposeOpenItemAction(for affordance: AXAffordanceDTO, owner: AXSemanticNodeDTO) -> Bool {
        guard affordance.foldedFromHiddenDescendant,
              let value = affordance.value,
              value.lowercased().hasPrefix("file://") else {
            return false
        }
        return ["row", "cell", "outline", "list", "table"].contains(owner.displayRole)
    }

    private func shouldExposeRawUIAction(
        _ affordance: AXAffordanceDTO,
        owner: AXSemanticNodeDTO,
        ownerState: NodeProjectionState
    ) -> Bool {
        guard affordance.rawAction == "AXShowDefaultUI" || affordance.rawAction == "AXShowAlternateUI" else {
            return false
        }
        guard ["row", "cell"].contains(owner.displayRole) else {
            return false
        }
        return ownerState.flags.contains("selected") || ownerState.flags.contains("focused")
    }

    private func shouldExposeActiveMenuCancel(_ affordance: AXAffordanceDTO, owner: AXSemanticNodeDTO) -> Bool {
        guard affordance.rawAction == "AXCancel",
              owner.displayRole == "menu",
              policy.activeMenuTopLevelTitle?.isEmpty == false else {
            return false
        }
        return true
    }

    private func shouldExposeDisclosureAction(
        _ affordance: AXAffordanceDTO,
        owner: AXSemanticNodeDTO,
        ownerState: NodeProjectionState
    ) -> Bool {
        if ownerState.flags.contains("web_descendant"),
           owner.displayRole == "disclosure triangle",
           affordance.foldedFromHiddenDescendant == false {
            return false
        }
        if affordance.sourceRole == String(kAXButtonRole),
           affordance.foldedFromHiddenDescendant == false,
           affordance.notes.contains("raw-expanded"),
           isPluginStyleDisclosureButton(affordance) == false {
            return false
        }
        if rawAction(forCanonicalIndex: affordance.sourceCanonicalIndex, preferred: ["AXPress"]) != nil {
            return true
        }
        return affordance.sourceRole == String(kAXDisclosureTriangleRole)
    }

    private func isPluginStyleDisclosureButton(_ affordance: AXAffordanceDTO) -> Bool {
        guard let title = affordance.sourceTitle else {
            return false
        }
        switch normalized(title) {
        case "[show]", "[hide]":
            return true
        default:
            return false
        }
    }

    private func shouldExposeVisibleRawAction(
        label: String,
        rawNode: AXRawNodeDTO,
        semanticNode: AXSemanticNodeDTO,
        state: NodeProjectionState
    ) -> Bool {
        if label == "Confirm",
           rawNode.identifier == "WEB_BROWSER_ADDRESS_AND_SEARCH_FIELD" {
            return false
        }

        if label == "Scroll Left" || label == "Scroll Right" {
            return shouldExposeHorizontalScrollAction(rawNode: rawNode, semanticNode: semanticNode, state: state)
        }

        return true
    }

    private func shouldExposeHorizontalScrollAction(
        rawNode: AXRawNodeDTO,
        semanticNode: AXSemanticNodeDTO,
        state: NodeProjectionState
    ) -> Bool {
        let title = normalized(rawNode.title ?? semanticNode.intrinsicLabel ?? state.label ?? "")
        if title == "sidebar" || title == "list view" {
            return false
        }
        return true
    }

    private func rawAction(forCanonicalIndex canonicalIndex: Int, preferred: [String]) -> String? {
        guard rawNodes.indices.contains(canonicalIndex) else {
            return nil
        }
        let actionNames = Set((rawNodes[canonicalIndex].availableActions ?? []).map(\.rawName))
        return preferred.first(where: actionNames.contains)
    }

    private func inferredMenuPath(for rawNode: AXRawNodeDTO) -> [String] {
        guard isMenuRole(rawNode.role) else {
            return []
        }

        var titles: [String] = []
        var cursor: AXRawNodeDTO? = rawNode
        var remaining = 12
        while let node = cursor, remaining > 0 {
            if node.role == String(kAXMenuBarItemRole) || node.role == String(kAXMenuItemRole),
               let title = ProjectionTextSupport.cleaned(node.title) {
                titles.insert(title, at: 0)
            }
            cursor = node.parentIndex.flatMap { rawNodes[safe: $0] }
            remaining -= 1
        }

        if let activeTitle = policy.activeMenuTopLevelTitle,
           titles.first != activeTitle {
            titles.insert(activeTitle, at: 0)
        }

        return uniqueOrderedStrings(titles)
    }

    private func isMenuRole(_ role: String?) -> Bool {
        switch role {
        case String(kAXMenuBarRole), String(kAXMenuBarItemRole), String(kAXMenuRole), String(kAXMenuItemRole):
            return true
        default:
            return false
        }
    }

    private func actionKind(category: String?, label: String) -> String {
        if category == "focus" {
            return "focus"
        }
        if category == "scroll" {
            return "scroll"
        }
        if category == "lifecycle" {
            return "lifecycle"
        }
        if label.range(of: "expand|collapse", options: [.regularExpression, .caseInsensitive]) != nil {
            return "disclosure"
        }
        if category == "menu" {
            return "menu"
        }
        if category == "primary" {
            return "primary"
        }
        return "unknown"
    }

    private func verificationHint(category: String?, label: String) -> String {
        if category == "scroll" {
            return "scroll_position_changed"
        }
        if category == "focus" {
            return "state_changed"
        }
        if category == "lifecycle" || label.range(of: "cancel", options: [.caseInsensitive]) != nil {
            return "menu_closed"
        }
        if label.range(of: "zoom", options: [.caseInsensitive]) != nil {
            return "window_frame_changed"
        }
        if label.range(of: "expand|collapse", options: [.regularExpression, .caseInsensitive]) != nil {
            return "expanded_state_changed"
        }
        return "state_changed"
    }

    private func classifyRisk(_ label: String) -> String {
        let text = label.lowercased()
        if text.range(of: #"\b(move to trash|delete|erase|force quit|close account|remove from sidebar|remove download|remove all|discard)\b"#, options: .regularExpression) != nil {
            return "destructive"
        }
        if text.range(of: #"\b(send|submit|post|purchase|buy|share|email|message|invite|upload|publish|sign in|log in|login)\b"#, options: .regularExpression) != nil {
            return "transmits_data"
        }
        if text.range(of: #"\b(rename|new folder|new file|new window|save|tag|open with|settings|preferences|log out|logout|print|duplicate|copy|paste|cut|clear|reload|move|close tab|close window|open|open finder item|show in enclosing folder|download|add|create|edit|schedule|cancel booking)\b"#, options: .regularExpression) != nil {
            return "persistent"
        }
        if text.range(of: #"\b(cancel|show|hide|expand|collapse|scroll|raise|zoom|close menu|move previous|move next)\b"#, options: .regularExpression) != nil {
            return "reversible"
        }
        return "unknown"
    }

    private func debugActionLabel(_ rawName: String) -> String {
        switch rawName {
        case "AXShowDefaultUI":
            return "Show Default UI"
        case "AXShowAlternateUI":
            return "Show Alternate UI"
        default:
            let trimmed = rawName.hasPrefix("AX") ? String(rawName.dropFirst(2)) : rawName
            return trimmed.replacingOccurrences(
                of: "([a-z])([A-Z])",
                with: "$1 $2",
                options: .regularExpression
            )
        }
    }

    private func stableActionID(_ parts: [String]) -> String {
        var hash: UInt64 = 1_469_598_103_934_665_603
        for byte in parts.joined(separator: "|").utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 1_099_511_628_211
        }
        return String(format: "sa_%016llx", hash)
    }

    private func isEffectivelyProjected(_ canonicalIndex: Int) -> Bool {
        guard states.indices.contains(canonicalIndex),
              rawNodes.indices.contains(canonicalIndex),
              semanticNodes.indices.contains(canonicalIndex),
              states[canonicalIndex].disposition == .normal,
              shouldSkipEntireSubtree(semanticNode: semanticNodes[canonicalIndex], state: states[canonicalIndex]) == false else {
            return false
        }

        var current = rawNodes[canonicalIndex].parentIndex
        while let currentIndex = current {
            guard states.indices.contains(currentIndex),
                  rawNodes.indices.contains(currentIndex),
                  semanticNodes.indices.contains(currentIndex) else {
                return false
            }
            let ancestorState = states[currentIndex]
            if shouldSkipEntireSubtree(semanticNode: semanticNodes[currentIndex], state: ancestorState) {
                return false
            }
            current = rawNodes[currentIndex].parentIndex
        }

        return true
    }

    private func nearestProjectedAffordanceOwner(forHiddenIndex canonicalIndex: Int) -> Int? {
        var fallback: Int?
        var current = rawNodes[safe: canonicalIndex]?.parentIndex

        while let currentIndex = current {
            guard rawNodes.indices.contains(currentIndex), semanticNodes.indices.contains(currentIndex) else {
                break
            }

            if isEffectivelyProjected(currentIndex) {
                if fallback == nil {
                    fallback = currentIndex
                }
                if isAffordanceOwner(currentIndex) {
                    return currentIndex
                }
            }

            current = rawNodes[currentIndex].parentIndex
        }

        return fallback
    }

    private func isAffordanceOwner(_ canonicalIndex: Int) -> Bool {
        guard rawNodes.indices.contains(canonicalIndex), semanticNodes.indices.contains(canonicalIndex) else {
            return false
        }

        let rawNode = rawNodes[canonicalIndex]
        let semanticNode = semanticNodes[canonicalIndex]

        if semanticNode.isInteractive || rawNode.selected == true || rawNode.isFocused == true {
            return true
        }

        switch semanticNode.displayRole {
        case "row", "cell", "tab", "menu item", "link", "button", "text field",
             "search text field", "text entry area", "combo box", "pop up button",
             "menu button", "outline", "list", "table", "collection", "content list":
            return true
        default:
            return false
        }
    }

    private func foldedAffordance(_ affordance: AXAffordanceDTO, ownerIndex: Int) -> AXAffordanceDTO {
        var notes = affordance.notes
        if notes.contains("folded-to-owner:\(ownerIndex)") == false {
            notes.append("folded-to-owner:\(ownerIndex)")
        }
        return AXAffordanceDTO(
            kind: affordance.kind,
            label: affordance.label,
            value: affordance.value,
            sourceCanonicalIndex: affordance.sourceCanonicalIndex,
            sourceNodeID: affordance.sourceNodeID,
            sourceRole: affordance.sourceRole,
            sourceSubrole: affordance.sourceSubrole,
            sourceTitle: affordance.sourceTitle,
            sourceURL: affordance.sourceURL,
            rawAction: affordance.rawAction,
            enabled: affordance.enabled,
            confidence: affordance.confidence,
            foldedFromHiddenDescendant: true,
            notes: uniqueOrderedStrings(notes)
        )
    }

    private func shouldFlattenIntoAncestor(_ semanticNode: AXSemanticNodeDTO) -> Bool {
        switch semanticNode.displayRole {
        case "standard window", "sheet", "toolbar", "menu bar", "menu bar item", "tab group", "search text field", "text field":
            return false
        default:
            break
        }
        if semanticNode.isInteractive {
            return true
        }
        switch semanticNode.displayRole {
        case "row", "cell", "link", "menu item", "tab", "section":
            return true
        default:
            return false
        }
    }

    private func shouldFlattenRedundantHierarchy(_ semanticNode: AXSemanticNodeDTO) -> Bool {
        guard rawNodes.indices.contains(semanticNode.index),
              states.indices.contains(semanticNode.index) else {
            return false
        }

        let rawNode = rawNodes[semanticNode.index]
        let state = states[semanticNode.index]
        let role = semanticNode.displayRole

        guard ["container", "group", "section", "collection", "content list", "list", "browser", "cell", "column"].contains(role) else {
            return false
        }
        guard rawNode.parentIndex != nil,
              rawNode.childCount == 1,
              semanticNode.isInteractive == false,
              state.label == nil,
              state.metadata.isEmpty,
              hasBlockingProjectionFlags(state.flags) == false,
              rawNode.secondaryActions.isEmpty,
              (rawNode.availableActions ?? []).isEmpty,
              rawNode.isValueSettable != true,
              rawNode.selected != true,
              rawNode.isFocused != true,
              semanticNode.isMenuChrome == false,
              (semanticNode.ownedLabelIndices.isEmpty),
              (rawNode.relationships?.selectedChildIndices?.isEmpty != false) else {
            return false
        }

        return true
    }

    private func shouldPruneNonDescriptiveLeaf(_ semanticNode: AXSemanticNodeDTO) -> Bool {
        guard rawNodes.indices.contains(semanticNode.index),
              states.indices.contains(semanticNode.index) else {
            return false
        }

        let rawNode = rawNodes[semanticNode.index]
        let state = states[semanticNode.index]
        let role = semanticNode.displayRole

        guard ["container", "group", "section", "cell", "column", "unknown"].contains(role),
              rawNode.childCount == 0,
              semanticNode.isInteractive == false,
              state.label == nil,
              state.metadata.isEmpty,
              hasBlockingProjectionFlags(state.flags) == false,
              rawNode.secondaryActions.isEmpty,
              (rawNode.availableActions ?? []).isEmpty,
              rawNode.isValueSettable != true,
              rawNode.selected != true,
              rawNode.isFocused != true,
              semanticNode.isMenuChrome == false else {
            return false
        }

        if let frame = rawNode.frameAppKit, isTinyNoiseFrame(frame) {
            return true
        }

        return false
    }

    private func descendantTextFragments(for canonicalIndex: Int, depthRemaining: Int) -> [String] {
        guard depthRemaining > 0, rawNodes.indices.contains(canonicalIndex) else {
            return []
        }

        var fragments: [String] = []
        for childIndex in rawNodes[canonicalIndex].childIndices {
            guard semanticNodes.indices.contains(childIndex) else {
                continue
            }
            let childState = states[childIndex]
            let childSemantic = semanticNodes[childIndex]
            let childRaw = rawNodes[childIndex]

            if childState.disposition == .hiddenSubtree {
                continue
            }

            if childSemantic.displayRole == "text",
               let label = childState.label ?? ProjectionTextSupport.cleaned(childRaw.value.preview) {
                fragments.append(label)
            } else if let label = childState.label,
                      (childSemantic.isInteractive == false ||
                       ["text field", "search text field", "text entry area", "combo box"].contains(childSemantic.displayRole)) {
                fragments.append(label)
            } else if let extractedText = ProjectionTextSupport.cleaned(childRaw.textExtraction?.selectedText ?? childRaw.textExtraction?.text),
                      childSemantic.isInteractive == false {
                fragments.append(truncate(extractedText, limit: 160))
            }

            fragments.append(contentsOf: descendantTextFragments(for: childIndex, depthRemaining: depthRemaining - 1))
            if fragments.count >= 4 {
                break
            }
        }
        return uniqueOrderedStrings(fragments).prefix(4).map { $0 }
    }

    private func flattenableDescendants(of canonicalIndex: Int, depthRemaining: Int) -> [Int] {
        guard depthRemaining > 0 else {
            return []
        }
        var result: [Int] = []
        for childIndex in rawNodes[canonicalIndex].childIndices {
            guard semanticNodes.indices.contains(childIndex) else {
                continue
            }
            let semantic = semanticNodes[childIndex]
            if semantic.isInteractive == false,
               ["text", "image", "container", "cell", "column"].contains(semantic.displayRole) {
                result.append(childIndex)
            }
            result.append(contentsOf: flattenableDescendants(of: childIndex, depthRemaining: depthRemaining - 1))
        }
        return uniqueOrdered(result)
    }

    private func menuItemCount(in canonicalIndex: Int) -> Int {
        var count = 0
        var stack = rawNodes[canonicalIndex].childIndices
        while let current = stack.popLast() {
            guard semanticNodes.indices.contains(current), states.indices.contains(current) else {
                continue
            }
            if semanticNodes[current].displayRole == "menu item",
               states[current].label != nil {
                count += 1
            }
            stack.append(contentsOf: rawNodes[current].childIndices)
        }
        return count
    }

    private func menuPreviewLabels(for canonicalIndex: Int, limit: Int) -> [String] {
        guard limit > 0 else { return [] }

        var labels: [String] = []
        var seen = Set<String>()
        var sectionIndex = 0
        var labelsInSection = 0

        for current in directMenuItemIndices(for: canonicalIndex) {
            guard rawNodes.indices.contains(current), semanticNodes.indices.contains(current) else {
                continue
            }

            let label = states[current].label
            let isSeparator = label == nil
            if isSeparator {
                sectionIndex += 1
                labelsInSection = 0
                continue
            }

            let includeBySection = labelsInSection < (sectionIndex == 0 ? 2 : 1)
            let includeBySubmenu = hasNestedMenu(for: current)
            guard includeBySection || includeBySubmenu else {
                continue
            }

            if let previewLabel = menuPreviewLabel(for: current) {
                let normalizedPreview = normalized(previewLabel)
                if normalizedPreview.isEmpty == false, seen.contains(normalizedPreview) == false {
                    seen.insert(normalizedPreview)
                    labels.append(previewLabel)
                    labelsInSection += 1
                }
            }

            if labels.count >= limit {
                break
            }
        }

        return labels
    }

    private func menuPreviewLabel(for canonicalIndex: Int) -> String? {
        guard semanticNodes[canonicalIndex].displayRole == "menu item",
              let label = states[canonicalIndex].label else {
            return nil
        }

        guard let firstNestedLabel = firstMenuItemLabel(inDescendantsOf: canonicalIndex),
              normalized(firstNestedLabel) != normalized(label) else {
            return label
        }

        return "\(label) -> \(firstNestedLabel)"
    }

    private func firstMenuItemLabel(inDescendantsOf canonicalIndex: Int) -> String? {
        var queue = rawNodes[canonicalIndex].childIndices
        while queue.isEmpty == false {
            let current = queue.removeFirst()
            guard rawNodes.indices.contains(current), semanticNodes.indices.contains(current) else {
                continue
            }

            if semanticNodes[current].displayRole == "menu item",
               let label = states[current].label {
                return label
            }

            queue.append(contentsOf: rawNodes[current].childIndices)
        }
        return nil
    }

    private func directMenuItemIndices(for canonicalIndex: Int) -> [Int] {
        let directChildren = rawNodes[canonicalIndex].childIndices
        let menuChildren = directChildren.filter { childIndex in
            semanticNodes.indices.contains(childIndex) && semanticNodes[childIndex].displayRole == "menu"
        }

        if menuChildren.isEmpty {
            return directChildren
        }

        return menuChildren.flatMap { rawNodes[$0].childIndices }
    }

    private func hasNestedMenu(for canonicalIndex: Int) -> Bool {
        rawNodes[canonicalIndex].childIndices.contains { childIndex in
            semanticNodes.indices.contains(childIndex) && semanticNodes[childIndex].displayRole == "menu"
        }
    }

    private func normalized(_ text: String) -> String {
        ProjectionTextSupport.cleaned(text)?
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) ?? ""
    }

    private func uniqueOrderedStrings(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for value in values {
            let normalized = normalized(value)
            if normalized.isEmpty || seen.contains(normalized) {
                continue
            }
            seen.insert(normalized)
            result.append(value)
        }
        return result
    }

    private func uniqueOrdered(_ values: [Int]) -> [Int] {
        var seen = Set<Int>()
        var result: [Int] = []
        for value in values where seen.insert(value).inserted {
            result.append(value)
        }
        return result
    }

    private func uniqueOrdered<T: Hashable>(_ values: [T]) -> [T] {
        var seen = Set<T>()
        var result: [T] = []
        for value in values where seen.insert(value).inserted {
            result.append(value)
        }
        return result
    }

    private func truncate(_ text: String, limit: Int) -> String {
        guard text.count > limit else { return text }
        return String(text.prefix(max(0, limit - 3))) + "..."
    }

    private func isTinyNoiseFrame(_ frame: RectDTO) -> Bool {
        let minDimension = min(frame.width, frame.height)
        let maxDimension = max(frame.width, frame.height)
        let area = frame.width * frame.height
        return area <= 24 || (minDimension <= 1.5 && maxDimension <= 24)
    }

    private func hasBlockingProjectionFlags(_ flags: [String]) -> Bool {
        flags.contains { flag in
            flag.localizedCaseInsensitiveContains("web") == false
        }
    }

    private func appendUniqueAffordances(_ newAffordances: [AXAffordanceDTO], to affordances: inout [AXAffordanceDTO]) {
        var seen = Set(affordances.map(affordanceKey))
        for affordance in newAffordances {
            let key = affordanceKey(affordance)
            guard seen.insert(key).inserted else {
                continue
            }
            affordances.append(affordance)
        }
    }

    private func affordanceKey(_ affordance: AXAffordanceDTO) -> String {
        [
            affordance.kind,
            affordance.label ?? "",
            affordance.value ?? "",
            String(affordance.sourceCanonicalIndex),
            affordance.rawAction ?? ""
        ].joined(separator: "|")
    }

    private static func localAffordances(
        rawNode: AXRawNodeDTO,
        semanticNode: AXSemanticNodeDTO
    ) -> [AXAffordanceDTO] {
        var affordances: [AXAffordanceDTO] = []

        func append(
            kind: String,
            label: String? = nil,
            value: String? = nil,
            rawAction: String? = nil,
            confidence: String = "medium",
            notes: [String] = []
        ) {
            affordances.append(
                AXAffordanceDTO(
                    kind: kind,
                    label: label,
                    value: value,
                    sourceCanonicalIndex: rawNode.index,
                    sourceNodeID: rawNode.identity?.nodeID,
                    sourceRole: rawNode.role,
                    sourceSubrole: rawNode.subrole,
                    sourceTitle: sourceTitle(rawNode: rawNode, semanticNode: semanticNode),
                    sourceURL: ProjectionTextSupport.cleaned(rawNode.url),
                    rawAction: rawAction,
                    enabled: rawNode.enabled,
                    confidence: confidence,
                    foldedFromHiddenDescendant: false,
                    notes: notes
                )
            )
        }

        if let url = ProjectionTextSupport.cleaned(rawNode.url) {
            append(
                kind: "represented_url",
                label: sourceTitle(rawNode: rawNode, semanticNode: semanticNode),
                value: url,
                confidence: "high",
                notes: ["raw-url"]
            )
        }

        if let expanded = rawNode.expanded,
           isDisclosureStateRole(rawNode: rawNode, semanticNode: semanticNode) {
            append(
                kind: "disclosure_state",
                label: expanded ? "Collapse" : "Expand",
                value: expanded ? "expanded" : "collapsed",
                confidence: "high",
                notes: ["raw-expanded"]
            )
        } else if rawNode.identifier == "xSidebarHeader",
                  semanticNode.displayRole == "text" {
            append(
                kind: "disclosure_state",
                label: "Collapse",
                value: "expanded",
                confidence: "medium",
                notes: ["appkit-sidebar-section-header"]
            )
        } else if semanticNode.displayRole == "disclosure triangle",
                  let disclosureValue = disclosureStateFromValue(rawNode.value.preview) {
            append(
                kind: "disclosure_state",
                label: disclosureValue == "expanded" ? "Collapse" : "Expand",
                value: disclosureValue,
                confidence: "medium",
                notes: ["disclosure-triangle-value"]
            )
        }

        for action in rawNode.availableActions ?? [] {
            if action.rawName.hasPrefix("Name:") {
                append(
                    kind: "custom_action",
                    label: action.label,
                    value: action.rawName,
                    rawAction: action.rawName,
                    confidence: "medium",
                    notes: ["custom-ax-action"]
                )
            } else if action.hiddenFromSecondaryActions {
                append(
                    kind: "raw_action",
                    label: action.label ?? debugActionLabel(action.rawName),
                    value: action.rawName,
                    rawAction: action.rawName,
                    confidence: "medium",
                    notes: ["hidden-raw-action"]
                )
            }
        }

        if let textLabel = foldedTextLabel(rawNode: rawNode, semanticNode: semanticNode) {
            append(
                kind: "text_label",
                label: textLabel,
                value: textLabel,
                confidence: "medium",
                notes: ["descendant-label"]
            )
        }

        if rawNode.selected == true {
            append(
                kind: "selection_state",
                label: "selected",
                value: "selected",
                confidence: "high",
                notes: ["raw-selected"]
            )
        }

        if rawNode.isFocused == true {
            append(
                kind: "selection_state",
                label: "focused",
                value: "focused",
                confidence: "high",
                notes: ["raw-focused"]
            )
        }

        return uniqueOrderedAffordances(affordances)
    }

    private static func isDisclosureStateRole(rawNode: AXRawNodeDTO, semanticNode: AXSemanticNodeDTO) -> Bool {
        if semanticNode.displayRole == "disclosure triangle" {
            return true
        }
        if semanticNode.displayRole == "row",
           rawNode.subrole == "AXOutlineRow" || rawNode.role == String(kAXRowRole) {
            return true
        }
        if semanticNode.displayRole == "button",
           rawNode.role == String(kAXButtonRole),
           rawNode.expanded != nil {
            return true
        }
        return false
    }

    private static func sourceTitle(rawNode: AXRawNodeDTO, semanticNode: AXSemanticNodeDTO) -> String? {
        semanticNode.intrinsicLabel
            ?? ProjectionTextSupport.cleaned(rawNode.title)
            ?? ProjectionTextSupport.cleaned(rawNode.value.preview)
            ?? ProjectionTextSupport.cleaned(rawNode.description)
    }

    private static func foldedTextLabel(rawNode: AXRawNodeDTO, semanticNode: AXSemanticNodeDTO) -> String? {
        switch semanticNode.displayRole {
        case "text", "text field", "search text field":
            return sourceTitle(rawNode: rawNode, semanticNode: semanticNode)
        default:
            return nil
        }
    }

    private static func disclosureStateFromValue(_ value: String?) -> String? {
        guard let normalized = ProjectionTextSupport.cleaned(value)?.lowercased() else {
            return nil
        }
        switch normalized {
        case "0", "false", "off", "collapsed":
            return "collapsed"
        case "1", "true", "on", "expanded":
            return "expanded"
        default:
            return nil
        }
    }

    private static func debugActionLabel(_ action: String) -> String? {
        switch action {
        case "AXShowDefaultUI":
            return "Show Default UI"
        case "AXShowAlternateUI":
            return "Show Alternate UI"
        case "AXCancel":
            return "Cancel"
        case "AXShowMenu":
            return "Show Menu"
        default:
            if action.hasPrefix("AX") {
                return String(action.dropFirst(2))
                    .replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
            }
            return action
        }
    }

    private static func uniqueOrderedAffordances(_ values: [AXAffordanceDTO]) -> [AXAffordanceDTO] {
        var seen = Set<String>()
        var result: [AXAffordanceDTO] = []
        for value in values {
            let key = [
                value.kind,
                value.label ?? "",
                value.value ?? "",
                String(value.sourceCanonicalIndex),
                value.rawAction ?? ""
            ].joined(separator: "|")
            guard seen.insert(key).inserted else {
                continue
            }
            result.append(value)
        }
        return result
    }

    private static func initialMetadata(
        rawNode: AXRawNodeDTO,
        semanticNode: AXSemanticNodeDTO,
        profile: AXProjectionProfile
    ) -> [String] {
        var metadata: [String] = []
        let label = semanticNode.intrinsicLabel

        if let description = ProjectionTextSupport.cleaned(rawNode.description),
           owns(label: label, fragment: description) == false {
            metadata.append("Description: \(description)")
        }
        if let valueDescription = ProjectionTextSupport.cleaned(rawNode.valueDescription),
           owns(label: label, fragment: valueDescription) == false {
            metadata.append("Value Description: \(valueDescription)")
        }
        if let preview = ProjectionTextSupport.cleaned(rawNode.value.preview),
           rawNode.role != String(kAXStaticTextRole),
           owns(label: label, fragment: preview) == false {
            metadata.append("Value: \(preview)")
        }
        if let extractedText = ProjectionTextSupport.cleaned(rawNode.textExtraction?.text),
           semanticNode.displayRole != "text",
           owns(label: label, fragment: extractedText) == false {
            let limit = profile == .compactNative ? 120 : 260
            metadata.append("Text: " + truncatedText(extractedText, limit: limit))
        }
        if let selectedText = ProjectionTextSupport.cleaned(rawNode.textExtraction?.selectedText),
           owns(label: label, fragment: selectedText) == false {
            metadata.append("Selected Text: " + truncatedText(selectedText, limit: 120))
        }
        if let collectionInfo = rawNode.collectionInfo,
           collectionInfo.isWindowed,
           let visibleStartIndex = collectionInfo.visibleStartIndex,
           let visibleEndIndex = collectionInfo.visibleEndIndex {
            metadata.append("showing \(visibleStartIndex)-\(visibleEndIndex) of \(collectionInfo.totalItems) items")
        }
        if profile == .richWeb {
            if let url = ProjectionTextSupport.cleaned(rawNode.url),
               owns(label: label, fragment: url) == false {
                metadata.append("URL: \(url)")
            }
            if let identifier = ProjectionTextSupport.cleaned(rawNode.identifier),
               owns(label: label, fragment: identifier) == false {
                metadata.append("ID: \(identifier)")
            }
        }

        return metadata
    }

    private static func owns(label: String?, fragment: String) -> Bool {
        guard let label else { return false }
        return normalized(label).contains(normalized(fragment))
    }

    private static func normalized(_ text: String) -> String {
        ProjectionTextSupport.cleaned(text)?
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) ?? ""
    }

    private static func truncatedText(_ text: String, limit: Int) -> String {
        guard text.count > limit else { return text }
        return String(text.prefix(max(0, limit - 3))) + "..."
    }

    private static func makeActiveBranchCanonicalIndices(
        rawNodes: [AXRawNodeDTO],
        focusSelection: AXFocusSelectionSnapshotDTO?,
        focusedCanonicalIndex: Int?
    ) -> Set<Int> {
        var activeIndices = Set<Int>()

        func addAncestorChain(from canonicalIndex: Int?) {
            var current = canonicalIndex
            while let currentIndex = current, rawNodes.indices.contains(currentIndex) {
                if activeIndices.insert(currentIndex).inserted == false {
                    break
                }
                current = rawNodes[currentIndex].parentIndex
            }
        }

        addAncestorChain(from: focusedCanonicalIndex)
        for selectedIndex in focusSelection?.selectedCanonicalIndices ?? [] {
            addAncestorChain(from: selectedIndex)
        }
        return activeIndices
    }
}

private enum NodeRenderDisposition: Equatable {
    case normal
    case skipKeepChildren
    case hiddenSubtree
}

private enum BranchSummaryStyle: Equatable {
    case menuBarItemPreview
}

private struct NodeProjectionState: Equatable {
    let canonicalIndex: Int
    var label: String?
    var metadata: [String]
    var flags: [String]
    var affordances: [AXAffordanceDTO]
    var disposition: NodeRenderDisposition
    var summaryStyle: BranchSummaryStyle?
    var transformNotes: [String]
    var profileHint: String?
}

private struct WorkingProjectedNode {
    let projectedIndex: Int
    let parentProjectedIndex: Int?
    let depth: Int
    let primaryCanonicalIndex: Int
    let canonicalIndices: [Int]
    let displayRole: String
    let label: String?
    let metadata: [String]
    let flags: [String]
    let secondaryActions: [String]
    let secondaryActionBindings: [AXSecondaryActionBindingDescriptorDTO]
    let affordances: [AXAffordanceDTO]
    let frameAppKit: RectDTO?
    var childProjectedIndices: [Int]
    let profileHint: String?
    let transformNotes: [String]

    var dto: AXProjectedNodeDTO {
        AXProjectedNodeDTO(
            projectedIndex: projectedIndex,
            parentProjectedIndex: parentProjectedIndex,
            depth: depth,
            primaryCanonicalIndex: primaryCanonicalIndex,
            canonicalIndices: canonicalIndices,
            displayRole: displayRole,
            label: label,
            metadata: metadata,
            flags: flags,
            secondaryActions: secondaryActions,
            secondaryActionBindings: secondaryActionBindings.isEmpty ? nil : secondaryActionBindings,
            affordances: affordances.isEmpty ? nil : affordances,
            frameAppKit: frameAppKit,
            childProjectedIndices: childProjectedIndices,
            profileHint: profileHint,
            transformNotes: transformNotes
        )
    }
}

private struct AXTextRenderResult {
    let renderedText: String
    let lineMappings: [AXV2VisibleLineMappingDTO]
    let focusedDisplayIndex: Int?
}

private struct AXTextRenderer {
    func render(
        nodes: [AXProjectedNodeDTO],
        rootProjectedIndices: [Int],
        focusedCanonicalIndex: Int?,
        canonicalToProjected: [Int: Int],
        selectionSummary: AXFocusSelectionSnapshotDTO?
    ) -> AXTextRenderResult {
        var lines: [String] = []
        var lineMappings: [AXV2VisibleLineMappingDTO] = []

        func renderNode(_ projectedIndex: Int) {
            guard nodes.indices.contains(projectedIndex) else { return }
            let node = nodes[projectedIndex]
            if shouldRenderLine(node) {
                let indent = String(repeating: "\t", count: node.depth)
                var line = "\(indent)\(lines.count) \(node.displayRole)"
                if let label = node.label, label.isEmpty == false {
                    line += " \(label)"
                }
                if node.flags.isEmpty == false {
                    line += " (" + node.flags.joined(separator: ", ") + ")"
                }
                var metadata = node.metadata
                if node.secondaryActions.isEmpty == false {
                    metadata.append("Secondary Actions: " + node.secondaryActions.joined(separator: ", "))
                }
                if metadata.isEmpty == false {
                    line += ", " + metadata.joined(separator: ", ")
                }

                lineMappings.append(
                    AXV2VisibleLineMappingDTO(
                        displayIndex: lines.count,
                        projectedIndex: node.projectedIndex,
                        primaryCanonicalIndex: node.primaryCanonicalIndex,
                        canonicalIndices: node.canonicalIndices,
                        kind: "node"
                    )
                )
                lines.append(line)
            }

            for childIndex in node.childProjectedIndices {
                renderNode(childIndex)
            }
        }

        for rootProjectedIndex in rootProjectedIndices {
            renderNode(rootProjectedIndex)
        }

        let focusedDisplayIndex = focusedCanonicalIndex
            .flatMap { canonicalToProjected[$0] }
            .flatMap { projectedIndex in
                lineMappings.first(where: { $0.projectedIndex == projectedIndex })?.displayIndex
            }

        if let focusedDisplayIndex,
           let line = lines[safe: focusedDisplayIndex] {
            lines.append("")
            lines.append("The focused UI element is \(focusedDisplayIndex) \(nodes[lineMappings[focusedDisplayIndex].projectedIndex].displayRole).")
            if line.isEmpty == false {
                lines.append("Focus line: \(line.trimmingCharacters(in: .whitespaces))")
            }
        }

        if let selectedText = selectionSummary?.selectedText,
           selectedText.isEmpty == false {
            lines.append("")
            lines.append("Selected text: \(selectedText)")
        }

        return AXTextRenderResult(
            renderedText: lines.joined(separator: "\n"),
            lineMappings: lineMappings,
            focusedDisplayIndex: focusedDisplayIndex
        )
    }

    private func shouldRenderLine(_ node: AXProjectedNodeDTO) -> Bool {
        let hasLabel = node.label?.isEmpty == false
        let hasMetadata = node.metadata.isEmpty == false
        let hasFlags = node.flags.isEmpty == false
        let hasActions = node.secondaryActions.isEmpty == false

        if node.displayRole == "container",
           hasLabel == false,
           hasMetadata == false,
           hasFlags == false,
           hasActions == false {
            return false
        }

        if node.displayRole == "image",
           hasLabel == false,
           hasMetadata == false,
           hasFlags == false,
           hasActions == false {
            return false
        }

        return true
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
