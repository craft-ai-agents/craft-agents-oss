import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

typealias AXUIElementGetWindowFunction = @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError

enum AXHelpers {
    static let privateGetWindow: AXUIElementGetWindowFunction? = {
        guard let symbol = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "_AXUIElementGetWindow") else {
            return nil
        }
        return unsafeBitCast(symbol, to: AXUIElementGetWindowFunction.self)
    }()

    static func requireAccessibility() throws {
        guard AccessibilityAuthorization.isTrusted(prompt: false) else {
            throw DiscoveryError.accessibilityDenied
        }
    }

    static func applicationElement(pid: pid_t) -> AXUIElement {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1.0)
        return app
    }

    static func setMessagingTimeout(_ element: AXUIElement, seconds: Float) {
        AXUIElementSetMessagingTimeout(element, seconds)
    }

    static func copyAttributeValue(_ element: AXUIElement, attribute: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &value) == .success ? value : nil
    }

    static func copyParameterizedAttributeValue(
        _ element: AXUIElement,
        attribute: CFString,
        parameter: CFTypeRef
    ) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyParameterizedAttributeValue(element, attribute, parameter, &value) == .success ? value : nil
    }

    static func stringAttribute(_ element: AXUIElement, attribute: CFString) -> String? {
        copyAttributeValue(element, attribute: attribute) as? String
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

    static func actionNames(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyActionNames(element, &names) == .success else {
            return []
        }
        return names as? [String] ?? []
    }

    static func actionDescription(_ element: AXUIElement, action: String) -> String? {
        var description: CFString?
        guard AXUIElementCopyActionDescription(element, action as CFString, &description) == .success else {
            return nil
        }
        return description as String?
    }

    static func attributeNames(_ element: AXUIElement) -> [String] {
        var names: CFArray?
        guard AXUIElementCopyAttributeNames(element, &names) == .success else {
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

    static func children(_ element: AXUIElement) -> [AXUIElement] {
        elementArrayAttribute(element, attribute: kAXChildrenAttribute as CFString)
    }

    static func parent(_ element: AXUIElement) -> AXUIElement? {
        elementAttribute(element, attribute: kAXParentAttribute as CFString)
    }

    static func menuBar(_ app: AXUIElement) -> AXUIElement? {
        elementAttribute(app, attribute: kAXMenuBarAttribute as CFString)
    }

    static func frame(_ element: AXUIElement) -> CGRect? {
        guard let position = pointValue(from: copyAttributeValue(element, attribute: kAXPositionAttribute as CFString)),
              let size = sizeValue(from: copyAttributeValue(element, attribute: kAXSizeAttribute as CFString)) else {
            return nil
        }

        return DesktopGeometry.appKitRect(fromAXOrigin: position, size: size)
    }

    static func appKitRect(fromAXOrigin origin: CGPoint, size: CGSize) -> CGRect {
        DesktopGeometry.appKitRect(fromAXOrigin: origin, size: size)
    }

    static func quartzRectToAppKit(_ rect: CGRect) -> CGRect {
        DesktopGeometry.appKitRect(fromQuartz: rect)
    }

    static func setFrame(_ element: AXUIElement, frame: CGRect) -> (position: AXError, size: AXError) {
        let positionStatus = setPosition(element, frame: frame)
        let sizeStatus = setSize(element, size: frame.size)
        return (positionStatus, sizeStatus)
    }

    static func setPosition(_ element: AXUIElement, frame: CGRect) -> AXError {
        var origin = DesktopGeometry.axOrigin(fromAppKitFrame: frame)
        guard let originValue = AXValueCreate(.cgPoint, &origin) else {
            return .illegalArgument
        }
        return AXUIElementSetAttributeValue(element, kAXPositionAttribute as CFString, originValue)
    }

    static func setSize(_ element: AXUIElement, size: CGSize) -> AXError {
        var size = size
        guard let sizeValue = AXValueCreate(.cgSize, &size) else {
            return .illegalArgument
        }
        return AXUIElementSetAttributeValue(element, kAXSizeAttribute as CFString, sizeValue)
    }

    static func windowNumber(for element: AXUIElement) -> Int? {
        guard let privateGetWindow else {
            return nil
        }

        var rawWindowID: CGWindowID = 0
        guard privateGetWindow(element, &rawWindowID) == .success, rawWindowID != 0 else {
            return nil
        }

        return Int(rawWindowID)
    }

    static func isRenderableFrame(_ frame: CGRect) -> Bool {
        DesktopGeometry.isRenderable(frame: frame)
    }

    static func isOnScreen(_ frame: CGRect) -> Bool {
        DesktopGeometry.isOnScreen(frame)
    }

    static func isValueSettable(_ element: AXUIElement) -> Bool? {
        var settable = DarwinBoolean(false)
        let result = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
        guard result == .success else {
            return nil
        }
        return settable.boolValue
    }

    static func activationPoint(_ element: AXUIElement) -> CGPoint? {
        pointValue(from: copyAttributeValue(element, attribute: "AXActivationPoint" as CFString))
    }

    static func elementsEqual(_ lhs: AXUIElement, _ rhs: AXUIElement) -> Bool {
        CFEqual(lhs, rhs)
    }

    static func pointValue(from value: CFTypeRef?) -> CGPoint? {
        guard let value, CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }

        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cgPoint else {
            return nil
        }

        var point = CGPoint.zero
        return AXValueGetValue(axValue, .cgPoint, &point) ? point : nil
    }

    static func sizeValue(from value: CFTypeRef?) -> CGSize? {
        guard let value, CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }

        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cgSize else {
            return nil
        }

        var size = CGSize.zero
        return AXValueGetValue(axValue, .cgSize, &size) ? size : nil
    }

    static func rangeValue(from value: CFTypeRef?) -> CFRange? {
        guard let value, CFGetTypeID(value) == AXValueGetTypeID() else {
            return nil
        }

        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cfRange else {
            return nil
        }

        var range = CFRange()
        return AXValueGetValue(axValue, .cfRange, &range) ? range : nil
    }

    static func axValue(for range: CFRange) -> AXValue? {
        var mutableRange = range
        return AXValueCreate(.cfRange, &mutableRange)
    }
}
