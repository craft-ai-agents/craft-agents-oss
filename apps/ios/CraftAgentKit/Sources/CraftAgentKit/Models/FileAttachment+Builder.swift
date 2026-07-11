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
}
