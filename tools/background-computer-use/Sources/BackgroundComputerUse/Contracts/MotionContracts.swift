import Foundation

public struct MotionProjectionDiagnosticsDTO: Encodable, Sendable {
    public let backendID: String
    public let targetFrameRate: Double
    public let requestedSamples: Int
    public let frameWrites: Int
    public let skippedSamples: Int
    public let projectionElapsedMs: Double
    public let effectiveFrameRate: Double
    public let lateSamples: Int
    public let maxSampleSlipMs: Double
    public let writeMs: Double
    public let maxWriteMs: Double
    public let midProjectionAXReads: Int
    public let observedEvents: Int
    public let observedFrameChanges: Int
    public let observedEffectiveFrameRate: Double
    public let observedEchoes: Int
    public let divergentObservedEvents: Int
    public let invalidObservedEvents: Int
    public let maxObservedGapMs: Double
    public let firstObservedChangeDelayMs: Double
    public let lastObservedChangeDelayMs: Double

    public init(
        backendID: String,
        targetFrameRate: Double,
        requestedSamples: Int,
        frameWrites: Int,
        skippedSamples: Int,
        projectionElapsedMs: Double,
        effectiveFrameRate: Double,
        lateSamples: Int,
        maxSampleSlipMs: Double,
        writeMs: Double,
        maxWriteMs: Double,
        midProjectionAXReads: Int,
        observedEvents: Int = 0,
        observedFrameChanges: Int = 0,
        observedEffectiveFrameRate: Double = 0,
        observedEchoes: Int = 0,
        divergentObservedEvents: Int = 0,
        invalidObservedEvents: Int = 0,
        maxObservedGapMs: Double = 0,
        firstObservedChangeDelayMs: Double = 0,
        lastObservedChangeDelayMs: Double = 0
    ) {
        self.backendID = backendID
        self.targetFrameRate = sanitizedJSONDouble(targetFrameRate)
        self.requestedSamples = requestedSamples
        self.frameWrites = frameWrites
        self.skippedSamples = skippedSamples
        self.projectionElapsedMs = sanitizedJSONDouble(projectionElapsedMs)
        self.effectiveFrameRate = sanitizedJSONDouble(effectiveFrameRate)
        self.lateSamples = lateSamples
        self.maxSampleSlipMs = sanitizedJSONDouble(maxSampleSlipMs)
        self.writeMs = sanitizedJSONDouble(writeMs)
        self.maxWriteMs = sanitizedJSONDouble(maxWriteMs)
        self.midProjectionAXReads = midProjectionAXReads
        self.observedEvents = observedEvents
        self.observedFrameChanges = observedFrameChanges
        self.observedEffectiveFrameRate = sanitizedJSONDouble(observedEffectiveFrameRate)
        self.observedEchoes = observedEchoes
        self.divergentObservedEvents = divergentObservedEvents
        self.invalidObservedEvents = invalidObservedEvents
        self.maxObservedGapMs = sanitizedJSONDouble(maxObservedGapMs)
        self.firstObservedChangeDelayMs = sanitizedJSONDouble(firstObservedChangeDelayMs)
        self.lastObservedChangeDelayMs = sanitizedJSONDouble(lastObservedChangeDelayMs)
    }
}

public struct MotionPerformanceDTO: Encodable, Sendable {
    public let resolveMs: Double
    public let planningMs: Double
    public let projectionMs: Double
    public let settleMs: Double
    public let totalMs: Double
    public let projectionDiagnostics: MotionProjectionDiagnosticsDTO?

    public init(
        resolveMs: Double,
        planningMs: Double,
        projectionMs: Double,
        settleMs: Double,
        totalMs: Double,
        projectionDiagnostics: MotionProjectionDiagnosticsDTO? = nil
    ) {
        self.resolveMs = sanitizedJSONDouble(resolveMs)
        self.planningMs = sanitizedJSONDouble(planningMs)
        self.projectionMs = sanitizedJSONDouble(projectionMs)
        self.settleMs = sanitizedJSONDouble(settleMs)
        self.totalMs = sanitizedJSONDouble(totalMs)
        self.projectionDiagnostics = projectionDiagnostics
    }
}

public struct MotionWindowDTO: Encodable, Sendable {
    public let windowID: String
    public let title: String
    public let bundleID: String
    public let pid: Int32
    public let launchDate: String?
    public let windowNumber: Int
    public let frameBeforeAppKit: RectDTO
    public let frameAfterAppKit: RectDTO
}

public struct DragRequestedDTO: Encodable, Sendable {
    public let window: String
    public let toX: Double
    public let toY: Double
    public let coordinateSpace: CoordinateSpaceDTO
}

public struct DragActionDTO: Encodable, Sendable {
    public let kind: String
    public let requested: DragRequestedDTO
    public let strategyUsed: String
    public let rawStatus: String
    public let effectVerified: Bool
    public let warnings: [String]
}

public struct DragResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let cursor: CursorResponseDTO
    public let action: DragActionDTO
    public let window: MotionWindowDTO
    public let backgroundSafety: BackgroundSafetyDTO
    public let performance: MotionPerformanceDTO
    public let error: ActionErrorDTO?
}

public struct ResizeRequestedDTO: Encodable, Sendable {
    public let window: String
    public let handle: ResizeHandleDTO
    public let toX: Double
    public let toY: Double
    public let coordinateSpace: CoordinateSpaceDTO
}

public struct ResizeActionDTO: Encodable, Sendable {
    public let kind: String
    public let requested: ResizeRequestedDTO
    public let strategyUsed: String
    public let rawStatus: String
    public let effectVerified: Bool
    public let warnings: [String]
}

public struct ResizeResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let cursor: CursorResponseDTO
    public let action: ResizeActionDTO
    public let window: MotionWindowDTO
    public let backgroundSafety: BackgroundSafetyDTO
    public let performance: MotionPerformanceDTO
    public let error: ActionErrorDTO?
}

public struct SetWindowFrameRequestedDTO: Encodable, Sendable {
    public let window: String
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
    public let animate: Bool
    public let coordinateSpace: CoordinateSpaceDTO
}

public struct SetWindowFrameActionDTO: Encodable, Sendable {
    public let kind: String
    public let requested: SetWindowFrameRequestedDTO
    public let strategyUsed: String
    public let presentationMode: MotionPresentationModeDTO
    public let rawStatus: String
    public let effectVerified: Bool
    public let warnings: [String]
}

public struct SetWindowFrameResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let cursor: CursorResponseDTO
    public let action: SetWindowFrameActionDTO
    public let window: MotionWindowDTO
    public let backgroundSafety: BackgroundSafetyDTO
    public let performance: MotionPerformanceDTO
    public let error: ActionErrorDTO?
}
