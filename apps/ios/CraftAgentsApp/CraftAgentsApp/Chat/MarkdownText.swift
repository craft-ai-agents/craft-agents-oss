// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/MarkdownText.swift
import SwiftUI

/// A lightweight, dependency-free Markdown renderer for chat messages. Handles
/// the block structure agents commonly produce — fenced code blocks, ATX
/// headings, bullet/numbered lists, blockquotes — and renders inline Markdown
/// (bold, italic, inline code, links) via `AttributedString`. It is not a full
/// CommonMark implementation, but covers typical assistant output far better
/// than plain `Text`.
struct MarkdownText: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(MarkdownBlock.parse(markdown).enumerated()), id: \.offset) { _, block in
                view(for: block)
            }
        }
    }

    @ViewBuilder
    private func view(for block: MarkdownBlock) -> some View {
        switch block {
        case .code(let code):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(.system(.callout, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(8)
            }
            .background(Color.secondary.opacity(0.12))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        case .heading(let level, let text):
            inline(text)
                .font(headingFont(level))
                .fontWeight(.semibold)
        case .quote(let text):
            HStack(spacing: 6) {
                Rectangle().fill(Color.secondary.opacity(0.4)).frame(width: 3)
                inline(text).foregroundStyle(.secondary)
            }
        case .listItem(let ordered, let index, let text):
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(ordered ? "\(index)." : "•").foregroundStyle(.secondary)
                inline(text)
            }
        case .paragraph(let text):
            inline(text)
        }
    }

    private func inline(_ text: String) -> Text {
        // `.inlineOnlyPreservingWhitespace` keeps soft line breaks and renders
        // bold/italic/code/links; falls back to plain text on parse failure.
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            return Text(attributed)
        }
        return Text(text)
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: return .title2
        case 2: return .title3
        case 3: return .headline
        default: return .subheadline
        }
    }
}

/// A parsed Markdown block. Parsing is intentionally minimal and line-based.
enum MarkdownBlock: Equatable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case code(String)
    case listItem(ordered: Bool, index: Int, text: String)
    case quote(String)

    static func parse(_ markdown: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        let lines = markdown.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")

        var i = 0
        var paragraph: [String] = []
        var orderedIndex = 0

        func flushParagraph() {
            let text = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty { blocks.append(.paragraph(text)) }
            paragraph.removeAll()
        }

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code block ``` ... ```
            if trimmed.hasPrefix("```") {
                flushParagraph()
                var code: [String] = []
                i += 1
                while i < lines.count && !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(lines[i])
                    i += 1
                }
                i += 1 // skip closing fence
                blocks.append(.code(code.joined(separator: "\n")))
                continue
            }

            // Blank line — paragraph boundary
            if trimmed.isEmpty {
                flushParagraph()
                orderedIndex = 0
                i += 1
                continue
            }

            // ATX heading
            if let heading = Self.parseHeading(trimmed) {
                flushParagraph()
                blocks.append(heading)
                i += 1
                continue
            }

            // Blockquote
            if trimmed.hasPrefix(">") {
                flushParagraph()
                let text = String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
                blocks.append(.quote(text))
                i += 1
                continue
            }

            // Bullet list
            if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                flushParagraph()
                blocks.append(.listItem(ordered: false, index: 0, text: String(trimmed.dropFirst(2))))
                i += 1
                continue
            }

            // Ordered list: "1. text"
            if let item = Self.parseOrdered(trimmed) {
                flushParagraph()
                orderedIndex += 1
                blocks.append(.listItem(ordered: true, index: orderedIndex, text: item))
                i += 1
                continue
            }

            orderedIndex = 0
            paragraph.append(line)
            i += 1
        }
        flushParagraph()
        return blocks
    }

    private static func parseHeading(_ line: String) -> MarkdownBlock? {
        var level = 0
        for ch in line {
            if ch == "#" { level += 1 } else { break }
        }
        guard level > 0, level <= 6 else { return nil }
        let rest = line.dropFirst(level)
        guard rest.first == " " else { return nil }
        return .heading(level: level, text: rest.trimmingCharacters(in: .whitespaces))
    }

    private static func parseOrdered(_ line: String) -> String? {
        guard let dotIndex = line.firstIndex(of: ".") else { return nil }
        let numberPart = line[line.startIndex..<dotIndex]
        guard !numberPart.isEmpty, numberPart.allSatisfy(\.isNumber) else { return nil }
        let after = line[line.index(after: dotIndex)...]
        guard after.first == " " else { return nil }
        return after.trimmingCharacters(in: .whitespaces)
    }
}
