import ApplicationServices
import Foundation

struct AXSemanticEnricher {
    func enrich(_ rawCapture: AXRawCaptureResult) -> AXSemanticTreeDTO {
        let rawNodes = rawCapture.nodes
        let relationshipContext = RelationshipContext(nodes: rawNodes)
        let webDescendantIndices = webDescendantIndices(in: rawNodes)

        let nodes = rawNodes.map { rawNode in
            let displayRole = ProjectionTextSupport.displayRole(
                role: rawNode.role,
                subrole: rawNode.subrole,
                title: rawNode.title,
                description: rawNode.description,
                identifier: rawNode.identifier
            )
            let labelResolution = resolveLabel(
                for: rawNode,
                displayRole: displayRole,
                relationshipContext: relationshipContext,
                rawNodes: rawNodes
            )
            let flags = semanticFlags(
                for: rawNode,
                displayRole: displayRole,
                focusedCanonicalIndex: rawCapture.focusedCanonicalIndex,
                isWebDescendant: webDescendantIndices.contains(rawNode.index)
            )

            return AXSemanticNodeDTO(
                index: rawNode.index,
                parentIndex: rawNode.parentIndex,
                depth: rawNode.depth,
                rawRole: rawNode.role,
                rawSubrole: rawNode.subrole,
                displayRole: displayRole,
                intrinsicLabel: labelResolution.label,
                primaryLabelSource: labelResolution.source,
                ownerLabel: ownerLabel(for: rawNode, relationshipContext: relationshipContext, rawNodes: rawNodes),
                ownedLabelIndices: relationshipContext.ownedLabelIndices[rawNode.index] ?? [],
                relationshipOwnerIndex: relationshipContext.ownerByLabelIndex[rawNode.index],
                description: renderedDescription(for: rawNode, label: labelResolution.label),
                identifier: rawNode.identifier,
                url: renderedURL(for: rawNode, label: labelResolution.label),
                isInteractive: isInteractive(rawNode: rawNode, displayRole: displayRole),
                isTransparentWrapper: isTransparentWrapper(
                    rawNode: rawNode,
                    displayRole: displayRole,
                    intrinsicLabel: labelResolution.label,
                    relationshipContext: relationshipContext
                ),
                isMenuChrome: isMenuChrome(displayRole: displayRole),
                isWebStructural: isWebStructural(displayRole: displayRole),
                structuralImportance: structuralImportance(
                    rawNode: rawNode,
                    displayRole: displayRole,
                    flags: flags
                ),
                projectionProfileHint: projectionProfileHint(
                    rawNode: rawNode,
                    displayRole: displayRole,
                    isWebDescendant: webDescendantIndices.contains(rawNode.index)
                ),
                flags: flags,
                childIndices: rawNode.childIndices,
                frameAppKit: rawNode.frameAppKit,
                textExtraction: rawNode.textExtraction
            )
        }

        return AXSemanticTreeDTO(
            rootIndices: rawCapture.rootIndices,
            nodes: nodes,
            focusedCanonicalIndex: rawCapture.focusedCanonicalIndex,
            focusSelection: rawCapture.focusSelection
        )
    }

    private func resolveLabel(
        for rawNode: AXRawNodeDTO,
        displayRole: String,
        relationshipContext: RelationshipContext,
        rawNodes: [AXRawNodeDTO]
    ) -> (label: String?, source: String?) {
        let ownedLabelIndices = relationshipContext.ownedLabelIndices[rawNode.index] ?? []
        if let relationshipLabel = firstRelationshipLabel(indices: ownedLabelIndices, rawNodes: rawNodes) {
            return (relationshipLabel, "relationship")
        }

        if let title = ProjectionTextSupport.cleaned(rawNode.title) {
            return (title, "title")
        }
        if let description = ProjectionTextSupport.cleaned(rawNode.description),
           usesDescriptionAsPrimaryLabel(displayRole: displayRole) {
            return (description, "description")
        }
        if let extractedText = ProjectionTextSupport.cleaned(rawNode.textExtraction?.selectedText) {
            return (truncate(extractedText), "selected-text")
        }
        if let extractedText = ProjectionTextSupport.cleaned(rawNode.textExtraction?.text),
           ["text", "text entry area", "HTML content"].contains(displayRole) {
            return (truncate(extractedText), "extracted-text")
        }
        if ["text field", "search text field", "text entry area", "combo box"].contains(displayRole),
           let preview = ProjectionTextSupport.cleaned(rawNode.value.preview) {
            return (preview, "value-preview")
        }
        if let placeholder = ProjectionTextSupport.cleaned(rawNode.placeholder),
           ["text field", "search text field", "text entry area", "combo box"].contains(displayRole) {
            return (placeholder, "placeholder")
        }
        if displayRole == "text" || displayRole == "heading",
           let preview = ProjectionTextSupport.cleaned(rawNode.value.preview) {
            return (preview, "value-preview")
        }
        if ["button", "link", "menu item", "checkbox", "radio button", "pop up button", "menu button"].contains(displayRole),
           let preview = ProjectionTextSupport.cleaned(rawNode.value.preview) {
            return (preview, "value-preview")
        }
        if displayRole == "image",
           let description = ProjectionTextSupport.cleaned(rawNode.description) {
            return (description, "description")
        }
        return (nil, nil)
    }

    private func firstRelationshipLabel(indices: [Int], rawNodes: [AXRawNodeDTO]) -> String? {
        for index in indices where rawNodes.indices.contains(index) {
            if let text = labelCarrierText(for: rawNodes[index]) {
                return text
            }
        }
        return nil
    }

    private func labelCarrierText(for rawNode: AXRawNodeDTO) -> String? {
        if let title = ProjectionTextSupport.cleaned(rawNode.title) {
            return title
        }
        if let selectedText = ProjectionTextSupport.cleaned(rawNode.textExtraction?.selectedText) {
            return truncate(selectedText)
        }
        if let extractedText = ProjectionTextSupport.cleaned(rawNode.textExtraction?.text) {
            return truncate(extractedText)
        }
        if let preview = ProjectionTextSupport.cleaned(rawNode.value.preview) {
            return preview
        }
        if let description = ProjectionTextSupport.cleaned(rawNode.description) {
            return description
        }
        return nil
    }

    private func ownerLabel(
        for rawNode: AXRawNodeDTO,
        relationshipContext: RelationshipContext,
        rawNodes: [AXRawNodeDTO]
    ) -> String? {
        guard let ownerIndex = relationshipContext.ownerByLabelIndex[rawNode.index],
              rawNodes.indices.contains(ownerIndex) else {
            return nil
        }
        return labelCarrierText(for: rawNodes[ownerIndex])
    }

    private func renderedDescription(for rawNode: AXRawNodeDTO, label: String?) -> String? {
        guard let description = ProjectionTextSupport.cleaned(rawNode.description) else {
            return nil
        }
        if let label, normalizedComparisonText(label) == normalizedComparisonText(description) {
            return nil
        }
        return description
    }

    private func renderedURL(for rawNode: AXRawNodeDTO, label: String?) -> String? {
        guard let url = ProjectionTextSupport.cleaned(rawNode.url) else {
            return nil
        }
        if let label, normalizedComparisonText(label) == normalizedComparisonText(url) {
            return nil
        }
        return url
    }

    private func semanticFlags(
        for rawNode: AXRawNodeDTO,
        displayRole: String,
        focusedCanonicalIndex: Int?,
        isWebDescendant: Bool
    ) -> [String] {
        var flags: [String] = []
        if rawNode.selected == true { flags.append("selected") }
        if rawNode.isFocused == true || rawNode.index == focusedCanonicalIndex { flags.append("focused") }
        if isWebDescendant { flags.append("web_descendant") }
        if shouldExposeExpandedState(displayRole: displayRole) {
            if rawNode.expanded == true { flags.append("expanded") }
            if rawNode.expanded == false { flags.append("collapsed") }
        }
        if rawNode.isValueSettable == true { flags.append("settable") }
        if rawNode.enabled == false { flags.append("disabled") }
        if let kind = rawNode.value.kind,
           shouldExposeValueKind(displayRole: displayRole, rawNode: rawNode),
           flags.contains(kind) == false {
            flags.append(kind)
        }
        return flags
    }

    private func isInteractive(rawNode: AXRawNodeDTO, displayRole: String) -> Bool {
        if rawNode.isValueSettable == true || rawNode.secondaryActions.isEmpty == false {
            return true
        }
        if (rawNode.relationships?.selectedChildIndices?.isEmpty == false) ||
            (rawNode.relationships?.linkedElementIndices?.isEmpty == false) {
            return true
        }
        switch displayRole {
        case "button", "close button", "full screen button", "minimize button", "zoom button",
             "link", "checkbox", "radio button", "menu button", "pop up button", "combo box",
             "text field", "search text field", "text entry area", "slider", "disclosure triangle",
             "menu item", "tab", "tab group", "row":
            return true
        default:
            return false
        }
    }

    private func isTransparentWrapper(
        rawNode: AXRawNodeDTO,
        displayRole: String,
        intrinsicLabel: String?,
        relationshipContext: RelationshipContext
    ) -> Bool {
        guard ["container", "group", "cell", "column", "unknown", "scroll area"].contains(displayRole) else {
            return false
        }
        guard intrinsicLabel == nil,
              ProjectionTextSupport.cleaned(rawNode.description) == nil,
              ProjectionTextSupport.cleaned(rawNode.url) == nil,
              rawNode.secondaryActions.isEmpty,
              rawNode.selected != true,
              rawNode.enabled != false,
              rawNode.childCount > 0 else {
            return false
        }
        guard (relationshipContext.ownedLabelIndices[rawNode.index] ?? []).isEmpty else {
            return false
        }
        if rawNode.isValueSettable == true,
           ["cell", "column"].contains(displayRole) {
            return false
        }
        return true
    }

    private func isMenuChrome(displayRole: String) -> Bool {
        displayRole == "menu bar" || displayRole == "menu bar item" || displayRole == "menu"
    }

    private func isWebStructural(displayRole: String) -> Bool {
        switch displayRole {
        case "HTML content", "table", "row", "cell", "column", "collection", "content list",
             "list", "list box", "outline", "section", "scroll area":
            return true
        default:
            return false
        }
    }

    private func structuralImportance(rawNode: AXRawNodeDTO, displayRole: String, flags: [String]) -> String {
        if flags.contains("focused") || flags.contains("selected") {
            return "high"
        }
        if isInteractive(rawNode: rawNode, displayRole: displayRole) {
            return "high"
        }
        if isWebStructural(displayRole: displayRole) || displayRole == "standard window" || displayRole == "sheet" {
            return "medium"
        }
        return rawNode.childCount > 0 ? "medium" : "low"
    }

    private func projectionProfileHint(
        rawNode: AXRawNodeDTO,
        displayRole: String,
        isWebDescendant: Bool
    ) -> String? {
        if rawNode.role == "AXWebArea" || isWebDescendant {
            return "rich-web"
        }
        if ["outline", "row", "table", "toolbar", "menu item", "menu bar item", "standard window"].contains(displayRole) {
            return "native-compact"
        }
        return nil
    }

    private func webDescendantIndices(in rawNodes: [AXRawNodeDTO]) -> Set<Int> {
        let webRoots = rawNodes.compactMap { node -> Int? in
            guard node.role == "AXWebArea" else {
                return nil
            }
            return node.index
        }

        guard webRoots.isEmpty == false else {
            return []
        }

        var result = Set<Int>()
        var stack = webRoots
        while let current = stack.popLast() {
            guard rawNodes.indices.contains(current), result.insert(current).inserted else {
                continue
            }
            stack.append(contentsOf: rawNodes[current].childIndices)
        }
        return result
    }

    private func normalizedComparisonText(_ text: String) -> String {
        ProjectionTextSupport.cleaned(text)?
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) ?? ""
    }

    private func usesDescriptionAsPrimaryLabel(displayRole: String) -> Bool {
        switch displayRole {
        case "button", "link", "checkbox", "radio button", "menu button", "pop up button",
             "outline", "scroll area", "collection", "content list", "list", "section", "toolbar",
             "tab", "tab group", "standard window", "sheet", "menu item", "row":
            return true
        default:
            return false
        }
    }

    private func shouldExposeExpandedState(displayRole: String) -> Bool {
        switch displayRole {
        case "combo box", "disclosure triangle", "row", "outline", "section", "menu button", "pop up button":
            return true
        default:
            return false
        }
    }

    private func shouldExposeValueKind(displayRole: String, rawNode: AXRawNodeDTO) -> Bool {
        if rawNode.isValueSettable == true {
            return true
        }

        switch displayRole {
        case "table", "row", "cell", "column", "text field", "search text field", "text entry area",
             "combo box", "slider", "scroll bar", "value indicator", "checkbox", "radio button":
            return true
        default:
            return false
        }
    }

    private func truncate(_ text: String) -> String {
        if text.count <= 180 {
            return text
        }
        return String(text.prefix(177)) + "..."
    }
}

private struct RelationshipContext {
    let ownedLabelIndices: [Int: [Int]]
    let ownerByLabelIndex: [Int: Int]

    init(nodes: [AXRawNodeDTO]) {
        var ownedLabels: [Int: [Int]] = [:]
        var ownerByLabel: [Int: Int] = [:]

        for node in nodes {
            if let titleIndex = node.relationships?.titleElementIndex {
                ownedLabels[node.index, default: []].append(titleIndex)
                ownerByLabel[titleIndex] = ownerByLabel[titleIndex] ?? node.index
            }
            for labelIndex in node.relationships?.labelElementIndices ?? [] {
                ownedLabels[node.index, default: []].append(labelIndex)
                ownerByLabel[labelIndex] = ownerByLabel[labelIndex] ?? node.index
            }
        }

        for node in nodes {
            for ownerIndex in node.relationships?.servesAsTitleForIndices ?? [] {
                ownedLabels[ownerIndex, default: []].append(node.index)
                ownerByLabel[node.index] = ownerByLabel[node.index] ?? ownerIndex
            }
        }

        self.ownedLabelIndices = ownedLabels.mapValues { Self.uniqueOrdered($0) }
        self.ownerByLabelIndex = ownerByLabel
    }

    private static func uniqueOrdered(_ values: [Int]) -> [Int] {
        var seen = Set<Int>()
        var result: [Int] = []
        for value in values where seen.insert(value).inserted {
            result.append(value)
        }
        return result
    }
}
