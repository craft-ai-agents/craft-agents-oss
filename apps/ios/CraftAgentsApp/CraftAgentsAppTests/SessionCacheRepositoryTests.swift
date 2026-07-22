// apps/ios/CraftAgentsApp/CraftAgentsAppTests/SessionCacheRepositoryTests.swift
import XCTest
import SwiftData
@testable import CraftAgentsApp
import CraftAgentKit

@MainActor
final class SessionCacheRepositoryTests: XCTestCase {
    func testCachesAndReloadsSessionsAndMessages() throws {
        let schema = Schema([CachedSession.self, CachedMessage.self])
        let container = try ModelContainer(for: schema, configurations: [.init(isStoredInMemoryOnly: true)])
        let repository = SessionCacheRepository(modelContainer: container)

        let session = Session(
            id: "s1", workspaceId: "w1", workspaceName: "Default", name: "Cached chat",
            preview: nil, lastMessageAt: 1_700_000_000_000, isProcessing: false,
            isFlagged: nil, permissionMode: nil, sessionStatus: "todo", labels: nil,
            hasUnread: nil, model: nil, messageCount: nil
        )
        try repository.upsert(session)

        let message = ChatMessage(id: "m1", role: .user, content: "hello", timestamp: 1_700_000_000_100)
        try repository.upsert(message, sessionId: "s1")

        let cachedSessions = try repository.cachedSessions()
        XCTAssertEqual(cachedSessions.map(\.id), ["s1"])

        let cachedMessages = try repository.cachedMessages(sessionId: "s1")
        XCTAssertEqual(cachedMessages.map(\.content), ["hello"])
    }
}
