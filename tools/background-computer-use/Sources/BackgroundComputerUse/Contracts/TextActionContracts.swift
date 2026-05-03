import Foundation

public enum ActionClassificationDTO: String, Encodable, Sendable {
    case success
    case unsupported
    case effectNotVerified = "effect_not_verified"
    case verifierAmbiguous = "verifier_ambiguous"
}

public enum ActionFailureDomainDTO: String, Encodable, Sendable {
    case targeting
    case unsupported
    case coercion
    case transport
    case verification
    case appSpecificSemantics = "app_specific_semantics"
}

public enum TypeTextFocusAssistModeDTO: String, Decodable, Encodable, Sendable {
    case none
    case focus
    case focusAndCaretEnd = "focus_and_caret_end"
}

public struct AXActionTargetSnapshotDTO: Encodable, Sendable {
    public let displayIndex: Int?
    public let projectedIndex: Int
    public let primaryCanonicalIndex: Int
    public let canonicalIndices: [Int]
    public let displayRole: String
    public let rawRole: String?
    public let rawSubrole: String?
    public let title: String?
    public let description: String?
    public let identifier: String?
    public let placeholder: String?
    public let url: String?
    public let nodeID: String?
    public let refetchFingerprint: String?
    public let projectedValueKind: String?
    public let projectedValuePreview: String?
    public let projectedValueLength: Int?
    public let projectedValueTruncated: Bool
    public let isValueSettable: Bool?
    public let supportsValueSet: Bool?
    public let isTextEntry: Bool?
    public let isFocused: Bool
    public let isSelected: Bool
    public let parameterizedAttributes: [String]
    public let frameAppKit: RectDTO?
    public let activationPointAppKit: PointDTO?
    public let suggestedInteractionPointAppKit: PointDTO?
}

public struct ActionCursorTargetResponseDTO: Encodable, Sendable {
    public let session: CursorResponseDTO
    public let targetPointAppKit: PointDTO?
    public let targetPointSource: String?
    public let moved: Bool
    public let moveDurationMs: Double?
    public let movement: String
    public let warnings: [String]
}

public struct SetValueRequestedValueDTO: Encodable, Sendable {
    public let original: String
    public let coercedKind: String?
    public let coercedPreview: String?
}

public struct SetValueObservedValueDTO: Encodable, Sendable {
    public let kind: String?
    public let preview: String?
    public let stringValue: String?
    public let boolValue: Bool?
    public let integerValue: Int?
    public let doubleValue: Double?
    public let truncated: Bool
}

public struct SetValueVerificationEvidenceDTO: Encodable, Sendable {
    public let beforeLiveValue: SetValueObservedValueDTO?
    public let afterSameElementValue: SetValueObservedValueDTO?
    public let afterResolvedLiveValue: SetValueObservedValueDTO?
    public let afterProjectedValue: SetValueObservedValueDTO?
    public let exactValueMatch: Bool
    public let exactValueMatchSource: String?
    public let targetRelocated: Bool
    public let refreshedTargetMatchStrategy: String?
    public let beforeFocusedNodeID: String?
    public let afterFocusedNodeID: String?
    public let beforeTargetFocused: Bool
    public let afterTargetFocused: Bool?
    public let beforeTargetSelected: Bool
    public let afterTargetSelected: Bool?
    public let renderedTextChanged: Bool
    public let renderedTextChangedBeyondTargetValue: Bool
    public let verificationNotes: [String]
}

public struct SetValueResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let classification: ActionClassificationDTO
    public let failureDomain: ActionFailureDomainDTO?
    public let summary: String
    public let window: ResolvedWindowDTO?
    public let target: AXActionTargetSnapshotDTO?
    public let requestedValue: SetValueRequestedValueDTO
    public let rawAXStatus: String?
    public let writePrimitive: String?
    public let semanticAppropriate: Bool?
    public let semanticReasons: [String]
    public let liveElementResolution: String?
    public let preStateToken: String?
    public let postStateToken: String?
    public let cursor: ActionCursorTargetResponseDTO
    public let warnings: [String]
    public let notes: [String]
    public let verification: SetValueVerificationEvidenceDTO?
}

public struct TypeTextSelectionRangeDTO: Encodable, Equatable, Sendable {
    public let location: Int
    public let length: Int
}

public struct TypeTextObservedStateDTO: Encodable, Sendable {
    public let valuePreview: String?
    public let valueString: String?
    public let length: Int?
    public let truncated: Bool
    public let selectedTextRange: TypeTextSelectionRangeDTO?
    public let isFocused: Bool?
}

public struct TypeTextExpectedOutcomeDTO: Encodable, Sendable {
    public let valuePreview: String?
    public let valueString: String?
    public let selectionRange: TypeTextSelectionRangeDTO?
}

public struct TypeTextVerificationEvidenceDTO: Encodable, Sendable {
    public let preparedBeforeLiveState: TypeTextObservedStateDTO?
    public let expectedOutcome: TypeTextExpectedOutcomeDTO?
    public let afterSameElementState: TypeTextObservedStateDTO?
    public let afterResolvedLiveState: TypeTextObservedStateDTO?
    public let afterProjectedState: TypeTextObservedStateDTO?
    public let exactValueMatch: Bool
    public let exactValueMatchSource: String?
    public let exactSelectionMatch: Bool?
    public let exactSelectionMatchSource: String?
    public let targetRelocated: Bool
    public let refreshedTargetMatchStrategy: String?
    public let beforeFocusedNodeID: String?
    public let afterFocusedNodeID: String?
    public let beforeTargetFocused: Bool
    public let afterTargetFocused: Bool?
    public let renderedTextChanged: Bool
    public let verificationNotes: [String]
}

public struct TypeTextResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let classification: ActionClassificationDTO
    public let failureDomain: ActionFailureDomainDTO?
    public let summary: String
    public let window: ResolvedWindowDTO?
    public let target: AXActionTargetSnapshotDTO?
    public let text: String
    public let focusAssistMode: TypeTextFocusAssistModeDTO
    public let dispatchPrimitive: String?
    public let dispatchSucceeded: Bool?
    public let semanticAppropriate: Bool?
    public let semanticReasons: [String]
    public let liveElementResolution: String?
    public let preStateToken: String?
    public let postStateToken: String?
    public let cursor: ActionCursorTargetResponseDTO
    public let warnings: [String]
    public let notes: [String]
    public let verification: TypeTextVerificationEvidenceDTO?
}
