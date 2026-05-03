import Foundation

public enum SecondaryActionBindingSourceDTO: String, Encodable, Sendable {
    case directPublicAction = "direct_public_action"
    case foldedAffordance = "folded_affordance"
    case inferredAffordance = "inferred_affordance"
    case stateBinding = "state_binding"
}

public enum SecondaryActionDispatchMethodDTO: String, Encodable, Sendable {
    case axPerformAction = "AXPerformAction"
}

public enum SecondaryActionTransportDispositionDTO: String, Encodable, Sendable {
    case accepted
    case returnedError = "returned_error"
}

public enum SecondaryActionSemanticKindDTO: String, Encodable, Sendable {
    case stateToggle = "state_toggle"
    case cancel
    case close
    case openRepresentedResource = "open_represented_resource"
    case genericAXAction = "generic_ax_action"
}

public enum SecondaryActionRouteDTO: String, Encodable, Sendable {
    case directPublicAction = "direct_public_action"
    case foldedAffordance = "folded_affordance"
    case inferredAffordance = "inferred_affordance"
    case stateBinding = "state_binding"
}

public enum SecondaryActionOutcomeStatusDTO: String, Encodable, Sendable {
    case effectVerified = "effect_verified"
    case acceptedWithoutVerifier = "accepted_without_verifier"
    case noEffectVerified = "no_effect_verified"
    case labelNotExposed = "label_not_exposed"
    case bindingUnavailable = "binding_unavailable"
    case targetUnresolved = "target_unresolved"
    case verifierAmbiguous = "verifier_ambiguous"
}

public enum SecondaryActionOutcomeReasonDTO: String, Encodable, Sendable {
    case expectedEffectObserved = "expected_effect_observed"
    case axAcceptedNoVerifier = "ax_accepted_no_verifier"
    case rawTransportErrorNoEffect = "raw_transport_error_no_effect"
    case transportAcceptedNoEffect = "transport_accepted_no_effect"
    case labelNotExposed = "label_not_exposed"
    case bindingNotFound = "binding_not_found"
    case dispatchTargetNotFound = "dispatch_target_not_found"
    case liveTargetUnresolved = "live_target_unresolved"
    case postStateUnavailable = "post_state_unavailable"
}

public struct SecondaryActionRequestedDTO: Encodable, Sendable {
    public let target: ActionTargetRequestDTO
    public let label: String
    public let actionID: String?
}

public struct SecondaryActionBindingDTO: Encodable, Sendable {
    public let actionID: String?
    public let label: String
    public let source: SecondaryActionBindingSourceDTO
    public let dispatchMethod: SecondaryActionDispatchMethodDTO
    public let rawName: String
    public let dispatchCanonicalIndex: Int
    public let dispatchNodeID: String?
    public let dispatchRole: String?
    public let dispatchSubrole: String?
    public let dispatchTitle: String?
    public let dispatchURL: String?
    public let risk: String?
    public let exposure: String?
    public let executionDisposition: String?
    public let evidence: [String]
}

public struct SecondaryActionTransportAttemptDTO: Encodable, Sendable {
    public let dispatchMethod: SecondaryActionDispatchMethodDTO
    public let rawName: String
    public let rawAXStatus: String
    public let transportDisposition: SecondaryActionTransportDispositionDTO
    public let transportSuccess: Bool
    public let liveElementResolution: String?
    public let notes: [String]
}

public struct SecondaryActionActionDTO: Encodable, Sendable {
    public let semanticKind: SecondaryActionSemanticKindDTO
    public let route: SecondaryActionRouteDTO
    public let dispatchPrimitive: String?
    public let dispatchSucceeded: Bool?
    public let rawAXStatus: String?
    public let detail: String
}

public struct SecondaryActionOutcomeDTO: Encodable, Sendable {
    public let status: SecondaryActionOutcomeStatusDTO
    public let reason: SecondaryActionOutcomeReasonDTO
    public let detail: String
    public let screenshotRecommended: Bool
}

public struct SecondaryActionVerificationDTO: Encodable, Sendable {
    public let beforeTargetSecondaryActions: [String]
    public let afterTargetSecondaryActions: [String]?
    public let expectedAfterSecondaryAction: String?
    public let targetRelocated: Bool
    public let refreshedTargetMatchStrategy: String?
    public let renderedTextChanged: Bool?
    public let menuVisibleBefore: Bool?
    public let menuVisibleAfter: Bool?
    public let observedEffect: Bool
    public let evidence: [String]
}

public struct PerformSecondaryActionResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let classification: ActionClassificationDTO
    public let failureDomain: ActionFailureDomainDTO?
    public let summary: String
    public let window: ResolvedWindowDTO?
    public let requestedAction: SecondaryActionRequestedDTO
    public let action: SecondaryActionActionDTO?
    public let outcome: SecondaryActionOutcomeDTO
    public let target: AXActionTargetSnapshotDTO?
    public let dispatchTarget: AXActionTargetSnapshotDTO?
    public let binding: SecondaryActionBindingDTO?
    public let transports: [SecondaryActionTransportAttemptDTO]
    public let preStateToken: String?
    public let postStateToken: String?
    public let postState: AXPipelineV2Response?
    public let cursor: ActionCursorTargetResponseDTO
    public let warnings: [String]
    public let notes: [String]
    public let verification: SecondaryActionVerificationDTO?
}
