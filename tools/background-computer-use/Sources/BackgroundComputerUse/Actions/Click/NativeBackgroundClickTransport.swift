import AppKit
import ApplicationServices
import Carbon.HIToolbox
import CoreGraphics
import Darwin
import Foundation

struct RoutedClickTarget {
    let pid: Int32
    let bundleID: String
    let windowNumber: Int
    let title: String
    let frameAppKit: CGRect
    let ownerConnection: Int32
    let processSerialNumberHigh: UInt32
    let processSerialNumberLow: UInt32
    let processSerialNumberPacked: Int64
    let cgBoundsTopLeft: CGRect?

    init(window: ResolvedWindowDTO, routing: NativeWindowServerRouting) {
        pid = window.pid
        bundleID = window.bundleID
        windowNumber = window.windowNumber
        title = window.title
        frameAppKit = CGRect(
            x: window.frameAppKit.x,
            y: window.frameAppKit.y,
            width: window.frameAppKit.width,
            height: window.frameAppKit.height
        )
        ownerConnection = routing.ownerConnection
        processSerialNumberHigh = routing.processSerialNumberHigh
        processSerialNumberLow = routing.processSerialNumberLow
        processSerialNumberPacked = routing.packedProcessSerialNumber
        cgBoundsTopLeft = routing.cgBoundsTopLeft
    }
}

struct NativeBackgroundClickDispatchRequest {
    let target: RoutedClickTarget
    let eventTapPointTopLeft: CGPoint
    let appKitPoint: CGPoint
    let clickCount: Int
    let mouseButton: MouseButtonDTO
}

struct NativeBackgroundClickTransportResult {
    let dispatchSuccess: Bool
    let eventsPrepared: Int
    let clickStates: [Int64]
    let targetPID: Int32
    let targetWindowNumber: Int
    let ownerConnection: Int32
    let processSerialNumberPacked: Int64
    let focusStatus: Int32
    let notes: [String]
}

final class NativeBackgroundClickTransport {
    func dispatch(_ request: NativeBackgroundClickDispatchRequest) throws -> NativeBackgroundClickTransportResult {
        guard request.mouseButton == .left else {
            throw ClickTransportError.unsupported("Only left-button native background clicks are implemented by this transport.")
        }
        guard request.clickCount == 1 || request.clickCount == 2 else {
            throw ClickTransportError.unsupported("Native background clicks support only explicit single or double click.")
        }

        let preparation = try prepareTargetWindowForInput(target: request.target)
        let focusStatus = preparation.targetFocusStatus ?? -1
        usleep(50_000)

        let events = makeEventSequence(request: request)
        guard events.isEmpty == false else {
            throw ClickTransportError.transportFailed("No native mouse events were prepared.")
        }

        for event in events {
            event.timestamp = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
            NativeClickSymbols.slEventPostToPid(request.target.pid, event)
            usleep(30_000)
        }

        let clickStates = (1...request.clickCount).map(Int64.init)
        return NativeBackgroundClickTransportResult(
            dispatchSuccess: true,
            eventsPrepared: events.count,
            clickStates: clickStates,
            targetPID: request.target.pid,
            targetWindowNumber: request.target.windowNumber,
            ownerConnection: request.target.ownerConnection,
            processSerialNumberPacked: request.target.processSerialNumberPacked,
            focusStatus: focusStatus,
            notes: preparation.notes + [
                "Target-only SLPSPostEventRecordTo focus-without-raise status=\(focusStatus).",
                "Posted one target-local move, one offscreen primer down/up at (-1, -1), then \(request.clickCount) explicit target click(s) through SLEventPostToPid.",
                "Stamped pid, window number, PSN, owner connection, and window-local location on all native click events.",
                "Native background click route does not foreground the target app and does not intentionally move the physical cursor."
            ]
        )
    }

    private func prepareTargetWindowForInput(target: RoutedClickTarget) throws -> NativeWindowServerPreparationResult {
        let preparation = NativeWindowServerPreparation.targetOnlyFocus(
            pid: target.pid,
            windowNumber: target.windowNumber
        )
        if let psnStatus = preparation.psnStatus, psnStatus != 0 {
            throw ClickTransportError.transportFailed("GetProcessForPID status=\(psnStatus) for pid \(target.pid).")
        }
        guard preparation.preparedTargetWindow(requireKeyWindowRecords: false) else {
            throw ClickTransportError.transportFailed("SLPSPostEventRecordTo target-only focus failed: \(preparation.rawStatus).")
        }
        return preparation
    }

    private func makeEventSequence(request: NativeBackgroundClickDispatchRequest) -> [CGEvent] {
        var events: [CGEvent] = []
        let targetWindowLocal = windowLocalTopLeft(point: request.eventTapPointTopLeft, target: request.target)

        appendEvent(
            type: .mouseMoved,
            point: request.eventTapPointTopLeft,
            windowLocal: targetWindowLocal,
            clickState: 0,
            target: request.target,
            to: &events
        )

        let primer = CGPoint(x: -1, y: -1)
        appendEvent(type: .leftMouseDown, point: primer, windowLocal: primer, clickState: 1, target: request.target, to: &events)
        appendEvent(type: .leftMouseUp, point: primer, windowLocal: primer, clickState: 1, target: request.target, to: &events)

        for clickState in (1...request.clickCount).map(Int64.init) {
            appendEvent(
                type: .leftMouseDown,
                point: request.eventTapPointTopLeft,
                windowLocal: targetWindowLocal,
                clickState: clickState,
                target: request.target,
                to: &events
            )
            appendEvent(
                type: .leftMouseUp,
                point: request.eventTapPointTopLeft,
                windowLocal: targetWindowLocal,
                clickState: clickState,
                target: request.target,
                to: &events
            )
        }
        return events
    }

    private func appendEvent(
        type: CGEventType,
        point: CGPoint,
        windowLocal: CGPoint,
        clickState: Int64,
        target: RoutedClickTarget,
        to events: inout [CGEvent]
    ) {
        if let event = makeNSEventBackedCGEvent(
            type: type,
            point: point,
            windowLocal: windowLocal,
            clickState: clickState,
            target: target
        ) {
            events.append(event)
        }
    }

    private func makeNSEventBackedCGEvent(
        type: CGEventType,
        point: CGPoint,
        windowLocal: CGPoint,
        clickState: Int64,
        target: RoutedClickTarget
    ) -> CGEvent? {
        let nsType: NSEvent.EventType
        switch type {
        case .mouseMoved:
            nsType = .mouseMoved
        case .leftMouseDown:
            nsType = .leftMouseDown
        case .leftMouseUp:
            nsType = .leftMouseUp
        default:
            return nil
        }

        guard let nsEvent = NSEvent.mouseEvent(
            with: nsType,
            location: windowLocal,
            modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: target.windowNumber,
            context: nil,
            eventNumber: 1,
            clickCount: type == .mouseMoved ? 0 : max(1, Int(clickState)),
            pressure: type == .leftMouseDown ? 1.0 : 0.0
        ), let event = nsEvent.cgEvent else {
            return nil
        }

        stamp(event, type: type, point: point, windowLocal: windowLocal, target: target, clickState: clickState)
        return event
    }

    private func stamp(
        _ event: CGEvent,
        type: CGEventType,
        point: CGPoint,
        windowLocal: CGPoint,
        target: RoutedClickTarget,
        clickState: Int64
    ) {
        event.location = point
        event.flags = []
        event.setIntegerValueField(.eventTargetUnixProcessID, value: Int64(target.pid))
        event.setIntegerValueField(.mouseEventButtonNumber, value: 0)
        event.setIntegerValueField(.mouseEventSubtype, value: 3)
        event.setIntegerValueField(.mouseEventClickState, value: clickState)
        event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: Int64(target.windowNumber))
        event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: Int64(target.windowNumber))
        event.setIntegerValueField(.eventTargetProcessSerialNumber, value: target.processSerialNumberPacked)
        NativeClickSymbols.cgEventSetWindowLocation(event, windowLocal)

        setSkyLightInteger(event, field: 40, value: Int64(target.pid))
        setSkyLightInteger(event, field: 51, value: Int64(target.windowNumber))
        setSkyLightInteger(event, field: 52, value: Int64(target.ownerConnection))
        setSkyLightInteger(event, field: 85, value: Int64(target.ownerConnection))
        setSkyLightInteger(event, field: 91, value: Int64(target.windowNumber))
        setSkyLightInteger(event, field: 92, value: Int64(target.windowNumber))
        if type == .leftMouseDown {
            setRawDouble(event, 2, 1.0)
            setRawInteger(event, 108, 1)
        }
        event.flags = []
    }

    private func setSkyLightInteger(_ event: CGEvent, field: UInt32, value: Int64) {
        NativeClickSymbols.slEventSetIntegerValueField(event, field, value)
        if let cgField = CGEventField(rawValue: field) {
            event.setIntegerValueField(cgField, value: value)
        }
    }

    private func windowLocalTopLeft(point: CGPoint, target: RoutedClickTarget) -> CGPoint {
        if let bounds = target.cgBoundsTopLeft {
            return CGPoint(x: point.x - bounds.minX, y: point.y - bounds.minY)
        }
        return CGPoint(
            x: point.x - target.frameAppKit.minX,
            y: point.y - (DesktopGeometry.desktopTop() - target.frameAppKit.maxY)
        )
    }
}

struct NativeWindowServerRouting {
    let ownerConnection: Int32
    let processSerialNumberHigh: UInt32
    let processSerialNumberLow: UInt32
    let packedProcessSerialNumber: Int64
    let cgBoundsTopLeft: CGRect?
    let notes: [String]
}

struct NativeWindowServerRoutingResolver {
    func resolve(windowNumber: Int) throws -> NativeWindowServerRouting {
        var ownerConnection: Int32 = 0
        let ownerStatus = NativeClickSymbols.cgsGetWindowOwner(
            NativeClickSymbols.cgsMainConnectionID(),
            UInt32(windowNumber),
            &ownerConnection
        )
        guard ownerStatus == 0 else {
            throw ClickTransportError.transportFailed("CGSGetWindowOwner status=\(ownerStatus) for window \(windowNumber).")
        }

        var psn = ProcessSerialNumber(highLongOfPSN: 0, lowLongOfPSN: 0)
        let psnStatus = NativeClickSymbols.cgsGetConnectionPSN(ownerConnection, &psn)
        guard psnStatus == 0 else {
            throw ClickTransportError.transportFailed("CGSGetConnectionPSN status=\(psnStatus) ownerConnection=\(ownerConnection).")
        }

        let high = psn.highLongOfPSN
        let low = psn.lowLongOfPSN
        let packed = (Int64(high) << 32) | Int64(low)
        let cgBounds = cgBoundsTopLeft(windowNumber: windowNumber)
        let notes = [
            "Resolved ownerConnection=\(ownerConnection) psn=(\(high), \(low)).",
            cgBounds.map { "Resolved CG window bounds top-left x=\($0.minX) y=\($0.minY) width=\($0.width) height=\($0.height)." }
                ?? "CG window bounds unavailable; used AppKit frame to derive window-local top-left."
        ]
        return NativeWindowServerRouting(
            ownerConnection: ownerConnection,
            processSerialNumberHigh: high,
            processSerialNumberLow: low,
            packedProcessSerialNumber: packed,
            cgBoundsTopLeft: cgBounds,
            notes: notes
        )
    }

    private func cgBoundsTopLeft(windowNumber: Int) -> CGRect? {
        guard let list = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(windowNumber)) as? [[String: Any]],
              let entry = list.first,
              let bounds = entry[kCGWindowBounds as String] as? [String: Any] else {
            return nil
        }
        return CGRect(
            x: (bounds["X"] as? NSNumber)?.doubleValue ?? 0,
            y: (bounds["Y"] as? NSNumber)?.doubleValue ?? 0,
            width: (bounds["Width"] as? NSNumber)?.doubleValue ?? 0,
            height: (bounds["Height"] as? NSNumber)?.doubleValue ?? 0
        )
    }
}

enum ClickTransportError: Error, CustomStringConvertible {
    case unsupported(String)
    case transportFailed(String)

    var description: String {
        switch self {
        case .unsupported(let message), .transportFailed(let message):
            return message
        }
    }
}

private enum NativeClickSymbols {
    static let loadedSkyLight: Bool = {
        guard dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY) != nil else {
            fatalError("Required SkyLight private framework could not be loaded for native background click transport.")
        }
        return true
    }()

    static let cgsMainConnectionID = loadRequired("CGSMainConnectionID", as: CGSMainConnectionIDFn.self)
    static let cgsGetWindowOwner = loadRequired("CGSGetWindowOwner", as: CGSGetWindowOwnerFn.self)
    static let cgsGetConnectionPSN = loadRequired("CGSGetConnectionPSN", as: CGSGetConnectionPSNFn.self)
    static let slEventPostToPid = loadRequired("SLEventPostToPid", as: SLEventPostToPidFn.self)
    static let slEventSetIntegerValueField = loadRequired("SLEventSetIntegerValueField", as: SLEventSetIntegerValueFieldFn.self)
    static let cgEventSetWindowLocation = loadRequired("CGEventSetWindowLocation", as: CGEventSetWindowLocationFn.self)

    private static func loadRequired<T>(_ name: String, as _: T.Type) -> T {
        _ = loadedSkyLight
        guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else {
            fatalError("Required native background click symbol \(name) is unavailable.")
        }
        return unsafeBitCast(pointer, to: T.self)
    }
}

private typealias CGSMainConnectionIDFn = @convention(c) () -> Int32
private typealias CGSGetWindowOwnerFn = @convention(c) (Int32, UInt32, UnsafeMutablePointer<Int32>?) -> Int32
private typealias CGSGetConnectionPSNFn = @convention(c) (Int32, UnsafeMutablePointer<ProcessSerialNumber>?) -> Int32
private typealias SLEventPostToPidFn = @convention(c) (pid_t, CGEvent) -> Void
private typealias SLEventSetIntegerValueFieldFn = @convention(c) (CGEvent, UInt32, Int64) -> Void
private typealias CGEventSetWindowLocationFn = @convention(c) (CGEvent, CGPoint) -> Void

private func setRawInteger(_ event: CGEvent, _ rawField: UInt32, _ value: Int64) {
    guard let field = CGEventField(rawValue: rawField) else { return }
    event.setIntegerValueField(field, value: value)
}

private func setRawDouble(_ event: CGEvent, _ rawField: UInt32, _ value: Double) {
    guard let field = CGEventField(rawValue: rawField) else { return }
    event.setDoubleValueField(field, value: value)
}
