import Foundation

/// Encodes/decodes `MessageEnvelope` to/from the wire JSON string format used
/// by `packages/server-core/src/transport/codec.ts`. Mirrors
/// `validateEnvelopeShape` so malformed frames are rejected the same way on
/// both ends of the connection.
public enum ProtocolCodec {
    public enum CodecError: Error, Equatable {
        case invalidShape(String)
        case notUtf8
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        return encoder
    }()

    private static let decoder = JSONDecoder()

    public static func serialize(_ envelope: MessageEnvelope) throws -> String {
        try validate(envelope)
        let data = try encoder.encode(envelope)
        guard let string = String(data: data, encoding: .utf8) else {
            throw CodecError.notUtf8
        }
        return string
    }

    public static func deserialize(_ raw: String) throws -> MessageEnvelope {
        guard let data = raw.data(using: .utf8) else {
            throw CodecError.notUtf8
        }
        let envelope = try decoder.decode(MessageEnvelope.self, from: data)
        try validate(envelope)
        return envelope
    }

    /// Mirrors `validateEnvelopeShape` in `packages/server-core/src/transport/codec.ts`.
    private static func validate(_ envelope: MessageEnvelope) throws {
        if envelope.id.isEmpty {
            throw CodecError.invalidShape("id must be non-empty")
        }
        if envelope.type == .handshakeAck, (envelope.clientId?.isEmpty ?? true) {
            throw CodecError.invalidShape("handshake_ack requires a non-empty clientId")
        }
        if (envelope.type == .request || envelope.type == .event), envelope.channel == nil {
            throw CodecError.invalidShape("\(envelope.type.rawValue) requires a channel")
        }
        if envelope.type == .error, envelope.error == nil {
            throw CodecError.invalidShape("error envelopes require an error payload")
        }
    }
}
