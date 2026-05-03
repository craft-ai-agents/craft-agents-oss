import Foundation

enum AXClickReadinessSupport {
    struct CuratedActions {
        let secondaryActions: [String]
        let availableActions: [AXActionDescriptorDTO]
    }

    static func curatedActions(
        projectedNode: AXProjectedNodeDTO,
        rawNode: AXRawNodeDTO?
    ) -> CuratedActions {
        let rawAvailableActions = rawNode?.availableActions ?? []
        let curatedAvailableActions = rawAvailableActions.filter { action in
            shouldKeepForClicking(
                action: action,
                projectedNode: projectedNode,
                rawNode: rawNode
            )
        }

        let curatedLabels = Set(curatedAvailableActions.compactMap(\.label))
        let curatedSecondaryActions = projectedNode.secondaryActions.filter { curatedLabels.contains($0) }

        return CuratedActions(
            secondaryActions: curatedSecondaryActions,
            availableActions: curatedAvailableActions
        )
    }

    static func metrics(for nodes: [AXPipelineV2SurfaceNodeDTO]) -> AXClickReadinessMetricsDTO {
        let candidateNodes = nodes.filter(isClickCandidate)
        let nodesWithActionFiltering = nodes.reduce(into: 0) { count, node in
            let rawCount = node.availableActions?.count ?? 0
            let curatedCount = node.curatedAvailableActions?.count ?? rawCount
            if curatedCount < rawCount {
                count += 1
            }
        }

        return AXClickReadinessMetricsDTO(
            candidateNodeCount: candidateNodes.count,
            candidateNodesWithGeometry: candidateNodes.filter(hasGeometry).count,
            candidateNodesWithLabel: candidateNodes.filter(hasLabel).count,
            candidateNodesWithPrimaryAction: candidateNodes.filter(hasPrimaryClickAction).count,
            wrapperLikeCandidateCount: candidateNodes.filter(isWrapperLike).count,
            wrapperLikeCandidatesWithoutLabel: candidateNodes.filter { isWrapperLike($0) && hasLabel($0) == false }.count,
            redundantWrapperNodeCount: nodes.filter(isRedundantWrapper).count,
            tinyAnonymousLeafCount: nodes.filter(isTinyAnonymousLeaf).count,
            nodesWithActionFiltering: nodesWithActionFiltering
        )
    }

    private static func shouldKeepForClicking(
        action: AXActionDescriptorDTO,
        projectedNode: AXProjectedNodeDTO,
        rawNode: AXRawNodeDTO?
    ) -> Bool {
        let rawName = action.rawName

        if isScrollAction(rawName: rawName, category: action.category) {
            return false
        }

        switch rawName {
        case "AXRaise", "AXCancel", "AXScrollToVisible":
            return false
        case "AXShowMenu":
            return isPopupLike(projectedNode: projectedNode, rawNode: rawNode) ||
                isTextEntryLike(projectedNode: projectedNode, rawNode: rawNode) ||
                isMenuItemLike(projectedNode: projectedNode, rawNode: rawNode)
        case "AXShowDefaultUI", "AXShowAlternateUI":
            return isRowLike(projectedNode: projectedNode, rawNode: rawNode) ||
                isPopupLike(projectedNode: projectedNode, rawNode: rawNode) ||
                isMenuItemLike(projectedNode: projectedNode, rawNode: rawNode)
        case "AXIncrement", "AXDecrement":
            return isStepperLike(projectedNode: projectedNode, rawNode: rawNode)
        default:
            break
        }

        if isStructuralWrapper(projectedNode),
           isPrimaryClickAction(rawName) == false {
            return false
        }

        return true
    }

    private static func isClickCandidate(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        if let curatedActions = node.curatedAvailableActions, curatedActions.isEmpty == false {
            return true
        }
        if node.isValueSettable == true {
            return true
        }
        if node.interactionTraits?.isTextEntry == true {
            return true
        }
        let displayRole = node.displayRole.lowercased()
        return displayRole.contains("button") ||
            displayRole.contains("link") ||
            displayRole.contains("tab") ||
            displayRole.contains("row") ||
            displayRole.contains("menu item")
    }

    private static func hasGeometry(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        node.activationPointAppKit != nil || node.suggestedInteractionPointAppKit != nil || node.frameAppKit != nil
    }

    private static func hasLabel(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        normalized(node.title).isEmpty == false
    }

    private static func hasPrimaryClickAction(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        let actions = node.curatedAvailableActions ?? node.availableActions ?? []
        return actions.contains { isPrimaryClickAction($0.rawName) }
    }

    private static func isWrapperLike(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        structuralWrapperRoles.contains(node.displayRole.lowercased())
    }

    private static func isRedundantWrapper(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        isWrapperLike(node) &&
            node.childCount == 1 &&
            hasLabel(node) == false &&
            (node.curatedAvailableActions ?? []).isEmpty &&
            (node.flags.isEmpty)
    }

    private static func isTinyAnonymousLeaf(_ node: AXPipelineV2SurfaceNodeDTO) -> Bool {
        guard node.childCount == 0,
              isWrapperLike(node),
              hasLabel(node) == false,
              (node.curatedAvailableActions ?? []).isEmpty,
              normalized(node.description).isEmpty else {
            return false
        }
        guard let frame = node.frameAppKit else {
            return false
        }
        return isTiny(frame: frame)
    }

    private static func isPrimaryClickAction(_ rawName: String) -> Bool {
        switch rawName {
        case "AXPress", "AXOpen", "AXPick", "AXShowDefaultUI", "AXShowAlternateUI", "AXShowMenu", "AXConfirm":
            return true
        default:
            return false
        }
    }

    private static func isScrollAction(rawName: String, category: String) -> Bool {
        rawName.hasPrefix("AXScroll") || category == "scroll"
    }

    private static func isStructuralWrapper(_ projectedNode: AXProjectedNodeDTO) -> Bool {
        structuralWrapperRoles.contains(projectedNode.displayRole.lowercased()) &&
            normalized(projectedNode.label).isEmpty &&
            projectedNode.childProjectedIndices.isEmpty == false
    }

    private static func isPopupLike(
        projectedNode: AXProjectedNodeDTO,
        rawNode: AXRawNodeDTO?
    ) -> Bool {
        let displayRole = projectedNode.displayRole.lowercased()
        let rawRole = normalized(rawNode?.role)
        let rawSubrole = normalized(rawNode?.subrole)
        return displayRole.contains("menu button") ||
            displayRole.contains("pop up") ||
            rawRole.contains("popup") ||
            rawSubrole.contains("popup")
    }

    private static func isTextEntryLike(
        projectedNode: AXProjectedNodeDTO,
        rawNode: AXRawNodeDTO?
    ) -> Bool {
        if rawNode?.interactionTraits?.isTextEntry == true {
            return true
        }
        let displayRole = projectedNode.displayRole.lowercased()
        return displayRole.contains("text field") ||
            displayRole.contains("search text field") ||
            displayRole.contains("text entry")
    }

    private static func isMenuItemLike(
        projectedNode: AXProjectedNodeDTO,
        rawNode: AXRawNodeDTO?
    ) -> Bool {
        projectedNode.displayRole.lowercased().contains("menu item") ||
            normalized(rawNode?.role) == "axmenuitem"
    }

    private static func isRowLike(
        projectedNode: AXProjectedNodeDTO,
        rawNode: AXRawNodeDTO?
    ) -> Bool {
        let displayRole = projectedNode.displayRole.lowercased()
        let rawRole = normalized(rawNode?.role)
        return displayRole.contains("row") ||
            displayRole.contains("list item") ||
            rawRole == "axrow" ||
            rawRole == "axoutlinerow"
    }

    private static func isStepperLike(
        projectedNode: AXProjectedNodeDTO,
        rawNode: AXRawNodeDTO?
    ) -> Bool {
        let displayRole = projectedNode.displayRole.lowercased()
        return displayRole.contains("stepper") ||
            displayRole.contains("slider") ||
            normalized(rawNode?.role) == "axstepper"
    }

    private static func isTiny(frame: RectDTO) -> Bool {
        let minDimension = min(frame.width, frame.height)
        let maxDimension = max(frame.width, frame.height)
        let area = frame.width * frame.height
        return area <= 24 || (minDimension <= 1.5 && maxDimension <= 24)
    }

    private static func normalized(_ text: String?) -> String {
        ProjectionTextSupport.cleaned(text)?
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) ?? ""
    }

    private static let structuralWrapperRoles: Set<String> = [
        "container",
        "group",
        "section",
        "collection",
        "content list",
        "list",
        "browser",
        "cell",
        "column",
        "scroll area",
    ]
}
