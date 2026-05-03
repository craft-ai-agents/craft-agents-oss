import Foundation

public struct RunningAppDTO: Encodable, Sendable {
    public let name: String
    public let bundleID: String
    public let pid: Int32
    public let launchDate: String?
    public let activationPolicy: String
    public let isActive: Bool
    public let isHidden: Bool
    public let isFrontmost: Bool
    public let onscreenWindowCount: Int
}

public struct ListAppsResponse: Encodable, Sendable {
    public let contractVersion: String
    public let frontmostApp: RunningAppDTO?
    public let runningApps: [RunningAppDTO]
    public let notes: [String]
}

public struct RectDTO: Codable, Sendable {
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = sanitizedJSONDouble(x)
        self.y = sanitizedJSONDouble(y)
        self.width = sanitizedJSONDouble(width)
        self.height = sanitizedJSONDouble(height)
    }
}

public struct WindowDTO: Encodable, Sendable {
    public let windowID: String
    public let title: String
    public let bundleID: String
    public let pid: Int32
    public let launchDate: String?
    public let role: String?
    public let subrole: String?
    public let windowNumber: Int
    public let frameAppKit: RectDTO
    public let isFocused: Bool
    public let isMain: Bool
    public let isMinimized: Bool
    public let isOnScreen: Bool
}

public struct AppReferenceDTO: Encodable, Sendable {
    public let name: String
    public let bundleID: String
    public let pid: Int32
    public let launchDate: String?
}

public struct ListWindowsResponse: Encodable, Sendable {
    public let contractVersion: String
    public let app: AppReferenceDTO
    public let windows: [WindowDTO]
    public let notes: [String]
}
