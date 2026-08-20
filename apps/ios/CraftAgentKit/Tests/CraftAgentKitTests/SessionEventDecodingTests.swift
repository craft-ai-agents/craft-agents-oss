import XCTest
@testable import CraftAgentKit

final class SessionEventDecodingTests: XCTestCase {
    func testDecodesTextDelta() throws {
        let json = Data("""
        {"type": "text_delta", "sessionId": "s1", "delta": "Hello"}
        """.utf8)
        let event = try JSONDecoder().decode(SessionEvent.self, from: json)
        guard case .textDelta(let sessionId, let delta, _) = event else {
            return XCTFail("expected .textDelta, got \(event)")
        }
        XCTAssertEqual(sessionId, "s1")
        XCTAssertEqual(delta, "Hello")
    }

    func testDecodesPermissionRequest() throws {
        let json = Data("""
        {
          "type": "permission_request",
          "sessionId": "s1",
          "request": {
            "requestId": "req-1",
            "toolName": "Bash",
            "command": "rm -rf /tmp/x",
            "description": "Delete a temp file"
          }
        }
        """.utf8)
        let event = try JSONDecoder().decode(SessionEvent.self, from: json)
        guard case .permissionRequest(let sessionId, let request) = event else {
            return XCTFail("expected .permissionRequest, got \(event)")
        }
        XCTAssertEqual(sessionId, "s1")
        XCTAssertEqual(request.requestId, "req-1")
        XCTAssertEqual(request.command, "rm -rf /tmp/x")
    }

    func testUnknownEventTypeDoesNotThrow() throws {
        // Forward-compat: packages/shared/src/protocol/dto.ts has 46 SessionEvent
        // variants; MVP only models a subset. New server-side variants must not
        // crash the client.
        let json = Data("""
        {"type": "workflow_agent_completed", "sessionId": "s1", "workflowId": "w1", "agentId": "a1"}
        """.utf8)
        let event = try JSONDecoder().decode(SessionEvent.self, from: json)
        guard case .unknown(let type) = event else {
            return XCTFail("expected .unknown, got \(event)")
        }
        XCTAssertEqual(type, "workflow_agent_completed")
    }
}
