import Foundation

extension FileAttachment {
    /// Builds an image `FileAttachment` from raw bytes (e.g. from
    /// `PhotosPicker`/`UIImage.jpegData`). `path` is set to `name` — the
    /// server only uses `path` as a display fallback for locally-referenced
    /// files, which does not apply to attachments sent from a remote client.
    public static func image(named name: String, data: Data, mimeType: String) -> FileAttachment {
        FileAttachment(
            type: .image,
            path: name,
            name: name,
            mimeType: mimeType,
            base64: data.base64EncodedString(),
            text: nil,
            size: data.count,
            thumbnailBase64: nil
        )
    }

    /// Maximum inline text payload, mirroring `MAX_TEXT_SIZE` in
    /// `packages/shared/src/utils/files.ts` (100 KB).
    public static let maxInlineTextBytes = 100 * 1024

    /// Builds a document/file `FileAttachment` from raw bytes, classifying the
    /// type by file extension the same way the server's `getFileType` does
    /// (`packages/shared/src/utils/files.ts`). Binary types (pdf, office,
    /// audio, image) are sent as base64; text/code files are sent inline as
    /// UTF-8 `text` (truncated to `maxInlineTextBytes`). A file classified as
    /// text that isn't valid UTF-8 falls back to base64 with type `.unknown`.
    public static func document(named name: String, data: Data, mimeType: String) -> FileAttachment {
        let ext = "." + (name as NSString).pathExtension.lowercased()
        var type = classify(extension: ext)
        var base64: String?
        var text: String?

        if type == .text {
            if let decoded = String(data: data, encoding: .utf8) {
                if data.count > maxInlineTextBytes {
                    let head = String(decoding: data.prefix(maxInlineTextBytes), as: UTF8.self)
                    text = head + "\n\n[File truncated — showing first \(maxInlineTextBytes / 1024)KB of \(data.count / 1024)KB]"
                } else {
                    text = decoded
                }
            } else {
                // Not valid UTF-8 — send raw bytes instead of garbled text.
                type = .unknown
                base64 = data.base64EncodedString()
            }
        } else {
            base64 = data.base64EncodedString()
        }

        return FileAttachment(
            type: type,
            path: name,
            name: name,
            mimeType: mimeType,
            base64: base64,
            text: text,
            size: data.count,
            thumbnailBase64: nil
        )
    }

    /// Mirrors the extension → type mapping in the server's `getFileType`.
    static func classify(extension ext: String) -> Kind {
        if imageExtensions.contains(ext) { return .image }
        if ext == ".pdf" { return .pdf }
        if officeExtensions.contains(ext) { return .office }
        if audioExtensions.contains(ext) { return .audio }
        // Everything else (including unknown extensions) is treated as text —
        // matching the server's fallback behavior.
        return .text
    }

    private static let imageExtensions: Set<String> = [
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".heic", ".heif", ".tiff", ".svg",
    ]
    private static let officeExtensions: Set<String> = [
        ".docx", ".xlsx", ".pptx", ".doc", ".xls", ".ppt",
    ]
    private static let audioExtensions: Set<String> = [
        ".ogg", ".opus", ".mp3", ".m4a", ".aac", ".wav", ".flac", ".weba", ".webm",
    ]
}
