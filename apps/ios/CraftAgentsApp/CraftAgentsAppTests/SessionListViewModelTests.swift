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

    func testResolvesConnectedWorkspaceIdForNewSession() async {
        // The "+" action must resolve a workspace even with no sessions loaded
        // yet — it prefers the connection's workspace id so it never shows
        // "No workspace available".
        let viewModel = SessionListViewModel(client: nil, cache: nil, workspaceId: "connected-ws")
        let resolved = await viewModel.resolveWorkspaceIdForNewSession()
        XCTAssertEqual(resolved, "connected-ws")
    }

    func testCreateNewSessionWithoutWorkspaceSurfacesError() async {
        let viewModel = SessionListViewModel(client: nil, cache: nil, workspaceId: nil)
        let created = await viewModel.createNewSession()
        XCTAssertNil(created)
        XCTAssertNotNil(viewModel.errorMessage)
    }

    func testWorkspaceIdForSessionPrefersSessionThenConnection() {
        let viewModel = SessionListViewModel(client: nil, cache: nil, workspaceId: "connected-ws")
        let session = Session(
            id: "s1", workspaceId: "session-ws", workspaceName: "WS",
            lastMessageAt: 1, isProcessing: false
        )
        viewModel.upsert(session)
        XCTAssertEqual(viewModel.workspaceId(for: "s1"), "session-ws")
        XCTAssertEqual(viewModel.workspaceId(for: "unknown"), "connected-ws")
    }

    func testStatusLabelFallsBackToIdWhenUnknown() {
        let viewModel = SessionListViewModel(client: nil, cache: nil)
        // No statuses loaded — unknown id returns itself; nil returns nil.
        XCTAssertEqual(viewModel.statusLabel(for: "needs-review"), "needs-review")
        XCTAssertNil(viewModel.statusLabel(for: nil))
    }

    func testVisibleSessionsSearchesNameAndPreviewCaseInsensitively() {
        let viewModel = SessionListViewModel(client: nil)
        viewModel.upsert(Session(
            id: "auth", workspaceId: "w1", workspaceName: "Default",
            name: "Authentication review", preview: "Inspect login redirects",
            lastMessageAt: 2, isProcessing: false
        ))
        viewModel.upsert(Session(
            id: "docs", workspaceId: "w1", workspaceName: "Default",
            name: "Documentation", preview: "Update setup guide",
            lastMessageAt: 1, isProcessing: false
        ))

        viewModel.searchText = "LOGIN"

        XCTAssertEqual(viewModel.visibleSessions.map(\.id), ["auth"])
    }

    func testVisibleSessionsAppliesQuickFilters() {
        let viewModel = SessionListViewModel(client: nil)
        viewModel.upsert(Session(
            id: "unread", workspaceId: "w1", workspaceName: "Default",
            lastMessageAt: 1, isProcessing: false, hasUnread: true
        ))
        viewModel.upsert(Session(
            id: "running", workspaceId: "w1", workspaceName: "Default",
            lastMessageAt: 2, isProcessing: true
        ))
        viewModel.upsert(Session(
            id: "flagged", workspaceId: "w1", workspaceName: "Default",
            lastMessageAt: 3, isProcessing: false, isFlagged: true
        ))

        viewModel.selectedFilter = .unread
        XCTAssertEqual(viewModel.visibleSessions.map(\.id), ["unread"])

        viewModel.selectedFilter = .running
        XCTAssertEqual(viewModel.visibleSessions.map(\.id), ["running"])

        viewModel.selectedFilter = .flagged
        XCTAssertEqual(viewModel.visibleSessions.map(\.id), ["flagged"])
    }

    func testLiveEventsUpdateRunningFilterState() {
        let viewModel = SessionListViewModel(client: nil)
        viewModel.upsert(Session(
            id: "s1", workspaceId: "w1", workspaceName: "Default",
            lastMessageAt: 1, isProcessing: false
        ))
        viewModel.selectedFilter = .running
        XCTAssertTrue(viewModel.visibleSessions.isEmpty)

        viewModel.apply(.textDelta(sessionId: "s1", delta: "Working", turnId: "t1"))
        XCTAssertEqual(viewModel.visibleSessions.map(\.id), ["s1"])

        viewModel.apply(.complete(sessionId: "s1"))
        XCTAssertTrue(viewModel.visibleSessions.isEmpty)
    }

    func testConnectionStateMarksSessionListOfflineWhileReconnecting() async {
        let transport = RPCTransport()
        let viewModel = SessionListViewModel(
            client: RPCClient(transport: transport),
            workspaceId: "w1"
        )
        XCTAssertFalse(viewModel.isOffline)

        await viewModel.transport(transport, didChangeState: .reconnecting(attempt: 1))
        XCTAssertTrue(viewModel.isOffline)

        await viewModel.transport(transport, didChangeState: .connected)
        XCTAssertFalse(viewModel.isOffline)
    }
}
