import XCTest
@testable import CraftAgentKit

final class MessageEnvelopeTests: XCTestCase {
    func testDecodesHandshakeAck() throws {
        let json = Data("""
        {
          "id": "abc-123",
          "type": "handshake_ack",
          "clientId": "client-1",
          "protocolVersion": "1.0",
          "serverVersion": "0.11.0",
          "registeredChannels": ["sessions:get", "sessions:sendMessage"],
          "reconnected": false
        }
        """.utf8)
        let envelope = try JSONDecoder().decode(MessageEnvelope.self, from: json)
        XCTAssertEqual(envelope.id, "abc-123")
        XCTAssertEqual(envelope.type, .handshakeAck)
        XCTAssertEqual(envelope.clientId, "client-1")
        XCTAssertEqual(envelope.registeredChannels, ["sessions:get", "sessions:sendMessage"])
        XCTAssertEqual(envelope.reconnected, false)
    }

    func testEncodesRequestWithArgs() throws {
        let envelope = MessageEnvelope(
            id: "req-1",
            type: .request,
            channel: RPCChannels.Sessions.sendMessage,
            args: [.string("session-1"), .string("hello"), .null, .null, .null]
        )
        let data = try JSONEncoder().encode(envelope)
        let redecoded = try JSONDecoder().decode(MessageEnvelope.self, from: data)
        XCTAssertEqual(redecoded.channel, "sessions:sendMessage")
        XCTAssertEqual(redecoded.args?.count, 5)
    }
}
