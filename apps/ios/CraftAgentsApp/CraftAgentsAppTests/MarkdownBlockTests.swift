// apps/ios/CraftAgentsApp/CraftAgentsAppTests/MarkdownBlockTests.swift
import XCTest
@testable import CraftAgentsApp

/// Guards the lightweight Markdown block parser that backs chat rendering.
@MainActor
final class MarkdownBlockTests: XCTestCase {
    func testParsesHeadingsParagraphsAndLists() {
        let md = """
        # Title

        Some **bold** text.

        - one
        - two

        1. first
        2. second
        """
        let blocks = MarkdownBlock.parse(md)
        XCTAssertEqual(blocks.first, .heading(level: 1, text: "Title"))
        XCTAssertTrue(blocks.contains(.paragraph("Some **bold** text.")))
        XCTAssertTrue(blocks.contains(.listItem(ordered: false, index: 0, text: "one")))
        XCTAssertTrue(blocks.contains(.listItem(ordered: true, index: 1, text: "first")))
        XCTAssertTrue(blocks.contains(.listItem(ordered: true, index: 2, text: "second")))
    }

    func testParsesFencedCodeBlockVerbatim() {
        let md = """
        Here:

        ```
        let x = 1
        print(x)
        ```
        """
        let blocks = MarkdownBlock.parse(md)
        XCTAssertTrue(blocks.contains(.code("let x = 1\nprint(x)")))
    }

    func testParsesBlockquote() {
        let blocks = MarkdownBlock.parse("> quoted line")
        XCTAssertEqual(blocks, [.quote("quoted line")])
    }

    func testPlainTextIsASingleParagraph() {
        let blocks = MarkdownBlock.parse("just some text")
        XCTAssertEqual(blocks, [.paragraph("just some text")])
    }
}
