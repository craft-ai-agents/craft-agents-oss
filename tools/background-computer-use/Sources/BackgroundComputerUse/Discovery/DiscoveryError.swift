import Foundation

enum DiscoveryError: Error {
    case accessibilityDenied
    case appNotFound(String)
    case windowNotFound(String)
}
