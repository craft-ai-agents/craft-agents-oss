// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/SessionMessagesDecodingTests.swift
import XCTest
@testable import CraftAgentKit

/// Guards the `sessions:getMessages` decoding contract: the server returns the
/// full Session object with an embedded `messages` array (not a bare array), so
/// `RPCClient.decodeMessagesResult` must unwrap it. Previously the client decoded
/// the raw result as `[ChatMessage]` and crashed every session open with
/// `typeMismatch: expected Array<Any> but found a dictionary instead`.
final class SessionMessagesDecodingTests: XCTestCase {
    func testExtractsMessagesFromSessionEnvelope() throws {
        let result = JSONValue.object([
            "id": .string("s1"),
            "workspaceId": .string("w1"),
            "workspaceName": .string("Default"),
            "lastMessageAt": .number(1_700_000_000_000),
            "isProcessing": .bool(false),
            "messages": .array([
                .object([
                    "id": .string("m1"),
                    "role": .string("user"),
                    "content": .string("hello"),
                    "timestamp": .number(1_700_000_000_000),
                ]),
                .object([
                    "id": .string("m2"),
                    "role": .string("assistant"),
                    "content": .string("hi there"),
                    "timestamp": .number(1_700_000_000_001),
                ]),
            ]),
        ])

        let messages = try RPCClient.decodeMessagesResult(result)
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(messages[0].id, "m1")
        XCTAssertEqual(messages[0].role, .user)
        XCTAssertEqual(messages[1].content, "hi there")
        XCTAssertEqual(messages[1].role, .assistant)
    }

    func testNullResultDecodesToEmptyConversation() throws {
        XCTAssertEqual(try RPCClient.decodeMessagesResult(.null).count, 0)
    }

    func testSessionWithoutMessagesFieldDecodesToEmpty() throws {
        let result = JSONValue.object([
            "id": .string("s1"),
            "workspaceId": .string("w1"),
            "workspaceName": .string("Default"),
            "lastMessageAt": .number(1_700_000_000_000),
            "isProcessing": .bool(false),
        ])
        XCTAssertEqual(try RPCClient.decodeMessagesResult(result).count, 0)
    }
}
