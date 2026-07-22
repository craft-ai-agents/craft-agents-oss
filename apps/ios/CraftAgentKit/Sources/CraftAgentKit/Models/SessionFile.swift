import Foundation

/// Mirrors `SessionFile` in `packages/shared/src/protocol/dto.ts` — the
/// recursive file tree returned by `sessions:getFiles`.
public struct SessionFile: Codable, Equatable, Identifiable, Sendable {
    public let name: String
    public let path: String
    /// "file" or "directory".
    public let type: String
    public let size: Double?
    public let children: [SessionFile]?

    public var id: String { path }
    public var isDirectory: Bool { type == "directory" }

    public init(
        name: String,
        path: String,
        type: String,
        size: Double? = nil,
        children: [SessionFile]? = nil
    ) {
        self.name = name
        self.path = path
        self.type = type
        self.size = size
        self.children = children
    }
}
