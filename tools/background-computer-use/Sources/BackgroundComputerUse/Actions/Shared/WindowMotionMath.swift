import CoreGraphics
import Foundation

enum WindowMotionMath {
    static func frameChanged(from before: CGRect, to after: CGRect, tolerance: CGFloat = 1) -> Bool {
        abs(before.minX - after.minX) > tolerance ||
            abs(before.minY - after.minY) > tolerance ||
            abs(before.width - after.width) > tolerance ||
            abs(before.height - after.height) > tolerance
    }

    static func approximatelyMatches(
        expected: CGRect,
        actual: CGRect,
        tolerance: CGFloat = 2
    ) -> Bool {
        abs(expected.minX - actual.minX) <= tolerance &&
            abs(expected.minY - actual.minY) <= tolerance &&
            abs(expected.width - actual.width) <= tolerance &&
            abs(expected.height - actual.height) <= tolerance
    }

    static func requestedFrameSatisfied(expected: CGRect, actual: CGRect) -> Bool {
        approximatelyMatches(expected: expected, actual: actual, tolerance: 12)
    }

    static func projectionDuration(from startFrame: CGRect, to endFrame: CGRect) -> TimeInterval {
        let centerTravel = hypot(
            endFrame.midX - startFrame.midX,
            endFrame.midY - startFrame.midY
        )
        let sizeTravel = hypot(
            endFrame.width - startFrame.width,
            endFrame.height - startFrame.height
        )
        return MotionPacing.transitDuration(for: max(centerTravel, sizeTravel))
    }

    static func frameByMovingHandle(
        from startFrame: CGRect,
        handle: ResizeHandleDTO,
        toPoint: CGPoint
    ) -> CGRect {
        var minX = startFrame.minX
        var maxX = startFrame.maxX
        var minY = startFrame.minY
        var maxY = startFrame.maxY

        switch handle {
        case .left:
            minX = toPoint.x
        case .right:
            maxX = toPoint.x
        case .top:
            maxY = toPoint.y
        case .bottom:
            minY = toPoint.y
        case .topLeft:
            minX = toPoint.x
            maxY = toPoint.y
        case .topRight:
            maxX = toPoint.x
            maxY = toPoint.y
        case .bottomLeft:
            minX = toPoint.x
            minY = toPoint.y
        case .bottomRight:
            maxX = toPoint.x
            minY = toPoint.y
        }

        return CGRect(
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        ).standardized
    }

    static func interpolate(_ startFrame: CGRect, _ endFrame: CGRect, progress: Double) -> CGRect {
        CGRect(
            x: startFrame.minX + ((endFrame.minX - startFrame.minX) * progress),
            y: startFrame.minY + ((endFrame.minY - startFrame.minY) * progress),
            width: startFrame.width + ((endFrame.width - startFrame.width) * progress),
            height: startFrame.height + ((endFrame.height - startFrame.height) * progress)
        )
    }

    static func easeInOutCubic(_ value: Double) -> Double {
        if value < 0.5 {
            return 4 * value * value * value
        }

        let adjusted = (-2 * value) + 2
        return 1 - ((adjusted * adjusted * adjusted) / 2)
    }
}
