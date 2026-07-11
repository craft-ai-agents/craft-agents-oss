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
/// The wire ids are fixed (`safe`/`ask`/`allow-all`); the display names match
/// the desktop client (Explore / Ask / Execute — see `mode.*` in the shared
/// i18n catalog).
public enum PermissionMode: String, Codable, Sendable, CaseIterable {
    case safe
    case ask
    case allowAll = "allow-all"

    /// User-facing label matching the desktop client.
    public var displayName: String {
        switch self {
        case .safe: return "Explore"
        case .ask: return "Ask"
        case .allowAll: return "Execute"
        }
    }

    /// Short description shown under the label in the desktop client.
    public var detail: String {
        switch self {
        case .safe: return "Read-only, no changes allowed"
        case .ask: return "Prompts before making edits"
        case .allowAll: return "Full autonomous execution"
        }
    }

    /// Maps a raw wire id (which may be `safe`/`ask`/`allow-all`) to a mode.
    public static func from(rawId: String?) -> PermissionMode? {
        guard let rawId else { return nil }
        return PermissionMode(rawValue: rawId)
    }
}
