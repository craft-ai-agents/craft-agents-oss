import Foundation

/// Mirrors `FileAttachment` in `packages/shared/src/protocol/dto.ts`.
public struct FileAttachment: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case image, text, pdf, office, audio, unknown
    }

    public var type: Kind
    public var path: String
    public var name: String
    public var mimeType: String
    public var base64: String?
    public var text: String?
    public var size: Int
    public var thumbnailBase64: String?
}
