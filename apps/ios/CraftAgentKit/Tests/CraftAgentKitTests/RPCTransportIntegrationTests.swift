// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/RPCTransportIntegrationTests.swift
import XCTest
@testable import CraftAgentKit

/// Requires a local server: from `packages/server`, run
///   `bun run src/index.ts --generate-token` once to obtain a token, then
///   from the repo root run `CRAFT_SERVER_TOKEN=<token> bun run server:start`
///   before running this test. Skips itself if `CRAFT_TEST_SERVER_URL` is
///   unset so the rest of the suite still runs in CI without a live server.
final class RPCTransportIntegrationTests: XCTestCase {
    private final class RecordingDelegate: RPCTransportDelegate {
        var states: [ConnectionState] = []
        func transport(_ transport: RPCTransport, didChangeState state: ConnectionState) async {
            states.append(state)
        }
        func transport(_ transport: RPCTransport, didReceiveEvent envelope: MessageEnvelope) async {}
    }

    func testConnectsAndListsSessions() async throws {
        guard let urlString = ProcessInfo.processInfo.environment["CRAFT_TEST_SERVER_URL"],
              let token = ProcessInfo.processInfo.environment["CRAFT_TEST_SERVER_TOKEN"],
              let url = URL(string: urlString) else {
            throw XCTSkip("Set CRAFT_TEST_SERVER_URL / CRAFT_TEST_SERVER_TOKEN to run against a live server")
        }

        let transport = RPCTransport()
        let delegate = RecordingDelegate()
        await transport.setDelegate(delegate)

        try await transport.connect(serverURL: url, token: token, workspaceId: nil)
        let result = try await transport.request(channel: RPCChannels.Sessions.get)

        guard case .array = result else {
            return XCTFail("expected sessions:get to return an array, got \(result)")
        }
        await transport.disconnect()
    }
}
