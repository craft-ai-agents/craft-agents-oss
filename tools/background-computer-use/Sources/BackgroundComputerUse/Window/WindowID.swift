import CryptoKit
import Foundation

enum WindowID {
    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    static func make(bundleID: String, pid: pid_t, launchDate: Date?, windowNumber: Int) -> String {
        let launchDateComponent = launchDate.map(Time.iso8601String) ?? "nil"
        let payload = "\(bundleID)|\(pid)|\(launchDateComponent)|\(windowNumber)"
        let digest = SHA256.hash(data: Data(payload.utf8))

        var value: UInt64 = 0
        for byte in digest.prefix(5) {
            value = (value << 8) | UInt64(byte)
        }

        var characters = Array(repeating: Character("0"), count: 8)
        for index in stride(from: 7, through: 0, by: -1) {
            characters[index] = alphabet[Int(value & 31)]
            value >>= 5
        }

        return "w_\(String(characters))"
    }
}
