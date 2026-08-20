// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Organization.swift
import Foundation

/// Organization channels: unread summary, statuses, and labels. Mirrors the
/// handlers in `packages/server-core/src/handlers/rpc/{sessions,statuses,labels}.ts`.
extension RPCClient {
    /// `sessions:getUnreadSummary()` — unread counts across workspaces.
    public func getUnreadSummary() async throws -> UnreadSummary {
        try await call(RPCChannels.Sessions.getUnreadSummary)
    }

    /// `sessions:markAllRead(workspaceId)`.
    public func markAllRead(workspaceId: String) async throws {
        try await callVoid(RPCChannels.Sessions.markAllRead, args: [.string(workspaceId)])
    }

    /// `statuses:list(workspaceId)`.
    public func listStatuses(workspaceId: String) async throws -> [WorkspaceStatus] {
        try await call(RPCChannels.Statuses.list, args: [.string(workspaceId)])
    }

    /// `labels:list(workspaceId)` — returns the workspace label tree (root list).
    public func listLabels(workspaceId: String) async throws -> [WorkspaceLabel] {
        let config: WorkspaceLabelConfig = try await call(RPCChannels.Labels.list, args: [.string(workspaceId)])
        return config.labels ?? []
    }

    /// `labels:create(workspaceId, input)`.
    @discardableResult
    public func createLabel(workspaceId: String, input: CreateLabelInput) async throws -> WorkspaceLabel {
        let payload = try encodeAsJSONValue(input)
        return try await call(RPCChannels.Labels.create, args: [.string(workspaceId), payload])
    }

    /// `labels:delete(workspaceId, labelId)`.
    public func deleteLabel(workspaceId: String, labelId: String) async throws {
        try await callVoid(RPCChannels.Labels.delete, args: [.string(workspaceId), .string(labelId)])
    }
}
