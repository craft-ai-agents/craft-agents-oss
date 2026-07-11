// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/AttachmentDecodingTests.swift
import XCTest
@testable import CraftAgentKit

/// Guards that user messages echoed by the server carry their attachments
/// (`StoredAttachment`) so the chat can render image thumbnails.
final class AttachmentDecodingTests: XCTestCase {
    func testChatMessageDecodesStoredAttachments() throws {
        let value = JSONValue.object([
            "id": .string("m1"),
            "role": .string("user"),
            "content": .string("look at this"),
            "timestamp": .number(1),
            "attachments": .array([
                .object([
                    "id": .string("a1"),
                    "type": .string("image"),
                    "name": .string("photo.jpg"),
                    "mimeType": .string("image/jpeg"),
                    "size": .number(1234),
                    "thumbnailBase64": .string("QUJD"),
                ]),
            ]),
        ])
        let message: ChatMessage = try value.decoded()
        XCTAssertEqual(message.attachments?.count, 1)
        let attachment = try XCTUnwrap(message.attachments?.first)
        XCTAssertTrue(attachment.isImage)
        XCTAssertEqual(attachment.name, "photo.jpg")
        XCTAssertEqual(attachment.thumbnailBase64, "QUJD")
    }

    func testChatMessageWithoutAttachmentsDecodesToNil() throws {
        let value = JSONValue.object([
            "id": .string("m2"), "role": .string("assistant"),
            "content": .string("hi"), "timestamp": .number(2),
        ])
        let message: ChatMessage = try value.decoded()
        XCTAssertNil(message.attachments)
    }
}
