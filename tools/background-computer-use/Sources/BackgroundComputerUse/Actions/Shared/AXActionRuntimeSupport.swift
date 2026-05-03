import AppKit
import ApplicationServices
import CoreGraphics
import CryptoKit
import Foundation

struct AXActionRefetchSignature {
    let role: String?
    let subrole: String?
    let roleDescription: String?
    let title: String?
    let description: String?
    let placeholder: String?
    let help: String?
    let identifier: String?
    let urlHost: String?
}

enum AXActionCoercionError: Error, CustomStringConvertible {
    case invalidBoolean(String)
    case invalidInteger(String)
    case invalidFloat(String)
    case unsupportedKind(String)

    var description: String {
        switch self {
        case let .invalidBoolean(raw):
            return "Requested value '\(raw)' is not a valid boolean."
        case let .invalidInteger(raw):
            return "Requested value '\(raw)' is not a valid integer."
        case let .invalidFloat(raw):
            return "Requested value '\(raw)' is not a valid float."
        case let .unsupportedKind(kind):
            return "The target value kind '\(kind)' is not supported by set_value."
        }
    }
}
enum AXActionCoercedValue {
    case string(String)
    case bool(Bool)
    case integer(Int)
    case float(Double)

    var kind: String {
        switch self {
        case .string:
            return "string"
        case .bool:
            return "boolean"
        case .integer:
            return "integer"
        case .float:
            return "float"
        }
    }

    var preview: String {
        switch self {
        case let .string(value):
            return value.replacingOccurrences(of: "\n", with: "\\n")
        case let .bool(value):
            return value ? "true" : "false"
        case let .integer(value):
            return String(value)
        case let .float(value):
            return String(value)
        }
    }

    var cfValue: CFTypeRef {
        switch self {
        case let .string(value):
            return value as CFString
        case let .bool(value):
            return value ? kCFBooleanTrue : kCFBooleanFalse
        case let .integer(value):
            return NSNumber(value: value)
        case let .float(value):
            return NSNumber(value: value)
        }
    }

    func matches(_ observed: SetValueObservedValueDTO?) -> Bool {
        guard let observed else {
            return false
        }

        switch self {
        case let .string(value):
            return observed.kind == "string" && observed.stringValue == value
        case let .bool(value):
            return observed.kind == "boolean" && observed.boolValue == value
        case let .integer(value):
            if observed.kind == "integer" {
                return observed.integerValue == value
            }
            if observed.kind == "float", let doubleValue = observed.doubleValue {
                return abs(doubleValue - Double(value)) < 0.0001
            }
            return false
        case let .float(value):
            if let doubleValue = observed.doubleValue {
                return abs(doubleValue - value) < 0.0001
            }
            if let integerValue = observed.integerValue {
                return abs(Double(integerValue) - value) < 0.0001
            }
            return false
        }
    }

    static func coerce(requested: String, targetKind: String?) throws -> AXActionCoercedValue {
        switch (targetKind ?? "string").lowercased() {
        case "string", "":
            return .string(requested)
        case "boolean":
            guard let parsed = parseBoolean(requested) else {
                throw AXActionCoercionError.invalidBoolean(requested)
            }
            return .bool(parsed)
        case "integer":
            guard let parsed = Int(requested.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                throw AXActionCoercionError.invalidInteger(requested)
            }
            return .integer(parsed)
        case "float":
            guard let parsed = Double(requested.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                throw AXActionCoercionError.invalidFloat(requested)
            }
            return .float(parsed)
        default:
            throw AXActionCoercionError.unsupportedKind(targetKind ?? "unknown")
        }
    }

    private static func parseBoolean(_ raw: String) -> Bool? {
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "true", "1", "yes", "on":
            return true
        case "false", "0", "no", "off":
            return false
        default:
            return nil
        }
    }
}

enum AXActionRuntimeSupport {
    static func copyAttributeValue(_ element: AXUIElement, attribute: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else {
            return nil
        }
        return value
    }

    static func stringAttribute(_ element: AXUIElement, attribute: CFString) -> String? {
        guard let value = copyAttributeValue(element, attribute: attribute) else {
            return nil
        }
        if let string = value as? String {
            return string
        }
        if let url = value as? URL {
            return url.absoluteString
        }
        if let url = value as? NSURL {
            return url.absoluteString
        }
        return nil
    }

    static func boolAttribute(_ element: AXUIElement, attribute: CFString) -> Bool? {
        guard let value = copyAttributeValue(element, attribute: attribute) else {
            return nil
        }
        if let bool = value as? Bool {
            return bool
        }
        return (value as? NSNumber)?.boolValue
    }

    static func intAttribute(_ element: AXUIElement, attribute: CFString) -> Int? {
        guard let value = copyAttributeValue(element, attribute: attribute) else {
            return nil
        }
        return (value as? NSNumber)?.intValue
    }

    static func numberAttribute(_ element: AXUIElement, attribute: CFString) -> Double? {
        guard let value = copyAttributeValue(element, attribute: attribute) else {
            return nil
        }
        return (value as? NSNumber)?.doubleValue
    }

    static func rectAttribute(_ element: AXUIElement, attribute: CFString) -> CGRect? {
        guard let value = copyAttributeValue(element, attribute: attribute),
              CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        let axValue = unsafeDowncast(value, to: AXValue.self)
        var rect = CGRect.zero
        guard AXValueGetType(axValue) == .cgRect,
              AXValueGetValue(axValue, .cgRect, &rect) else {
            return nil
        }
        return rect
    }

    static func elementAttribute(_ element: AXUIElement, attribute: CFString) -> AXUIElement? {
        guard let value = copyAttributeValue(element, attribute: attribute),
              CFGetTypeID(value) == AXUIElementGetTypeID() else {
            return nil
        }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    static func elementArrayAttribute(_ element: AXUIElement, attribute: CFString) -> [AXUIElement] {
        copyAttributeValue(element, attribute: attribute) as? [AXUIElement] ?? []
    }

    static func childElements(_ element: AXUIElement) -> [AXUIElement] {
        let visibleChildren = elementArrayAttribute(element, attribute: "AXVisibleChildren" as CFString)
        if visibleChildren.isEmpty == false {
            if visibleChildren.count >= AXDenseCollectionSupport.windowingThreshold,
               let visibleRows = denseVisibleRowsIfAvailable(for: element) {
                return visibleRows
            }
            return visibleChildren
        }
        let children = elementArrayAttribute(element, attribute: kAXChildrenAttribute as CFString)
        if children.count >= AXDenseCollectionSupport.windowingThreshold,
           let visibleRows = denseVisibleRowsIfAvailable(for: element) {
            return visibleRows
        }
        return children
    }

    private static func denseVisibleRowsIfAvailable(for element: AXUIElement) -> [AXUIElement]? {
        let role = stringAttribute(element, attribute: kAXRoleAttribute as CFString)
        guard AXDenseCollectionSupport.isNativeCollectionRole(role) else {
            return nil
        }

        let rows = elementArrayAttribute(element, attribute: AXDenseCollectionSupport.rowsAttribute)
        guard rows.count >= AXDenseCollectionSupport.windowingThreshold else {
            return nil
        }

        let visibleRows = elementArrayAttribute(element, attribute: AXDenseCollectionSupport.visibleRowsAttribute)
        guard visibleRows.isEmpty == false, visibleRows.count < rows.count else {
            return nil
        }

        return visibleRows
    }

    static func descendants(of root: AXUIElement, limit: Int = 2_000) -> [AXUIElement] {
        var queue = [root]
        var results: [AXUIElement] = []
        var index = 0

        while index < queue.count, results.count < limit {
            let current = queue[index]
            index += 1
            results.append(current)
            queue.append(contentsOf: childElements(current))
        }

        return results
    }

    static func parent(_ element: AXUIElement) -> AXUIElement? {
        elementAttribute(element, attribute: kAXParentAttribute as CFString)
    }

    static func actionNames(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success else {
            return []
        }
        return names as? [String] ?? []
    }

    static func parameterizedAttributeNames(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyParameterizedAttributeNames(element, &names) == .success else {
            return []
        }
        return names as? [String] ?? []
    }

    static func performAction(_ action: String, on element: AXUIElement) -> AXError {
        AXUIElementPerformAction(element, action as CFString)
    }

    static func performParameterizedAttribute(
        _ attribute: String,
        on element: AXUIElement,
        parameter: AXUIElement
    ) -> AXError {
        var value: CFTypeRef?
        return AXUIElementCopyParameterizedAttributeValue(
            element,
            attribute as CFString,
            parameter,
            &value
        )
    }

    static func hitTest(_ root: AXUIElement, point: CGPoint) -> AXUIElement? {
        var hitElement: AXUIElement?
        guard AXUIElementCopyElementAtPosition(root, Float(point.x), Float(point.y), &hitElement) == .success else {
            return nil
        }
        return hitElement
    }

    static func walkAncestors(startingAt element: AXUIElement, maxDepth: Int = 8) -> [AXUIElement] {
        var result: [AXUIElement] = []
        var current: AXUIElement? = element
        var remaining = max(maxDepth, 0)

        while remaining > 0, let resolved = current {
            result.append(resolved)
            current = parent(resolved)
            remaining -= 1
        }

        return result
    }

    static func isAttributeSettable(_ element: AXUIElement, attribute: CFString) -> Bool {
        var settable = DarwinBoolean(false)
        let result = AXUIElementIsAttributeSettable(element, attribute, &settable)
        return result == .success && settable.boolValue
    }

    static func setValue(_ value: AXActionCoercedValue, on element: AXUIElement) -> AXError {
        AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value.cfValue)
    }

    static func setBoolAttributeResult(_ element: AXUIElement, attribute: CFString, value: Bool) -> AXError {
        AXUIElementSetAttributeValue(element, attribute, value as CFTypeRef)
    }

    static func setNumberAttributeResult(_ element: AXUIElement, attribute: CFString, value: Double) -> AXError {
        AXUIElementSetAttributeValue(element, attribute, NSNumber(value: value))
    }

    static func selectedTextRange(_ element: AXUIElement) -> TypeTextSelectionRangeDTO? {
        guard let value = copyAttributeValue(element, attribute: kAXSelectedTextRangeAttribute as CFString),
              CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cfRange else {
            return nil
        }
        var range = CFRange()
        guard AXValueGetValue(axValue, .cfRange, &range) else {
            return nil
        }
        return TypeTextSelectionRangeDTO(location: range.location, length: range.length)
    }

    static func visibleCharacterRange(_ element: AXUIElement) -> CFRange? {
        guard let value = copyAttributeValue(element, attribute: "AXVisibleCharacterRange" as CFString),
              CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }
        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cfRange else {
            return nil
        }
        var range = CFRange()
        guard AXValueGetValue(axValue, .cfRange, &range),
              range.location >= 0,
              range.length >= 0,
              range.location < Int.max / 4,
              range.length < Int.max / 4 else {
            return nil
        }
        return range
    }

    static func setSelectedTextRangeResult(_ element: AXUIElement, location: Int, length: Int) -> AXError {
        var range = CFRange(location: location, length: length)
        guard let value = AXValueCreate(.cfRange, &range) else {
            return .illegalArgument
        }
        return AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, value)
    }

    static func readValueEvidence(_ element: AXUIElement) -> SetValueObservedValueDTO? {
        valueEvidence(from: copyAttributeValue(element, attribute: kAXValueAttribute as CFString))
    }

    static func valueEvidence(from rawValue: CFTypeRef?) -> SetValueObservedValueDTO? {
        guard let rawValue else {
            return nil
        }

        if CFGetTypeID(rawValue) == CFBooleanGetTypeID() {
            let boolValue = (rawValue as? Bool) ?? (rawValue as? NSNumber)?.boolValue
            return SetValueObservedValueDTO(
                kind: "boolean",
                preview: (boolValue ?? false) ? "true" : "false",
                stringValue: nil,
                boolValue: boolValue,
                integerValue: nil,
                doubleValue: nil,
                truncated: false
            )
        }

        if let stringValue = rawValue as? String {
            return SetValueObservedValueDTO(
                kind: "string",
                preview: stringValue.replacingOccurrences(of: "\n", with: "\\n"),
                stringValue: stringValue,
                boolValue: nil,
                integerValue: nil,
                doubleValue: nil,
                truncated: false
            )
        }

        if CFGetTypeID(rawValue) == CFNumberGetTypeID(),
           let number = rawValue as? NSNumber {
            let cfNumber = number as CFNumber
            switch CFNumberGetType(cfNumber) {
            case .charType,
                 .shortType,
                 .intType,
                 .longType,
                 .longLongType,
                 .nsIntegerType,
                 .sInt8Type,
                 .sInt16Type,
                 .sInt32Type,
                 .sInt64Type,
                 .cfIndexType:
                return SetValueObservedValueDTO(
                    kind: "integer",
                    preview: number.stringValue,
                    stringValue: nil,
                    boolValue: nil,
                    integerValue: number.intValue,
                    doubleValue: Double(number.intValue),
                    truncated: false
                )
            default:
                return SetValueObservedValueDTO(
                    kind: "float",
                    preview: number.stringValue,
                    stringValue: nil,
                    boolValue: nil,
                    integerValue: nil,
                    doubleValue: number.doubleValue,
                    truncated: false
                )
            }
        }

        return SetValueObservedValueDTO(
            kind: String(describing: type(of: rawValue)),
            preview: String(describing: rawValue),
            stringValue: nil,
            boolValue: nil,
            integerValue: nil,
            doubleValue: nil,
            truncated: false
        )
    }

    static func readTextState(_ element: AXUIElement) -> TypeTextObservedStateDTO {
        let rawValue = stringAttribute(element, attribute: kAXValueAttribute as CFString)
        return TypeTextObservedStateDTO(
            valuePreview: rawValue?.replacingOccurrences(of: "\n", with: "\\n"),
            valueString: rawValue,
            length: rawValue.map { ($0 as NSString).length },
            truncated: false,
            selectedTextRange: selectedTextRange(element),
            isFocused: boolAttribute(element, attribute: kAXFocusedAttribute as CFString)
        )
    }

    static func postUnicodeText(_ text: String, to pid: pid_t) -> Bool {
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            return false
        }

        for character in text {
            let utf16 = Array(String(character).utf16)
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                return false
            }

            down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            down.postToPid(pid)
            up.postToPid(pid)
            sleepRunLoop(0.010)
        }

        return true
    }

    static func signature(for element: AXUIElement) -> AXActionRefetchSignature {
        let urlValue = stringAttribute(element, attribute: kAXURLAttribute as CFString)
        return AXActionRefetchSignature(
            role: stringAttribute(element, attribute: kAXRoleAttribute as CFString),
            subrole: stringAttribute(element, attribute: kAXSubroleAttribute as CFString),
            roleDescription: stringAttribute(element, attribute: kAXRoleDescriptionAttribute as CFString),
            title: stringAttribute(element, attribute: kAXTitleAttribute as CFString),
            description: stringAttribute(element, attribute: kAXDescriptionAttribute as CFString),
            placeholder: stringAttribute(element, attribute: kAXPlaceholderValueAttribute as CFString),
            help: stringAttribute(element, attribute: kAXHelpAttribute as CFString),
            identifier: stringAttribute(element, attribute: kAXIdentifierAttribute as CFString),
            urlHost: urlValue.flatMap { URL(string: $0)?.host?.lowercased() }
        )
    }

    static func fingerprint(for signature: AXActionRefetchSignature) -> String {
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
        .map(normalize)
        .joined(separator: "|")

        let digest = SHA256.hash(data: Data(raw.utf8))
        return digest.prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    static func label(_ element: AXUIElement) -> String? {
        if let title = sanitizedLabel(stringAttribute(element, attribute: kAXTitleAttribute as CFString)) {
            return title
        }
        if let value = copyAttributeValue(element, attribute: kAXValueAttribute as CFString) {
            if let string = value as? String, let label = sanitizedLabel(string) {
                return label
            }
            if let number = value as? NSNumber {
                return number.stringValue
            }
        }
        if let description = sanitizedLabel(stringAttribute(element, attribute: kAXDescriptionAttribute as CFString)) {
            return description
        }
        return nil
    }

    static func normalize(_ value: String?) -> String {
        guard let value else {
            return ""
        }

        return value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    static func sanitizedLabel(_ value: String?) -> String? {
        guard let value else {
            return nil
        }
        let cleaned = value
            .replacingOccurrences(of: "\u{00a0}", with: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleaned.isEmpty == false else {
            return nil
        }
        return cleaned.count > 220 ? String(cleaned.prefix(220)) : cleaned
    }

    static func rawStatusString(for error: AXError) -> String {
        switch error {
        case .success:
            return "success"
        case .attributeUnsupported:
            return "attribute_unsupported"
        case .actionUnsupported:
            return "action_unsupported"
        case .cannotComplete:
            return "cannot_complete"
        case .invalidUIElement:
            return "invalid_ui_element"
        case .illegalArgument:
            return "illegal_argument"
        case .apiDisabled:
            return "api_disabled"
        default:
            return "ax_error_\(error.rawValue)"
        }
    }
}
