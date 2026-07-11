// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Sessions.swift
import Foundation

extension RPCClient {
    /// `sessions:get` — no args; the server scopes results to the workspace
    /// sent on the handshake (`packages/server-core/src/handlers/rpc/sessions.ts:138`).
    public func listSessions() async throws -> [Session] {
        try await call(RPCChannels.Sessions.get)
    }

    /// `sessions:getMessages` — takes `sessionId`.
    ///
    /// The server returns the **full Session object with an embedded `messages`
    /// array** (see `packages/server-core/src/handlers/rpc/sessions.ts` — "Get a
    /// single session with messages"), not a bare array. Decoding the raw result
    /// as `[ChatMessage]` therefore fails with
    /// `typeMismatch(Array, found a dictionary instead)`, so we unwrap the
    /// envelope here and extract `.messages`.
    public func getMessages(sessionId: String) async throws -> [ChatMessage] {
        let result = try await transport.request(
            channel: RPCChannels.Sessions.getMessages,
            args: [.string(sessionId)]
        )
        return try RPCClient.decodeMessagesResult(result)
    }

    /// Extracts the message list from a `sessions:getMessages` result. Exposed as
    /// an internal static helper so it can be unit-tested without a live socket.
    /// Treats a `null` result (session not found) as an empty conversation.
    static func decodeMessagesResult(_ result: JSONValue) throws -> [ChatMessage] {
        if case .null = result { return [] }
        let envelope: SessionMessagesEnvelope = try result.decoded()
        return envelope.messages ?? []
    }

    /// Minimal decodable view over the server's Session DTO — we only need the
    /// embedded `messages` array. Extra Session fields are ignored.
    private struct SessionMessagesEnvelope: Decodable {
        let messages: [ChatMessage]?
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
