import Foundation

/// Read-only view of a workspace skill, as returned by `skills:get`
/// (`LoadedSkill` in `packages/shared/src/skills/types.ts`). Only `slug` and
/// the display metadata are decoded; content and paths are ignored.
public struct Skill: Codable, Equatable, Identifiable, Sendable {
    public struct Metadata: Codable, Equatable, Sendable {
        public let name: String
        public let description: String
        public let icon: String?

        public init(name: String, description: String, icon: String? = nil) {
            self.name = name
            self.description = description
            self.icon = icon
        }
    }

    public let slug: String
    public let metadata: Metadata
    /// "workspace" | "global" | "project".
    public let source: String?

    public var id: String { slug }
    public var name: String { metadata.name }

    public init(slug: String, metadata: Metadata, source: String? = nil) {
        self.slug = slug
        self.metadata = metadata
        self.source = source
    }
}
