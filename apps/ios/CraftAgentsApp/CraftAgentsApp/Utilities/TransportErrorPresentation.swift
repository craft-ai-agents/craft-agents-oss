import Foundation
import CraftAgentKit

func isRecoverableConnectionError(_ error: Error) -> Bool {
    if let transportError = error as? RPCTransport.TransportError {
        return transportError.isConnectionUnavailable
    }
    guard let urlError = error as? URLError else { return false }
    switch urlError.code {
    case .timedOut,
         .cannotFindHost,
         .cannotConnectToHost,
         .networkConnectionLost,
         .dnsLookupFailed,
         .notConnectedToInternet,
         .internationalRoamingOff,
         .callIsActive,
         .dataNotAllowed:
        return true
    default:
        return false
    }
}

func userFacingTransportError(_ error: Error) -> String {
    if let urlError = error as? URLError,
       urlError.code == .dataLengthExceedsMaximum {
        return RPCTransport.TransportError.messageTooLarge.localizedDescription
    }
    return error.localizedDescription
}
