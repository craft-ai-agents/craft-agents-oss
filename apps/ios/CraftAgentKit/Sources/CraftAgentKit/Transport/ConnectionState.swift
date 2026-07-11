// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Transport/ConnectionState.swift
import Foundation

/// Mirrors `TransportConnectionStatus`/`TransportConnectionErrorKind` in
/// `packages/server-core/src/transport/client.ts`.
public enum ConnectionErrorKind: Equatable, Sendable {
    case auth
    case protocolVersion
    case timeout
    case network
    case server
    case unknown
}

public struct ConnectionError: Equatable, Sendable {
    public let kind: ConnectionErrorKind
    public let message: String
}

public enum ConnectionState: Equatable, Sendable {
    case idle
    case connecting
    case connected
    case reconnecting(attempt: Int)
    case disconnected
    case failed(ConnectionError)
}

/// Delegate callbacks fired from the transport's background receive loop.
/// Implementations MUST hop back to the main actor themselves before
/// touching UI state — the transport does not assume a specific executor.
public protocol RPCTransportDelegate: AnyObject, Sendable {
    func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async
    func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async
}
