// apps/ios/CraftAgentsApp/CraftAgentsAppTests/ChatViewModelTests.swift
import XCTest
@testable import CraftAgentsApp
import CraftAgentKit

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
