import CoreGraphics
import Foundation

public enum ModelFacingScreenshotSpace {}
public enum RawRetinaCaptureSpace {}
public enum WindowLocalTopLeftSpace {}
public enum WindowLocalAppKitBottomLeftSpace {}
public enum GlobalEventTapTopLeftSpace {}
public enum AXGlobalTopLeftSpace {}

public typealias ModelFacingScreenshotPoint = Point2D<ModelFacingScreenshotSpace>
public typealias RawRetinaCapturePoint = Point2D<RawRetinaCaptureSpace>
public typealias WindowLocalTopLeftPoint = Point2D<WindowLocalTopLeftSpace>
public typealias WindowLocalAppKitBottomLeftPoint = Point2D<WindowLocalAppKitBottomLeftSpace>
public typealias GlobalEventTapTopLeftPoint = Point2D<GlobalEventTapTopLeftSpace>
public typealias AXGlobalTopLeftPoint = Point2D<AXGlobalTopLeftSpace>

public typealias ModelFacingScreenshotRect = Rect2D<ModelFacingScreenshotSpace>
public typealias RawRetinaCaptureRect = Rect2D<RawRetinaCaptureSpace>
public typealias WindowLocalTopLeftRect = Rect2D<WindowLocalTopLeftSpace>
public typealias GlobalEventTapTopLeftRect = Rect2D<GlobalEventTapTopLeftSpace>
public typealias AXGlobalTopLeftRect = Rect2D<AXGlobalTopLeftSpace>

public enum CoordinateSpaceName: String, Codable, Sendable {
    case modelFacingScreenshot
    case rawRetinaCapture
    case windowLocalTopLeft
    case windowLocalAppKitBottomLeft
    case globalEventTapTopLeft
    case axGlobalTopLeft
}

public enum CoordinateOrigin: String, Codable, Sendable {
    case topLeft
    case bottomLeft
}

public struct Point2D<Space>: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct Rect2D<Space>: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var minX: Double { x }
    public var minY: Double { y }
    public var maxX: Double { x + width }
    public var maxY: Double { y + height }

    public func contains(_ point: Point2D<Space>, tolerance: Double = 0) -> Bool {
        point.x >= -tolerance &&
            point.y >= -tolerance &&
            point.x <= width + tolerance &&
            point.y <= height + tolerance
    }

    public var cgRect: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }
}

public struct PixelSize: Codable, Equatable, Sendable {
    public let width: Int
    public let height: Int

    public init(width: Int, height: Int) {
        self.width = width
        self.height = height
    }
}

public struct Scale2D: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}

public struct ImagePlane<Space>: Codable, Equatable, Sendable {
    public let path: String?
    public let pixelSize: PixelSize
    public let coordinateOrigin: CoordinateOrigin
    public let scaleToWindowLogical: Scale2D
    public let captureKind: String

    public init(
        path: String?,
        pixelSize: PixelSize,
        coordinateOrigin: CoordinateOrigin,
        scaleToWindowLogical: Scale2D,
        captureKind: String
    ) {
        self.path = path
        self.pixelSize = pixelSize
        self.coordinateOrigin = coordinateOrigin
        self.scaleToWindowLogical = scaleToWindowLogical
        self.captureKind = captureKind
    }
}

public struct TargetWindowIdentity: Codable, Equatable, Sendable {
    public let bundleID: String
    public let pid: Int32
    public let windowNumber: Int
    public let title: String
    public let logicalFrameTopLeft: GlobalEventTapTopLeftRect
    public let ownerConnection: Int64?
    public let processSerialNumberHigh: Int64?
    public let processSerialNumberLow: Int64?

    public init(
        bundleID: String,
        pid: Int32,
        windowNumber: Int,
        title: String,
        logicalFrameTopLeft: GlobalEventTapTopLeftRect,
        ownerConnection: Int64? = nil,
        processSerialNumberHigh: Int64? = nil,
        processSerialNumberLow: Int64? = nil
    ) {
        self.bundleID = bundleID
        self.pid = pid
        self.windowNumber = windowNumber
        self.title = title
        self.logicalFrameTopLeft = logicalFrameTopLeft
        self.ownerConnection = ownerConnection
        self.processSerialNumberHigh = processSerialNumberHigh
        self.processSerialNumberLow = processSerialNumberLow
    }
}

public struct ScreenshotFitRule: Codable, Equatable, Sendable {
    public let shortEdgeTarget: Double
    public let longEdgeMax: Double

    public init(shortEdgeTarget: Double = 768, longEdgeMax: Double = 2048) {
        self.shortEdgeTarget = shortEdgeTarget
        self.longEdgeMax = longEdgeMax
    }

    public func predictedModelSize(for windowFrame: GlobalEventTapTopLeftRect) -> PixelSize {
        let scale = chosenScale(for: windowFrame)
        return PixelSize(
            width: Int((windowFrame.width * scale).rounded()),
            height: Int((windowFrame.height * scale).rounded())
        )
    }

    public func chosenScale(for windowFrame: GlobalEventTapTopLeftRect) -> Double {
        min(
            shortEdgeTarget / min(windowFrame.width, windowFrame.height),
            longEdgeMax / max(windowFrame.width, windowFrame.height)
        )
    }
}

public struct WindowObservation: Codable, Equatable, Sendable {
    public let bundleID: String
    public let pid: Int32
    public let windowNumber: Int
    public let title: String
    public let logicalFrameTopLeft: GlobalEventTapTopLeftRect
    public let modelFacingPixelSize: PixelSize?
    public let rawRetinaPixelSize: PixelSize?

    public init(
        bundleID: String,
        pid: Int32,
        windowNumber: Int,
        title: String,
        logicalFrameTopLeft: GlobalEventTapTopLeftRect,
        modelFacingPixelSize: PixelSize? = nil,
        rawRetinaPixelSize: PixelSize? = nil
    ) {
        self.bundleID = bundleID
        self.pid = pid
        self.windowNumber = windowNumber
        self.title = title
        self.logicalFrameTopLeft = logicalFrameTopLeft
        self.modelFacingPixelSize = modelFacingPixelSize
        self.rawRetinaPixelSize = rawRetinaPixelSize
    }
}

public struct StaleGuardPolicy: Codable, Equatable, Sendable {
    public let maxAgeSeconds: TimeInterval?
    public let frameTolerancePoints: Double
    public let imageSizeTolerancePixels: Int
    public let allowTitleChange: Bool

    public init(
        maxAgeSeconds: TimeInterval? = 2.0,
        frameTolerancePoints: Double = 1.0,
        imageSizeTolerancePixels: Int = 1,
        allowTitleChange: Bool = false
    ) {
        self.maxAgeSeconds = maxAgeSeconds
        self.frameTolerancePoints = frameTolerancePoints
        self.imageSizeTolerancePixels = imageSizeTolerancePixels
        self.allowTitleChange = allowTitleChange
    }
}

public struct StaleGuardResult: Codable, Equatable, Sendable {
    public let isFresh: Bool
    public let failures: [String]
    public let warnings: [String]

    public init(isFresh: Bool, failures: [String], warnings: [String]) {
        self.isFresh = isFresh
        self.failures = failures
        self.warnings = warnings
    }
}

public enum PixelRoundingRule: String, Codable, Sendable {
    case nearest
    case floor
    case ceil
}

public struct RoundedPixelPoint: Codable, Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let residualX: Double
    public let residualY: Double
    public let rule: PixelRoundingRule

    public init(x: Int, y: Int, residualX: Double, residualY: Double, rule: PixelRoundingRule) {
        self.x = x
        self.y = y
        self.residualX = residualX
        self.residualY = residualY
        self.rule = rule
    }
}

public struct CoordinateMappingDiagnostic: Codable, Equatable, Sendable {
    public let inputSpace: CoordinateSpaceName
    public let outputSpace: CoordinateSpaceName
    public let inputPoint: UntypedPoint
    public let outputPoint: UntypedPoint
    public let roundedOutput: RoundedPixelPoint?
    public let modelScale: Scale2D
    public let rawScale: Scale2D?
    public let windowFrameTopLeft: GlobalEventTapTopLeftRect
    public let warnings: [String]

    public init(
        inputSpace: CoordinateSpaceName,
        outputSpace: CoordinateSpaceName,
        inputPoint: UntypedPoint,
        outputPoint: UntypedPoint,
        roundedOutput: RoundedPixelPoint?,
        modelScale: Scale2D,
        rawScale: Scale2D?,
        windowFrameTopLeft: GlobalEventTapTopLeftRect,
        warnings: [String]
    ) {
        self.inputSpace = inputSpace
        self.outputSpace = outputSpace
        self.inputPoint = inputPoint
        self.outputPoint = outputPoint
        self.roundedOutput = roundedOutput
        self.modelScale = modelScale
        self.rawScale = rawScale
        self.windowFrameTopLeft = windowFrameTopLeft
        self.warnings = warnings
    }
}

public struct UntypedPoint: Codable, Equatable, Sendable {
    public let x: Double
    public let y: Double

    public init<Space>(_ point: Point2D<Space>) {
        self.x = point.x
        self.y = point.y
    }
}

public struct ActionableScreenshot: Codable, Equatable, Sendable {
    public let contract: ScreenshotCoordinateContract
    public let preferredInputSpace: CoordinateSpaceName
    public let diagnostics: [CoordinateMappingDiagnostic]

    public init(
        contract: ScreenshotCoordinateContract,
        preferredInputSpace: CoordinateSpaceName = .modelFacingScreenshot,
        diagnostics: [CoordinateMappingDiagnostic] = []
    ) {
        self.contract = contract
        self.preferredInputSpace = preferredInputSpace
        self.diagnostics = diagnostics
    }
}

public struct ScreenshotCoordinateContract: Codable, Equatable, Sendable {
    public static let currentVersion = "screenshot-coordinate-contract.v1"

    public let version: String
    public let capturedAt: Date
    public let stateToken: String?
    public let targetWindow: TargetWindowIdentity
    public let modelFacingScreenshot: ImagePlane<ModelFacingScreenshotSpace>
    public let rawRetinaCapture: ImagePlane<RawRetinaCaptureSpace>?
    public let fitRule: ScreenshotFitRule
    public let notes: [String]

    public init(
        version: String = ScreenshotCoordinateContract.currentVersion,
        capturedAt: Date = Date(),
        stateToken: String?,
        targetWindow: TargetWindowIdentity,
        modelFacingScreenshot: ImagePlane<ModelFacingScreenshotSpace>,
        rawRetinaCapture: ImagePlane<RawRetinaCaptureSpace>?,
        fitRule: ScreenshotFitRule = ScreenshotFitRule(),
        notes: [String] = []
    ) {
        self.version = version
        self.capturedAt = capturedAt
        self.stateToken = stateToken
        self.targetWindow = targetWindow
        self.modelFacingScreenshot = modelFacingScreenshot
        self.rawRetinaCapture = rawRetinaCapture
        self.fitRule = fitRule
        self.notes = notes
    }

    public static func make(
        capturedAt: Date = Date(),
        stateToken: String?,
        targetWindow: TargetWindowIdentity,
        modelFacingPath: String?,
        modelFacingPixelSize: PixelSize,
        rawPath: String?,
        rawPixelSize: PixelSize?,
        fitRule: ScreenshotFitRule = ScreenshotFitRule(),
        notes: [String] = []
    ) throws -> ScreenshotCoordinateContract {
        let frame = targetWindow.logicalFrameTopLeft
        let modelScale = Scale2D(
            x: Double(modelFacingPixelSize.width) / frame.width,
            y: Double(modelFacingPixelSize.height) / frame.height
        )
        let modelPlane = ImagePlane<ModelFacingScreenshotSpace>(
            path: modelFacingPath,
            pixelSize: modelFacingPixelSize,
            coordinateOrigin: .topLeft,
            scaleToWindowLogical: modelScale,
            captureKind: "model-facing-window-fit"
        )

        let rawPlane: ImagePlane<RawRetinaCaptureSpace>?
        if let rawPixelSize {
            rawPlane = ImagePlane<RawRetinaCaptureSpace>(
                path: rawPath,
                pixelSize: rawPixelSize,
                coordinateOrigin: .topLeft,
                scaleToWindowLogical: Scale2D(
                    x: Double(rawPixelSize.width) / frame.width,
                    y: Double(rawPixelSize.height) / frame.height
                ),
                captureKind: "raw-retina-window-capture"
            )
        } else {
            rawPlane = nil
        }

        let contract = ScreenshotCoordinateContract(
            capturedAt: capturedAt,
            stateToken: stateToken,
            targetWindow: targetWindow,
            modelFacingScreenshot: modelPlane,
            rawRetinaCapture: rawPlane,
            fitRule: fitRule,
            notes: notes
        )
        try contract.validateStatic()
        return contract
    }

    public var targetObservation: WindowObservation {
        WindowObservation(
            bundleID: targetWindow.bundleID,
            pid: targetWindow.pid,
            windowNumber: targetWindow.windowNumber,
            title: targetWindow.title,
            logicalFrameTopLeft: targetWindow.logicalFrameTopLeft,
            modelFacingPixelSize: modelFacingScreenshot.pixelSize,
            rawRetinaPixelSize: rawRetinaCapture?.pixelSize
        )
    }

    public func validateStatic() throws {
        guard version == ScreenshotCoordinateContract.currentVersion else {
            throw ScreenshotCoordinateError.unsupportedVersion(version)
        }
        guard targetWindow.logicalFrameTopLeft.width > 0, targetWindow.logicalFrameTopLeft.height > 0 else {
            throw ScreenshotCoordinateError.invalidWindowFrame
        }
        guard modelFacingScreenshot.coordinateOrigin == .topLeft else {
            throw ScreenshotCoordinateError.invalidOrigin("model-facing screenshots must be top-left")
        }
        guard modelFacingScreenshot.pixelSize.width > 0, modelFacingScreenshot.pixelSize.height > 0 else {
            throw ScreenshotCoordinateError.invalidImageSize("model-facing screenshot")
        }
        if let rawRetinaCapture {
            guard rawRetinaCapture.coordinateOrigin == .topLeft else {
                throw ScreenshotCoordinateError.invalidOrigin("raw captures must be top-left")
            }
            guard rawRetinaCapture.pixelSize.width > 0, rawRetinaCapture.pixelSize.height > 0 else {
                throw ScreenshotCoordinateError.invalidImageSize("raw Retina capture")
            }
        }
    }

    public func validateFreshness(
        against current: WindowObservation,
        now: Date = Date(),
        policy: StaleGuardPolicy = StaleGuardPolicy()
    ) -> StaleGuardResult {
        var failures: [String] = []
        var warnings: [String] = []

        if targetWindow.bundleID != current.bundleID {
            failures.append("bundleID changed: expected \(targetWindow.bundleID), got \(current.bundleID)")
        }
        if targetWindow.pid != current.pid {
            failures.append("pid changed: expected \(targetWindow.pid), got \(current.pid)")
        }
        if targetWindow.windowNumber != current.windowNumber {
            failures.append("windowNumber changed: expected \(targetWindow.windowNumber), got \(current.windowNumber)")
        }
        if !policy.allowTitleChange, targetWindow.title != current.title {
            failures.append("title changed: expected \(targetWindow.title), got \(current.title)")
        }

        let frameDelta = maxFrameDelta(targetWindow.logicalFrameTopLeft, current.logicalFrameTopLeft)
        if frameDelta > policy.frameTolerancePoints {
            failures.append("window frame changed by \(frameDelta) pt, tolerance \(policy.frameTolerancePoints) pt")
        }

        if let expected = current.modelFacingPixelSize {
            let dw = abs(expected.width - modelFacingScreenshot.pixelSize.width)
            let dh = abs(expected.height - modelFacingScreenshot.pixelSize.height)
            if max(dw, dh) > policy.imageSizeTolerancePixels {
                failures.append("model-facing image size changed: expected \(modelFacingScreenshot.pixelSize), got \(expected)")
            }
        } else {
            warnings.append("current observation did not include model-facing image size")
        }

        if let raw = rawRetinaCapture?.pixelSize, let currentRaw = current.rawRetinaPixelSize {
            let dw = abs(currentRaw.width - raw.width)
            let dh = abs(currentRaw.height - raw.height)
            if max(dw, dh) > policy.imageSizeTolerancePixels {
                failures.append("raw capture image size changed: expected \(raw), got \(currentRaw)")
            }
        }

        if let maxAgeSeconds = policy.maxAgeSeconds {
            let age = now.timeIntervalSince(capturedAt)
            if age > maxAgeSeconds {
                failures.append("coordinate contract is stale: age \(age)s exceeds \(maxAgeSeconds)s")
            }
        }

        return StaleGuardResult(isFresh: failures.isEmpty, failures: failures, warnings: warnings)
    }

    public func modelToWindowLocalTopLeft(_ point: ModelFacingScreenshotPoint) throws -> WindowLocalTopLeftPoint {
        try validateModelPoint(point)
        return WindowLocalTopLeftPoint(
            x: point.x / modelFacingScreenshot.scaleToWindowLogical.x,
            y: point.y / modelFacingScreenshot.scaleToWindowLogical.y
        )
    }

    public func windowLocalTopLeftToModel(_ point: WindowLocalTopLeftPoint) throws -> ModelFacingScreenshotPoint {
        try validateWindowLocalPoint(point)
        return ModelFacingScreenshotPoint(
            x: point.x * modelFacingScreenshot.scaleToWindowLogical.x,
            y: point.y * modelFacingScreenshot.scaleToWindowLogical.y
        )
    }

    public func rawToWindowLocalTopLeft(_ point: RawRetinaCapturePoint) throws -> WindowLocalTopLeftPoint {
        guard let rawRetinaCapture else {
            throw ScreenshotCoordinateError.missingRawCapture
        }
        try validateRawPoint(point)
        return WindowLocalTopLeftPoint(
            x: point.x / rawRetinaCapture.scaleToWindowLogical.x,
            y: point.y / rawRetinaCapture.scaleToWindowLogical.y
        )
    }

    public func windowLocalTopLeftToRaw(_ point: WindowLocalTopLeftPoint) throws -> RawRetinaCapturePoint {
        guard let rawRetinaCapture else {
            throw ScreenshotCoordinateError.missingRawCapture
        }
        try validateWindowLocalPoint(point)
        return RawRetinaCapturePoint(
            x: point.x * rawRetinaCapture.scaleToWindowLogical.x,
            y: point.y * rawRetinaCapture.scaleToWindowLogical.y
        )
    }

    public func modelToRaw(_ point: ModelFacingScreenshotPoint) throws -> RawRetinaCapturePoint {
        try windowLocalTopLeftToRaw(modelToWindowLocalTopLeft(point))
    }

    public func rawToModel(_ point: RawRetinaCapturePoint) throws -> ModelFacingScreenshotPoint {
        try windowLocalTopLeftToModel(rawToWindowLocalTopLeft(point))
    }

    public func windowLocalTopLeftToGlobalEventTapTopLeft(_ point: WindowLocalTopLeftPoint) throws -> GlobalEventTapTopLeftPoint {
        try validateWindowLocalPoint(point)
        let frame = targetWindow.logicalFrameTopLeft
        return GlobalEventTapTopLeftPoint(x: frame.x + point.x, y: frame.y + point.y)
    }

    public func globalEventTapTopLeftToWindowLocalTopLeft(_ point: GlobalEventTapTopLeftPoint) throws -> WindowLocalTopLeftPoint {
        try validateFinite(point.x, point.y)
        let frame = targetWindow.logicalFrameTopLeft
        return WindowLocalTopLeftPoint(x: point.x - frame.x, y: point.y - frame.y)
    }

    public func modelToGlobalEventTapTopLeft(_ point: ModelFacingScreenshotPoint) throws -> GlobalEventTapTopLeftPoint {
        try windowLocalTopLeftToGlobalEventTapTopLeft(modelToWindowLocalTopLeft(point))
    }

    public func rawToGlobalEventTapTopLeft(_ point: RawRetinaCapturePoint) throws -> GlobalEventTapTopLeftPoint {
        try windowLocalTopLeftToGlobalEventTapTopLeft(rawToWindowLocalTopLeft(point))
    }

    public func windowLocalTopLeftToAppKitBottomLeft(_ point: WindowLocalTopLeftPoint) throws -> WindowLocalAppKitBottomLeftPoint {
        try validateWindowLocalPoint(point)
        return WindowLocalAppKitBottomLeftPoint(
            x: point.x,
            y: targetWindow.logicalFrameTopLeft.height - point.y
        )
    }

    public func appKitBottomLeftToWindowLocalTopLeft(_ point: WindowLocalAppKitBottomLeftPoint) throws -> WindowLocalTopLeftPoint {
        try validateFinite(point.x, point.y)
        return WindowLocalTopLeftPoint(
            x: point.x,
            y: targetWindow.logicalFrameTopLeft.height - point.y
        )
    }

    public func modelToAppKitBottomLeft(_ point: ModelFacingScreenshotPoint) throws -> WindowLocalAppKitBottomLeftPoint {
        try windowLocalTopLeftToAppKitBottomLeft(modelToWindowLocalTopLeft(point))
    }

    public func globalEventTapTopLeftToAXGlobalTopLeft(_ point: GlobalEventTapTopLeftPoint) -> AXGlobalTopLeftPoint {
        AXGlobalTopLeftPoint(x: point.x, y: point.y)
    }

    public func axGlobalTopLeftToGlobalEventTapTopLeft(_ point: AXGlobalTopLeftPoint) -> GlobalEventTapTopLeftPoint {
        GlobalEventTapTopLeftPoint(x: point.x, y: point.y)
    }

    public func axGlobalFrameToWindowLocalTopLeft(_ frame: AXGlobalTopLeftRect) -> WindowLocalTopLeftRect {
        let window = targetWindow.logicalFrameTopLeft
        return WindowLocalTopLeftRect(
            x: frame.x - window.x,
            y: frame.y - window.y,
            width: frame.width,
            height: frame.height
        )
    }

    public func roundForPixelDispatch<Space>(
        _ point: Point2D<Space>,
        rule: PixelRoundingRule = .nearest
    ) -> RoundedPixelPoint {
        let roundedX = rounded(point.x, rule: rule)
        let roundedY = rounded(point.y, rule: rule)
        return RoundedPixelPoint(
            x: roundedX,
            y: roundedY,
            residualX: point.x - Double(roundedX),
            residualY: point.y - Double(roundedY),
            rule: rule
        )
    }

    public func diagnosticForModelToGlobal(
        _ point: ModelFacingScreenshotPoint,
        roundingRule: PixelRoundingRule? = nil
    ) throws -> CoordinateMappingDiagnostic {
        let output = try modelToGlobalEventTapTopLeft(point)
        return CoordinateMappingDiagnostic(
            inputSpace: .modelFacingScreenshot,
            outputSpace: .globalEventTapTopLeft,
            inputPoint: UntypedPoint(point),
            outputPoint: UntypedPoint(output),
            roundedOutput: roundingRule.map { roundForPixelDispatch(output, rule: $0) },
            modelScale: modelFacingScreenshot.scaleToWindowLogical,
            rawScale: rawRetinaCapture?.scaleToWindowLogical,
            windowFrameTopLeft: targetWindow.logicalFrameTopLeft,
            warnings: diagnosticWarnings()
        )
    }

    public func diagnosticForRawToModel(_ point: RawRetinaCapturePoint) throws -> CoordinateMappingDiagnostic {
        let output = try rawToModel(point)
        return CoordinateMappingDiagnostic(
            inputSpace: .rawRetinaCapture,
            outputSpace: .modelFacingScreenshot,
            inputPoint: UntypedPoint(point),
            outputPoint: UntypedPoint(output),
            roundedOutput: nil,
            modelScale: modelFacingScreenshot.scaleToWindowLogical,
            rawScale: rawRetinaCapture?.scaleToWindowLogical,
            windowFrameTopLeft: targetWindow.logicalFrameTopLeft,
            warnings: diagnosticWarnings()
        )
    }

    private func validateModelPoint(_ point: ModelFacingScreenshotPoint) throws {
        try validateFinite(point.x, point.y)
        let bounds = ModelFacingScreenshotRect(
            x: 0,
            y: 0,
            width: Double(modelFacingScreenshot.pixelSize.width),
            height: Double(modelFacingScreenshot.pixelSize.height)
        )
        guard bounds.contains(point, tolerance: 0.5) else {
            throw ScreenshotCoordinateError.pointOutOfBounds("model-facing screenshot", point.x, point.y)
        }
    }

    private func validateRawPoint(_ point: RawRetinaCapturePoint) throws {
        guard let rawRetinaCapture else {
            throw ScreenshotCoordinateError.missingRawCapture
        }
        try validateFinite(point.x, point.y)
        let bounds = RawRetinaCaptureRect(
            x: 0,
            y: 0,
            width: Double(rawRetinaCapture.pixelSize.width),
            height: Double(rawRetinaCapture.pixelSize.height)
        )
        guard bounds.contains(point, tolerance: 0.5) else {
            throw ScreenshotCoordinateError.pointOutOfBounds("raw Retina capture", point.x, point.y)
        }
    }

    private func validateWindowLocalPoint(_ point: WindowLocalTopLeftPoint) throws {
        try validateFinite(point.x, point.y)
        let frame = targetWindow.logicalFrameTopLeft
        let bounds = WindowLocalTopLeftRect(x: 0, y: 0, width: frame.width, height: frame.height)
        guard bounds.contains(point, tolerance: 0.5) else {
            throw ScreenshotCoordinateError.pointOutOfBounds("window-local top-left", point.x, point.y)
        }
    }

    private func validateFinite(_ x: Double, _ y: Double) throws {
        guard x.isFinite, y.isFinite else {
            throw ScreenshotCoordinateError.nonFinitePoint(x, y)
        }
    }

    private func diagnosticWarnings() -> [String] {
        var warnings: [String] = []
        let predicted = fitRule.predictedModelSize(for: targetWindow.logicalFrameTopLeft)
        let observed = modelFacingScreenshot.pixelSize
        if abs(predicted.width - observed.width) > 1 || abs(predicted.height - observed.height) > 1 {
            warnings.append("model-facing size deviates from 768/2048 fit prediction by more than one pixel")
        }
        if rawRetinaCapture == nil {
            warnings.append("no raw Retina capture is attached; raw/model round-trip conversion is unavailable")
        }
        return warnings
    }
}

public enum ScreenshotCoordinateError: Error, CustomStringConvertible, Equatable, Sendable {
    case unsupportedVersion(String)
    case invalidWindowFrame
    case invalidImageSize(String)
    case invalidOrigin(String)
    case missingRawCapture
    case nonFinitePoint(Double, Double)
    case pointOutOfBounds(String, Double, Double)

    public var description: String {
        switch self {
        case .unsupportedVersion(let version):
            return "Unsupported screenshot coordinate contract version: \(version)"
        case .invalidWindowFrame:
            return "Target window frame must have positive width and height."
        case .invalidImageSize(let label):
            return "\(label) must have positive pixel width and height."
        case .invalidOrigin(let message):
            return message
        case .missingRawCapture:
            return "Raw Retina capture is missing from this contract."
        case .nonFinitePoint(let x, let y):
            return "Point must be finite, got (\(x), \(y))."
        case .pointOutOfBounds(let space, let x, let y):
            return "Point (\(x), \(y)) is outside \(space) bounds."
        }
    }
}

private func maxFrameDelta<Space>(_ lhs: Rect2D<Space>, _ rhs: Rect2D<Space>) -> Double {
    max(
        abs(lhs.x - rhs.x),
        abs(lhs.y - rhs.y),
        abs(lhs.width - rhs.width),
        abs(lhs.height - rhs.height)
    )
}

private func rounded(_ value: Double, rule: PixelRoundingRule) -> Int {
    switch rule {
    case .nearest:
        return Int(value.rounded())
    case .floor:
        return Int(Foundation.floor(value))
    case .ceil:
        return Int(Foundation.ceil(value))
    }
}
