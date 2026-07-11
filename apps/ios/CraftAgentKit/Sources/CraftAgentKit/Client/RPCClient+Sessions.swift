// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Sessions.swift
import Foundation

extension RPCClient {
    /// `sessions:get` — no args; the server scopes results to the workspace
    /// sent on the handshake (`packages/server-core/src/handlers/rpc/sessions.ts:138`).
    public func listSessions() async throws -> [Session] {
        try await call(RPCChannels.Sessions.get)
    }

    /// `sessions:getMessages` — takes `sessionId`.
    public func getMessages(sessionId: String) async throws -> [ChatMessage] {
        try await call(RPCChannels.Sessions.getMessages, args: [.string(sessionId)])
    }

    /// `sessions:sendMessage(sessionId, message, attachments?, storedAttachments?, options?)`.
    /// The iOS client never populates `storedAttachments` (a desktop-only
    /// optimization for referencing already-on-disk files), so that
    /// positional arg is always `.null`.
    public func sendMessage(sessionId: String, text: String, attachments: [FileAttachment] = []) async throws {
        let attachmentsValue: JSONValue = attachments.isEmpty
            ? .null
            : try encodeAsJSONValue(attachments)
        try await callVoid(
            RPCChannels.Sessions.sendMessage,
            args: [.string(sessionId), .string(text), attachmentsValue, .null, .null]
        )
    }

    /// `sessions:create(workspaceId, options?)`. MVP never passes `options`.
    public func createSession(workspaceId: String) async throws -> Session {
        try await call(RPCChannels.Sessions.create, args: [.string(workspaceId), .null])
    }

    /// `sessions:respondToPermission(sessionId, requestId, allowed, alwaysAllow)`.
    public func respondToPermission(sessionId: String, requestId: String, allowed: Bool, alwaysAllow: Bool) async throws {
        try await callVoid(
            RPCChannels.Sessions.respondToPermission,
            args: [.string(sessionId), .string(requestId), .bool(allowed), .bool(alwaysAllow)]
        )
    }
}

extension RPCClient {
    /// `server:getWorkspaces` — no args.
    public func listWorkspaces() async throws -> [Workspace] {
        try await call(RPCChannels.Server.getWorkspaces)
    }
}

/// Encodes any `Encodable` value into a `JSONValue` by round-tripping
/// through `Data` — the inverse of `JSONValue.decoded()`.
func encodeAsJSONValue<T: Encodable>(_ value: T) throws -> JSONValue {
    let data = try JSONEncoder().encode(value)
    return try JSONDecoder().decode(JSONValue.self, from: data)
}
