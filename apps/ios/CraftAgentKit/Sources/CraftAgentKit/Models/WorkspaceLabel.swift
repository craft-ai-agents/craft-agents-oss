import Foundation

/// Mirrors `LabelConfig` in `packages/shared/src/labels/types.ts` — the
/// recursive label tree. `color` is decoded dynamically (`EntityColor` may be a
/// string or an object).
public struct WorkspaceLabel: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
    public let color: JSONValue?
    public let valueType: String?
    public let children: [WorkspaceLabel]?

    public init(
        id: String,
        name: String,
        color: JSONValue? = nil,
        valueType: String? = nil,
        children: [WorkspaceLabel]? = nil
    ) {
        self.id = id
        self.name = name
        self.color = color
        self.valueType = valueType
        self.children = children
    }
}

/// Mirrors `WorkspaceLabelConfig` — the envelope `labels:list` returns.
public struct WorkspaceLabelConfig: Codable, Equatable, Sendable {
    public let labels: [WorkspaceLabel]?

    public init(labels: [WorkspaceLabel]? = nil) {
        self.labels = labels
    }
}

/// Mirrors `CreateLabelInput` — payload for `labels:create`.
public struct CreateLabelInput: Codable, Equatable, Sendable {
    public let name: String
    public let parentId: String?
    public let valueType: String?

    public init(name: String, parentId: String? = nil, valueType: String? = nil) {
        self.name = name
        self.parentId = parentId
        self.valueType = valueType
    }
}
