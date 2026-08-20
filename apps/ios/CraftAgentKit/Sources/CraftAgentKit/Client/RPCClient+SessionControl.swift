// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+SessionControl.swift
import Foundation

/// Session lifecycle and control channels: delete, cancel, kill shell, the
/// consolidated `sessions:command` operations, credential responses, model
/// selection, and permission-mode state. Mirrors the handlers in
/// `packages/server-core/src/handlers/rpc/sessions.ts` and `settings.ts`.
extension RPCClient {
    // MARK: Lifecycle

    /// `sessions:delete(sessionId)`.
    public func deleteSession(sessionId: String) async throws {
        try await callVoid(RPCChannels.Sessions.delete, args: [.string(sessionId)])
    }

    /// `sessions:cancel(sessionId, silent?)` — stops in-flight generation.
    public func cancelProcessing(sessionId: String, silent: Bool = false) async throws {
        try await callVoid(RPCChannels.Sessions.cancel, args: [.string(sessionId), .bool(silent)])
    }

    /// `sessions:killShell(sessionId, shellId)` — kills a background shell.
    public func killShell(sessionId: String, shellId: String) async throws {
        try await callVoid(RPCChannels.Sessions.killShell, args: [.string(sessionId), .string(shellId)])
    }

    // MARK: Consolidated `sessions:command`

    /// Sends one `SessionCommand` object `{ type, ... }` for `sessionId`.
    private func sendCommand(_ sessionId: String, _ command: JSONValue) async throws {
        try await callVoid(RPCChannels.Sessions.command, args: [.string(sessionId), command])
    }

    public func renameSession(sessionId: String, name: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("rename"), "name": .string(name)]))
    }

    public func archiveSession(sessionId: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("archive")]))
    }

    public func unarchiveSession(sessionId: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("unarchive")]))
    }

    public func flagSession(sessionId: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("flag")]))
    }

    public func unflagSession(sessionId: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("unflag")]))
    }

    public func markSessionRead(sessionId: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("markRead")]))
    }

    public func markSessionUnread(sessionId: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("markUnread")]))
    }

    public func setSessionStatus(sessionId: String, status: String) async throws {
        try await sendCommand(sessionId, .object(["type": .string("setSessionStatus"), "state": .string(status)]))
    }

    public func setSessionPermissionMode(sessionId: String, mode: PermissionMode) async throws {
        try await sendCommand(sessionId, .object(["type": .string("setPermissionMode"), "mode": .string(mode.rawValue)]))
    }

    public func setSessionLabels(sessionId: String, labels: [String]) async throws {
        try await sendCommand(sessionId, .object([
            "type": .string("setLabels"),
            "labels": .array(labels.map { .string($0) }),
        ]))
    }

    // MARK: Credentials

    /// `sessions:respondToCredential(sessionId, requestId, response)`.
    public func respondToCredential(sessionId: String, requestId: String, response: CredentialResponse) async throws {
        let payload = try encodeAsJSONValue(response)
        try await callVoid(
            RPCChannels.Sessions.respondToCredential,
            args: [.string(sessionId), .string(requestId), payload]
        )
    }

    // MARK: Model

    /// `session:getModel(sessionId, workspaceId)` — returns the effective model
    /// id, or `nil` when the session uses the workspace/app default.
    public func getModel(sessionId: String, workspaceId: String) async throws -> String? {
        try await callOptional(RPCChannels.Sessions.getModel, args: [.string(sessionId), .string(workspaceId)])
    }

    /// `session:setModel(sessionId, workspaceId, model?, connection?)`.
    public func setModel(sessionId: String, workspaceId: String, model: String?, connection: String? = nil) async throws {
        try await callVoid(RPCChannels.Sessions.setModel, args: [
            .string(sessionId),
            .string(workspaceId),
            model.map { JSONValue.string($0) } ?? .null,
            connection.map { JSONValue.string($0) } ?? .null,
        ])
    }

    // MARK: Permission-mode state

    /// `sessions:getPermissionModeState(sessionId)` — `nil` if session is gone.
    public func getPermissionModeState(sessionId: String) async throws -> PermissionModeState? {
        try await callOptional(RPCChannels.Sessions.getPermissionModeState, args: [.string(sessionId)])
    }
}
