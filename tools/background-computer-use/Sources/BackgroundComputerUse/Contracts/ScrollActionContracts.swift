import Foundation

public enum ScrollActionClassificationDTO: String, Encodable, Sendable {
    case success
    case boundary
    case unsupported
    case unresolved
    case verifierAmbiguous = "verifier_ambiguous"
}

public enum ScrollIssueBucketDTO: String, Encodable, Sendable {
    case none
    case targeting
    case transport
    case verification
    case opacity
}

public enum ScrollTransportModeDTO: String, Encodable, Sendable {
    case backgroundSafeAXLadder = "background_safe_ax_ladder"
    case postToPIDPaging = "post_to_pid_paging"
    case targetedScrollWheelPostToPID = "targeted_scroll_wheel_post_to_pid"
}

public enum ScrollStrategyDTO: String, Encodable, Sendable {
    case axScrollToShowDescendant = "ax_scroll_to_show_descendant"
    case scrollbarValue = "scrollbar_value"
    case axPageAction = "ax_page_action"
    case postToPIDPaging = "post_to_pid_paging"
    case targetedScrollWheelPostToPID = "targeted_scroll_wheel_post_to_pid"
}

public struct ScrollCandidateDTO: Encodable, Sendable {
    public let rank: Int
    public let score: Int
    public let reasons: [String]
    public let target: AXActionTargetSnapshotDTO
}

public struct ScrollTransportAttemptDTO: Encodable, Sendable {
    public let mode: ScrollTransportModeDTO
    public let strategy: ScrollStrategyDTO
    public let candidateRank: Int
    public let actedOnTarget: AXActionTargetSnapshotDTO
    public let liveElementResolution: String?
    public let rawStatus: String
    public let transportSuccess: Bool
    public let didDispatch: Bool
    public let boundaryReason: String?
    public let notes: [String]
}

public struct ScrollVerificationReadDTO: Encodable, Sendable {
    public let readOrdinal: Int
    public let delayMilliseconds: Int
    public let stateToken: String?
    public let observedDirection: String
    public let targetedScrollBarDelta: Double?
    public let visibleCharacterRangeDelta: Int?
    public let visibleTextChanged: Bool
    public let visibleLabelSetChanged: Bool
    public let sameLabelFrameShift: Double?
    public let sameLabelFrameDirectionMatched: Bool
    public let targetRegionChangeRatio: Double?
    public let fullWindowChangeRatio: Double?
    public let directTargetRegionChangeRatio: Double?
    public let directFullWindowChangeRatio: Double?
    public let wrongPaneMovementLikely: Bool
    public let strongEvidence: Bool
    public let evidence: [String]
}

public struct ScrollVerificationSummaryDTO: Encodable, Sendable {
    public let classification: ScrollActionClassificationDTO
    public let issueBucket: ScrollIssueBucketDTO
    public let matchedOnReadOrdinal: Int?
    public let finalObservedDirection: String
    public let evidence: [String]
}

public struct ScrollResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let classification: ScrollActionClassificationDTO
    public let failureDomain: ActionFailureDomainDTO?
    public let issueBucket: ScrollIssueBucketDTO
    public let summary: String
    public let window: ResolvedWindowDTO?
    public let requestedTarget: AXActionTargetSnapshotDTO?
    public let chosenContainer: AXActionTargetSnapshotDTO?
    public let direction: ScrollDirectionDTO
    public let pages: Int
    public let winningMode: ScrollTransportModeDTO?
    public let winningStrategy: ScrollStrategyDTO?
    public let planCandidates: [ScrollCandidateDTO]
    public let transports: [ScrollTransportAttemptDTO]
    public let preStateToken: String?
    public let postStateToken: String?
    public let cursor: ActionCursorTargetResponseDTO
    public let frontmostBundleBefore: String?
    public let frontmostBundleBeforeDispatch: String?
    public let frontmostBundleAfter: String?
    public let warnings: [String]
    public let notes: [String]
    public let verification: ScrollVerificationSummaryDTO?
    public let verificationReads: [ScrollVerificationReadDTO]
}
