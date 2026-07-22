import XCTest
@testable import CraftAgentKit

final class JSONValueTests: XCTestCase {
    func testRoundTripsMixedJSON() throws {
        let json = """
        {"a": 1, "b": "text", "c": true, "d": null, "e": [1, "two", false], "f": {"nested": 2.5}}
        """
        let data = Data(json.utf8)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)

        guard case .object(let obj) = decoded else {
            return XCTFail("expected object")
        }
        XCTAssertEqual(obj["a"], .number(1))
        XCTAssertEqual(obj["b"], .string("text"))
        XCTAssertEqual(obj["c"], .bool(true))
        XCTAssertEqual(obj["d"], .null)
        XCTAssertEqual(obj["e"], .array([.number(1), .string("two"), .bool(false)]))
        XCTAssertEqual(obj["f"], .object(["nested": .number(2.5)]))

        // Re-encode and decode again — must be stable.
        let reencoded = try JSONEncoder().encode(decoded)
        let redecoded = try JSONDecoder().decode(JSONValue.self, from: reencoded)
        XCTAssertEqual(decoded, redecoded)
    }
}
