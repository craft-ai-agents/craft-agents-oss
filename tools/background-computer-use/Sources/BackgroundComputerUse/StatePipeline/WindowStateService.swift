import AppKit
import Foundation

private func elapsedMilliseconds(since start: UInt64, to end: UInt64 = DispatchTime.now().uptimeNanoseconds) -> Double {
    Double(end - start) / 1_000_000
}

struct WindowStateService {
    private let executionOptions: ActionExecutionOptions
    private let resolver = WindowTargetResolver()
    private let statePipeline = StatePipelineExperiment()

    init(executionOptions: ActionExecutionOptions = .visualCursorEnabled) {
        self.executionOptions = executionOptions
    }

    func getWindowState(request: GetWindowStateRequest) throws -> GetWindowStateResponse {
        let totalStarted = DispatchTime.now().uptimeNanoseconds
        let frontmostBefore = NSWorkspace.shared.frontmostApplication?.bundleIdentifier

        let resolveStarted = DispatchTime.now().uptimeNanoseconds
        let resolved = try resolver.resolve(windowID: request.window)
        let resolveFinished = DispatchTime.now().uptimeNanoseconds

        let captureStarted = DispatchTime.now().uptimeNanoseconds
        let capture = try statePipeline.captureResolvedWindow(
            resolved: resolved,
            includeMenuBar: request.includeMenuBar ?? true,
            menuPathComponents: request.menuPath ?? [],
            webTraversal: request.webTraversal ?? .visible,
            maxNodes: request.maxNodes ?? 6500,
            imageMode: .omit
        )
        let captureFinished = DispatchTime.now().uptimeNanoseconds

        let screenshotStarted = DispatchTime.now().uptimeNanoseconds
        let screenshot = ScreenshotCaptureService.capture(
            window: capture.envelope.response.window,
            stateToken: capture.envelope.response.stateToken,
            imageMode: request.imageMode ?? .path,
            includeRawRetinaCapture: request.includeRawScreenshot ?? false,
            includeCursorOverlay: executionOptions.visualCursorEnabled
        )
        let screenshotFinished = DispatchTime.now().uptimeNanoseconds

        let frontmostAfter = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        let debugInclusion = StateDebugInclusion(request: request)
        var notes: [String] = []
        if capture.envelope.response.tree.truncated {
            notes.append("AX tree was truncated at the requested maxNodes limit.")
        }
        if let debugNote = debugInclusion.note {
            notes.append(debugNote)
            notes.append(contentsOf: capture.envelope.response.notes)
        }
        if screenshot.status == "permission_denied" {
            notes.append("Grant Screen Recording to the signed app bundle to enable screenshot capture.")
        }
        if let captureError = screenshot.captureError {
            notes.append(captureError)
        }

        return GetWindowStateResponse(
            contractVersion: capture.envelope.response.contractVersion,
            stateToken: capture.envelope.response.stateToken,
            window: capture.envelope.response.window,
            screenshot: screenshot,
            tree: capture.envelope.response.tree,
            menuPresentation: capture.envelope.menuPresentation,
            focusedElement: capture.envelope.response.focusedElement,
            selectionSummary: capture.envelope.response.selectionSummary,
            backgroundSafety: BackgroundSafetyDTO(
                frontmostBefore: FrontmostAppObservationDTO(bundleID: frontmostBefore),
                frontmostAfter: FrontmostAppObservationDTO(bundleID: frontmostAfter),
                backgroundSafeReadObserved: capture.envelope.response.backgroundSafety.backgroundSafeReadObserved,
                backgroundSafeObserved: frontmostBefore == frontmostAfter
            ),
            performance: ReadPerformanceDTO(
                resolveMs: elapsedMilliseconds(since: resolveStarted, to: resolveFinished),
                captureMs: elapsedMilliseconds(since: captureStarted, to: captureFinished),
                projectionMs: 0,
                screenshotMs: elapsedMilliseconds(since: screenshotStarted, to: screenshotFinished),
                totalMs: elapsedMilliseconds(since: totalStarted)
            ),
            debug: debugInclusion.makeDebugDTO(from: capture.envelope),
            notes: notes
        )
    }
}

private struct StateDebugInclusion {
    let includeDiagnostics: Bool
    let includePlatformProfile: Bool
    let includeRawCapture: Bool
    let includeSemanticTree: Bool
    let includeProjectedTree: Bool

    init(request: GetWindowStateRequest) {
        let mode = request.debugMode ?? (request.debug == true ? .summary : .none)
        let summaryDefault = mode == .summary || mode == .full
        let fullDefault = mode == .full

        includeDiagnostics = request.includeDiagnostics ?? summaryDefault
        includePlatformProfile = request.includePlatformProfile ?? summaryDefault
        includeRawCapture = request.includeRawCapture ?? fullDefault
        includeSemanticTree = request.includeSemanticTree ?? fullDefault
        includeProjectedTree = request.includeProjectedTree ?? fullDefault
    }

    var note: String? {
        if includeRawCapture || includeSemanticTree || includeProjectedTree {
            return "Debug payload includes requested pipeline internals. Use debugMode none or omit debug flags for the compact API response."
        }
        if includeDiagnostics || includePlatformProfile {
            return "Debug payload includes summary diagnostics/profile only. Use debugMode full to include raw, semantic, and projected pipeline internals."
        }
        return nil
    }

    func makeDebugDTO(from envelope: AXPipelineV2Envelope) -> GetWindowStateDebugDTO? {
        guard includeDiagnostics || includePlatformProfile || includeRawCapture || includeSemanticTree || includeProjectedTree else {
            return nil
        }

        return GetWindowStateDebugDTO(
            diagnostics: includeDiagnostics ? envelope.diagnostics : nil,
            platformProfile: includePlatformProfile ? envelope.platformProfile : nil,
            rawCapture: includeRawCapture ? envelope.rawCapture : nil,
            semanticTree: includeSemanticTree ? envelope.semanticTree : nil,
            projectedTree: includeProjectedTree ? envelope.projectedTree : nil
        )
    }
}
