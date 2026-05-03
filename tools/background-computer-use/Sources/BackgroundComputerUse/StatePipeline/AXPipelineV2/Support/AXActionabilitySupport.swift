import ApplicationServices
import Foundation

enum AXActionabilitySupport {
    private static let textEntryRoles: Set<String> = [
        String(kAXTextFieldRole),
        String(kAXTextAreaRole),
        String(kAXComboBoxRole),
        String(kAXSearchFieldSubrole)
    ]

    private static let scrollContainerRoles: Set<String> = [
        String(kAXScrollAreaRole),
        String(kAXOutlineRole),
        String(kAXTableRole),
        String(kAXTextAreaRole),
        "AXCollection",
        "AXList",
        "AXListBox",
        "AXContentList",
        "AXWebArea"
    ]

    static func actionDescriptors(for element: AXUIElement) -> [AXActionDescriptorDTO] {
        let secondaryLabels = Set(ProjectionTextSupport.secondaryActionLabels(for: element))
        return AXHelpers.actionNames(element).map { actionName in
            let label = ProjectionTextSupport.actionLabel(actionName)
            return AXActionDescriptorDTO(
                rawName: actionName,
                label: label,
                description: AXHelpers.actionDescription(element, action: actionName),
                category: ProjectionTextSupport.actionCategory(actionName),
                hiddenFromSecondaryActions: label.map { secondaryLabels.contains($0) == false } ?? true
            )
        }
    }

    static func interactionTraits(
        role: String?,
        subrole: String?,
        isValueSettable: Bool?,
        actions: [AXActionDescriptorDTO],
        parameterizedAttributes: [String]
    ) -> AXInteractionTraitsDTO {
        let rawNames = Set(actions.map(\.rawName))
        let parameterizedNames = Set(parameterizedAttributes)
        let isTextEntry = isTextEntryRole(role: role, subrole: subrole)
        let isPotentialScrollBar = role == String(kAXScrollBarRole) || role == String(kAXValueIndicatorRole)
        let isPotentialScrollContainer =
            scrollContainerRoles.contains(role ?? "") ||
            parameterizedNames.contains("AXScrollToShowDescendant") ||
            rawNames.contains("AXScrollUpByPage") ||
            rawNames.contains("AXScrollDownByPage") ||
            rawNames.contains("AXScrollLeftByPage") ||
            rawNames.contains("AXScrollRightByPage")

        return AXInteractionTraitsDTO(
            supportsPress: rawNames.contains("AXPress"),
            supportsOpen: rawNames.contains("AXOpen"),
            supportsPick: rawNames.contains("AXPick"),
            supportsShowMenu: rawNames.contains("AXShowMenu"),
            supportsRaise: rawNames.contains("AXRaise"),
            supportsConfirm: rawNames.contains("AXConfirm"),
            supportsCancel: rawNames.contains("AXCancel"),
            supportsIncrement: rawNames.contains("AXIncrement"),
            supportsDecrement: rawNames.contains("AXDecrement"),
            supportsScrollToVisible: rawNames.contains("AXScrollToVisible"),
            supportsScrollToShowDescendant: parameterizedNames.contains("AXScrollToShowDescendant"),
            supportsValueSet: isValueSettable == true,
            isPotentialScrollContainer: isPotentialScrollContainer,
            isPotentialScrollBar: isPotentialScrollBar,
            isTextEntry: isTextEntry
        )
    }

    static func suggestedInteractionPoint(
        frameAppKit: RectDTO?,
        activationPointAppKit: PointDTO?,
        role: String?,
        subrole: String?,
        isValueSettable: Bool?
    ) -> PointDTO? {
        if let activationPointAppKit {
            return activationPointAppKit
        }

        guard let frameAppKit else {
            return nil
        }

        if isTextEntryRole(role: role, subrole: subrole) {
            let inset = min(max(frameAppKit.width * 0.16, 12), 22)
            return PointDTO(
                x: min(frameAppKit.x + frameAppKit.width - 8, frameAppKit.x + inset),
                y: frameAppKit.y + (frameAppKit.height / 2)
            )
        }

        return PointDTO(
            x: frameAppKit.x + (frameAppKit.width / 2),
            y: frameAppKit.y + (frameAppKit.height / 2)
        )
    }

    static func isTextEntryRole(role: String?, subrole: String?) -> Bool {
        guard let role else {
            return subrole == String(kAXSearchFieldSubrole)
        }
        if textEntryRoles.contains(role) {
            return true
        }
        return subrole == String(kAXSearchFieldSubrole)
    }
}
