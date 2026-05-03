import Foundation

public enum RouteExecutionLaneDTO: String, Encodable, Sendable {
    case sharedRead = "shared_read"
    case windowRead = "window_read"
    case windowWrite = "window_write"
}

public enum BackgroundBehaviorDTO: String, Encodable, Sendable {
    case backgroundRequired = "background_required"
    case backgroundPreferred = "background_preferred"
    case foregroundAllowed = "foreground_allowed"
    case foregroundRequired = "foreground_required"
}

public enum FocusStealPolicyDTO: String, Encodable, Sendable {
    case forbidden
    case discouraged
    case allowed
    case required
}

public enum MainThreadBehaviorDTO: String, Encodable, Sendable {
    case avoid = "avoid_main_thread"
    case allowed = "main_thread_allowed"
    case required = "main_thread_required"
}

public enum RouteImplementationStatusDTO: String, Encodable, Sendable {
    case implemented
}

public struct RouteExecutionPolicyDTO: Encodable, Sendable {
    public let lane: RouteExecutionLaneDTO
    public let backgroundBehavior: BackgroundBehaviorDTO
    public let focusStealPolicy: FocusStealPolicyDTO
    public let mainThreadBehavior: MainThreadBehaviorDTO
    public let readActRead: Bool
    public let allowsConcurrentClients: Bool
    public let notes: [String]
}

public struct RouteDescriptorDTO: Encodable, Sendable {
    public let id: String
    public let method: String
    public let path: String
    public let category: String
    public let summary: String
    public let execution: RouteExecutionPolicyDTO
    public let implementationStatus: RouteImplementationStatusDTO
    public let notes: [String]
}

public enum RouteTargetKindDTO: String, Encodable, Sendable {
    case shared
    case appQuery = "app_query"
    case window
}

public struct RouteTargetSummaryDTO: Encodable, Sendable {
    public let kind: RouteTargetKindDTO
    public let appQuery: String?
    public let windowID: String?

    static let shared = RouteTargetSummaryDTO(kind: .shared, appQuery: nil, windowID: nil)
}

public struct RouteExecutionReceiptDTO: Encodable, Sendable {
    public let laneKey: String
    public let lane: RouteExecutionLaneDTO
    public let backgroundBehavior: BackgroundBehaviorDTO
    public let focusStealPolicy: FocusStealPolicyDTO
    public let mainThreadBehavior: MainThreadBehaviorDTO
    public let coordinatedAt: String
    public let executedOnMainThread: Bool
    public let readActRead: Bool
}
