import Foundation

/// Mirrors `MessageType` in `packages/shared/src/protocol/types.ts`.
public enum MessageType: String, Codable, Sendable {
    case handshake
    case handshakeAck = "handshake_ack"
    case request
    case response
    case event
    case error
    case sequenceAck = "sequence_ack"
}

/// Mirrors `MessageEnvelope` in `packages/shared/src/protocol/types.ts`.
/// Field names/casing match the wire format exactly (no snake_case translation
/// needed — the TS source already uses camelCase on the wire).
public struct MessageEnvelope: Codable, Equatable, Sendable {
    public var id: String
    public var type: MessageType
    public var channel: String?
    public var args: [JSONValue]?
    public var result: JSONValue?
    public var error: WireError?
    public var protocolVersion: String?
    public var workspaceId: String?
    public var token: String?
    public var clientId: String?
    public var serverId: String?
    public var webContentsId: Int?
    public var clientCapabilities: [String]?
    public var registeredChannels: [String]?
    public var seq: Int?
    public var lastSeq: Int?
    public var reconnectClientId: String?
    public var reconnected: Bool?
    public var stale: Bool?
    public var serverVersion: String?

    public init(
        id: String,
        type: MessageType,
        channel: String? = nil,
        args: [JSONValue]? = nil,
        result: JSONValue? = nil,
        error: WireError? = nil,
        protocolVersion: String? = nil,
        workspaceId: String? = nil,
        token: String? = nil,
        clientId: String? = nil,
        serverId: String? = nil,
        webContentsId: Int? = nil,
        clientCapabilities: [String]? = nil,
        registeredChannels: [String]? = nil,
        seq: Int? = nil,
        lastSeq: Int? = nil,
        reconnectClientId: String? = nil,
        reconnected: Bool? = nil,
        stale: Bool? = nil,
        serverVersion: String? = nil
    ) {
        self.id = id
        self.type = type
        self.channel = channel
        self.args = args
        self.result = result
        self.error = error
        self.protocolVersion = protocolVersion
        self.workspaceId = workspaceId
        self.token = token
        self.clientId = clientId
        self.serverId = serverId
        self.webContentsId = webContentsId
        self.clientCapabilities = clientCapabilities
        self.registeredChannels = registeredChannels
        self.seq = seq
        self.lastSeq = lastSeq
        self.reconnectClientId = reconnectClientId
        self.reconnected = reconnected
        self.stale = stale
        self.serverVersion = serverVersion
    }
}
