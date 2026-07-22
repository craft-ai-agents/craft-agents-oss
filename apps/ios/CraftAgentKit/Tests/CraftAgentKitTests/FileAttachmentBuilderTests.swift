// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/FileAttachmentBuilderTests.swift
import XCTest
@testable import CraftAgentKit

/// Guards `FileAttachment.document` classification and payload encoding so the
/// iOS client mirrors the server's `getFileType` (base64 for binary types,
/// inline UTF-8 text for text/code files).
final class FileAttachmentBuilderTests: XCTestCase {
    func testTextFileIsSentAsInlineText() {
        let body = "hello, world\n"
        let att = FileAttachment.document(named: "notes.txt", data: Data(body.utf8), mimeType: "text/plain")
        XCTAssertEqual(att.type, .text)
        XCTAssertEqual(att.text, body)
        XCTAssertNil(att.base64)
        XCTAssertEqual(att.name, "notes.txt")
    }

    func testUnknownExtensionDefaultsToText() {
        let att = FileAttachment.document(named: "data.weirdext", data: Data("plain".utf8), mimeType: "application/octet-stream")
        XCTAssertEqual(att.type, .text)
        XCTAssertEqual(att.text, "plain")
    }

    func testPdfIsSentAsBase64() {
        let bytes = Data([0x25, 0x50, 0x44, 0x46]) // %PDF
        let att = FileAttachment.document(named: "report.pdf", data: bytes, mimeType: "application/pdf")
        XCTAssertEqual(att.type, .pdf)
        XCTAssertEqual(att.base64, bytes.base64EncodedString())
        XCTAssertNil(att.text)
    }

    func testOfficeIsSentAsBase64() {
        let bytes = Data([0x50, 0x4B, 0x03, 0x04]) // PK.. (zip/docx)
        let att = FileAttachment.document(named: "doc.docx", data: bytes, mimeType: "application/octet-stream")
        XCTAssertEqual(att.type, .office)
        XCTAssertEqual(att.base64, bytes.base64EncodedString())
    }

    func testAudioIsSentAsBase64() {
        let att = FileAttachment.document(named: "clip.mp3", data: Data([0xFF, 0xFB]), mimeType: "audio/mpeg")
        XCTAssertEqual(att.type, .audio)
        XCTAssertNotNil(att.base64)
    }

    func testNonUTF8TextExtensionFallsBackToBinary() {
        // .txt classifies as text, but invalid UTF-8 bytes fall back to base64.
        let invalid = Data([0xFF, 0xFE, 0xFF])
        let att = FileAttachment.document(named: "weird.txt", data: invalid, mimeType: "text/plain")
        XCTAssertEqual(att.type, .unknown)
        XCTAssertNil(att.text)
        XCTAssertEqual(att.base64, invalid.base64EncodedString())
    }

    func testLargeTextIsTruncated() {
        let big = String(repeating: "a", count: FileAttachment.maxInlineTextBytes + 5_000)
        let att = FileAttachment.document(named: "big.log", data: Data(big.utf8), mimeType: "text/plain")
        XCTAssertEqual(att.type, .text)
        XCTAssertNotNil(att.text)
        XCTAssertTrue(att.text?.contains("[File truncated") == true)
        XCTAssertEqual(att.size, big.utf8.count)
    }
}
