// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/RPCTransportMultiDelegateTests.swift
import XCTest
@testable import CraftAgentKit

final class RPCTransportMultiDelegateTests: XCTestCase {
    private final class RecordingDelegate: RPCTransportDelegate {
        nonisolated(unsafe) var receivedEventCount = 0
        nonisolated(unsafe) var states: [ConnectionState] = []
        func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {
            states.append(state)
        }
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

        // `notifyDelegates` fans out to each delegate in an unordered
        // fire-and-forget Task, so the counters increment asynchronously after
        // `dispatchForTesting` returns. Poll instead of asserting immediately.
        await waitUntil { delegateA.receivedEventCount == 1 && delegateB.receivedEventCount == 1 }

        XCTAssertEqual(delegateA.receivedEventCount, 1)
        XCTAssertEqual(delegateB.receivedEventCount, 1)
    }

    func testStateNotificationsPreserveTransportOrder() async {
        let transport = RPCTransport()
        let delegate = RecordingDelegate()
        await transport.addDelegate(delegate)

        await transport.updateStateForTesting(.connecting)
        await transport.updateStateForTesting(.connected)
        await transport.updateStateForTesting(.reconnecting(attempt: 1))

        await waitUntil { delegate.states.count == 3 }

        XCTAssertEqual(
            delegate.states,
            [.connecting, .connected, .reconnecting(attempt: 1)]
        )
    }

    /// Polls `condition` until true or a timeout elapses, yielding between
    /// checks so background delegate Tasks can run.
    private func waitUntil(timeout: TimeInterval = 2.0, _ condition: @Sendable () -> Bool) async {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() && Date() < deadline {
            try? await Task.sleep(nanoseconds: 5_000_000) // 5ms
        }
    }
}
