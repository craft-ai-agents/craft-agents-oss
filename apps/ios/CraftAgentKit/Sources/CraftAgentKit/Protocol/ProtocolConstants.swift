import Foundation

/// Mirrors the constants exported from `packages/shared/src/protocol/types.ts`.
public enum ProtocolConstants {
    public static let protocolVersion = "1.0"
    public static let heartbeatIntervalMs: UInt64 = 30_000
    public static let heartbeatMaxMissed = 2
    public static let requestTimeoutMs: UInt64 = 30_000
    public static let eventBufferMaxSize = 500
    public static let eventBufferTtlMs: UInt64 = 30_000
    public static let disconnectedClientTtlMs: UInt64 = 60_000
    public static let sequenceAckIntervalMs: UInt64 = 5_000
}
