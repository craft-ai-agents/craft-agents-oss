import Foundation

/// Mirrors `UnreadSummary` in `packages/shared/src/protocol/dto.ts`.
public struct UnreadSummary: Codable, Equatable, Sendable {
    public let totalUnreadSessions: Int
    public let byWorkspace: [String: Int]
    public let hasUnreadByWorkspace: [String: Bool]

    public init(
        totalUnreadSessions: Int,
        byWorkspace: [String: Int] = [:],
        hasUnreadByWorkspace: [String: Bool] = [:]
    ) {
        self.totalUnreadSessions = totalUnreadSessions
        self.byWorkspace = byWorkspace
        self.hasUnreadByWorkspace = hasUnreadByWorkspace
    }
}
