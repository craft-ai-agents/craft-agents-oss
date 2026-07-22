import XCTest
@testable import CraftAgentKit

final class ProtocolCodecTests: XCTestCase {
    func testRoundTripsARequestEnvelope() throws {
        let envelope = MessageEnvelope(
            id: "req-1",
            type: .request,
            channel: RPCChannels.Sessions.get
        )
        let wire = try ProtocolCodec.serialize(envelope)
        let decoded = try ProtocolCodec.deserialize(wire)
        XCTAssertEqual(decoded, envelope)
    }

    func testRejectsEnvelopeWithMissingId() {
        let json = """
        {"id": "", "type": "request", "channel": "sessions:get"}
        """
        XCTAssertThrowsError(try ProtocolCodec.deserialize(json)) { error in
            guard case ProtocolCodec.CodecError.invalidShape = error else {
                return XCTFail("expected invalidShape, got \(error)")
            }
        }
    }

    func testRejectsHandshakeAckWithoutClientId() {
        let json = """
        {"id": "abc", "type": "handshake_ack"}
        """
        XCTAssertThrowsError(try ProtocolCodec.deserialize(json)) { error in
            guard case ProtocolCodec.CodecError.invalidShape = error else {
                return XCTFail("expected invalidShape, got \(error)")
            }
        }
    }

    func testRejectsRequestWithoutChannel() {
        let json = """
        {"id": "abc", "type": "request"}
        """
        XCTAssertThrowsError(try ProtocolCodec.deserialize(json)) { error in
            guard case ProtocolCodec.CodecError.invalidShape = error else {
                return XCTFail("expected invalidShape, got \(error)")
            }
        }
    }

    func testAcceptsRealHandshakeAckFixture() throws {
        // Captured shape from packages/server-core/src/transport/server.ts onConnection().
        let json = """
        {
          "id": "hs-1",
          "type": "handshake_ack",
          "clientId": "client-42",
          "protocolVersion": "1.0",
          "serverVersion": "0.11.0",
          "registeredChannels": ["sessions:get", "sessions:sendMessage", "session:event"],
          "reconnected": false
        }
        """
        let decoded = try ProtocolCodec.deserialize(json)
        XCTAssertEqual(decoded.clientId, "client-42")
    }
}
