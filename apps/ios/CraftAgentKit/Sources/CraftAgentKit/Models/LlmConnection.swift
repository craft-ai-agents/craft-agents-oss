import Foundation

/// One selectable model within an `LlmConnection`. The server's `models` array
/// contains either bare id strings or `ModelDefinition` objects
/// (`packages/shared/src/config/models.ts`), so this decodes both forms.
public struct LlmModel: Codable, Equatable, Identifiable, Sendable {
    public let modelId: String
    public let name: String?

    public var id: String { modelId }
    public var displayName: String { name ?? modelId }

    public init(modelId: String, name: String? = nil) {
        self.modelId = modelId
        self.name = name
    }

    private enum CodingKeys: String, CodingKey { case id, name }

    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(), let raw = try? single.decode(String.self) {
            self.modelId = raw
            self.name = nil
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.modelId = try container.decode(String.self, forKey: .id)
        self.name = try container.decodeIfPresent(String.self, forKey: .name)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(modelId, forKey: .id)
        try container.encodeIfPresent(name, forKey: .name)
    }
}

/// Read-only view of an LLM connection, as returned by `LLM_Connection:list`
/// (`LlmConnection` in `packages/shared/src/config/llm-connections.ts`).
public struct LlmConnection: Codable, Equatable, Identifiable, Sendable {
    public let slug: String
    public let name: String
    public let providerType: String
    public let authType: String
    public let defaultModel: String?
    public let models: [LlmModel]?

    public var id: String { slug }

    /// De-duplicated list of selectable models, ensuring `defaultModel` appears.
    public var selectableModels: [LlmModel] {
        var seen = Set<String>()
        var result: [LlmModel] = []
        for model in models ?? [] where seen.insert(model.modelId).inserted {
            result.append(model)
        }
        if let defaultModel, seen.insert(defaultModel).inserted {
            result.append(LlmModel(modelId: defaultModel))
        }
        return result
    }

    public init(
        slug: String,
        name: String,
        providerType: String,
        authType: String,
        defaultModel: String? = nil,
        models: [LlmModel]? = nil
    ) {
        self.slug = slug
        self.name = name
        self.providerType = providerType
        self.authType = authType
        self.defaultModel = defaultModel
        self.models = models
    }
}
