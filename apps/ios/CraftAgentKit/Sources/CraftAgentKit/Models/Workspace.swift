// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Models/Workspace.swift
import Foundation

/// Mirrors the MVP-relevant fields returned by `server:getWorkspaces`
/// (`packages/server-core/src/handlers/rpc/workspace.ts`).
public struct Workspace: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let name: String
}
