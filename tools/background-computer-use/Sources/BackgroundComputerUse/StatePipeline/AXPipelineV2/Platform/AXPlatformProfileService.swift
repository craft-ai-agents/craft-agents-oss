import ApplicationServices
import AppKit
import Foundation

struct AXPlatformProfileService {
    private static var manualAccessibilityAttribute: CFString { "AXManualAccessibility" as CFString }
    private static var enhancedUserInterfaceAttribute: CFString { "AXEnhancedUserInterface" as CFString }

    func prepareAndProfile(app: NSRunningApplication, appElement: AXUIElement) -> AXPlatformProfileDTO {
        let frameworkHints = frameworkHints(for: app)
        let helperAppHints = helperAppHints(for: app)
        let bundleID = app.bundleIdentifier
        let bundlePath = app.bundleURL?.path
        let normalizedBundleID = bundleID?.lowercased() ?? ""

        let isElectronLike = frameworkHints.contains("Electron Framework.framework") || normalizedBundleID.contains("electron")
        let isChromiumLike =
            frameworkHints.contains("Chromium Embedded Framework.framework") ||
            isElectronLike ||
            normalizedBundleID.contains("chromium") ||
            normalizedBundleID.contains("chrome") ||
            normalizedBundleID == "com.openai.atlas"

        let shouldTryEnhancedUI =
            helperAppHints.contains(where: { $0.localizedCaseInsensitiveContains("UIKit") }) ||
            normalizedBundleID.contains("catalyst")

        let manualAttempt = enablementAttempt(
            attribute: Self.manualAccessibilityAttribute,
            mode: "manualAccessibility",
            shouldAttempt: isChromiumLike,
            appElement: appElement,
            note: "Best-effort Chromium/Electron accessibility enablement."
        )
        let enhancedAttempt = enablementAttempt(
            attribute: Self.enhancedUserInterfaceAttribute,
            mode: "enhancedUserInterface",
            shouldAttempt: shouldTryEnhancedUI,
            appElement: appElement,
            note: "Best-effort richer AppKit/Catalyst accessibility surface."
        )

        var notes: [String] = []
        if isElectronLike {
            notes.append("Detected Electron-style app bundle from framework contents.")
        }
        if isChromiumLike && isElectronLike == false {
            notes.append("Detected Chromium-like app bundle from framework contents or bundle identifier.")
        }
        if manualAttempt.attempted {
            notes.append("Manual accessibility enablement is tracked explicitly by mode instead of as an implicit side effect.")
        }
        if enhancedAttempt.attempted {
            notes.append("Enhanced UI enablement was attempted as a separate best-effort mode.")
        }

        return AXPlatformProfileDTO(
            bundleID: bundleID,
            bundlePath: bundlePath,
            frameworkHints: frameworkHints,
            helperAppHints: helperAppHints,
            isChromiumLike: isChromiumLike,
            isElectronLike: isElectronLike,
            manualAccessibility: AXPlatformManualAccessibilityDTO(
                attempted: manualAttempt.attempted,
                before: manualAttempt.before,
                result: manualAttempt.result,
                after: manualAttempt.after
            ),
            enablementAttempts: [manualAttempt, enhancedAttempt].filter { $0.attempted },
            notes: notes
        )
    }

    private func frameworkHints(for app: NSRunningApplication) -> [String] {
        guard let frameworksPath = app.bundleURL?.appendingPathComponent("Contents/Frameworks").path else {
            return []
        }
        let names = (try? FileManager.default.contentsOfDirectory(atPath: frameworksPath)) ?? []
        return names.filter {
            $0 == "Electron Framework.framework" || $0 == "Chromium Embedded Framework.framework"
        }.sorted()
    }

    private func helperAppHints(for app: NSRunningApplication) -> [String] {
        guard let frameworksPath = app.bundleURL?.appendingPathComponent("Contents/Frameworks").path else {
            return []
        }
        let names = (try? FileManager.default.contentsOfDirectory(atPath: frameworksPath)) ?? []
        return names.filter { $0.contains("Helper") }.sorted()
    }

    private func enablementAttempt(
        attribute: CFString,
        mode: String,
        shouldAttempt: Bool,
        appElement: AXUIElement,
        note: String
    ) -> AXEnablementAttemptDTO {
        guard shouldAttempt else {
            return AXEnablementAttemptDTO(
                mode: mode,
                attempted: false,
                before: nil,
                result: nil,
                after: nil,
                note: note
            )
        }

        let before = AXHelpers.boolAttribute(appElement, attribute: attribute)
        if before == true {
            return AXEnablementAttemptDTO(
                mode: mode,
                attempted: true,
                before: before,
                result: "already_enabled",
                after: before,
                note: note
            )
        }

        let result = AXUIElementSetAttributeValue(appElement, attribute, kCFBooleanTrue)
        let after: Bool? = {
            guard result == .success else { return before }
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
            return AXHelpers.boolAttribute(appElement, attribute: attribute)
        }()

        return AXEnablementAttemptDTO(
            mode: mode,
            attempted: true,
            before: before,
            result: result == .success ? "success" : String(describing: result),
            after: after,
            note: note
        )
    }
}
