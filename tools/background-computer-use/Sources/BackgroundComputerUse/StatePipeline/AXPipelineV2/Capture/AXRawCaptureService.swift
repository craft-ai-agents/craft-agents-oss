import ApplicationServices
import CryptoKit
import Foundation

private let maxValuePreviewLength = 220
private let perElementAXReadTimeout: Float = 0.25
private let denseCollectionFrameReadTimeout: Float = 0.05
private let denseCollectionViewportPadding: CGFloat = 24
private typealias AXElementIdentity = ObjectIdentifier

private enum AXAttributeNames {
    static var children: CFString { kAXChildrenAttribute as CFString }
    static var visibleChildren: CFString { "AXVisibleChildren" as CFString }
    static var rows: CFString { AXDenseCollectionSupport.rowsAttribute }
    static var visibleRows: CFString { AXDenseCollectionSupport.visibleRowsAttribute }
    static var role: CFString { kAXRoleAttribute as CFString }
    static var subrole: CFString { kAXSubroleAttribute as CFString }
    static var roleDescription: CFString { "AXRoleDescription" as CFString }
    static var title: CFString { kAXTitleAttribute as CFString }
    static var titleUIElement: CFString { "AXTitleUIElement" as CFString }
    static var placeholder: CFString { kAXPlaceholderValueAttribute as CFString }
    static var description: CFString { kAXDescriptionAttribute as CFString }
    static var help: CFString { kAXHelpAttribute as CFString }
    static var identifier: CFString { kAXIdentifierAttribute as CFString }
    static var url: CFString { kAXURLAttribute as CFString }
    static var enabled: CFString { kAXEnabledAttribute as CFString }
    static var selected: CFString { kAXSelectedAttribute as CFString }
    static var selectedChildren: CFString { "AXSelectedChildren" as CFString }
    static var expanded: CFString { kAXExpandedAttribute as CFString }
    static var value: CFString { kAXValueAttribute as CFString }
    static var valueDescription: CFString { "AXValueDescription" as CFString }
    static var linkedUIElements: CFString { "AXLinkedUIElements" as CFString }
    static var labelUIElements: CFString { "AXLabelUIElements" as CFString }
    static var servesAsTitleForUIElements: CFString { "AXServesAsTitleForUIElements" as CFString }
    static var topLevelUIElement: CFString { "AXTopLevelUIElement" as CFString }
    static var disclosedByRow: CFString { "AXDisclosedByRow" as CFString }
    static var position: CFString { kAXPositionAttribute as CFString }
    static var size: CFString { kAXSizeAttribute as CFString }
}

struct AXRawLiveCaptureResult {
    let rawCapture: AXRawCaptureResult
    let liveElementsByCanonicalIndex: [Int: AXUIElement]
}

struct AXRawCaptureService {
    private let textExtractionService = AXTextExtractionService()

    func capture(
        roots: [AXUIElement],
        focusedElement: AXUIElement?,
        maxNodes: Int,
        webTraversal: AXWebTraversalMode = .visible
    ) -> AXRawLiveCaptureResult {
        let session = AXReadSession()
        let focusedAncestorElements = focusedElement.map(focusedAncestorChain) ?? []

        var workingNodes: [WorkingRawNode] = []
        var indexedElements: [AXUIElement] = []
        var rootIndices: [Int] = []
        var stack: [(element: AXUIElement, parentIndex: Int?, depth: Int, path: [Int], isInsideWebArea: Bool)] = roots.enumerated().reversed().map {
            (element: $0.element, parentIndex: nil, depth: 0, path: [$0.offset], isInsideWebArea: false)
        }
        var canonicalIndexByIdentity: [AXElementIdentity: Int] = [:]
        var visited: Set<AXElementIdentity> = []
        var truncated = false

        while let item = stack.popLast() {
            AXUIElementSetMessagingTimeout(item.element, perElementAXReadTimeout)
            let identity = AXElementIdentity(item.element as AnyObject)
            if visited.contains(identity) {
                continue
            }
            visited.insert(identity)

            if workingNodes.count >= maxNodes {
                truncated = true
                break
            }

            let isPassiveMenuBarItem = item.parentIndex.map {
                workingNodes[$0].role == String(kAXMenuBarRole)
            } ?? false
            let isRootNode = item.parentIndex == nil
            var baseValues = session.multiple(
                item.element,
                attributes: baseAttributesForCapture(),
                fallbackOnFailure: isRootNode
            )
            let baseRoleWasMissing = session.string(from: baseValues, attribute: AXAttributeNames.role) == nil
            let shouldFallbackBaseValues = baseRoleWasMissing && shouldFallbackBaseValuesForPartialRead(
                depth: item.depth,
                isRootNode: isRootNode
            )
            if shouldFallbackBaseValues {
                baseValues = mergedValues(
                    baseValues,
                    session.individualValues(item.element, attributes: baseFallbackAttributesForPartialRead())
                )
            }

            let role = session.string(from: baseValues, attribute: AXAttributeNames.role)
            let expanded = session.bool(from: baseValues, attribute: AXAttributeNames.expanded)
            let isWebNode = item.isInsideWebArea || role == "AXWebArea"
            let shouldCaptureChildren = shouldCaptureChildren(
                role: role,
                isPassiveMenuBarItem: isPassiveMenuBarItem
            )
            var childValues = shouldCaptureChildren == false
                ? [:]
                : session.multiple(
                    item.element,
                    attributes: childAttributesForCapture(),
                    fallbackOnFailure: isRootNode
                )
            if shouldFallbackChildValues(
                childValues,
                session: session,
                shouldFallbackBaseValues: shouldFallbackBaseValues,
                isRootNode: isRootNode
            ) {
                childValues = mergedValues(
                    childValues,
                    session.individualValues(item.element, attributes: childAttributesForCapture())
                )
            }
            let rowValues = shouldCaptureChildren && shouldReadNativeRows(role: role, isWebNode: isWebNode)
                ? session.multiple(
                    item.element,
                    attributes: nativeRowAttributesForCapture()
                )
                : [:]
            let relationshipValues = isPassiveMenuBarItem || isWebNode
                ? [:]
                : session.multiple(
                    item.element,
                    attributes: relationshipAttributesForCapture()
                )
            let values = mergedValues(baseValues, childValues, rowValues, relationshipValues)
            let parameterizedAttributes = shouldReadParameterizedAttributes(role: role, isWebNode: isWebNode)
                ? AXHelpers.parameterizedAttributeNames(item.element).sorted()
                : []
            let rawChildren = shouldCaptureChildren ? session.elementArray(from: values, attribute: AXAttributeNames.children) : []
            let visibleChildren = shouldCaptureChildren ? session.elementArray(from: values, attribute: AXAttributeNames.visibleChildren) : []
            let rawRows = shouldCaptureChildren ? session.elementArray(from: values, attribute: AXAttributeNames.rows) : []
            let visibleRows = shouldCaptureChildren ? session.elementArray(from: values, attribute: AXAttributeNames.visibleRows) : []
            let frame = frame(from: values)
            let projectedChildren = shouldCaptureChildren == false
                ? ProjectedChildren(
                    elements: [],
                    source: childSummarySource(role: role, isPassiveMenuBarItem: isPassiveMenuBarItem),
                    collectionInfo: nil
                )
                : filteredProjectedChildren(
                    rawChildren,
                    visibleChildren: visibleChildren,
                    rawRows: rawRows,
                    visibleRows: visibleRows,
                    parentRole: role,
                    parentFrame: frame,
                    session: session,
                    webTraversal: webTraversal,
                    isWebNode: isWebNode
                )

            let index = workingNodes.count
            let frameAppKit = rectDTO(frame)
            let valueSummary = self.valueSummary(from: session.cfValue(from: values, attribute: AXAttributeNames.value))
            let textExtraction = shouldExtractText(role: role, isWebNode: isWebNode)
                ? textExtractionService.extract(
                    from: item.element,
                    role: role,
                    parameterizedAttributeNames: Set(parameterizedAttributes)
                )
                : nil
            let availableActions = shouldReadActions(role: role, isWebNode: isWebNode, expanded: expanded)
                ? AXActionabilitySupport.actionDescriptors(for: item.element)
                : []
            let isValueSettable = shouldReadValueSettable(role: role, isWebNode: isWebNode)
                ? session.isValueSettable(item.element)
                : nil
            let activationPointAppKit = shouldReadActivationPoint(role: role, isWebNode: isWebNode)
                ? validatedActivationPoint(
                    AXHelpers.activationPoint(item.element),
                    frameAppKit: frameAppKit
                )
                : nil
            let node = WorkingRawNode(
                index: index,
                parentIndex: item.parentIndex,
                depth: item.depth,
                path: item.path,
                childIndices: [],
                role: role,
                subrole: session.string(from: values, attribute: AXAttributeNames.subrole),
                roleDescription: session.string(from: values, attribute: AXAttributeNames.roleDescription),
                title: cleaned(session.string(from: values, attribute: AXAttributeNames.title)),
                placeholder: cleaned(session.string(from: values, attribute: AXAttributeNames.placeholder)),
                description: cleaned(session.string(from: values, attribute: AXAttributeNames.description)),
                help: cleaned(session.string(from: values, attribute: AXAttributeNames.help)),
                identifier: cleaned(session.string(from: values, attribute: AXAttributeNames.identifier)),
                url: urlString(from: session.cfValue(from: values, attribute: AXAttributeNames.url)),
                valueDescription: cleaned(session.string(from: values, attribute: AXAttributeNames.valueDescription)),
                valueType: valueTypeName(from: session.cfValue(from: values, attribute: AXAttributeNames.value)),
                enabled: session.bool(from: values, attribute: AXAttributeNames.enabled),
                selected: session.bool(from: values, attribute: AXAttributeNames.selected),
                expanded: expanded,
                isFocused: focusedElement.map { AXHelpers.elementsEqual($0, item.element) } ?? false,
                value: valueSummary,
                isValueSettable: isValueSettable,
                secondaryActions: filteredSecondaryActions(availableActions.compactMap(\.label)),
                availableActions: availableActions,
                parameterizedAttributes: parameterizedAttributes,
                frameAppKit: frameAppKit,
                activationPointAppKit: activationPointAppKit,
                childCount: projectedChildren.elements.count,
                childSource: projectedChildren.source,
                collectionInfo: projectedChildren.collectionInfo,
                titleElement: isPassiveMenuBarItem ? nil : session.element(from: values, attribute: AXAttributeNames.titleUIElement),
                labelElements: isPassiveMenuBarItem ? [] : session.elementArray(from: values, attribute: AXAttributeNames.labelUIElements),
                linkedElements: isPassiveMenuBarItem ? [] : session.elementArray(from: values, attribute: AXAttributeNames.linkedUIElements),
                servesAsTitleForElements: isPassiveMenuBarItem ? [] : session.elementArray(from: values, attribute: AXAttributeNames.servesAsTitleForUIElements),
                visibleChildrenElements: visibleChildren,
                selectedChildrenElements: isPassiveMenuBarItem ? [] : session.elementArray(from: values, attribute: AXAttributeNames.selectedChildren),
                topLevelElement: isPassiveMenuBarItem ? nil : session.element(from: values, attribute: AXAttributeNames.topLevelUIElement),
                disclosedByRowElement: isPassiveMenuBarItem ? nil : session.element(from: values, attribute: AXAttributeNames.disclosedByRow),
                textExtraction: textExtraction,
                interactionTraits: AXActionabilitySupport.interactionTraits(
                    role: role,
                    subrole: session.string(from: values, attribute: AXAttributeNames.subrole),
                    isValueSettable: isValueSettable,
                    actions: availableActions,
                    parameterizedAttributes: parameterizedAttributes
                )
            )

            workingNodes.append(node)
            indexedElements.append(item.element)
            canonicalIndexByIdentity[identity] = index

            if let parentIndex = item.parentIndex {
                workingNodes[parentIndex].childIndices.append(index)
            } else {
                rootIndices.append(index)
            }

            let childIsInsideWebArea = item.isInsideWebArea || role == "AXWebArea"
            for child in projectedChildren.elements.reversed() {
                stack.append((
                    element: child.element,
                    parentIndex: index,
                    depth: item.depth + 1,
                    path: item.path + [child.ordinal],
                    isInsideWebArea: childIsInsideWebArea
                ))
            }
        }

        let focusedCanonicalIndex = firstAncestorMatch(
            focusedAncestorElements: focusedAncestorElements,
            indexedElements: indexedElements,
            canonicalIndexByIdentity: canonicalIndexByIdentity
        )
        let refetchFingerprints = workingNodes.map { $0.refetchFingerprint }
        let finalizedNodes = workingNodes.map { node in
            node.dto(
                canonicalIndexByIdentity: canonicalIndexByIdentity,
                workingNodes: workingNodes,
                refetchFingerprints: refetchFingerprints
            )
        }
        let focusSelection = buildFocusSelection(
            nodes: finalizedNodes,
            focusedCanonicalIndex: focusedCanonicalIndex,
            focusedElement: focusedElement
        )

        return AXRawLiveCaptureResult(
            rawCapture: AXRawCaptureResult(
                rootIndices: rootIndices,
                nodes: finalizedNodes,
                focusedCanonicalIndex: focusedCanonicalIndex,
                focusSelection: focusSelection,
                truncated: truncated
            ),
            liveElementsByCanonicalIndex: Dictionary(
                uniqueKeysWithValues: indexedElements.enumerated().map { index, element in
                    (index, element)
                }
            )
        )
    }

    private func baseAttributesForCapture() -> [CFString] {
        [
            AXAttributeNames.role,
            AXAttributeNames.subrole,
            AXAttributeNames.roleDescription,
            AXAttributeNames.title,
            AXAttributeNames.placeholder,
            AXAttributeNames.description,
            AXAttributeNames.help,
            AXAttributeNames.identifier,
            AXAttributeNames.url,
            AXAttributeNames.enabled,
            AXAttributeNames.selected,
            AXAttributeNames.expanded,
            AXAttributeNames.value,
            AXAttributeNames.valueDescription,
            AXAttributeNames.position,
            AXAttributeNames.size,
        ]
    }

    private func childAttributesForCapture() -> [CFString] {
        [
            AXAttributeNames.children,
            AXAttributeNames.visibleChildren,
        ]
    }

    private func nativeRowAttributesForCapture() -> [CFString] {
        [
            AXAttributeNames.rows,
            AXAttributeNames.visibleRows,
        ]
    }

    private func baseFallbackAttributesForPartialRead() -> [CFString] {
        [
            AXAttributeNames.role,
            AXAttributeNames.subrole,
            AXAttributeNames.roleDescription,
            AXAttributeNames.title,
            AXAttributeNames.description,
            AXAttributeNames.enabled,
            AXAttributeNames.position,
            AXAttributeNames.size,
        ]
    }

    private func relationshipAttributesForCapture() -> [CFString] {
        [
            AXAttributeNames.titleUIElement,
            AXAttributeNames.selectedChildren,
            AXAttributeNames.labelUIElements,
            AXAttributeNames.linkedUIElements,
            AXAttributeNames.servesAsTitleForUIElements,
            AXAttributeNames.topLevelUIElement,
            AXAttributeNames.disclosedByRow,
        ]
    }

    private func mergedValues(_ dictionaries: [String: Any]...) -> [String: Any] {
        dictionaries.reduce(into: [:]) { result, values in
            for (key, value) in values {
                result[key] = value
            }
        }
    }

    private func shouldCaptureChildren(
        role: String?,
        isPassiveMenuBarItem: Bool
    ) -> Bool {
        if isPassiveMenuBarItem {
            return false
        }
        return true
    }

    private func childSummarySource(role: String?, isPassiveMenuBarItem: Bool) -> String {
        if isPassiveMenuBarItem {
            return "passiveMenuBarItemSummary"
        }
        if role == "AXWebArea" {
            return "webAreaSummary"
        }
        return "childrenSuppressed"
    }

    private func shouldFallbackBaseValuesForPartialRead(depth: Int, isRootNode: Bool) -> Bool {
        isRootNode || depth <= 6
    }

    private func shouldFallbackChildValues(
        _ childValues: [String: Any],
        session: AXReadSession,
        shouldFallbackBaseValues: Bool,
        isRootNode: Bool
    ) -> Bool {
        guard isRootNode || shouldFallbackBaseValues else {
            return false
        }
        let rawChildren = session.elementArray(from: childValues, attribute: AXAttributeNames.children)
        let visibleChildren = session.elementArray(from: childValues, attribute: AXAttributeNames.visibleChildren)
        return rawChildren.isEmpty && visibleChildren.isEmpty
    }

    private func shouldReadParameterizedAttributes(role: String?, isWebNode: Bool) -> Bool {
        guard isWebNode else {
            return true
        }
        return AXActionabilitySupport.isTextEntryRole(role: role, subrole: nil)
    }

    private func shouldReadNativeRows(role: String?, isWebNode: Bool) -> Bool {
        guard isWebNode == false else {
            return false
        }
        return AXDenseCollectionSupport.isNativeCollectionRole(role)
    }

    private func shouldExtractText(role: String?, isWebNode: Bool) -> Bool {
        guard isWebNode else {
            return true
        }
        return AXActionabilitySupport.isTextEntryRole(role: role, subrole: nil)
    }

    private func shouldReadActions(role: String?, isWebNode: Bool, expanded: Bool?) -> Bool {
        guard isWebNode else {
            return true
        }
        return isWebActionRole(role, expanded: expanded)
    }

    private func shouldReadValueSettable(role: String?, isWebNode: Bool) -> Bool {
        guard isWebNode else {
            return true
        }
        return AXActionabilitySupport.isTextEntryRole(role: role, subrole: nil)
    }

    private func shouldReadActivationPoint(role: String?, isWebNode: Bool) -> Bool {
        guard isWebNode else {
            return true
        }
        return AXActionabilitySupport.isTextEntryRole(role: role, subrole: nil)
    }

    private func isWebActionRole(_ role: String?, expanded: Bool?) -> Bool {
        switch role {
        case String(kAXButtonRole):
            return expanded != nil
        default:
            return AXActionabilitySupport.isTextEntryRole(role: role, subrole: nil)
        }
    }

    private func filteredProjectedChildren(
        _ children: [AXUIElement],
        visibleChildren: [AXUIElement],
        rawRows: [AXUIElement],
        visibleRows: [AXUIElement],
        parentRole: String?,
        parentFrame: CGRect?,
        session: AXReadSession,
        webTraversal: AXWebTraversalMode,
        isWebNode: Bool
    ) -> ProjectedChildren {
        if parentRole == String(kAXMenuBarRole) {
            let filtered = children.enumerated().compactMap { ordinal, child -> ProjectedChild? in
                AXUIElementSetMessagingTimeout(child, perElementAXReadTimeout)
                let values = session.multiple(
                    child,
                    attributes: [AXAttributeNames.role, AXAttributeNames.title]
                )
                let childRole = session.string(from: values, attribute: AXAttributeNames.role)
                let childTitle = session.string(from: values, attribute: AXAttributeNames.title)
                guard childRole == String(kAXMenuBarItemRole), childTitle != "Apple" else {
                    return nil
                }
                return ProjectedChild(element: child, ordinal: ordinal)
            }
            return ProjectedChildren(elements: filtered, source: "children", collectionInfo: nil)
        }

        let rawChildren = children.enumerated().map { ordinal, child in
            ProjectedChild(element: child, ordinal: ordinal)
        }
        let rawRowChildren = rawRows.enumerated().map { ordinal, child in
            ProjectedChild(element: child, ordinal: ordinal)
        }
        let visibleProjectedRows = projectedVisibleChildren(
            visibleRows,
            rawChildren: rawRows
        )
        if shouldWindowDenseCollection(
            parentRole: parentRole,
            isWebNode: isWebNode,
            rawChildCount: rawRows.count
        ) {
            if visibleProjectedRows.isEmpty == false, visibleProjectedRows.count < rawRows.count {
                return ProjectedChildren(
                    elements: visibleProjectedRows,
                    source: "visibleRows",
                    collectionInfo: collectionInfo(
                        source: "visibleRows",
                        totalItems: rawRows.count,
                        returnedChildren: visibleProjectedRows,
                        reason: "dense_native_collection_visible_rows"
                    )
                )
            }

            if let windowedRows = viewportWindowedChildren(
                rawRowChildren,
                parentFrame: parentFrame,
                source: "rows",
                session: session
            ) {
                return windowedRows
            }
        }

        let visibleProjectedChildren = projectedVisibleChildren(
            visibleChildren,
            rawChildren: children
        )
        let sourceElements: [ProjectedChild]
        let source: String
        if prefersVisibleChildren(parentRole, webTraversal: webTraversal), visibleProjectedChildren.isEmpty == false {
            sourceElements = visibleProjectedChildren
            source = "visibleChildren"
        } else {
            sourceElements = rawChildren
            source = "children"
        }

        if shouldWindowDenseCollection(
            parentRole: parentRole,
            isWebNode: isWebNode,
            rawChildCount: children.count
        ) {
            if visibleProjectedChildren.isEmpty == false, visibleProjectedChildren.count < children.count {
                return ProjectedChildren(
                    elements: visibleProjectedChildren,
                    source: "visibleChildren",
                    collectionInfo: collectionInfo(
                        source: "visibleChildren",
                        totalItems: children.count,
                        returnedChildren: visibleProjectedChildren,
                        reason: "dense_native_collection_visible_children"
                    )
                )
            }

            if let windowedChildren = viewportWindowedChildren(
                rawChildren,
                parentFrame: parentFrame,
                source: source,
                session: session
            ) {
                return windowedChildren
            }
        }

        return ProjectedChildren(elements: sourceElements, source: source, collectionInfo: nil)
    }

    private func projectedVisibleChildren(
        _ visibleChildren: [AXUIElement],
        rawChildren: [AXUIElement]
    ) -> [ProjectedChild] {
        guard visibleChildren.isEmpty == false else {
            return []
        }
        guard visibleChildren.count != rawChildren.count else {
            return visibleChildren.enumerated().map { ordinal, child in
                ProjectedChild(element: child, ordinal: ordinal)
            }
        }

        var rawOrdinalByIdentity: [AXElementIdentity: Int] = [:]
        for (ordinal, child) in rawChildren.enumerated() {
            let identity = AXElementIdentity(child as AnyObject)
            if rawOrdinalByIdentity[identity] == nil {
                rawOrdinalByIdentity[identity] = ordinal
            }
        }
        var usedOrdinals = Set<Int>()

        return visibleChildren.enumerated().map { fallbackOrdinal, child in
            let identity = AXElementIdentity(child as AnyObject)
            if let ordinal = rawOrdinalByIdentity[identity], usedOrdinals.insert(ordinal).inserted {
                return ProjectedChild(element: child, ordinal: ordinal)
            }
            if let ordinal = rawChildren.firstIndex(where: { candidate in
                AXHelpers.elementsEqual(candidate, child)
            }), usedOrdinals.insert(ordinal).inserted {
                return ProjectedChild(element: child, ordinal: ordinal)
            }
            return ProjectedChild(element: child, ordinal: fallbackOrdinal)
        }
    }

    private func shouldWindowDenseCollection(
        parentRole: String?,
        isWebNode: Bool,
        rawChildCount: Int
    ) -> Bool {
        guard isWebNode == false, rawChildCount >= AXDenseCollectionSupport.windowingThreshold else {
            return false
        }
        return AXDenseCollectionSupport.isNativeCollectionRole(parentRole)
    }

    private func viewportWindowedChildren(
        _ children: [ProjectedChild],
        parentFrame: CGRect?,
        source: String,
        session: AXReadSession
    ) -> ProjectedChildren? {
        guard let parentFrame, parentFrame.isEmpty == false else {
            return nil
        }

        let viewport = parentFrame.insetBy(dx: 0, dy: -denseCollectionViewportPadding)
        let visibleChildren = children.filter { child in
            guard let childFrame = childFrame(child.element, session: session),
                  childFrame.isEmpty == false else {
                return false
            }
            return childFrame.intersects(viewport)
        }

        guard visibleChildren.isEmpty == false, visibleChildren.count < children.count else {
            return nil
        }

        let windowedSource = source + ".viewport"
        return ProjectedChildren(
            elements: visibleChildren,
            source: windowedSource,
            collectionInfo: collectionInfo(
                source: windowedSource,
                totalItems: children.count,
                returnedChildren: visibleChildren,
                reason: "dense_native_collection_viewport"
            )
        )
    }

    private func childFrame(
        _ child: AXUIElement,
        session: AXReadSession
    ) -> CGRect? {
        AXUIElementSetMessagingTimeout(child, denseCollectionFrameReadTimeout)
        let values = session.multiple(
            child,
            attributes: [AXAttributeNames.position, AXAttributeNames.size]
        )
        return frame(from: values)
    }

    private func collectionInfo(
        source: String,
        totalItems: Int,
        returnedChildren: [ProjectedChild],
        reason: String
    ) -> AXCollectionWindowDTO {
        let ordinals = returnedChildren.map(\.ordinal)
        return AXCollectionWindowDTO(
            source: source,
            totalItems: totalItems,
            returnedItems: returnedChildren.count,
            visibleStartIndex: ordinals.min(),
            visibleEndIndex: ordinals.max(),
            isWindowed: true,
            reason: reason
        )
    }

    private func prefersVisibleChildren(_ parentRole: String?, webTraversal: AXWebTraversalMode) -> Bool {
        if parentRole == "AXWebArea" {
            return webTraversal != .full
        }
        switch parentRole {
        case String(kAXListRole),
             String(kAXTableRole),
             String(kAXRowRole),
             String(kAXOutlineRole),
             String(kAXScrollAreaRole):
            return true
        default:
            return false
        }
    }

    private func focusedAncestorChain(_ element: AXUIElement) -> [AXUIElement] {
        var result: [AXUIElement] = []
        var current: AXUIElement? = element
        while let currentElement = current {
            result.append(currentElement)
            current = AXHelpers.parent(currentElement)
        }
        return result
    }

    private func firstAncestorMatch(
        focusedAncestorElements: [AXUIElement],
        indexedElements: [AXUIElement],
        canonicalIndexByIdentity: [AXElementIdentity: Int]
    ) -> Int? {
        for element in focusedAncestorElements {
            let identity = AXElementIdentity(element as AnyObject)
            if let index = canonicalIndexByIdentity[identity] {
                return index
            }
            if let index = indexedElements.firstIndex(where: { AXHelpers.elementsEqual($0, element) }) {
                return index
            }
        }
        return nil
    }

    private func buildFocusSelection(
        nodes: [AXRawNodeDTO],
        focusedCanonicalIndex: Int?,
        focusedElement: AXUIElement?
    ) -> AXFocusSelectionSnapshotDTO? {
        var selectedCanonicalIndices = Set(nodes.indices.filter { nodes[$0].selected == true })
        for node in nodes {
            for index in node.relationships?.selectedChildIndices ?? [] {
                selectedCanonicalIndices.insert(index)
            }
        }

        let focusedNodeID = focusedCanonicalIndex
            .flatMap { nodes[safe: $0]?.identity?.nodeID }
        let selectedTextExtraction = focusedCanonicalIndex.flatMap { nodes[safe: $0]?.textExtraction }

        return AXFocusSelectionSnapshotDTO(
            focusedCanonicalIndex: focusedCanonicalIndex,
            focusedNodeID: focusedNodeID,
            selectedCanonicalIndices: selectedCanonicalIndices.sorted(),
            selectedNodeIDs: selectedCanonicalIndices.sorted().compactMap { nodes[safe: $0]?.identity?.nodeID },
            selectedText: selectedTextExtraction?.selectedText,
            selectedTextSource: selectedTextExtraction?.source
        )
    }

    private func frame(from values: [String: Any]) -> CGRect? {
        guard let position = AXHelpers.pointValue(from: values[AXAttributeNames.position as String] as AnyObject?),
              let size = AXHelpers.sizeValue(from: values[AXAttributeNames.size as String] as AnyObject?) else {
            return nil
        }
        return AXHelpers.appKitRect(fromAXOrigin: position, size: size)
    }

    private func rectDTO(_ rect: CGRect?) -> RectDTO? {
        guard let rect else { return nil }
        return RectDTO(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height)
    }

    private func pointDTO(_ point: CGPoint?) -> PointDTO? {
        guard let point else { return nil }
        return PointDTO(x: point.x, y: point.y)
    }

    private func validatedActivationPoint(
        _ point: CGPoint?,
        frameAppKit: RectDTO?
    ) -> PointDTO? {
        guard let point,
              let frameAppKit else {
            return nil
        }

        let rect = CGRect(
            x: frameAppKit.x,
            y: frameAppKit.y,
            width: frameAppKit.width,
            height: frameAppKit.height
        )
        .insetBy(dx: -8, dy: -8)

        guard rect.contains(point) else {
            return nil
        }

        return pointDTO(point)
    }

    private func cleaned(_ value: String?) -> String? {
        ProjectionTextSupport.cleaned(value)
    }

    private func valueSummary(from rawValue: CFTypeRef?) -> ValueSummaryDTO {
        guard let rawValue else {
            return ValueSummaryDTO(kind: nil, preview: nil, length: nil, truncated: false)
        }
        let kind = ProjectionTextSupport.valueKind(rawValue)
        let stringValue = ProjectionTextSupport.valuePreview(rawValue)
        guard let stringValue, stringValue.isEmpty == false else {
            return ValueSummaryDTO(kind: kind, preview: nil, length: nil, truncated: false)
        }
        let truncated = stringValue.count > maxValuePreviewLength
        let preview = truncated ? String(stringValue.prefix(maxValuePreviewLength)) : stringValue
        return ValueSummaryDTO(kind: kind, preview: preview, length: stringValue.count, truncated: truncated)
    }

    private func valueTypeName(from rawValue: CFTypeRef?) -> String? {
        guard let rawValue else {
            return nil
        }
        if CFGetTypeID(rawValue) == CFBooleanGetTypeID() {
            return "boolean"
        }
        if rawValue is String {
            return "string"
        }
        if CFGetTypeID(rawValue) == CFNumberGetTypeID() {
            return "number"
        }
        if rawValue is URL || rawValue is NSURL {
            return "url"
        }
        return String(describing: type(of: rawValue))
    }

    private func urlString(from rawValue: CFTypeRef?) -> String? {
        guard let rawValue else { return nil }
        if let text = rawValue as? String {
            return ProjectionTextSupport.cleaned(text)
        }
        if let url = rawValue as? URL {
            return ProjectionTextSupport.cleaned(url.absoluteString)
        }
        if let url = rawValue as? NSURL {
            return ProjectionTextSupport.cleaned(url.absoluteString)
        }
        return nil
    }

    private func filteredSecondaryActions(_ actions: [String]) -> [String] {
        actions.filter {
            $0 != "Show Menu" &&
            $0 != "Scroll To Visible"
        }
    }
}

private struct ProjectedChild {
    let element: AXUIElement
    let ordinal: Int
}

private struct ProjectedChildren {
    let elements: [ProjectedChild]
    let source: String
    let collectionInfo: AXCollectionWindowDTO?
}

private struct WorkingRawNode {
    let index: Int
    let parentIndex: Int?
    let depth: Int
    let path: [Int]
    var childIndices: [Int]
    let role: String?
    let subrole: String?
    let roleDescription: String?
    let title: String?
    let placeholder: String?
    let description: String?
    let help: String?
    let identifier: String?
    let url: String?
    let valueDescription: String?
    let valueType: String?
    let enabled: Bool?
    let selected: Bool?
    let expanded: Bool?
    let isFocused: Bool?
    let value: ValueSummaryDTO
    let isValueSettable: Bool?
    let secondaryActions: [String]
    let availableActions: [AXActionDescriptorDTO]
    let parameterizedAttributes: [String]
    let frameAppKit: RectDTO?
    let activationPointAppKit: PointDTO?
    let childCount: Int
    let childSource: String?
    let collectionInfo: AXCollectionWindowDTO?
    let titleElement: AXUIElement?
    let labelElements: [AXUIElement]
    let linkedElements: [AXUIElement]
    let servesAsTitleForElements: [AXUIElement]
    let visibleChildrenElements: [AXUIElement]
    let selectedChildrenElements: [AXUIElement]
    let topLevelElement: AXUIElement?
    let disclosedByRowElement: AXUIElement?
    let textExtraction: AXTextExtractionDTO?
    let interactionTraits: AXInteractionTraitsDTO?

    var refetchFingerprint: String {
        let signature = AXNodeRefetchSignatureDTO(
            role: role,
            subrole: subrole,
            roleDescription: roleDescription,
            title: title,
            description: description,
            placeholder: placeholder,
            help: help,
            identifier: identifier,
            urlHost: URL(string: url ?? "")?.host
        )
        return Self.fingerprint(for: signature)
    }

    func dto(
        canonicalIndexByIdentity: [AXElementIdentity: Int],
        workingNodes: [WorkingRawNode],
        refetchFingerprints: [String]
    ) -> AXRawNodeDTO {
        let signature = AXNodeIdentitySignatureDTO(
            role: role,
            subrole: subrole,
            title: title,
            description: description,
            valuePreview: value.preview,
            identifier: identifier,
            url: url
        )
        let refetchSignature = AXNodeRefetchSignatureDTO(
            role: role,
            subrole: subrole,
            roleDescription: roleDescription,
            title: title,
            description: description,
            placeholder: placeholder,
            help: help,
            identifier: identifier,
            urlHost: URL(string: url ?? "")?.host
        )
        let refetchLocator = AXNodeRefetchLocatorDTO(
            fingerprint: refetchFingerprints[index],
            parentFingerprint: parentIndex.flatMap { refetchFingerprints[safe: $0] },
            ancestorFingerprints: ancestorFingerprints(workingNodes: workingNodes, refetchFingerprints: refetchFingerprints),
            ordinalWithinParent: path.last ?? 0,
            rolePath: rolePath(workingNodes: workingNodes),
            signature: refetchSignature
        )
        let identity = AXNodeIdentityDTO(
            nodeID: "n:" + path.map(String.init).joined(separator: "."),
            path: path,
            pathString: path.map(String.init).joined(separator: "."),
            signature: signature,
            refetch: refetchLocator
        )

        let relationships = AXRelationshipSnapshotDTO(
            titleElementIndex: titleElement.flatMap { canonicalIndexByIdentity[AXElementIdentity($0 as AnyObject)] },
            labelElementIndices: mapElements(labelElements, canonicalIndexByIdentity: canonicalIndexByIdentity),
            linkedElementIndices: mapElements(linkedElements, canonicalIndexByIdentity: canonicalIndexByIdentity),
            servesAsTitleForIndices: mapElements(servesAsTitleForElements, canonicalIndexByIdentity: canonicalIndexByIdentity),
            visibleChildIndices: mapElements(visibleChildrenElements, canonicalIndexByIdentity: canonicalIndexByIdentity),
            selectedChildIndices: mapElements(selectedChildrenElements, canonicalIndexByIdentity: canonicalIndexByIdentity),
            topLevelElementIndex: topLevelElement.flatMap { canonicalIndexByIdentity[AXElementIdentity($0 as AnyObject)] },
            disclosedByRowIndex: disclosedByRowElement.flatMap { canonicalIndexByIdentity[AXElementIdentity($0 as AnyObject)] }
        )

        return AXRawNodeDTO(
            index: index,
            parentIndex: parentIndex,
            depth: depth,
            childIndices: childIndices,
            role: role,
            subrole: subrole,
            roleDescription: roleDescription,
            title: title,
            placeholder: placeholder,
            description: description,
            help: help,
            identifier: identifier,
            url: url,
            valueDescription: valueDescription,
            valueType: valueType,
            enabled: enabled,
            selected: selected,
            expanded: expanded,
            isFocused: isFocused,
            value: value,
            isValueSettable: isValueSettable,
            secondaryActions: secondaryActions,
            availableActions: availableActions,
            parameterizedAttributes: parameterizedAttributes,
            frameAppKit: frameAppKit,
            activationPointAppKit: activationPointAppKit,
            childCount: childCount,
            childSource: childSource,
            collectionInfo: collectionInfo,
            identity: identity,
            relationships: relationships,
            textExtraction: textExtraction,
            interactionTraits: interactionTraits
        )
    }

    private func ancestorFingerprints(
        workingNodes: [WorkingRawNode],
        refetchFingerprints: [String]
    ) -> [String] {
        var values: [String] = []
        var currentParentIndex = parentIndex
        while let current = currentParentIndex {
            guard let fingerprint = refetchFingerprints[safe: current] else {
                break
            }
            values.append(fingerprint)
            currentParentIndex = workingNodes[safe: current]?.parentIndex
        }
        return values.reversed()
    }

    private func rolePath(workingNodes: [WorkingRawNode]) -> [String] {
        var values: [String] = [role ?? "unknown"]
        var currentParentIndex = parentIndex
        while let current = currentParentIndex {
            guard let currentNode = workingNodes[safe: current] else {
                break
            }
            values.append(currentNode.role ?? "unknown")
            currentParentIndex = currentNode.parentIndex
        }
        return values.reversed()
    }

    private func mapElements(
        _ elements: [AXUIElement],
        canonicalIndexByIdentity: [AXElementIdentity: Int]
    ) -> [Int]? {
        let indices = elements.compactMap { canonicalIndexByIdentity[AXElementIdentity($0 as AnyObject)] }
        return indices.isEmpty ? nil : indices
    }

    private static func fingerprint(for signature: AXNodeRefetchSignatureDTO) -> String {
        let raw = [
            signature.role,
            signature.subrole,
            signature.roleDescription,
            signature.title,
            signature.description,
            signature.placeholder,
            signature.help,
            signature.identifier,
            signature.urlHost,
        ]
        .map { normalized($0) }
        .joined(separator: "|")
        let digest = SHA256.hash(data: Data(raw.utf8))
        return digest.prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    private static func normalized(_ value: String?) -> String {
        ProjectionTextSupport.cleaned(value)?
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) ?? ""
    }
}

private final class AXReadSession {
    func multiple(
        _ element: AXUIElement,
        attributes: [CFString],
        fallbackOnFailure: Bool = false
    ) -> [String: Any] {
        let uniqueAttributes = deduplicated(attributes)
        guard uniqueAttributes.isEmpty == false else {
            return [:]
        }

        var values: CFArray?
        let result = AXUIElementCopyMultipleAttributeValues(
            element,
            uniqueAttributes as CFArray,
            [],
            &values
        )
        if result == .success, let rawValues = values as? [Any] {
            var output: [String: Any] = [:]
            for (index, rawValue) in rawValues.enumerated() where uniqueAttributes.indices.contains(index) {
                if let normalized = normalizedValue(rawValue) {
                    output[uniqueAttributes[index] as String] = normalized
                }
            }
            return output
        }

        guard fallbackOnFailure else {
            return [:]
        }
        return individualValues(element, attributes: uniqueAttributes)
    }

    func string(from values: [String: Any], attribute: CFString) -> String? {
        ProjectionTextSupport.cleaned(values[attribute as String] as? String)
    }

    func bool(from values: [String: Any], attribute: CFString) -> Bool? {
        guard let rawValue = values[attribute as String] else {
            return nil
        }
        if let bool = rawValue as? Bool {
            return bool
        }
        return (rawValue as? NSNumber)?.boolValue
    }

    func cfValue(from values: [String: Any], attribute: CFString) -> CFTypeRef? {
        values[attribute as String] as AnyObject?
    }

    func element(from values: [String: Any], attribute: CFString) -> AXUIElement? {
        guard let value = values[attribute as String] else {
            return nil
        }
        let object = value as AnyObject
        guard CFGetTypeID(object) == AXUIElementGetTypeID() else {
            return nil
        }
        return unsafeDowncast(object, to: AXUIElement.self)
    }

    func elementArray(from values: [String: Any], attribute: CFString) -> [AXUIElement] {
        values[attribute as String] as? [AXUIElement] ?? []
    }

    func secondaryActionLabels(for element: AXUIElement) -> [String] {
        ProjectionTextSupport.secondaryActionLabels(for: element)
    }

    func isValueSettable(_ element: AXUIElement) -> Bool? {
        AXHelpers.isValueSettable(element)
    }

    private func deduplicated(_ attributes: [CFString]) -> [CFString] {
        var seen = Set<String>()
        var result: [CFString] = []
        for attribute in attributes {
            let key = attribute as String
            if seen.insert(key).inserted {
                result.append(attribute)
            }
        }
        return result
    }

    private func normalizedValue(_ rawValue: Any) -> Any? {
        if rawValue is NSNull {
            return nil
        }

        let object = rawValue as AnyObject
        if CFGetTypeID(object) == AXValueGetTypeID() {
            let axValue = unsafeDowncast(object, to: AXValue.self)
            if AXValueGetType(axValue) == .axError {
                return nil
            }
        }
        return rawValue
    }

    func individualValues(_ element: AXUIElement, attributes: [CFString]) -> [String: Any] {
        var output: [String: Any] = [:]
        for attribute in attributes {
            guard let rawValue = AXHelpers.copyAttributeValue(element, attribute: attribute),
                  let normalized = normalizedValue(rawValue) else {
                continue
            }
            output[attribute as String] = normalized
        }
        return output
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
