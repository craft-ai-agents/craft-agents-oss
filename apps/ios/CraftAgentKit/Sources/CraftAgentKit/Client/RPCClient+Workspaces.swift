// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Workspaces.swift
import Foundation

/// Workspace management plus read-only access to sources, skills, and LLM
/// connections. Mirrors handlers in
/// `packages/server-core/src/handlers/rpc/{server,sources,skills,llm-connections}.ts`.
extension RPCClient {
    /// `server:createWorkspace(name)` — creates a workspace and returns it.
    @discardableResult
    public func createWorkspace(name: String) async throws -> Workspace {
        try await call(RPCChannels.Server.createWorkspace, args: [.string(name)])
    }

    /// `sources:get(workspaceId)` — configured sources for a workspace.
    public func getSources(workspaceId: String) async throws -> [Source] {
        try await call(RPCChannels.Sources.get, args: [.string(workspaceId)])
    }

    /// `skills:get(workspaceId, workingDirectory?)`.
    public func getSkills(workspaceId: String, workingDirectory: String? = nil) async throws -> [Skill] {
        try await call(RPCChannels.Skills.get, args: [
            .string(workspaceId),
            workingDirectory.map { JSONValue.string($0) } ?? .null,
        ])
    }

    /// `LLM_Connection:list()` — configured model connections.
    public func listLlmConnections() async throws -> [LlmConnection] {
        try await call(RPCChannels.LlmConnections.list)
    }
}
