import ApplicationServices
import Foundation

enum ProjectionTextSupport {
    static func displayRole(
        role: String?,
        subrole: String?,
        title: String?,
        description: String?,
        identifier: String?
    ) -> String {
        if role == String(kAXButtonRole) {
            switch subrole {
            case String(kAXCloseButtonSubrole):
                return "close button"
            case String(kAXFullScreenButtonSubrole):
                return "full screen button"
            case String(kAXZoomButtonSubrole):
                return "zoom button"
            case String(kAXMinimizeButtonSubrole):
                return "minimize button"
            case String(kAXSearchFieldSubrole):
                return "search text field"
            default:
                break
            }
        }

        if subrole == "AXApplicationStatus" {
            return "status bar"
        }

        switch role {
        case String(kAXWindowRole):
            return "standard window"
        case String(kAXSheetRole):
            return "sheet"
        case String(kAXDrawerRole):
            return "drawer"
        case String(kAXScrollAreaRole):
            return "scroll area"
        case String(kAXTextAreaRole):
            return "text entry area"
        case String(kAXTextFieldRole):
            return subrole == String(kAXSearchFieldSubrole) ? "search text field" : "text field"
        case String(kAXComboBoxRole):
            return "combo box"
        case String(kAXPopUpButtonRole):
            return "pop up button"
        case String(kAXMenuButtonRole):
            return "menu button"
        case String(kAXButtonRole):
            return "button"
        case String(kAXColorWellRole):
            return "color well"
        case String(kAXCheckBoxRole):
            return "checkbox"
        case String(kAXRadioButtonRole):
            return "radio button"
        case String(kAXRadioGroupRole):
            return "radio group"
        case String(kAXSliderRole):
            return "slider"
        case String(kAXScrollBarRole):
            return "scroll bar"
        case String(kAXValueIndicatorRole):
            return "value indicator"
        case String(kAXRulerMarkerRole):
            return "ruler marker"
        case String(kAXMenuBarRole):
            return "menu bar"
        case String(kAXMenuBarItemRole):
            return "menu bar item"
        case String(kAXMenuRole):
            return "menu"
        case String(kAXMenuItemRole):
            return "menu item"
        case String(kAXGroupRole):
            return "container"
        case String(kAXStaticTextRole):
            return "text"
        case String(kAXImageRole):
            return "image"
        case "AXWebArea":
            return "HTML content"
        case "AXLink":
            return "link"
        case String(kAXRowRole):
            return "row"
        case String(kAXCellRole):
            return "cell"
        case String(kAXColumnRole):
            return "column"
        case "AXColumnHeader":
            return "column header"
        case String(kAXTableRole):
            return "table"
        case String(kAXListRole):
            if subrole == "AXCollectionList" {
                return "collection"
            }
            if subrole == "AXContentList" {
                return "content list"
            }
            if subrole == "AXSectionList" {
                return "section"
            }
            return "list"
        case "AXListBox":
            return "list box"
        case String(kAXOutlineRole):
            return "outline"
        case String(kAXBrowserRole):
            return "browser"
        case String(kAXSplitGroupRole):
            return "split group"
        case String(kAXSplitterRole):
            return "splitter"
        case String(kAXToolbarRole):
            return "toolbar"
        case String(kAXTabGroupRole):
            return "tab group"
        case String(kAXDisclosureTriangleRole):
            return "disclosure triangle"
        default:
            if role == "AXUnknown" {
                return "unknown"
            }
            if let role {
                return role
                    .replacingOccurrences(of: "AX", with: "")
                    .replacingOccurrences(of: "UIElement", with: "UI element")
                    .replacingOccurrences(of: "_", with: " ")
                    .replacingOccurrences(of: "([a-z0-9])([A-Z])", with: "$1 $2", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .lowercased()
            }
            return "unknown"
        }
    }

    static func valueKind(_ value: CFTypeRef) -> String? {
        if CFGetTypeID(value) == CFBooleanGetTypeID() {
            return "boolean"
        }
        if value is String {
            return "string"
        }
        if CFGetTypeID(value) == CFNumberGetTypeID() {
            let number = unsafeDowncast(value, to: NSNumber.self) as CFNumber
            switch CFNumberGetType(number) {
            case .charType, .shortType, .intType, .longType, .longLongType, .nsIntegerType, .sInt8Type, .sInt16Type, .sInt32Type, .sInt64Type, .cfIndexType:
                return "integer"
            default:
                return "float"
            }
        }
        return nil
    }

    static func valuePreview(_ value: CFTypeRef) -> String? {
        if CFGetTypeID(value) == CFBooleanGetTypeID() {
            return ((value as? Bool) ?? (value as? NSNumber)?.boolValue ?? false) ? "on" : "off"
        }
        if let string = value as? String {
            return string.replacingOccurrences(of: "\n", with: "\\n")
        }
        if let number = value as? NSNumber {
            return number.stringValue
        }
        return nil
    }

    static func secondaryActionLabels(for element: AXUIElement) -> [String] {
        AXHelpers.actionNames(element)
            .compactMap(actionLabel)
            .filter { $0.isEmpty == false }
    }

    static func actionLabel(_ action: String) -> String? {
        if let namedToolbarAction = namedToolbarActionLabel(action) {
            return namedToolbarAction
        }

        switch action {
        case "AXPress":
            return nil
        case "AXRaise":
            return "Raise"
        case "AXCancel":
            return nil
        case "AXConfirm":
            return "Confirm"
        case "AXDelete":
            return "delete"
        case "AXOpen":
            return "open"
        case "AXPick":
            return nil
        case "AXZoomWindow":
            return "zoom the window"
        case "AXShowMenu":
            return nil
        case "AXScrollLeftByPage":
            return "Scroll Left"
        case "AXScrollRightByPage":
            return "Scroll Right"
        case "AXScrollUpByPage":
            return "Scroll Up"
        case "AXScrollDownByPage":
            return "Scroll Down"
        case "AXScrollToVisible":
            return nil
        case "AXShowDefaultUI", "AXShowAlternateUI":
            return nil
        case "AXIncrement", "AXDecrement":
            return nil
        default:
            if action.hasPrefix("AX") {
                let raw = String(action.dropFirst(2))
                return raw.unicodeScalars.reduce(into: "") { partial, scalar in
                    let character = Character(scalar)
                    if scalar.properties.isUppercase && partial.isEmpty == false {
                        partial.append(" ")
                    }
                    partial.append(character)
                }
            }
            return action
        }
    }

    static func actionCategory(_ action: String) -> String {
        if action.hasPrefix("Name:") {
            return "custom"
        }

        switch action {
        case "AXPress":
            return "primary"
        case "AXOpen", "AXPick":
            return "open"
        case "AXShowMenu":
            return "menu"
        case "AXRaise":
            return "focus"
        case "AXConfirm", "AXCancel", "AXDelete":
            return "lifecycle"
        case "AXIncrement", "AXDecrement":
            return "adjust"
        case "AXScrollLeftByPage", "AXScrollRightByPage", "AXScrollUpByPage", "AXScrollDownByPage", "AXScrollToVisible":
            return "scroll"
        default:
            return action.hasPrefix("AX") ? "ax" : "custom"
        }
    }

    private static func namedToolbarActionLabel(_ action: String) -> String? {
        guard action.hasPrefix("Name:") else { return nil }
        let firstLine = action.split(separator: "\n", omittingEmptySubsequences: true).first
        let name = firstLine?
            .replacingOccurrences(of: "Name:", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let name, name.isEmpty == false else { return nil }
        return name
    }

    static func urlString(for element: AXUIElement) -> String? {
        guard let raw = AXHelpers.copyAttributeValue(element, attribute: kAXURLAttribute as CFString) else {
            return nil
        }
        if let text = raw as? String {
            return cleaned(text)
        }
        if let url = raw as? URL {
            return cleaned(url.absoluteString)
        }
        if let url = raw as? NSURL {
            return cleaned(url.absoluteString)
        }
        return nil
    }

    static func cleaned(_ text: String?) -> String? {
        guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), text.isEmpty == false else {
            return nil
        }
        let collapsed = text
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return collapsed.isEmpty ? nil : collapsed
    }
}
