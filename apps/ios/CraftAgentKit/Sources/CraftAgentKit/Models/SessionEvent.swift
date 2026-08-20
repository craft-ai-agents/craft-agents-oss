import Foundation

/// Mirrors the MVP-relevant subset of the `SessionEvent` discriminated union
/// in `packages/shared/src/protocol/dto.ts`. Decoding an unrecognized `type`
/// yields `.unknown(type)` rather than throwing, so the client tolerates
/// server-side additions without a matching app release.
public enum SessionEvent: Equatable, Sendable {
    case textDelta(sessionId: String, delta: String, turnId: String?)
    case textComplete(sessionId: String, text: String)
    case toolStart(sessionId: String, toolName: String, toolUseId: String, toolInput: [String: JSONValue])
    case toolResult(sessionId: String, toolUseId: String, toolName: String, result: String, isError: Bool?)
    case errorEvent(sessionId: String, error: String)
    case complete(sessionId: String)
    case status(sessionId: String, message: String)
    case permissionRequest(sessionId: String, request: PermissionRequest)
    case credentialRequest(sessionId: String, request: CredentialRequest)
    case permissionModeChanged(sessionId: String, permissionMode: String)
    case sessionModelChanged(sessionId: String, model: String?)
    case userMessage(sessionId: String, message: ChatMessage, status: String)
    case sessionCreated(sessionId: String)
    case sessionDeleted(sessionId: String)
    case nameChanged(sessionId: String, name: String?)
    case sessionStatusChanged(sessionId: String, sessionStatus: String)
    case unknown(String)
}

extension SessionEvent: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, sessionId, delta, turnId, text, toolName, toolUseId, toolInput
        case result, isError, error, message, statusType, request, status
        case name, sessionStatus, permissionMode, model
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        let sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId) ?? ""

        switch type {
        case "text_delta":
            self = .textDelta(
                sessionId: sessionId,
                delta: try container.decode(String.self, forKey: .delta),
                turnId: try container.decodeIfPresent(String.self, forKey: .turnId)
            )
        case "text_complete":
            self = .textComplete(sessionId: sessionId, text: try container.decode(String.self, forKey: .text))
        case "tool_start":
            self = .toolStart(
                sessionId: sessionId,
                toolName: try container.decode(String.self, forKey: .toolName),
                toolUseId: try container.decode(String.self, forKey: .toolUseId),
                toolInput: try container.decodeIfPresent([String: JSONValue].self, forKey: .toolInput) ?? [:]
            )
        case "tool_result":
            self = .toolResult(
                sessionId: sessionId,
                toolUseId: try container.decode(String.self, forKey: .toolUseId),
                toolName: try container.decode(String.self, forKey: .toolName),
                result: try container.decode(String.self, forKey: .result),
                isError: try container.decodeIfPresent(Bool.self, forKey: .isError)
            )
        case "error":
            self = .errorEvent(sessionId: sessionId, error: try container.decode(String.self, forKey: .error))
        case "complete":
            self = .complete(sessionId: sessionId)
        case "status":
            self = .status(sessionId: sessionId, message: try container.decode(String.self, forKey: .message))
        case "permission_request":
            self = .permissionRequest(
                sessionId: sessionId,
                request: try container.decode(PermissionRequest.self, forKey: .request)
            )
        case "credential_request":
            self = .credentialRequest(
                sessionId: sessionId,
                request: try container.decode(CredentialRequest.self, forKey: .request)
            )
        case "permission_mode_changed":
            self = .permissionModeChanged(
                sessionId: sessionId,
                permissionMode: try container.decode(String.self, forKey: .permissionMode)
            )
        case "session_model_changed":
            self = .sessionModelChanged(
                sessionId: sessionId,
                model: try container.decodeIfPresent(String.self, forKey: .model)
            )
        case "user_message":
            self = .userMessage(
                sessionId: sessionId,
                message: try container.decode(ChatMessage.self, forKey: .message),
                status: try container.decode(String.self, forKey: .status)
            )
        case "session_created":
            self = .sessionCreated(sessionId: sessionId)
        case "session_deleted":
            self = .sessionDeleted(sessionId: sessionId)
        case "name_changed":
            self = .nameChanged(sessionId: sessionId, name: try container.decodeIfPresent(String.self, forKey: .name))
        case "session_status_changed":
            self = .sessionStatusChanged(
                sessionId: sessionId,
                sessionStatus: try container.decode(String.self, forKey: .sessionStatus)
            )
        default:
            self = .unknown(type)
        }
    }

    public func encode(to encoder: Encoder) throws {
        // The client never re-encodes a SessionEvent onto the wire (it only
        // sends explicit RPC requests) — this satisfies `Codable` for
        // symmetry/testability but is not on any real send path.
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .textDelta(let sessionId, let delta, let turnId):
            try container.encode("text_delta", forKey: .type)
            try container.encode(sessionId, forKey: .sessionId)
            try container.encode(delta, forKey: .delta)
            try container.encodeIfPresent(turnId, forKey: .turnId)
        default:
            try container.encode("unknown", forKey: .type)
        }
    }
}
