// apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionListViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

@MainActor
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

    func testUpsertInsertsNewSessionsAtTheTop() {
        // Guards the ordering `createSession` (Step 3 below) relies on:
        // it calls `upsert(_:)` with the just-created session and expects
        // it to appear first without any extra sorting step.
        let viewModel = SessionListViewModel(client: nil, cache: nil)
        let existing = Session(
            id: "old", workspaceId: "w1", workspaceName: "Default", name: "Old",
            preview: nil, lastMessageAt: 1, isProcessing: false, isFlagged: nil,
            permissionMode: nil, sessionStatus: nil, labels: nil, hasUnread: nil,
            model: nil, messageCount: nil
        )
        viewModel.upsert(existing)

        let created = Session(
            id: "new", workspaceId: "w1", workspaceName: "Default", name: nil,
            preview: nil, lastMessageAt: 2, isProcessing: false, isFlagged: nil,
            permissionMode: nil, sessionStatus: nil, labels: nil, hasUnread: nil,
            model: nil, messageCount: nil
        )
        viewModel.upsert(created)

        XCTAssertEqual(viewModel.sessions.map(\.id), ["new", "old"])
    }
}
