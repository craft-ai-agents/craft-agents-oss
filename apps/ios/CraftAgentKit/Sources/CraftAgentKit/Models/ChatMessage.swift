import Foundation

/// Mirrors `MessageRole` in `packages/core/src/types/message.ts`.
public enum MessageRole: String, Codable, Sendable {
    case user
    case assistant
    case tool
    case error
    case status
    case info
    case warning
    case plan
    case authRequest = "auth-request"
}

/// Mirrors the MVP-relevant fields of `Message` in
/// `packages/core/src/types/message.ts`.
public struct ChatMessage: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public var role: MessageRole
    public var content: String
    public var timestamp: Double
    public var toolName: String?
    public var toolUseId: String?
    public var toolInput: [String: JSONValue]?
    public var toolResult: String?
    public var toolStatus: String?
    public var toolDuration: Double?
    public var parentToolUseId: String?
    public var isError: Bool?
    public var isStreaming: Bool?
}
