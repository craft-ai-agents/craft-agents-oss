import Foundation

public enum PressKeyIntentDTO: String, Encodable, Sendable {
    case openFindOrSearch = "open_find_or_search"
    case selectAll = "select_all"
    case rawKey = "raw_key"
}

public enum PressKeyRouteDTO: String, Encodable, Sendable {
    case semanticFocusExistingSearch = "semantic_focus_existing_search"
    case semanticOpenSearchInWindow = "semantic_open_search_in_window"
    case semanticSelectAllFocusedText = "semantic_select_all_focused_text"
    case nativeKeyDelivery = "native_key_delivery"
    case none
}

public struct PressKeyParsedKeyDTO: Encodable, Sendable {
    public let raw: String
    public let normalized: String
    public let key: String
    public let keyCode: Int
    public let modifiers: [String]
    public let intent: PressKeyIntentDTO
}

public struct PressKeyActionDTO: Encodable, Sendable {
    public let route: PressKeyRouteDTO
    public let transport: String
    public let dispatchPrimitive: String?
    public let nativeKeyDelivery: Bool
    public let dispatchSucceeded: Bool?
    public let rawStatus: String?
    public let detail: String
}

public struct PressKeySearchVerificationDTO: Encodable, Sendable {
    public let beforeSearchFieldCount: Int
    public let afterSearchFieldCount: Int
    public let focusedSearchFieldVerified: Bool
    public let targetWindowNumberBefore: Int?
    public let targetWindowNumberAfter: Int?
    public let targetWindowTitleBefore: String?
    public let targetWindowTitleAfter: String?
    public let frontmostBundleIDBefore: String?
    public let frontmostBundleIDAfter: String?
}

public struct PressKeySelectionVerificationDTO: Encodable, Sendable {
    public let beforeSelection: TypeTextSelectionRangeDTO?
    public let afterSelection: TypeTextSelectionRangeDTO?
    public let expectedSelection: TypeTextSelectionRangeDTO?
    public let exactSelectionMatch: Bool
}

public struct PressKeyVerificationEvidenceDTO: Encodable, Sendable {
    public let preStateToken: String?
    public let postStateToken: String?
    public let renderedTextChanged: Bool?
    public let focusedElementChanged: Bool?
    public let textStateChanged: Bool?
    public let selectionSummaryChanged: Bool?
    public let visualChangeRatio: Double?
    public let visualChanged: Bool?
    public let search: PressKeySearchVerificationDTO?
    public let selection: PressKeySelectionVerificationDTO?
    public let verificationNotes: [String]
}

public struct PressKeyResponse: Encodable, Sendable {
    public let contractVersion: String
    public let ok: Bool
    public let classification: ActionClassificationDTO
    public let failureDomain: ActionFailureDomainDTO?
    public let summary: String
    public let window: ResolvedWindowDTO?
    public let parsedKey: PressKeyParsedKeyDTO?
    public let action: PressKeyActionDTO?
    public let preStateToken: String?
    public let postStateToken: String?
    public let cursor: ActionCursorTargetResponseDTO
    public let warnings: [String]
    public let notes: [String]
    public let verification: PressKeyVerificationEvidenceDTO?
}
