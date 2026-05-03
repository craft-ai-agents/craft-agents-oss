import AppKit
import CoreGraphics
import Foundation

enum DesktopGeometry {
    static func desktopTop() -> CGFloat {
        NSScreen.screens.map(\.frame.maxY).max() ?? 0
    }

    static func appKitRect(fromQuartz rect: CGRect) -> CGRect {
        CGRect(
            x: rect.minX,
            y: desktopTop() - rect.minY - rect.height,
            width: rect.width,
            height: rect.height
        )
        .standardized
    }

    static func appKitRect(fromAXOrigin origin: CGPoint, size: CGSize) -> CGRect {
        CGRect(
            x: origin.x,
            y: desktopTop() - origin.y - size.height,
            width: size.width,
            height: size.height
        )
        .standardized
    }

    static func axOrigin(fromAppKitFrame frame: CGRect) -> CGPoint {
        CGPoint(
            x: frame.minX,
            y: desktopTop() - frame.minY - frame.height
        )
    }

    static func screenContaining(point: CGPoint) -> NSScreen? {
        NSScreen.screens.first(where: { $0.frame.contains(point) })
    }

    static func screenMatching(frame: CGRect) -> NSScreen? {
        NSScreen.screens.max { lhs, rhs in
            lhs.frame.intersection(frame).area < rhs.frame.intersection(frame).area
        }
    }

    static func isRenderable(frame: CGRect, minimumDimension: CGFloat = 120) -> Bool {
        frame.width >= minimumDimension && frame.height >= minimumDimension
    }

    static func isOnScreen(_ frame: CGRect) -> Bool {
        NSScreen.screens.contains { !$0.frame.intersection(frame).isNull }
    }
}

private extension CGRect {
    var area: CGFloat {
        max(width, 0) * max(height, 0)
    }
}
