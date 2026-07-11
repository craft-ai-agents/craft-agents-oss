import Foundation

/// Mirrors the return of `sessions:getPermissionModeState` in
/// `packages/server-core/src/sessions/SessionManager.ts`.
public struct PermissionModeState: Codable, Equatable, Sendable {
    public let permissionMode: String
    public let previousPermissionMode: String?
    public let transitionDisplay: String?
    public let modeVersion: Int
    public let changedAt: String
    public let changedBy: String

    public init(
        permissionMode: String,
        previousPermissionMode: String? = nil,
        transitionDisplay: String? = nil,
        modeVersion: Int,
        changedAt: String,
        changedBy: String
    ) {
        self.permissionMode = permissionMode
        self.previousPermissionMode = previousPermissionMode
        self.transitionDisplay = transitionDisplay
        self.modeVersion = modeVersion
        self.changedAt = changedAt
        self.changedBy = changedBy
    }
}

/// The three fixed permission modes (mirrors `PermissionMode` in shared config).
public enum PermissionMode: String, Codable, Sendable, CaseIterable {
    case safe
    case ask
    case allowAll = "allow-all"
}
