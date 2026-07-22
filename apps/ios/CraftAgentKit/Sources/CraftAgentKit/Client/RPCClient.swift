// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient.swift
import Foundation

/// Typed façade over `RPCTransport`. ViewModels depend on this, never on
/// `RPCTransport` directly, so the wire format stays fully encapsulated.
public actor RPCClient {
    public let transport: RPCTransport

    public init(transport: RPCTransport) {
        self.transport = transport
    }

    public func connect(serverURL: URL, token: String, workspaceId: String?) async throws {
        try await transport.connect(serverURL: serverURL, token: token, workspaceId: workspaceId)
    }

    public func disconnect() async {
        await transport.disconnect()
    }

    /// Internal helper: send a request and decode its result as `T`.
    func call<T: Decodable>(_ channel: String, args: [JSONValue] = []) async throws -> T {
        let result = try await transport.request(channel: channel, args: args)
        return try result.decoded()
    }

    /// Like `call`, but maps a `null` result to `nil` instead of failing to
    /// decode. Used by channels that legitimately return null (e.g.
    /// `session:getModel`, `sessions:getPermissionModeState`).
    func callOptional<T: Decodable>(_ channel: String, args: [JSONValue] = []) async throws -> T? {
        let result = try await transport.request(channel: channel, args: args)
        if case .null = result { return nil }
        return try result.decoded()
    }

    /// Internal helper for requests whose result the caller does not need.
    func callVoid(_ channel: String, args: [JSONValue] = []) async throws {
        _ = try await transport.request(channel: channel, args: args)
    }
}
