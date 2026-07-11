// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/MessageBubble.swift
import SwiftUI
import CraftAgentKit

/// Renders a single chat message: any image/file attachments followed by the
/// Markdown-formatted body. User messages are tinted blue; others gray.
struct MessageBubble: View {
    let message: ChatMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
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
        .padding(10)
        .background(isUser ? Color.blue.opacity(0.15) : Color.gray.opacity(0.15))
        .clipShape(RoundedRectangle(cornerRadius: 8))
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
