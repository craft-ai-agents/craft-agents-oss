// apps/ios/CraftAgentsApp/CraftAgentsApp/Persistence/CachedSession.swift
import Foundation
import SwiftData

@Model
final class CachedSession {
    @Attribute(.unique) var id: String
    var workspaceId: String
    var workspaceName: String
    var name: String?
    var preview: String?
    var lastMessageAt: Double
    var isProcessing: Bool
    var sessionStatus: String?

    init(id: String, workspaceId: String, workspaceName: String, name: String?, preview: String?, lastMessageAt: Double, isProcessing: Bool, sessionStatus: String?) {
        self.id = id
        self.workspaceId = workspaceId
        self.workspaceName = workspaceName
        self.name = name
        self.preview = preview
        self.lastMessageAt = lastMessageAt
        self.isProcessing = isProcessing
        self.sessionStatus = sessionStatus
    }
}
