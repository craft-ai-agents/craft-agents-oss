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

    public init(
        id: String,
        workspaceId: String,
        workspaceName: String,
        name: String? = nil,
        preview: String? = nil,
        lastMessageAt: Double,
        isProcessing: Bool,
        isFlagged: Bool? = nil,
        permissionMode: String? = nil,
        sessionStatus: String? = nil,
        labels: [String]? = nil,
        hasUnread: Bool? = nil,
        model: String? = nil,
        messageCount: Int? = nil
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.workspaceName = workspaceName
        self.name = name
        self.preview = preview
        self.lastMessageAt = lastMessageAt
        self.isProcessing = isProcessing
        self.isFlagged = isFlagged
        self.permissionMode = permissionMode
        self.sessionStatus = sessionStatus
        self.labels = labels
        self.hasUnread = hasUnread
        self.model = model
        self.messageCount = messageCount
    }
}
