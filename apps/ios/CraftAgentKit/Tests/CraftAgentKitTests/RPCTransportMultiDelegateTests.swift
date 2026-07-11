// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/RPCTransportMultiDelegateTests.swift
import XCTest
@testable import CraftAgentKit

final class RPCTransportMultiDelegateTests: XCTestCase {
    private final class RecordingDelegate: RPCTransportDelegate {
        nonisolated(unsafe) var receivedEventCount = 0
        func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {}
        func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {
            receivedEventCount += 1
        }
    }

    func testBothDelegatesReceiveTheSameEvent() async {
        let transport = RPCTransport()
        let delegateA = RecordingDelegate()
        let delegateB = RecordingDelegate()
        await transport.addDelegate(delegateA)
        await transport.addDelegate(delegateB)

        let envelope = MessageEnvelope(id: "e1", type: .event, channel: RPCChannels.Sessions.event, args: [])
        await transport.dispatchForTesting(envelope)

        XCTAssertEqual(delegateA.receivedEventCount, 1)
        XCTAssertEqual(delegateB.receivedEventCount, 1)
    }
}
