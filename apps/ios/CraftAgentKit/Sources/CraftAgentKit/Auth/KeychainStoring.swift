import Foundation

/// Minimal key-value secure storage abstraction so `ServerConnectionStore`
/// can be unit-tested without touching the real iOS Keychain.
public protocol KeychainStoring: Sendable {
    func save(_ data: Data, forKey key: String) throws
    func load(forKey key: String) throws -> Data?
    func delete(forKey key: String) throws
}

public actor InMemoryKeychainStore: KeychainStoring {
    private var storage: [String: Data] = [:]
    public init() {}
    public func save(_ data: Data, forKey key: String) throws { storage[key] = data }
    public func load(forKey key: String) throws -> Data? { storage[key] }
    public func delete(forKey key: String) throws { storage.removeValue(forKey: key) }
}
