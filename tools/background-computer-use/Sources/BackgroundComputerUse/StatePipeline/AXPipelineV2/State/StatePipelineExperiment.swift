import AppKit
import ApplicationServices
import Foundation

typealias StatePipelineEnvelope = AXPipelineV2Envelope
typealias StatePipelineFixture = AXPipelineV2Fixture
typealias StatePipelineScenario = AXPipelineV2Scenario
typealias StatePipelineMenuMode = AXMenuMode

struct StatePipelineLiveCaptureOptions {
    let appQuery: String
    let windowTitleContains: String?
    let includeMenuBar: Bool
    let menuMode: StatePipelineMenuMode?
    let menuPathComponents: [String]
    let webTraversal: AXWebTraversalMode
    let maxNodes: Int
    let imageMode: ImageMode
    let includeCursorOverlay: Bool
    let scenarioID: String?

    init(
        appQuery: String,
        windowTitleContains: String? = nil,
        includeMenuBar: Bool,
        menuMode: StatePipelineMenuMode? = nil,
        menuPathComponents: [String] = [],
        webTraversal: AXWebTraversalMode = .visible,
        maxNodes: Int,
        imageMode: ImageMode,
        includeCursorOverlay: Bool = true,
        scenarioID: String? = nil
    ) {
        self.appQuery = appQuery
        self.windowTitleContains = windowTitleContains
        self.includeMenuBar = includeMenuBar
        self.menuMode = menuMode
        self.menuPathComponents = menuPathComponents
        self.webTraversal = webTraversal
        self.maxNodes = maxNodes
        self.imageMode = imageMode
        self.includeCursorOverlay = includeCursorOverlay
        self.scenarioID = scenarioID
    }
}

struct StatePipelineCaptureResult {
    let envelope: StatePipelineEnvelope
    let fixture: StatePipelineFixture
    let liveElementsByCanonicalIndex: [Int: AXUIElement]

    init(envelope: StatePipelineEnvelope, fixture: StatePipelineFixture) {
        self.envelope = envelope
        self.fixture = fixture
        liveElementsByCanonicalIndex = [:]
    }

    init(
        envelope: StatePipelineEnvelope,
        fixture: StatePipelineFixture,
        liveElementsByCanonicalIndex: [Int: AXUIElement]
    ) {
        self.envelope = envelope
        self.fixture = fixture
        self.liveElementsByCanonicalIndex = liveElementsByCanonicalIndex
    }
}

enum StatePipelineExperimentError: Error, CustomStringConvertible {
    case invalidFixture(String)
    case invalidScenario(String)

    var description: String {
        switch self {
        case let .invalidFixture(path):
            return "Fixture could not be decoded: \(path)"
        case let .invalidScenario(path):
            return "Scenario could not be decoded: \(path)"
        }
    }
}

struct StatePipelineExperiment {
    private let targetResolver = WindowTargetResolver()
    private let rawCaptureService = AXRawCaptureService()
    private let platformProfileService = AXPlatformProfileService()
    private let semanticEnricher = AXSemanticEnricher()
    private let projectedTreeBuilder = AXProjectedTreeBuilder()
    private let menuLiveCaptureService = AXMenuLiveCaptureService()

    init() {}

    func captureLive(_ options: StatePipelineLiveCaptureOptions) throws -> StatePipelineCaptureResult {
        let frontmostBefore = NSWorkspace.shared.frontmostApplication
        let resolved = try targetResolver.resolve(
            appQuery: options.appQuery,
            windowTitleContains: options.windowTitleContains
        )
        let platformProfile = platformProfileService.prepareAndProfile(app: resolved.app, appElement: resolved.appElement)
        let effectiveMenuMode = effectiveMenuMode(
            includeMenuBar: options.includeMenuBar,
            explicitMenuMode: options.menuMode
        )
        let menuContext = menuLiveCaptureService.prepare(
            windowRoot: resolved.window.element,
            appElement: resolved.appElement,
            processIdentifier: resolved.app.processIdentifier,
            includeMenuBar: options.includeMenuBar,
            options: AXMenuLiveCaptureOptions(
                menuMode: effectiveMenuMode,
                menuPathComponents: options.menuPathComponents
            )
        )

        let focusedElement = AXHelpers.elementAttribute(resolved.appElement, attribute: kAXFocusedUIElementAttribute as CFString)
        let liveCapture = rawCaptureService.capture(
            roots: menuContext.roots,
            focusedElement: focusedElement,
            maxNodes: options.maxNodes,
            webTraversal: options.webTraversal
        )
        let rawCapture = liveCapture.rawCapture
        let semanticTree = semanticEnricher.enrich(rawCapture)
        let projectionPolicy = makeProjectionPolicy(
            platformProfile: platformProfile,
            rawCapture: rawCapture,
            includeMenuBar: effectiveMenuMode != .none,
            effectiveMenuMode: effectiveMenuMode,
            activeMenuTopLevelTitle: menuContext.projectionHints.activeTopLevelTitle
        )
        let projectedTree = projectedTreeBuilder.build(
            rawCapture: rawCapture,
            semanticTree: semanticTree,
            policy: projectionPolicy
        )

        let generatedAt = Date()
        let windowID = WindowID.make(
            bundleID: resolved.app.bundleIdentifier ?? "",
            pid: resolved.app.processIdentifier,
            launchDate: resolved.app.launchDate,
            windowNumber: resolved.window.windowNumber
        )
        let stateToken = StateToken.make(
            windowID: windowID,
            title: resolved.window.title,
            frame: resolved.window.frameAppKit,
            projectedTree: projectedTree,
            selectionSummary: rawCapture.focusSelection,
            pixelWidth: nil,
            pixelHeight: nil
        )

        let frontmostAfter = NSWorkspace.shared.frontmostApplication
        let backgroundSafety = BackgroundSafetyDTO(
            frontmostBefore: FrontmostAppObservationDTO(bundleID: frontmostBefore?.bundleIdentifier),
            frontmostAfter: FrontmostAppObservationDTO(bundleID: frontmostAfter?.bundleIdentifier),
            backgroundSafeReadObserved: frontmostBefore?.bundleIdentifier == frontmostAfter?.bundleIdentifier
        )

        let window = ResolvedWindowDTO(
            windowID: windowID,
            title: resolved.window.title,
            bundleID: resolved.app.bundleIdentifier ?? "",
            pid: resolved.app.processIdentifier,
            launchDate: resolved.app.launchDate.map(Time.iso8601String),
            windowNumber: resolved.window.windowNumber,
            frameAppKit: RectDTO(
                x: resolved.window.frameAppKit.minX,
                y: resolved.window.frameAppKit.minY,
                width: resolved.window.frameAppKit.width,
                height: resolved.window.frameAppKit.height
            ),
            resolutionStrategy: resolved.resolutionStrategy
        )
        let screenshot = ScreenshotCaptureService.capture(
            window: window,
            stateToken: stateToken,
            imageMode: options.imageMode,
            includeCursorOverlay: options.includeCursorOverlay
        )

        let focusedProjectedNode = projectedTree.focusedProjectedIndex.flatMap { projectedTree.nodes[safe: $0] }
        let focusedElementDTO = FocusedElementDTO(
            index: projectedTree.focusedDisplayIndex,
            displayRole: focusedProjectedNode?.displayRole,
            title: focusedProjectedNode?.label,
            description: focusedProjectedNode?.metadata.first,
            secondaryActions: focusedProjectedNode?.secondaryActions ?? []
        )

        let responseNotes = buildNotes(
            resolvedNotes: resolved.notes,
            options: options,
            effectiveMenuMode: effectiveMenuMode,
            rawCapture: rawCapture,
            platformProfile: platformProfile,
            menuContext: menuContext
        )
        let surfaceTree = makeSurfaceTreeDTO(projectedTree: projectedTree, rawCapture: rawCapture)
        let clickReadiness = AXClickReadinessSupport.metrics(for: surfaceTree.nodes)

        let response = AXPipelineV2Response(
            contractVersion: StatePipelineContractVersion.current,
            stateToken: stateToken,
            window: window,
            screenshot: screenshot,
            tree: surfaceTree,
            menuPresentation: menuContext.menuPresentation,
            focusedElement: focusedElementDTO,
            selectionSummary: rawCapture.focusSelection,
            backgroundSafety: backgroundSafety,
            notes: responseNotes
        )

        let diagnostics = AXPipelineV2DiagnosticsDTO(
            rawNodeCount: rawCapture.nodes.count,
            semanticNodeCount: semanticTree.nodes.count,
            projectedNodeCount: projectedTree.nodes.count,
            renderedLineCount: projectedTree.renderedText.split(separator: "\n", omittingEmptySubsequences: false).count,
            focusedCanonicalIndex: projectedTree.focusedCanonicalIndex,
            focusedProjectedIndex: projectedTree.focusedProjectedIndex,
            focusedDisplayIndex: projectedTree.focusedDisplayIndex,
            projectionProfile: projectedTree.profile,
            appliedTransforms: projectedTree.appliedTransforms.map(\.name),
            selectedTextAvailable: rawCapture.focusSelection?.selectedText?.isEmpty == false,
            clickReadiness: clickReadiness,
            notes: responseNotes
        )

        let envelope = AXPipelineV2Envelope(
            response: response,
            rawCapture: rawCapture,
            platformProfile: platformProfile,
            semanticTree: semanticTree,
            projectedTree: projectedTree,
            menuPresentation: menuContext.menuPresentation,
            diagnostics: diagnostics
        )

        let fixture = AXPipelineV2Fixture(
            generatedAt: Time.iso8601String(from: generatedAt),
            scenarioID: options.scenarioID,
            appQuery: options.appQuery,
            includeMenuBar: options.includeMenuBar,
            menuMode: effectiveMenuMode,
            maxNodes: options.maxNodes,
            window: window,
            rawCapture: rawCapture,
            platformProfile: platformProfile,
            menuPresentation: menuContext.menuPresentation,
            notes: responseNotes
        )

        return StatePipelineCaptureResult(
            envelope: envelope,
            fixture: fixture,
            liveElementsByCanonicalIndex: liveCapture.liveElementsByCanonicalIndex
        )
    }

    func captureResolvedWindow(
        resolved: ResolvedWindowTarget,
        includeMenuBar: Bool,
        menuMode: StatePipelineMenuMode? = nil,
        menuPathComponents: [String] = [],
        webTraversal: AXWebTraversalMode = .visible,
        maxNodes: Int,
        imageMode: ImageMode,
        includeCursorOverlay: Bool = true,
        scenarioID: String? = nil
    ) throws -> StatePipelineCaptureResult {
        let frontmostBefore = NSWorkspace.shared.frontmostApplication
        let platformProfile = platformProfileService.prepareAndProfile(app: resolved.app, appElement: resolved.appElement)
        let effectiveMenuMode = effectiveMenuMode(
            includeMenuBar: includeMenuBar,
            explicitMenuMode: menuMode
        )
        let menuContext = menuLiveCaptureService.prepare(
            windowRoot: resolved.window.element,
            appElement: resolved.appElement,
            processIdentifier: resolved.app.processIdentifier,
            includeMenuBar: includeMenuBar,
            options: AXMenuLiveCaptureOptions(
                menuMode: effectiveMenuMode,
                menuPathComponents: menuPathComponents
            )
        )

        let focusedElement = AXHelpers.elementAttribute(resolved.appElement, attribute: kAXFocusedUIElementAttribute as CFString)
        let liveCapture = rawCaptureService.capture(
            roots: menuContext.roots,
            focusedElement: focusedElement,
            maxNodes: maxNodes,
            webTraversal: webTraversal
        )
        let rawCapture = liveCapture.rawCapture
        let semanticTree = semanticEnricher.enrich(rawCapture)
        let projectionPolicy = makeProjectionPolicy(
            platformProfile: platformProfile,
            rawCapture: rawCapture,
            includeMenuBar: effectiveMenuMode != .none,
            effectiveMenuMode: effectiveMenuMode,
            activeMenuTopLevelTitle: menuContext.projectionHints.activeTopLevelTitle
        )
        let projectedTree = projectedTreeBuilder.build(
            rawCapture: rawCapture,
            semanticTree: semanticTree,
            policy: projectionPolicy
        )

        let generatedAt = Date()
        let windowID = resolved.windowID
        let stateToken = StateToken.make(
            windowID: windowID,
            title: resolved.window.title,
            frame: resolved.window.frameAppKit,
            projectedTree: projectedTree,
            selectionSummary: rawCapture.focusSelection,
            pixelWidth: nil,
            pixelHeight: nil
        )

        let frontmostAfter = NSWorkspace.shared.frontmostApplication
        let backgroundSafety = BackgroundSafetyDTO(
            frontmostBefore: FrontmostAppObservationDTO(bundleID: frontmostBefore?.bundleIdentifier),
            frontmostAfter: FrontmostAppObservationDTO(bundleID: frontmostAfter?.bundleIdentifier),
            backgroundSafeReadObserved: frontmostBefore?.bundleIdentifier == frontmostAfter?.bundleIdentifier
        )

        let window = ResolvedWindowDTO(
            windowID: windowID,
            title: resolved.window.title,
            bundleID: resolved.bundleID,
            pid: resolved.app.processIdentifier,
            launchDate: resolved.launchDate.map(Time.iso8601String),
            windowNumber: resolved.window.windowNumber,
            frameAppKit: RectDTO(
                x: resolved.window.frameAppKit.minX,
                y: resolved.window.frameAppKit.minY,
                width: resolved.window.frameAppKit.width,
                height: resolved.window.frameAppKit.height
            ),
            resolutionStrategy: resolved.resolutionStrategy
        )
        let screenshot = ScreenshotCaptureService.capture(
            window: window,
            stateToken: stateToken,
            imageMode: imageMode,
            includeCursorOverlay: includeCursorOverlay
        )

        let focusedProjectedNode = projectedTree.focusedProjectedIndex.flatMap { projectedTree.nodes[safe: $0] }
        let focusedElementDTO = FocusedElementDTO(
            index: projectedTree.focusedDisplayIndex,
            displayRole: focusedProjectedNode?.displayRole,
            title: focusedProjectedNode?.label,
            description: focusedProjectedNode?.metadata.first,
            secondaryActions: focusedProjectedNode?.secondaryActions ?? []
        )

        let options = StatePipelineLiveCaptureOptions(
            appQuery: resolved.bundleID,
            windowTitleContains: nil,
            includeMenuBar: includeMenuBar,
            menuMode: menuMode,
            menuPathComponents: menuPathComponents,
            webTraversal: webTraversal,
            maxNodes: maxNodes,
            imageMode: imageMode,
            includeCursorOverlay: includeCursorOverlay,
            scenarioID: scenarioID
        )
        let responseNotes = buildNotes(
            resolvedNotes: resolved.notes,
            options: options,
            effectiveMenuMode: effectiveMenuMode,
            rawCapture: rawCapture,
            platformProfile: platformProfile,
            menuContext: menuContext
        )
        let surfaceTree = makeSurfaceTreeDTO(projectedTree: projectedTree, rawCapture: rawCapture)
        let clickReadiness = AXClickReadinessSupport.metrics(for: surfaceTree.nodes)

        let response = AXPipelineV2Response(
            contractVersion: StatePipelineContractVersion.current,
            stateToken: stateToken,
            window: window,
            screenshot: screenshot,
            tree: surfaceTree,
            menuPresentation: menuContext.menuPresentation,
            focusedElement: focusedElementDTO,
            selectionSummary: rawCapture.focusSelection,
            backgroundSafety: backgroundSafety,
            notes: responseNotes
        )

        let diagnostics = AXPipelineV2DiagnosticsDTO(
            rawNodeCount: rawCapture.nodes.count,
            semanticNodeCount: semanticTree.nodes.count,
            projectedNodeCount: projectedTree.nodes.count,
            renderedLineCount: projectedTree.renderedText.split(separator: "\n", omittingEmptySubsequences: false).count,
            focusedCanonicalIndex: projectedTree.focusedCanonicalIndex,
            focusedProjectedIndex: projectedTree.focusedProjectedIndex,
            focusedDisplayIndex: projectedTree.focusedDisplayIndex,
            projectionProfile: projectedTree.profile,
            appliedTransforms: projectedTree.appliedTransforms.map(\.name),
            selectedTextAvailable: rawCapture.focusSelection?.selectedText?.isEmpty == false,
            clickReadiness: clickReadiness,
            notes: responseNotes
        )

        let envelope = AXPipelineV2Envelope(
            response: response,
            rawCapture: rawCapture,
            platformProfile: platformProfile,
            semanticTree: semanticTree,
            projectedTree: projectedTree,
            menuPresentation: menuContext.menuPresentation,
            diagnostics: diagnostics
        )

        let fixture = AXPipelineV2Fixture(
            generatedAt: Time.iso8601String(from: generatedAt),
            scenarioID: scenarioID,
            appQuery: resolved.bundleID,
            includeMenuBar: includeMenuBar,
            menuMode: effectiveMenuMode,
            maxNodes: maxNodes,
            window: window,
            rawCapture: rawCapture,
            platformProfile: platformProfile,
            menuPresentation: menuContext.menuPresentation,
            notes: responseNotes
        )

        return StatePipelineCaptureResult(
            envelope: envelope,
            fixture: fixture,
            liveElementsByCanonicalIndex: liveCapture.liveElementsByCanonicalIndex
        )
    }

    func replayFixture(_ fixture: StatePipelineFixture, imageMode _: ImageMode = .path) -> StatePipelineEnvelope {
        let replayPreparation = prepareReplayFixture(fixture)
        let semanticTree = semanticEnricher.enrich(replayPreparation.rawCapture)
        let replayNotes = sanitizedFixtureNotes(fixture.notes + replayPreparation.notes)
        let projectedTree = projectedTreeBuilder.build(
            rawCapture: replayPreparation.rawCapture,
            semanticTree: semanticTree,
            policy: makeProjectionPolicy(
                platformProfile: fixture.platformProfile,
                rawCapture: replayPreparation.rawCapture,
                includeMenuBar: replayPreparation.effectiveMenuMode != .none,
                effectiveMenuMode: replayPreparation.effectiveMenuMode,
                activeMenuTopLevelTitle: replayPreparation.menuPresentation?.activeTopLevelTitle
            )
        )
        let stateToken = StateToken.make(
            windowID: fixture.window.windowID,
            title: fixture.window.title,
            frame: CGRect(
                x: fixture.window.frameAppKit.x,
                y: fixture.window.frameAppKit.y,
                width: fixture.window.frameAppKit.width,
                height: fixture.window.frameAppKit.height
            ),
            projectedTree: projectedTree,
            selectionSummary: replayPreparation.rawCapture.focusSelection,
            pixelWidth: nil,
            pixelHeight: nil
        )
        let screenshot = ScreenshotDTO(
            status: "fixture_replay",
            image: nil,
            rawRetinaCapture: nil,
            coordinateContract: nil,
            captureError: nil
        )
        let focusedProjectedNode = projectedTree.focusedProjectedIndex.flatMap { projectedTree.nodes[safe: $0] }

        let surfaceTree = makeSurfaceTreeDTO(projectedTree: projectedTree, rawCapture: replayPreparation.rawCapture)
        let clickReadiness = AXClickReadinessSupport.metrics(for: surfaceTree.nodes)

        let response = AXPipelineV2Response(
            contractVersion: StatePipelineContractVersion.current,
            stateToken: stateToken,
            window: fixture.window,
            screenshot: screenshot,
            tree: surfaceTree,
            menuPresentation: replayPreparation.menuPresentation,
            focusedElement: FocusedElementDTO(
                index: projectedTree.focusedDisplayIndex,
                displayRole: focusedProjectedNode?.displayRole,
                title: focusedProjectedNode?.label,
                description: focusedProjectedNode?.metadata.first,
                secondaryActions: focusedProjectedNode?.secondaryActions ?? []
            ),
            selectionSummary: replayPreparation.rawCapture.focusSelection,
            backgroundSafety: BackgroundSafetyDTO(
                frontmostBefore: nil,
                frontmostAfter: nil,
                backgroundSafeReadObserved: nil
            ),
            notes: replayNotes
        )

        return AXPipelineV2Envelope(
            response: response,
            rawCapture: replayPreparation.rawCapture,
            platformProfile: fixture.platformProfile,
            semanticTree: semanticTree,
            projectedTree: projectedTree,
            menuPresentation: replayPreparation.menuPresentation,
            diagnostics: AXPipelineV2DiagnosticsDTO(
                rawNodeCount: replayPreparation.rawCapture.nodes.count,
                semanticNodeCount: semanticTree.nodes.count,
                projectedNodeCount: projectedTree.nodes.count,
                renderedLineCount: projectedTree.renderedText.split(separator: "\n", omittingEmptySubsequences: false).count,
                focusedCanonicalIndex: projectedTree.focusedCanonicalIndex,
                focusedProjectedIndex: projectedTree.focusedProjectedIndex,
                focusedDisplayIndex: projectedTree.focusedDisplayIndex,
                projectionProfile: projectedTree.profile,
                appliedTransforms: projectedTree.appliedTransforms.map(\.name),
                selectedTextAvailable: replayPreparation.rawCapture.focusSelection?.selectedText?.isEmpty == false,
                clickReadiness: clickReadiness,
                notes: replayNotes
            )
        )
    }

    func loadFixture(at path: String) throws -> StatePipelineFixture {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let decoder = JSONDecoder()
        guard let fixture = try? decoder.decode(StatePipelineFixture.self, from: data) else {
            throw StatePipelineExperimentError.invalidFixture(path)
        }
        return fixture
    }

    func saveFixture(_ fixture: StatePipelineFixture, to path: String) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(fixture)
        let url = URL(fileURLWithPath: path)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    func loadScenario(at path: String) throws -> StatePipelineScenario {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let decoder = JSONDecoder()
        guard let scenario = try? decoder.decode(StatePipelineScenario.self, from: data) else {
            throw StatePipelineExperimentError.invalidScenario(path)
        }
        return scenario
    }

    private func buildNotes(
        resolvedNotes: [String],
        options: StatePipelineLiveCaptureOptions,
        effectiveMenuMode: AXMenuMode,
        rawCapture: AXRawCaptureResult,
        platformProfile: AXPlatformProfileDTO,
        menuContext: AXMenuLiveCaptureContext
    ) -> [String] {
        var notes = resolvedNotes
        notes.append("State capture stages: raw capture -> semantic enrichment -> projection passes -> text rendering.")
        if rawCapture.truncated {
            notes.append("Raw capture reached the maxNodes limit before traversing the full accessibility tree.")
        }
        if rawCapture.nodes.contains(where: { $0.collectionInfo?.isWindowed == true }) {
            notes.append("Dense native collection branches are windowed to visible rows and report collectionInfo ranges.")
        }
        if effectiveMenuMode == .none {
            notes.append("Menu bar chrome is excluded by default in the projection policy.")
        } else if effectiveMenuMode == .fullMenuTraversal {
            notes.append("Menu bar branches are projected with active-surface-first summaries so passive menus do not expand into full inventory trees.")
        } else {
            notes.append("Menu capture is running in open-menu-only mode, using a separate menu-state provider to narrow roots when an active menu branch is known.")
        }
        if options.menuPathComponents.isEmpty == false {
            notes.append("Menu activation path for this live read: \(options.menuPathComponents.joined(separator: " > ")).")
        }
        notes.append(contentsOf: menuContext.notes)
        notes.append(contentsOf: platformProfile.notes)
        return notes
    }

    private func makeSurfaceTreeDTO(
        projectedTree: AXProjectedTreeDTO,
        rawCapture: AXRawCaptureResult
    ) -> AXPipelineV2TreeDTO {
        let displayIndexByProjectedIndex = Dictionary(
            uniqueKeysWithValues: projectedTree.lineMappings.map { ($0.projectedIndex, $0.displayIndex) }
        )

        return AXPipelineV2TreeDTO(
            nodeCount: projectedTree.nodes.count,
            truncated: rawCapture.truncated,
            renderedText: projectedTree.renderedText,
            nodes: projectedTree.nodes.map {
                makeSurfaceNodeDTO(
                    projectedNode: $0,
                    displayIndex: displayIndexByProjectedIndex[$0.projectedIndex],
                    rawCapture: rawCapture
                )
            },
            lineMappings: projectedTree.lineMappings,
            profile: projectedTree.profile
        )
    }

    private func makeSurfaceNodeDTO(
        projectedNode: AXProjectedNodeDTO,
        displayIndex: Int?,
        rawCapture: AXRawCaptureResult
    ) -> AXPipelineV2SurfaceNodeDTO {
        let primaryRawNode = rawCapture.nodes[safe: projectedNode.primaryCanonicalIndex]
        let curatedActions = AXClickReadinessSupport.curatedActions(
            projectedNode: projectedNode,
            rawNode: primaryRawNode
        )
        let identifier = primaryRawNode?.identifier
            ?? projectedNode.metadata.first(where: { $0.hasPrefix("ID: ") }).map { String($0.dropFirst(4)) }
        let url = primaryRawNode?.url
            ?? projectedNode.metadata.first(where: { $0.hasPrefix("URL: ") }).map { String($0.dropFirst(5)) }
        let activationPoint = primaryRawNode?.activationPointAppKit
        let suggestedInteractionPoint = AXActionabilitySupport.suggestedInteractionPoint(
            frameAppKit: projectedNode.frameAppKit,
            activationPointAppKit: activationPoint,
            role: primaryRawNode?.role,
            subrole: primaryRawNode?.subrole,
            isValueSettable: primaryRawNode?.isValueSettable
        )

        return AXPipelineV2SurfaceNodeDTO(
            index: projectedNode.projectedIndex,
            displayIndex: displayIndex,
            projectedIndex: projectedNode.projectedIndex,
            parentIndex: projectedNode.parentProjectedIndex,
            depth: projectedNode.depth,
            primaryCanonicalIndex: projectedNode.primaryCanonicalIndex,
            canonicalIndices: projectedNode.canonicalIndices,
            childIndices: projectedNode.childProjectedIndices,
            displayRole: projectedNode.displayRole,
            rawRole: primaryRawNode?.role,
            rawSubrole: primaryRawNode?.subrole,
            title: projectedNode.label,
            description: projectedNode.metadata.first,
            help: primaryRawNode?.help,
            identifier: identifier,
            url: url,
            nodeID: primaryRawNode?.identity?.nodeID,
            identity: primaryRawNode?.identity,
            refetch: primaryRawNode?.identity?.refetch,
            refetchFingerprint: primaryRawNode?.identity?.refetch?.fingerprint,
            value: primaryRawNode?.value,
            valueKind: primaryRawNode?.value.kind,
            isValueSettable: primaryRawNode?.isValueSettable,
            flags: projectedNode.flags,
            secondaryActions: projectedNode.secondaryActions,
            secondaryActionBindings: bindingsWithDisplayIndex(projectedNode.secondaryActionBindings, displayIndex: displayIndex),
            affordances: projectedNode.affordances,
            availableActions: primaryRawNode?.availableActions,
            curatedSecondaryActions: curatedActions.secondaryActions,
            curatedAvailableActions: curatedActions.availableActions,
            parameterizedAttributes: primaryRawNode?.parameterizedAttributes,
            frameAppKit: projectedNode.frameAppKit,
            activationPointAppKit: activationPoint,
            suggestedInteractionPointAppKit: suggestedInteractionPoint,
            childCount: projectedNode.childProjectedIndices.count,
            collectionInfo: primaryRawNode?.collectionInfo,
            interactionTraits: primaryRawNode?.interactionTraits,
            profileHint: projectedNode.profileHint,
            transformNotes: projectedNode.transformNotes
        )
    }

    private func bindingsWithDisplayIndex(
        _ bindings: [AXSecondaryActionBindingDescriptorDTO]?,
        displayIndex: Int?
    ) -> [AXSecondaryActionBindingDescriptorDTO]? {
        guard let bindings, bindings.isEmpty == false else {
            return nil
        }
        return bindings.map { binding in
            let target = AXSecondaryActionBindingTargetDTO(
                displayIndex: displayIndex,
                projectedIndex: binding.target.projectedIndex,
                primaryCanonicalIndex: binding.target.primaryCanonicalIndex,
                canonicalIndices: binding.target.canonicalIndices,
                nodeID: binding.target.nodeID,
                refetchFingerprint: binding.target.refetchFingerprint,
                role: binding.target.role,
                rawRole: binding.target.rawRole,
                rawSubrole: binding.target.rawSubrole,
                title: binding.target.title,
                frameAppKit: binding.target.frameAppKit
            )
            return AXSecondaryActionBindingDescriptorDTO(
                actionID: binding.actionID,
                label: binding.label,
                source: binding.source,
                kind: binding.kind,
                dispatchMethod: binding.dispatchMethod,
                rawName: binding.rawName,
                menuPath: binding.menuPath,
                target: target,
                dispatchTarget: binding.dispatchTarget,
                enabled: binding.enabled,
                risk: binding.risk,
                exposure: binding.exposure,
                visibility: binding.visibility,
                modelVisible: binding.modelVisible,
                canDispatch: binding.canDispatch,
                executionDisposition: binding.executionDisposition,
                callabilityReasons: binding.callabilityReasons,
                confidence: binding.confidence,
                verificationHint: binding.verificationHint,
                evidence: binding.evidence
            )
        }
    }

    private func makeProjectionPolicy(
        platformProfile: AXPlatformProfileDTO,
        rawCapture: AXRawCaptureResult,
        includeMenuBar: Bool,
        effectiveMenuMode: AXMenuMode,
        activeMenuTopLevelTitle: String?
    ) -> AXProjectionPolicy {
        let hasWebContent = rawCapture.nodes.contains(where: { $0.role == "AXWebArea" })

        if platformProfile.isChromiumLike || hasWebContent {
            return .webElectronRich(
                includeMenuBar: includeMenuBar,
                menuMode: effectiveMenuMode,
                activeMenuTopLevelTitle: activeMenuTopLevelTitle
            )
        }

        return .compactNative(
            includeMenuBar: includeMenuBar,
            menuMode: effectiveMenuMode,
            activeMenuTopLevelTitle: activeMenuTopLevelTitle
        )
    }

    private func effectiveMenuMode(includeMenuBar: Bool, explicitMenuMode: AXMenuMode?) -> AXMenuMode {
        if let explicitMenuMode {
            return explicitMenuMode
        }
        return includeMenuBar ? .fullMenuTraversal : .none
    }

    private func prepareReplayFixture(_ fixture: StatePipelineFixture) -> ReplayFixturePreparation {
        let menuPresentation = fixture.menuPresentation
        let effectiveMenuMode = effectiveMenuMode(
            includeMenuBar: fixture.includeMenuBar,
            explicitMenuMode: fixture.menuMode
        )
        let narrowedRootIndices = replayRootIndices(
            rawCapture: fixture.rawCapture,
            effectiveMenuMode: effectiveMenuMode,
            menuPresentation: menuPresentation
        )
        let replayRawCapture = AXRawCaptureResult(
            rootIndices: narrowedRootIndices,
            nodes: fixture.rawCapture.nodes,
            focusedCanonicalIndex: fixture.rawCapture.focusedCanonicalIndex,
            focusSelection: fixture.rawCapture.focusSelection,
            truncated: fixture.rawCapture.truncated
        )

        var notes: [String] = []
        if effectiveMenuMode == .openMenuOnly,
           narrowedRootIndices != fixture.rawCapture.rootIndices,
           let title = menuPresentation?.activeTopLevelTitle {
            notes.append("Replay roots were narrowed to the active menu branch \(title) so the archived fixture matches the current menu-surface architecture.")
        }

        return ReplayFixturePreparation(
            rawCapture: replayRawCapture,
            effectiveMenuMode: effectiveMenuMode,
            menuPresentation: menuPresentation,
            notes: notes
        )
    }

    private func replayRootIndices(
        rawCapture: AXRawCaptureResult,
        effectiveMenuMode: AXMenuMode,
        menuPresentation: AXMenuPresentationDTO?
    ) -> [Int] {
        guard effectiveMenuMode == .openMenuOnly,
              let activeTopLevelTitle = menuPresentation?.activeTopLevelTitle,
              let menuBarItemIndex = rawCapture.nodes.first(where: { node in
                  node.role == String(kAXMenuBarItemRole) &&
                      normalizedMenuTitle(node.title) == normalizedMenuTitle(activeTopLevelTitle)
              })?.index else {
            return rawCapture.rootIndices
        }

        return [menuBarItemIndex]
    }

    private func normalizedMenuTitle(_ raw: String?) -> String {
        ProjectionTextSupport.cleaned(raw)?
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression) ?? ""
    }

    private func sanitizedFixtureNotes(_ notes: [String]) -> [String] {
        let sanitized = notes.map { note -> String in
            if note.contains("V2 pipeline stages:") {
                return "Fixture replay through state capture pipeline."
            }
            if note.contains("V2 projection policy") {
                return note.replacingOccurrences(
                    of: "V2 projection policy",
                    with: "projection policy"
                )
            }
            return note
        }

        var seen = Set<String>()
        return sanitized.filter { seen.insert($0).inserted }
    }
}

private struct ReplayFixturePreparation {
    let rawCapture: AXRawCaptureResult
    let effectiveMenuMode: AXMenuMode
    let menuPresentation: AXMenuPresentationDTO?
    let notes: [String]
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
