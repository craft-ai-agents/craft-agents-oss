// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ToolCallCardView.swift
import SwiftUI
import CraftAgentKit

/// Renders machine activity as a compact, expandable timeline card.
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
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(statusColor.opacity(0.12))
                        .frame(width: 30, height: 30)
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .font(.caption)
                        .foregroundStyle(statusColor)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(message.toolName ?? "Tool")
                        .font(.subheadline.weight(.semibold))
                    if let command = commandText {
                        Text(command)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 4)
                HStack(spacing: 5) {
                    statusIcon
                    Text(statusLabel)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .tint(.secondary)
        .padding(12)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(statusColor.opacity(message.toolStatus == "running" ? 0.24 : 0.12), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
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
            Image(systemName: "xmark.circle.fill").foregroundStyle(statusColor)
        default:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(statusColor)
        }
    }

    private var statusLabel: String {
        switch message.toolStatus {
        case "running": "Running"
        case "error": "Failed"
        default: "Done"
        }
    }

    private var statusColor: Color {
        switch message.toolStatus {
        case "running": CraftTheme.accent
        case "error": .red
        default: .green
        }
    }
}
