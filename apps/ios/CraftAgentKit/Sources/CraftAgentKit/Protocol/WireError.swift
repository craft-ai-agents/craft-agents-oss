import Foundation

/// Mirrors `ErrorCode` in `packages/shared/src/protocol/types.ts`.
/// Unknown wire values decode to `.unknown(rawValue)` instead of throwing,
/// so a client on an older build tolerates new server-side error codes.
public enum ErrorCode: Equatable, Sendable {
    case handlerError
    case channelNotFound
    case authFailed
    case protocolVersionUnsupported
    case sessionNotIdle
    case sessionIdConflict
    case artifactNotPortable
    case transferTooLarge
    case transferTimeout
    case transferVerificationFailed
    case requestTimeout
    case capabilityUnavailable
    case clientDisconnected
    case clientRequestTimeout
    case browserNoCapableClient
    case browserInstanceNotOwned
    case browserRemoteUploadNotSupported
    case browserRemoteEvaluateBlocked
    case unknown(String)

    private static let wireMap: [String: ErrorCode] = [
        "HANDLER_ERROR": .handlerError,
        "CHANNEL_NOT_FOUND": .channelNotFound,
        "AUTH_FAILED": .authFailed,
        "PROTOCOL_VERSION_UNSUPPORTED": .protocolVersionUnsupported,
        "SESSION_NOT_IDLE": .sessionNotIdle,
        "SESSION_ID_CONFLICT": .sessionIdConflict,
        "ARTIFACT_NOT_PORTABLE": .artifactNotPortable,
        "TRANSFER_TOO_LARGE": .transferTooLarge,
        "TRANSFER_TIMEOUT": .transferTimeout,
        "TRANSFER_VERIFICATION_FAILED": .transferVerificationFailed,
        "REQUEST_TIMEOUT": .requestTimeout,
        "CAPABILITY_UNAVAILABLE": .capabilityUnavailable,
        "CLIENT_DISCONNECTED": .clientDisconnected,
        "CLIENT_REQUEST_TIMEOUT": .clientRequestTimeout,
        "BROWSER_NO_CAPABLE_CLIENT": .browserNoCapableClient,
        "BROWSER_INSTANCE_NOT_OWNED": .browserInstanceNotOwned,
        "BROWSER_REMOTE_UPLOAD_NOT_SUPPORTED": .browserRemoteUploadNotSupported,
        "BROWSER_REMOTE_EVALUATE_BLOCKED": .browserRemoteEvaluateBlocked,
    ]

    init(wireValue: String) {
        self = Self.wireMap[wireValue] ?? .unknown(wireValue)
    }

    var wireValue: String {
        for (key, value) in Self.wireMap where value == self { return key }
        if case .unknown(let raw) = self { return raw }
        return "HANDLER_ERROR"
    }
}

extension ErrorCode: Codable {
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = ErrorCode(wireValue: raw)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(wireValue)
    }
}

/// Mirrors `WireError` in `packages/shared/src/protocol/types.ts`.
public struct WireError: Codable, Equatable, Sendable {
    public let code: ErrorCode
    public let message: String
    public let data: JSONValue?
}
