import Foundation

/// Mirrors `StoredAttachment` in `packages/core/src/types/message.ts` — the
/// persisted attachment echoed back on a user message. A remote client cannot
/// read `storedPath` (server-side disk), so image display uses
/// `thumbnailBase64` (a base64 PNG the server generates for the renderer).
public struct StoredAttachment: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    /// "image" | "text" | "pdf" | "office" | "audio" | "unknown".
    public let type: String
    public let name: String
    public let mimeType: String
    public let size: Int
    public let thumbnailBase64: String?

    public var isImage: Bool { type == "image" }

    public init(
        id: String,
        type: String,
        name: String,
        mimeType: String,
        size: Int,
        thumbnailBase64: String? = nil
    ) {
        self.id = id
        self.type = type
        self.name = name
        self.mimeType = mimeType
        self.size = size
        self.thumbnailBase64 = thumbnailBase64
    }

    private enum CodingKeys: String, CodingKey {
        case id, type, name, mimeType, size, thumbnailBase64
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        self.type = try c.decodeIfPresent(String.self, forKey: .type) ?? "unknown"
        self.name = try c.decodeIfPresent(String.self, forKey: .name) ?? "attachment"
        self.mimeType = try c.decodeIfPresent(String.self, forKey: .mimeType) ?? "application/octet-stream"
        self.size = try c.decodeIfPresent(Int.self, forKey: .size) ?? 0
        self.thumbnailBase64 = try c.decodeIfPresent(String.self, forKey: .thumbnailBase64)
    }
}
