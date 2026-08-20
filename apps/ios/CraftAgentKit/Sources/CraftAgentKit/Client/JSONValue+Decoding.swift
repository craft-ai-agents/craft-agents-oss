// apps/ios/CraftAgentKit/Sources/CraftAgentKit/Client/JSONValue+Decoding.swift
import Foundation

extension JSONValue {
    /// Bridges a dynamically-typed `JSONValue` (as returned by
    /// `RPCTransport.request`) into a concrete `Decodable` model, by
    /// round-tripping through `Data`. This is the one conversion point
    /// between the transport layer and typed domain models.
    public func decoded<T: Decodable>() throws -> T {
        let data = try JSONEncoder().encode(self)
        return try JSONDecoder().decode(T.self, from: data)
    }
}
