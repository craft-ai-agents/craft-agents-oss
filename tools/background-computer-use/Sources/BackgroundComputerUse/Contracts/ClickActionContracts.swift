import Foundation

public enum ClickTargetKindDTO: String, Encodable, Sendable {
    case semanticTarget = "semantic_target"
    case coordinate
}

public enum ClickFinalRouteDTO: String, Encodable, Sendable {
    case coordinateXY = "coordinate_xy"
    case semanticAX = "semantic_ax"
    case axElementPointerXY = "ax_element_pointer_xy"
    case semanticAXThenRemainingXY = "semantic_ax_then_remaining_xy"
    case rejected
}

public enum ClickFallbackReasonDTO: String, Encodable, Sendable {
    case none
    case axCoordinateRequired = "ax_coordinate_required"
    case axMultiClickRequiresXY = "ax_multi_click_requires_xy"
    case axFirstClickUnverifiedUsingFullElementPointer = "ax_first_click_unverified_using_full_element_pointer"
    case missingStableAXCoordinate = "missing_stable_ax_coordinate"
    case unsupportedMouseButton = "unsupported_mouse_button"
    case invalidClickCount = "invalid_click_count"
    case invalidTarget = "invalid_target"
    case staleCoordinateGuard = "stale_coordinate_guard"
    case transportFailed = "transport_failed"
}

public enum ClickAXAttemptDTO: String, Encodable, Sendable {
    case exactPrimaryAXAction = "exact_primary_ax_action"
    case setContainerSelectedRows = "set_container_selected_rows"
    case setRowSelectedTrue = "set_row_selected_true"
    case safeUniqueDescendantRetarget = "safe_unique_descendant_retarget"
    case ambiguousDescendantClick = "ambiguous_descendant_click"
    case coordinateRequired = "coordinate_required"
    case unsupportedPrimaryClick = "unsupported_primary_click"
    case none
}

public enum ClickTransportRouteDTO: String, Encodable, Sendable {
    case axPerformAction = "ax_perform_action"
    case axSetSelectedRows = "ax_set_selected_rows"
    case axSetSelected = "ax_set_selected"
    case nativeBackgroundCoordinate = "native_background_coordinate"
}

public enum ClickModeDTO: String, Decodable, Encodable, Sendable {
    case single
    case double
}

public struct ClickRequestedTargetDTO: Encodable, Sendable {
    public let kind: ClickTargetKindDTO
    public let target: ActionTargetRequestDTO?
    public let x: Double?
    public let y: Double?
    public let coordinateSpace: CoordinateSpaceName?
}

public struct ClickCoordinateMappingDTO: Encodable, Sendable {
    public let inputPoint: PointDTO
    public let inputCoordinateSpace: CoordinateSpaceName
    public let modelPixelSize: PixelSize
    public let scaleToWindowLogical: Scale2D
    public let targetPointAppKit: PointDTO
    public let eventTapPointTopLeft: PointDTO
    public let targetPointSource: String
    public let warnings: [String]
}

public struct ClickTransportAttemptDTO: Encodable, Sendable {
    public let route: ClickTransportRouteDTO
    public let axAttempt: ClickAXAttemptDTO?
    public let dispatchPrimitive: String
    public let rawStatus: String?
    public let transportSuccess: Bool
    public let didDispatch: Bool
    public let clickCount: Int
    public let mouseButton: MouseButtonDTO
    public let targetPointAppKit: PointDTO?
    public let eventTapPointTopLeft: PointDTO?
    public let eventsPrepared: Int?
    public let targetPID: Int32?
    public let targetWindowNumber: Int?
    public let liveElementResolution: String?
    public let notes: [String]
}

public struct ClickRouteStepDTO: Encodable, Sendable {
    public let route: ClickFinalRouteDTO
    public let dispatchSuccess: Bool
    public let verificationSuccess: Bool
    public let intentSuccess: Bool
    public let note: String
}

public struct ClickVerificationEvidenceDTO: Encodable, Sendable {
    public let preStateToken: String?
    public let postStateToken: String?
    public let targetRelocated: Bool
    public let refreshedTargetMatchStrategy: String?
    public let beforeTargetSelected: Bool?
    public let afterTargetSelected: Bool?
    public let beforeTargetFocused: Bool?
    public let afterTargetFocused: Bool?
    public let beforeTargetValuePreview: String?
    public let afterTargetValuePreview: String?
    public let beforeFocusedNodeID: String?
    public let afterFocusedNodeID: String?
    public let renderedTextChanged: Bool?
    public let selectionSummaryChanged: Bool?
    public let focusedElementChanged: Bool?
    public let windowTitleChanged: Bool?
    public let targetStateChanged: Bool?
    public let foregroundPreserved: Bool?
    public let verificationNotes: [String]
}

public struct ClickResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let classification: ActionClassificationDTO
    public let failureDomain: ActionFailureDomainDTO?
    public let summary: String
    public let window: ResolvedWindowDTO?
    public let requestedTarget: ClickRequestedTargetDTO
    public let target: AXActionTargetSnapshotDTO?
    public let clickCount: Int?
    public let mouseButton: MouseButtonDTO?
    public let finalRoute: ClickFinalRouteDTO
    public let fallbackReason: ClickFallbackReasonDTO
    public let axAttempt: ClickAXAttemptDTO?
    public let coordinate: ClickCoordinateMappingDTO?
    public let transports: [ClickTransportAttemptDTO]
    public let routeSteps: [ClickRouteStepDTO]
    public let preStateToken: String?
    public let postStateToken: String?
    public let cursor: ActionCursorTargetResponseDTO
    public let frontmostBundleBefore: String?
    public let frontmostBundleBeforeDispatch: String?
    public let frontmostBundleAfter: String?
    public let warnings: [String]
    public let notes: [String]
    public let verification: ClickVerificationEvidenceDTO?
}
