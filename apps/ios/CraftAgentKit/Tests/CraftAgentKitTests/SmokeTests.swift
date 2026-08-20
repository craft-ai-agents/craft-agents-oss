// apps/ios/CraftAgentKit/Tests/CraftAgentKitTests/SmokeTests.swift
import XCTest
@testable import CraftAgentKit

final class SmokeTests: XCTestCase {
    func testPackageBuilds() {
        XCTAssertEqual(CraftAgentKit.supportedProtocolVersion, "1.0")
    }
}
