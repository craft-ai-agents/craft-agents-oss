import Foundation

public enum ImageMode: String, Decodable, Encodable, Hashable, Sendable {
    case path
    case base64
    case omit
}

public enum StateDebugModeDTO: String, Decodable, Encodable, Sendable {
    case none
    case summary
    case full
}

public enum MouseButtonDTO: String, Decodable, Encodable, Sendable {
    case left
    case right
    case middle
}

public enum ResizeHandleDTO: String, Decodable, Encodable, Sendable {
    case left
    case right
    case top
    case bottom
    case topLeft
    case topRight
    case bottomLeft
    case bottomRight
}

public enum ScrollDirectionDTO: String, Decodable, Encodable, Sendable {
    case up
    case down
    case left
    case right
}

public enum ActionVerificationModeDTO: String, Decodable, Encodable, Sendable {
    case strict
    case fast
}

public enum CoordinateSpaceDTO: String, Decodable, Encodable, Sendable {
    case modelFacingScreenshot
    case rawRetinaCapture
    case windowLocalTopLeft
    case windowLocalAppKitBottomLeft
    case globalEventTapTopLeft
    case axGlobalTopLeft
    case appKitGlobal
}

public enum MotionPresentationModeDTO: String, Encodable, Sendable {
    case none
    case drag
    case resize
    case dragThenResize
}

public struct CursorRequestDTO: Decodable, Encodable, Sendable {
    public let id: String?
    public let name: String?
    public let color: String?

    public init(id: String? = nil, name: String? = nil, color: String? = nil) {
        self.id = id
        self.name = name
        self.color = color
    }
}

public struct CursorResponseDTO: Encodable, Sendable {
    public let id: String
    public let name: String
    public let color: String
    public let reused: Bool

    public init(id: String, name: String, color: String, reused: Bool) {
        self.id = id
        self.name = name
        self.color = color
        self.reused = reused
    }
}

public struct ActionErrorDTO: Encodable, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}
