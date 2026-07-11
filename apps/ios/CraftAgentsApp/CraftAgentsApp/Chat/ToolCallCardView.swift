// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ToolCallCardView.swift
import SwiftUI
import CraftAgentKit

/// Renders a tool call as a distinct, monospaced gray card so it reads clearly
/// as machine activity — visually separate from the assistant's prose body.
struct ToolCallCardView: View {
    let message: ChatMessage
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                if let command = commandText {
                    Text(command)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if let result = message.toolResult, !result.isEmpty {
                    Divider()
                    Text(result)
                        .font(.system(.caption, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
            }
            .padding(.top, 6)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "wrench.and.screwdriver")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(message.toolName ?? "Tool")
                    .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                Spacer(minLength: 4)
                statusIcon
            }
        }
        .tint(.secondary)
        .padding(10)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.25), lineWidth: 1)
        )
    }

    /// The primary tool argument (e.g. a Bash command) if present.
    private var commandText: String? {
        guard let input = message.toolInput else { return nil }
        for key in ["command", "cmd", "query", "path", "file_path", "pattern"] {
            if case .string(let value)? = input[key], !value.isEmpty { return value }
        }
        return nil
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch message.toolStatus {
        case "running":
            ProgressView().controlSize(.small)
        case "error":
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        default:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        }
    }
}
