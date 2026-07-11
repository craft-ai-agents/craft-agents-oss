import Foundation

/// Mirrors the MVP-relevant fields of `Session` in
/// `packages/shared/src/protocol/dto.ts`.
public struct Session: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let workspaceId: String
    public let workspaceName: String
    public var name: String?
    public var preview: String?
    public var lastMessageAt: Double
    public var isProcessing: Bool
    public var isFlagged: Bool?
    public var permissionMode: String?
    public var sessionStatus: String?
    public var labels: [String]?
    public var hasUnread: Bool?
    public var model: String?
    public var messageCount: Int?
}
