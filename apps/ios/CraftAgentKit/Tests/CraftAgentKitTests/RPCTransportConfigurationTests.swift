import Foundation
import XCTest
@testable import CraftAgentKit

final class RPCTransportConfigurationTests: XCTestCase {
    func testConfiguresWebSocketForLargeSessionResponses() {
        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1")!)
        RPCTransport.configureWebSocketTask(task)

        XCTAssertEqual(task.maximumMessageSize, ProtocolConstants.maxIncomingMessageSizeBytes)
        XCTAssertGreaterThan(task.maximumMessageSize, 1_048_576)
        task.cancel()
    }

    func testTransportErrorsHaveUserFacingDescriptions() {
        XCTAssertEqual(
            RPCTransport.TransportError.notConnected.localizedDescription,
            "The server connection is unavailable. Reconnecting..."
        )
        XCTAssertEqual(
            RPCTransport.TransportError.requestTimedOut.localizedDescription,
            "The server took too long to respond."
        )
        XCTAssertEqual(
            RPCTransport.TransportError.connectionTimedOut.localizedDescription,
            "Could not reconnect to the server in time."
        )
        XCTAssertEqual(
            RPCTransport.TransportError.messageTooLarge.localizedDescription,
            "This session is too large to load on this device."
        )
    }

    func testMapsOversizedSocketFailuresWithoutCallingThemDisconnected() {
        XCTAssertEqual(
            RPCTransport.transportError(
                forSocketFailure: URLError(.dataLengthExceedsMaximum)
            ),
            .messageTooLarge
        )
    }

    func testIdleRequestFailsWithoutWaitingForAConnectionTimeout() async {
        let transport = RPCTransport()
        do {
            _ = try await transport.request(channel: "test:idle")
            XCTFail("Expected an idle transport request to fail")
        } catch let error as RPCTransport.TransportError {
            XCTAssertEqual(error, .notConnected)
            XCTAssertTrue(error.isConnectionUnavailable)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testReconnectStopsForPermanentHandshakeErrors() {
        let authError = RPCTransport.TransportError.remote(WireError(
            code: .authFailed,
            message: "Token expired",
            data: nil
        ))

        XCTAssertFalse(RPCTransport.shouldReconnect(after: authError))
        XCTAssertFalse(
            RPCTransport.shouldReconnect(
                after: RPCTransport.TransportError.messageTooLarge
            )
        )
        XCTAssertTrue(RPCTransport.shouldReconnect(after: URLError(.networkConnectionLost)))
        XCTAssertEqual(RPCTransport.connectionError(from: authError).kind, .auth)
    }
}
