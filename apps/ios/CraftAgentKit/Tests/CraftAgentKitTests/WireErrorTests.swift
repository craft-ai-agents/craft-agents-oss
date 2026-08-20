import XCTest
@testable import CraftAgentKit

final class WireErrorTests: XCTestCase {
    func testDecodesKnownErrorCode() throws {
        let json = Data("""
        {"code": "AUTH_FAILED", "message": "Invalid token"}
        """.utf8)
        let error = try JSONDecoder().decode(WireError.self, from: json)
        XCTAssertEqual(error.code, .authFailed)
        XCTAssertEqual(error.message, "Invalid token")
        XCTAssertNil(error.data)
    }

    func testUnknownErrorCodeDecodesToUnknownCase() throws {
        // Forward-compat: the server may add new codes; the client must not crash.
        let json = Data("""
        {"code": "SOME_FUTURE_CODE", "message": "future"}
        """.utf8)
        let error = try JSONDecoder().decode(WireError.self, from: json)
        XCTAssertEqual(error.code, .unknown("SOME_FUTURE_CODE"))
    }
}
