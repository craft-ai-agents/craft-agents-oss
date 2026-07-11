import Foundation

/// Mirrors `PermissionRequestType`/`PermissionRequest` in
/// `packages/core/src/types/message.ts`.
public enum PermissionRequestType: String, Codable, Sendable {
    case bash
    case fileWrite = "file_write"
    case mcpMutation = "mcp_mutation"
    case apiMutation = "api_mutation"
    case adminApproval = "admin_approval"
}

public struct PermissionRequest: Codable, Equatable, Sendable {
    public let requestId: String
    public let toolName: String
    public var command: String?
    public let description: String
    public var type: PermissionRequestType?
    public var appName: String?
    public var reason: String?
    public var impact: String?
    public var requiresSystemPrompt: Bool?
    public var rememberForMinutes: Int?
}

extension PermissionRequest: Identifiable {
    public var id: String { requestId }
}
