// apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

@MainActor
final class ChatViewModelTests: XCTestCase {
    func testAppliesStreamingTextDeltaToLastAssistantMessage() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.textDelta(sessionId: "s1", delta: "Hel", turnId: "t1"))
        viewModel.apply(.textDelta(sessionId: "s1", delta: "lo", turnId: "t1"))

        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.content, "Hello")
        XCTAssertEqual(viewModel.messages.first?.isStreaming, true)
    }

    func testTextCompleteFinalizesTheMessage() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.textDelta(sessionId: "s1", delta: "Hi", turnId: "t1"))
        viewModel.apply(.textComplete(sessionId: "s1", text: "Hi there"))

        XCTAssertEqual(viewModel.messages.first?.content, "Hi there")
        XCTAssertEqual(viewModel.messages.first?.isStreaming, false)
    }

    func testEventsForOtherSessionsAreIgnored() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.textDelta(sessionId: "other-session", delta: "nope", turnId: nil))
        XCTAssertTrue(viewModel.messages.isEmpty)
    }
}

extension ChatViewModelTests {
    func testToolStartThenToolResultUpdateTheSameMessage() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.toolStart(
            sessionId: "s1", toolName: "Bash", toolUseId: "tool-1",
            toolInput: ["command": .string("ls -la")]
        ))
        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.toolStatus, "running")

        viewModel.apply(.toolResult(
            sessionId: "s1", toolUseId: "tool-1", toolName: "Bash",
            result: "file1.txt\nfile2.txt", isError: false
        ))
        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.toolResult, "file1.txt\nfile2.txt")
        XCTAssertEqual(viewModel.messages.first?.toolStatus, "success")
    }
}

extension ChatViewModelTests {
    func testPermissionRequestEventSurfacesForApproval() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        let request = PermissionRequest(
            requestId: "req-1", toolName: "Bash", command: "rm -rf /tmp/x",
            description: "Delete a temp file"
        )
        viewModel.apply(.permissionRequest(sessionId: "s1", request: request))
        XCTAssertEqual(viewModel.pendingPermissionRequest?.requestId, "req-1")
    }
}

extension ChatViewModelTests {
    func testIsOfflineWhenNoClientIsAvailable() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        XCTAssertTrue(viewModel.isOffline)
    }
}

extension ChatViewModelTests {
    func testUserMessageEventSurfacesOwnMessage() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        let mine = ChatMessage(id: "m1", role: .user, content: "hello", timestamp: 1)
        viewModel.apply(.userMessage(sessionId: "s1", message: mine, status: "sent"))

        XCTAssertEqual(viewModel.messages.count, 1)
        XCTAssertEqual(viewModel.messages.first?.id, "m1")
        XCTAssertEqual(viewModel.messages.first?.content, "hello")
        XCTAssertEqual(viewModel.messages.first?.role, .user)
    }

    func testDuplicateUserMessageEventIsDeduped() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        let mine = ChatMessage(id: "m1", role: .user, content: "hello", timestamp: 1)
        viewModel.apply(.userMessage(sessionId: "s1", message: mine, status: "sent"))
        viewModel.apply(.userMessage(sessionId: "s1", message: mine, status: "sent"))

        XCTAssertEqual(viewModel.messages.count, 1)
    }
}

extension ChatViewModelTests {
    func testProcessingBecomesTrueOnActivityAndFalseOnComplete() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        XCTAssertFalse(viewModel.isProcessing)
        viewModel.apply(.textDelta(sessionId: "s1", delta: "Hi", turnId: "t1"))
        XCTAssertTrue(viewModel.isProcessing)
        viewModel.apply(.complete(sessionId: "s1"))
        XCTAssertFalse(viewModel.isProcessing)
    }

    func testStatusMessageIsSurfacedAndClearedOnComplete() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.status(sessionId: "s1", message: "Compacting…"))
        XCTAssertEqual(viewModel.statusMessage, "Compacting…")
        viewModel.apply(.complete(sessionId: "s1"))
        XCTAssertNil(viewModel.statusMessage)
    }

    func testCredentialRequestEventSurfacesForInput() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        let request = CredentialRequest(requestId: "c1", sourceName: "GitHub", mode: "api_key")
        viewModel.apply(.credentialRequest(sessionId: "s1", request: request))
        XCTAssertEqual(viewModel.pendingCredentialRequest?.requestId, "c1")
    }

    func testSessionModelChangedUpdatesCurrentModel() {
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        viewModel.apply(.sessionModelChanged(sessionId: "s1", model: "claude-opus-4-8"))
        XCTAssertEqual(viewModel.currentModel, "claude-opus-4-8")
    }

    func testEchoedUserMessageWithSameIdDoesNotDuplicateOptimisticOne() {
        // Simulate an already-shown optimistic user message, then the server's
        // echoed user_message event with the same id — it must dedupe.
        let viewModel = ChatViewModel(client: nil, sessionId: "s1")
        let mine = ChatMessage(id: "server-id-1", role: .user, content: "hi", timestamp: 1)
        viewModel.apply(.userMessage(sessionId: "s1", message: mine, status: "sent"))
        viewModel.apply(.userMessage(sessionId: "s1", message: mine, status: "sent"))
        XCTAssertEqual(viewModel.messages.filter { $0.id == "server-id-1" }.count, 1)
    }

    func testConnectionStateDisablesChatWhileReconnecting() async {
        let transport = RPCTransport()
        let viewModel = ChatViewModel(
            client: RPCClient(transport: transport),
            sessionId: "s1"
        )
        XCTAssertFalse(viewModel.isOffline)

        await viewModel.transport(transport, didChangeState: .reconnecting(attempt: 1))
        XCTAssertTrue(viewModel.isOffline)

        await viewModel.transport(transport, didChangeState: .connected)
        XCTAssertFalse(viewModel.isOffline)
    }

    func testFailedSendRestoresDraftAndShowsFriendlyConnectionError() async {
        let viewModel = ChatViewModel(
            client: RPCClient(transport: RPCTransport()),
            sessionId: "s1"
        )
        viewModel.draftText = "Keep this message"

        await viewModel.send()

        XCTAssertEqual(viewModel.draftText, "Keep this message")
        XCTAssertFalse(viewModel.isProcessing)
        XCTAssertEqual(
            viewModel.errorMessage,
            "The server connection is unavailable. Reconnecting..."
        )
    }

    func testOversizedResponseIsNotTreatedAsRecoverableDisconnect() {
        let error = URLError(.dataLengthExceedsMaximum)
        XCTAssertFalse(isRecoverableConnectionError(error))
        XCTAssertEqual(
            userFacingTransportError(error),
            "This session is too large to load on this device."
        )
    }
}
