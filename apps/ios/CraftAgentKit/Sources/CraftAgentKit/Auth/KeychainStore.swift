import Foundation
#if canImport(Security)
import Security

/// Real Keychain-backed `KeychainStoring`. Only available on Apple platforms
/// that provide the Security framework (iOS app target, not `swift test` on Linux).
///
/// On unsigned builds (e.g. a simulator app built with
/// `CODE_SIGNING_ALLOWED=NO`, or any build lacking the keychain entitlement),
/// the Keychain returns `errSecMissingEntitlement` (-34018). To stay usable in
/// those development scenarios, the store transparently falls back to a
/// per-app sandbox file. Properly signed device/production builds always use
/// the Keychain and never touch the fallback.
public struct KeychainStore: KeychainStoring {
    private let service: String
    private let fallback: FileFallbackStore

    public init(service: String = "do.craft.agents.ios") {
        self.service = service
        self.fallback = FileFallbackStore(namespace: service)
    }

    public func save(_ data: Data, forKey key: String) async throws {
        try? await delete(forKey: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        if status == errSecSuccess { return }
        if Self.isEntitlementFailure(status) {
            try fallback.save(data, forKey: key)
            return
        }
        throw NSError(domain: "KeychainStore", code: Int(status))
    }

    public func load(forKey key: String) async throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess { return result as? Data }
        // If the Keychain has no entry, a prior fallback write may still hold it.
        if status == errSecItemNotFound { return try fallback.load(forKey: key) }
        if Self.isEntitlementFailure(status) { return try fallback.load(forKey: key) }
        throw NSError(domain: "KeychainStore", code: Int(status))
    }

    public func delete(forKey key: String) async throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        try? fallback.delete(forKey: key)
    }

    /// Keychain returned an entitlement/availability error, meaning the real
    /// Keychain cannot be used by this (unsigned) build.
    private static func isEntitlementFailure(_ status: OSStatus) -> Bool {
        status == errSecMissingEntitlement || status == errSecNotAvailable
    }
}

/// Minimal per-app file store used only when the Keychain is unavailable.
/// Writes one protected file per key under Application Support.
struct FileFallbackStore {
    private let directory: URL

    init(namespace: String) {
        let base = (try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )) ?? FileManager.default.temporaryDirectory
        self.directory = base.appendingPathComponent("CraftAgentKit/\(namespace)", isDirectory: true)
    }

    private func fileURL(forKey key: String) -> URL {
        let safe = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key
        return directory.appendingPathComponent(safe)
    }

    func save(_ data: Data, forKey key: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: fileURL(forKey: key), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func load(forKey key: String) throws -> Data? {
        let url = fileURL(forKey: key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try Data(contentsOf: url)
    }

    func delete(forKey key: String) throws {
        let url = fileURL(forKey: key)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }
}
#endif
