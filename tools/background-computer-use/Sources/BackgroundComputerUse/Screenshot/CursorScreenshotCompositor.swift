import AppKit
import CoreGraphics
import Foundation

enum CursorScreenshotCompositor {
    static func compositedImage(
        baseImage: CGImage,
        windowFrameAppKit: CGRect,
        snapshots: [CursorSnapshot]
    ) -> CGImage? {
        if Thread.isMainThread == false {
            return DispatchQueue.main.sync {
                compositedImage(
                    baseImage: baseImage,
                    windowFrameAppKit: windowFrameAppKit,
                    snapshots: snapshots
                )
            }
        }

        guard windowFrameAppKit.width > 0,
              windowFrameAppKit.height > 0,
              snapshots.isEmpty == false else {
            return nil
        }

        let imageSize = NSSize(width: baseImage.width, height: baseImage.height)
        let sortedSnapshots = snapshots.sorted { $0.cursorID < $1.cursorID }
        let base = NSImage(cgImage: baseImage, size: imageSize)

        let composed = NSImage(size: imageSize, flipped: true) { rect in
            base.draw(in: rect)
            guard let context = NSGraphicsContext.current?.cgContext else {
                return true
            }

            context.saveGState()
            context.translateBy(x: 0, y: imageSize.height)
            context.scaleBy(x: 1, y: -1)
            defer { context.restoreGState() }

            for snapshot in sortedSnapshots {
                let cursorPoint = modelFacingPoint(
                    for: snapshot.position,
                    in: windowFrameAppKit,
                    modelImageSize: imageSize
                )
                if isNearModelBounds(cursorPoint, imageSize: imageSize) == false {
                    continue
                }

                let modelSnapshot = snapshot.mapGeometry { point in
                    rendererPoint(
                        for: point,
                        in: windowFrameAppKit,
                        modelImageSize: imageSize
                    )
                }
                let visibleHistories = modelSnapshot.trailHistories.map { history in
                    history.filter {
                        isNearModelBounds($0, imageSize: imageSize, padding: 96)
                    }
                }
                let clippedSnapshot = CursorSnapshot(
                    cursorID: modelSnapshot.cursorID,
                    attachedWindowNumber: modelSnapshot.attachedWindowNumber,
                    attachedWindowLevelRawValue: modelSnapshot.attachedWindowLevelRawValue,
                    position: modelSnapshot.position,
                    angle: modelSnapshot.angle,
                    scale: modelSnapshot.scale * 0.72,
                    alpha: modelSnapshot.alpha,
                    glyph: modelSnapshot.glyph,
                    previousGlyph: modelSnapshot.previousGlyph,
                    morphProgress: modelSnapshot.morphProgress,
                    isPressed: modelSnapshot.isPressed,
                    accent: modelSnapshot.accent,
                    baseColor: modelSnapshot.baseColor,
                    pivotLocal: modelSnapshot.pivotLocal,
                    labelText: modelSnapshot.labelText,
                    labelAlpha: modelSnapshot.labelAlpha,
                    labelScale: modelSnapshot.labelScale,
                    trailHistories: visibleHistories,
                    trailVisible: modelSnapshot.trailVisible,
                    caretPhase: modelSnapshot.caretPhase,
                    anticipationTilt: modelSnapshot.anticipationTilt,
                    effects: modelSnapshot.effects
                )
                CursorRenderer.draw(clippedSnapshot, in: context)
            }
            return true
        }

        guard let tiff = composed.tiffRepresentation,
              let bitmapRep = NSBitmapImageRep(data: tiff),
              let cgImage = bitmapRep.cgImage else {
            return nil
        }

        return cgImage
    }

    static func modelFacingPoint(
        for appKitScreenPoint: CGPoint,
        in windowFrameAppKit: CGRect,
        modelImageSize: CGSize
    ) -> CGPoint {
        let scaleX = modelImageSize.width / max(windowFrameAppKit.width, 1)
        let scaleY = modelImageSize.height / max(windowFrameAppKit.height, 1)
        return CGPoint(
            x: (appKitScreenPoint.x - windowFrameAppKit.minX) * scaleX,
            y: (windowFrameAppKit.maxY - appKitScreenPoint.y) * scaleY
        )
    }

    private static func rendererPoint(
        for appKitScreenPoint: CGPoint,
        in windowFrameAppKit: CGRect,
        modelImageSize: CGSize
    ) -> CGPoint {
        let modelPoint = modelFacingPoint(
            for: appKitScreenPoint,
            in: windowFrameAppKit,
            modelImageSize: modelImageSize
        )
        return CGPoint(
            x: modelPoint.x,
            y: modelImageSize.height - modelPoint.y
        )
    }

    private static func isNearModelBounds(_ point: CGPoint, imageSize: NSSize, padding: CGFloat = 56) -> Bool {
        point.x >= -padding &&
            point.y >= -padding &&
            point.x <= imageSize.width + padding &&
            point.y <= imageSize.height + padding
    }
}
