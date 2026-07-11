// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ToolCallCardView.swift
import SwiftUI
import CraftAgentKit

struct ToolCallCardView: View {
    let message: ChatMessage
    @State private var isExpanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            if let result = message.toolResult {
                Text(result)
                    .font(.system(.caption, design: .monospaced))
                    .padding(.top, 4)
            }
        } label: {
            HStack {
                statusIcon
                Text(message.toolName ?? "Tool")
                    .font(.subheadline.bold())
            }
        }
        .padding(10)
        .background(Color.gray.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
