import AppKit
import CoreGraphics
import Darwin
import Foundation

struct CGWindowCapture {
    let image: CGImage
    let windowNumber: Int
}

enum CGWindowCaptureError: Error, CustomStringConvertible {
    case permissionDenied
    case symbolUnavailable
    case captureReturnedNil(windowNumber: Int)

    var description: String {
        switch self {
        case .permissionDenied:
            return "Screen Recording permission is required to capture window screenshots."
        case .symbolUnavailable:
            return "Could not resolve CGWindowListCreateImage from CoreGraphics."
        case let .captureReturnedNil(windowNumber):
            return "CGWindowListCreateImage returned nil for windowNumber \(windowNumber)."
        }
    }
}

enum CGWindowCaptureService {
    private typealias CreateImageFunction = @convention(c) (
        CGRect,
        UInt32,
        UInt32,
        UInt32
    ) -> Unmanaged<CGImage>?

    static func captureImage(window: ResolvedWindowDTO) -> CGImage? {
        switch capture(windowNumber: window.windowNumber) {
        case let .success(capture):
            return capture.image
        case .failure:
            return nil
        }
    }

    static func capture(windowNumber: Int) -> Result<CGWindowCapture, CGWindowCaptureError> {
        guard ScreenCaptureAuthorization.isAuthorized() else {
            return .failure(.permissionDenied)
        }

        guard let createImage = resolveCreateImage() else {
            return .failure(.symbolUnavailable)
        }

        let listOption = CGWindowListOption.optionIncludingWindow.rawValue
        let imageOption = CGWindowImageOption.boundsIgnoreFraming.rawValue |
            CGWindowImageOption.bestResolution.rawValue

        guard let unmanagedImage = createImage(
            .null,
            listOption,
            UInt32(windowNumber),
            imageOption
        ) else {
            return .failure(.captureReturnedNil(windowNumber: windowNumber))
        }

        return .success(
            CGWindowCapture(
                image: unmanagedImage.takeRetainedValue(),
                windowNumber: windowNumber
            )
        )
    }

    private static let createImageFunction: CreateImageFunction? = {
        guard let handle = dlopen(
            "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
            RTLD_LAZY
        ) else {
            return nil
        }

        guard let symbol = dlsym(handle, "CGWindowListCreateImage") else {
            return nil
        }

        return unsafeBitCast(symbol, to: CreateImageFunction.self)
    }()

    private static func resolveCreateImage() -> CreateImageFunction? {
        createImageFunction
    }
}
