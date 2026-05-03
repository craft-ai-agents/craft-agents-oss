import ApplicationServices
import Foundation

enum ScreenCaptureAuthorization {
    static func isAuthorized() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    @discardableResult
    static func requestIfNeeded() -> Bool {
        guard isAuthorized() == false else {
            return true
        }
        return CGRequestScreenCaptureAccess()
    }
}
