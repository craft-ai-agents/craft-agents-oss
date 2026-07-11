// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/JSONValueDecodingTests.swift
import XCTest
@testable import CraftAgentKit

final class JSONValueDecodingTests: XCTestCase {
    func testDecodesArrayOfSessions() throws {
        let value = JSONValue.array([
            .object([
                "id": .string("s1"),
                "workspaceId": .string("w1"),
                "workspaceName": .string("Default"),
                "lastMessageAt": .number(1_700_000_000_000),
                "isProcessing": .bool(false),
            ])
        ])
        let sessions: [Session] = try value.decoded()
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions[0].id, "s1")
        XCTAssertEqual(sessions[0].isProcessing, false)
    }
}
