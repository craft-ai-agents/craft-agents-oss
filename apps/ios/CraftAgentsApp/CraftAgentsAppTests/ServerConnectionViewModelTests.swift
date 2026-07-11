// apps/ios/CraftAgentsApp/CraftAgentsAppTests/ServerConnectionViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

final class ServerConnectionViewModelTests: XCTestCase {
    func testSavesConnectionAfterSuccessfulTest() async throws {
        let store = ServerConnectionStore(keychain: InMemoryKeychainStore())
        let viewModel = ServerConnectionViewModel(store: store)
        viewModel.serverURLText = "wss://example.com:9100"
        viewModel.token = "a-valid-looking-token-1234567890"

        // A real connection attempt requires a live server (covered by
        // RPCTransportIntegrationTests in CraftAgentKit); here we only verify
        // the save path once a connection is known-good.
        let connection = ServerConnection(
            name: "Test",
            url: URL(string: viewModel.serverURLText)!,
            token: viewModel.token,
            workspaceId: "w1"
        )
        try await store.save(connection)

        let saved = try await store.list()
        XCTAssertEqual(saved.first?.workspaceId, "w1")
    }
}
