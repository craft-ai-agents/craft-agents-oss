import Foundation

/// Mirrors `StatusConfig` in `packages/shared/src/statuses/types.ts`, returned
/// by `statuses:list`. `color` is decoded as a dynamic value because the
/// server's `EntityColor` may be either a string or an object.
public struct WorkspaceStatus: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    /// Display name (the server field is `label`).
    public let label: String
    public let color: JSONValue?
    public let icon: String?

    public init(id: String, label: String, color: JSONValue? = nil, icon: String? = nil) {
        self.id = id
        self.label = label
        self.color = color
        self.icon = icon
    }
}
