import Foundation

struct RuntimePermissionsSnapshot {
    let accessibilityGranted: Bool
    let screenRecordingGranted: Bool
    let checkedAt: Date
    let checkMs: Double

    static func current() -> RuntimePermissionsSnapshot {
        let started = DispatchTime.now().uptimeNanoseconds
        let accessibilityGranted = AccessibilityAuthorization.isTrusted(prompt: false)
        let screenRecordingGranted = ScreenCaptureAuthorization.isAuthorized()
        let finished = DispatchTime.now().uptimeNanoseconds
        return RuntimePermissionsSnapshot(
            accessibilityGranted: accessibilityGranted,
            screenRecordingGranted: screenRecordingGranted,
            checkedAt: Date(),
            checkMs: Double(finished - started) / 1_000_000
        )
    }

    var dto: RuntimePermissionsDTO {
        RuntimePermissionsDTO(
            accessibility: PermissionStatusDTO(
                granted: accessibilityGranted,
                promptable: true
            ),
            screenRecording: PermissionStatusDTO(
                granted: screenRecordingGranted,
                promptable: true
            ),
            checkedAt: Time.iso8601String(from: checkedAt),
            checkMs: sanitizedJSONDouble(checkMs)
        )
    }
}
