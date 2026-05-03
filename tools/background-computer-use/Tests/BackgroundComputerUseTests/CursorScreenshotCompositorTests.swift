import AppKit
import CoreGraphics
import Testing
@testable import BackgroundComputerUse

@Suite
struct CursorScreenshotCompositorTests {
    @Test
    func testModelFacingPointUsesAppKitBottomLeftToTopLeftMapping() {
        let windowFrame = CGRect(x: 100, y: 200, width: 400, height: 300)
        let modelSize = CGSize(width: 800, height: 600)

        let topLeftPoint = CursorScreenshotCompositor.modelFacingPoint(
            for: CGPoint(x: windowFrame.minX, y: windowFrame.maxY),
            in: windowFrame,
            modelImageSize: modelSize
        )
        #expect(abs(topLeftPoint.x - 0) <= 0.01)
        #expect(abs(topLeftPoint.y - 0) <= 0.01)

        let bottomLeftPoint = CursorScreenshotCompositor.modelFacingPoint(
            for: CGPoint(x: windowFrame.minX, y: windowFrame.minY),
            in: windowFrame,
            modelImageSize: modelSize
        )
        #expect(abs(bottomLeftPoint.x - 0) <= 0.01)
        #expect(abs(bottomLeftPoint.y - modelSize.height) <= 0.01)

        let centerPoint = CursorScreenshotCompositor.modelFacingPoint(
            for: CGPoint(x: windowFrame.midX, y: windowFrame.midY),
            in: windowFrame,
            modelImageSize: modelSize
        )
        #expect(abs(centerPoint.x - modelSize.width / 2) <= 0.01)
        #expect(abs(centerPoint.y - modelSize.height / 2) <= 0.01)
    }

    @Test
    func testCompositorDrawsPixelsNearExpectedMappedCursorPosition() throws {
        let baseImage = try #require(makeSolidImage(width: 240, height: 160, color: .black))
        let windowFrame = CGRect(x: 10, y: 20, width: 120, height: 80)
        let cursorPoint = CGPoint(x: 70, y: 60)
        let expectedPoint = CursorScreenshotCompositor.modelFacingPoint(
            for: cursorPoint,
            in: windowFrame,
            modelImageSize: CGSize(width: 240, height: 160)
        )
        let accent = CursorAccentPalette.derive(from: NSColor.presenceCursorColor(hex: "#00C2C7"))
        let snapshot = CursorSnapshot(
            cursorID: "codex",
            attachedWindowNumber: 11,
            attachedWindowLevelRawValue: 0,
            position: cursorPoint,
            angle: CursorMotionConstants.arrowHomeAngle,
            scale: 1,
            alpha: 1,
            glyph: .arrow,
            previousGlyph: nil,
            morphProgress: 1,
            isPressed: false,
            accent: accent,
            baseColor: accent.fill,
            pivotLocal: CursorPivotKind.tip.pathPoint,
            labelText: "Codex",
            labelAlpha: 1,
            labelScale: 1,
            trailHistories: [],
            trailVisible: true,
            caretPhase: 0,
            anticipationTilt: 0,
            effects: []
        )

        let compositedImage = try #require(
            CursorScreenshotCompositor.compositedImage(
                baseImage: baseImage,
                windowFrameAppKit: windowFrame,
                snapshots: [snapshot]
            )
        )

        let bitmap = NSBitmapImageRep(cgImage: compositedImage)
        let expectedRegion = CGRect(
            x: expectedPoint.x - 7,
            y: expectedPoint.y - 7,
            width: 15,
            height: 15
        )
        let controlRegion = CGRect(x: 0, y: 0, width: 20, height: 20)

        #expect(nonBlackPixelCount(inTopLeftRegion: expectedRegion, bitmap: bitmap) > 10)
        #expect(nonBlackPixelCount(inTopLeftRegion: controlRegion, bitmap: bitmap) == 0)
    }

    @Test
    func testCompositorDoesNotMirrorCursorVerticallyInScreenshot() throws {
        let baseImage = try #require(makeSolidImage(width: 240, height: 160, color: .black))
        let windowFrame = CGRect(x: 10, y: 20, width: 120, height: 80)
        let cursorPoint = CGPoint(x: 70, y: 90)
        let expectedPoint = CursorScreenshotCompositor.modelFacingPoint(
            for: cursorPoint,
            in: windowFrame,
            modelImageSize: CGSize(width: 240, height: 160)
        )
        let accent = CursorAccentPalette.derive(from: NSColor.presenceCursorColor(hex: "#00C2C7"))
        let snapshot = CursorSnapshot(
            cursorID: "codex",
            attachedWindowNumber: 11,
            attachedWindowLevelRawValue: 0,
            position: cursorPoint,
            angle: CursorMotionConstants.arrowHomeAngle,
            scale: 1,
            alpha: 1,
            glyph: .arrow,
            previousGlyph: nil,
            morphProgress: 1,
            isPressed: false,
            accent: accent,
            baseColor: accent.fill,
            pivotLocal: CursorPivotKind.tip.pathPoint,
            labelText: "",
            labelAlpha: 0,
            labelScale: 1,
            trailHistories: [],
            trailVisible: false,
            caretPhase: 0,
            anticipationTilt: 0,
            effects: []
        )

        let compositedImage = try #require(
            CursorScreenshotCompositor.compositedImage(
                baseImage: baseImage,
                windowFrameAppKit: windowFrame,
                snapshots: [snapshot]
            )
        )

        let bitmap = NSBitmapImageRep(cgImage: compositedImage)
        let expectedRegion = CGRect(
            x: expectedPoint.x - 10,
            y: expectedPoint.y - 10,
            width: 24,
            height: 28
        )
        let mirroredRegion = CGRect(
            x: expectedPoint.x - 10,
            y: CGFloat(bitmap.pixelsHigh) - expectedPoint.y - 18,
            width: 24,
            height: 28
        )

        #expect(nonBlackPixelCount(inTopLeftRegion: expectedRegion, bitmap: bitmap) > 10)
        #expect(nonBlackPixelCount(inTopLeftRegion: mirroredRegion, bitmap: bitmap) == 0)
    }

    private func makeSolidImage(width: Int, height: Int, color: NSColor) -> CGImage? {
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return nil
        }

        context.setFillColor(color.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()
    }

    private func nonBlackPixelCount(
        inTopLeftRegion region: CGRect,
        bitmap: NSBitmapImageRep
    ) -> Int {
        let minX = max(Int(region.minX.rounded(.down)), 0)
        let maxX = min(Int(region.maxX.rounded(.up)), bitmap.pixelsWide)
        let minY = max(Int(region.minY.rounded(.down)), 0)
        let maxY = min(Int(region.maxY.rounded(.up)), bitmap.pixelsHigh)
        guard minX < maxX, minY < maxY else {
            return 0
        }

        var count = 0
        for y in minY..<maxY {
            for x in minX..<maxX {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else {
                    continue
                }
                if color.redComponent > 0 || color.greenComponent > 0 || color.blueComponent > 0 {
                    count += 1
                }
            }
        }
        return count
    }

}
