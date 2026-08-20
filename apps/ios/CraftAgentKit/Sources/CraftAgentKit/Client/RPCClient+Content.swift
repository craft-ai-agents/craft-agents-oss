// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/RPCClient+Content.swift
import Foundation

/// A single content-search hit — mirrors `SessionSearchResult` in
/// `packages/shared/src/protocol/dto.ts`.
public struct SessionSearchResult: Codable, Equatable, Identifiable, Sendable {
    public struct Match: Codable, Equatable, Sendable {
        public let sessionId: String
        public let lineNumber: Int
        public let snippet: String
    }

    public let sessionId: String
    public let matchCount: Int
    public let matches: [Match]

    public var id: String { sessionId }
}

/// Session content channels: file tree, notes, and content search. Mirrors the
/// handlers in `packages/server-core/src/handlers/rpc/sessions.ts`.
extension RPCClient {
    /// `sessions:getFiles(sessionId)` — recursive file tree of the session dir.
    public func getFiles(sessionId: String) async throws -> [SessionFile] {
        try await call(RPCChannels.Sessions.getFiles, args: [.string(sessionId)])
    }

    /// `sessions:getNotes(sessionId)` — notes.md content ("" if none).
    public func getNotes(sessionId: String) async throws -> String {
        try await call(RPCChannels.Sessions.getNotes, args: [.string(sessionId)])
    }

    /// `sessions:setNotes(sessionId, content)`.
    public func setNotes(sessionId: String, content: String) async throws {
        try await callVoid(RPCChannels.Sessions.setNotes, args: [.string(sessionId), .string(content)])
    }

    /// `sessions:searchContent(workspaceId, query, searchId?)`.
    public func searchContent(workspaceId: String, query: String, searchId: String? = nil) async throws -> [SessionSearchResult] {
        try await call(RPCChannels.Sessions.searchContent, args: [
            .string(workspaceId),
            .string(query),
            searchId.map { JSONValue.string($0) } ?? .null,
        ])
    }
}
