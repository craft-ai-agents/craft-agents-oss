// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/FileFallbackStoreTests.swift
import XCTest
@testable import CraftAgentKit

#if canImport(Security)
/// Verifies the file fallback used when the Keychain is unavailable
/// (errSecMissingEntitlement) round-trips data and honors deletion.
final class FileFallbackStoreTests: XCTestCase {
    private let namespace = "test-\(UUID().uuidString)"

    func testSaveLoadDeleteRoundTrip() throws {
        let store = FileFallbackStore(namespace: namespace)
        let key = "server-connections"
        let payload = Data("{\"token\":\"abc\"}".utf8)

        XCTAssertNil(try store.load(forKey: key))

        try store.save(payload, forKey: key)
        XCTAssertEqual(try store.load(forKey: key), payload)

        // Overwrite.
        let updated = Data("{\"token\":\"def\"}".utf8)
        try store.save(updated, forKey: key)
        XCTAssertEqual(try store.load(forKey: key), updated)

        try store.delete(forKey: key)
        XCTAssertNil(try store.load(forKey: key))
    }
}
#endif
