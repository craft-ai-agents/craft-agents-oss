// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/MessageBubble.swift
import SwiftUI
import CraftAgentKit

/// Renders user messages as compact bubbles and assistant output as a document
/// surface, matching the desktop hierarchy without copying its chrome.
struct MessageBubble: View {
    let message: ChatMessage

    private var isUser: Bool { message.role == .user }

    @ViewBuilder
    var body: some View {
        switch message.role {
        case .user:
            content
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: 620, alignment: .trailing)
                .background(
                    CraftTheme.accent.opacity(0.13),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
        case .plan:
            semanticCard(
                title: "Plan",
                systemImage: "list.bullet.clipboard",
                color: .green
            )
        case .error:
            semanticCard(
                title: "Error",
                systemImage: "exclamationmark.octagon.fill",
                color: .red
            )
        case .warning:
            semanticCard(
                title: "Warning",
                systemImage: "exclamationmark.triangle.fill",
                color: .orange
            )
        case .status, .info:
            semanticCard(
                title: message.role == .status ? "Status" : "Information",
                systemImage: message.role == .status ? "clock" : "info.circle.fill",
                color: CraftTheme.accent
            )
        case .authRequest:
            semanticCard(
                title: "Authentication required",
                systemImage: "key.fill",
                color: .orange
            )
        default:
            content
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 2)
        }
    }

    private var content: some View {
        VStack(alignment: isUser ? .trailing : .leading, spacing: 6) {
            if let attachments = message.attachments, !attachments.isEmpty {
                ForEach(attachments) { attachment in
                    AttachmentThumbnail(attachment: attachment)
                }
            }
            if !message.content.isEmpty {
                MarkdownText(markdown: message.content)
            }
        }
        .textSelection(.enabled)
    }

    private func semanticCard(title: String, systemImage: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(color.opacity(0.18))
        }
    }
}

/// Shows a persisted attachment: an image (from its base64 thumbnail) or a
/// labeled chip for non-image files.
struct AttachmentThumbnail: View {
    let attachment: StoredAttachment

    var body: some View {
        if attachment.isImage, let image = decodedImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(maxWidth: 200, maxHeight: 200)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            Label(attachment.name, systemImage: icon)
                .font(.caption)
                .padding(6)
                .background(Color.secondary.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private var decodedImage: UIImage? {
        guard let base64 = attachment.thumbnailBase64,
              let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }

    private var icon: String {
        switch attachment.type {
        case "pdf": return "doc.richtext"
        case "office": return "doc.text"
        case "audio": return "waveform"
        case "text": return "doc.plaintext"
        default: return "doc"
        }
    }
}

/// A pending (not-yet-sent) attachment shown in the input area, with a remove
/// button. Images render from the picked bytes (`FileAttachment.base64`).
struct PendingAttachmentChip: View {
    let attachment: FileAttachment
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            content
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.white, .black.opacity(0.6))
            }
            .padding(2)
        }
    }

    @ViewBuilder
    private var content: some View {
        if attachment.type == .image, let image = decodedImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 60, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 8))
        } else {
            VStack(spacing: 2) {
                Image(systemName: "doc")
                Text(attachment.name).lineLimit(1).font(.caption2)
            }
            .frame(width: 60, height: 60)
            .background(Color.secondary.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private var decodedImage: UIImage? {
        guard let base64 = attachment.base64,
              let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }
}
