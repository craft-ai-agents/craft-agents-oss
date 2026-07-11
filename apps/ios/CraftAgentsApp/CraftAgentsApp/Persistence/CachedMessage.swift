// apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedMessage.swift
import Foundation
import SwiftData

@Model
final class CachedMessage {
    @Attribute(.unique) var id: String
    var sessionId: String
    var role: String
    var content: String
    var timestamp: Double

    init(id: String, sessionId: String, role: String, content: String, timestamp: Double) {
        self.id = id
        self.sessionId = sessionId
        self.role = role
        self.content = content
        self.timestamp = timestamp
    }
}
