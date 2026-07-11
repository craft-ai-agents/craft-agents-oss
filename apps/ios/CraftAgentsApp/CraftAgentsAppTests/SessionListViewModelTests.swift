// apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionListViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

final class SessionListViewModelTests: XCTestCase {
    func testAppliesSessionCreatedEventOptimistically() async throws {
        let viewModel = SessionListViewModel(client: nil)
        XCTAssertTrue(viewModel.sessions.isEmpty)

        // Simulate what RPCTransport would deliver on a real "sessions:create"
        // response — the view model's `apply(_:)` is the single place that
        // reconciles both the initial `load()` fetch and live push events.
        let session = Session(
            id: "s1", workspaceId: "w1", workspaceName: "Default",
            name: "New chat", preview: nil, lastMessageAt: 1_700_000_000_000,
            isProcessing: false, isFlagged: nil, permissionMode: nil,
            sessionStatus: nil, labels: nil, hasUnread: nil, model: nil, messageCount: nil
        )
        viewModel.upsert(session)
        XCTAssertEqual(viewModel.sessions.count, 1)
        XCTAssertEqual(viewModel.sessions.first?.id, "s1")

        viewModel.remove(sessionId: "s1")
        XCTAssertTrue(viewModel.sessions.isEmpty)
    }
}
