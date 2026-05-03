import AppKit
import Foundation

enum RuntimePermissionPresenter {
    private final class PresentationState: @unchecked Sendable {
        private let lock = NSLock()
        private var activeMissingPermissionSignature: String?
        private var dismissedMissingPermissionSignatures = Set<String>()

        func decision(for signature: String) -> PresentationDecision {
            lock.lock()
            defer { lock.unlock() }

            guard dismissedMissingPermissionSignatures.contains(signature) == false else {
                return PresentationDecision(shouldPresent: false, requestImmediately: false, activate: false)
            }

            if activeMissingPermissionSignature == signature {
                return PresentationDecision(shouldPresent: true, requestImmediately: false, activate: false)
            }

            activeMissingPermissionSignature = signature
            return PresentationDecision(shouldPresent: true, requestImmediately: true, activate: true)
        }

        func markDismissed(signature: String) {
            lock.lock()
            dismissedMissingPermissionSignatures.insert(signature)
            if activeMissingPermissionSignature == signature {
                activeMissingPermissionSignature = nil
            }
            lock.unlock()
        }

        func clear() {
            lock.lock()
            activeMissingPermissionSignature = nil
            dismissedMissingPermissionSignatures.removeAll()
            lock.unlock()
        }
    }

    private struct PresentationDecision {
        let shouldPresent: Bool
        let requestImmediately: Bool
        let activate: Bool
    }

    @MainActor
    private final class PermissionPanelController: NSObject, NSWindowDelegate {
        private let panel: NSPanel
        private let detailLabel = NSTextField(wrappingLabelWithString: "")
        private let accessibilityStatusLabel = NSTextField(labelWithString: "")
        private let screenRecordingStatusLabel = NSTextField(labelWithString: "")
        private let retryButton = NSButton(title: "Request Again", target: nil, action: nil)
        private let accessibilityButton = NSButton(title: "Open Accessibility", target: nil, action: nil)
        private let screenRecordingButton = NSButton(title: "Open Screen Recording", target: nil, action: nil)

        private var permissions: RuntimePermissionsDTO
        private var instructions: BootstrapInstructionsDTO
        private var pollTimer: Timer?
        private var closingAfterGrant = false

        var onPermissionsSatisfied: (() -> Void)?
        var onDismissed: (() -> Void)?

        init(permissions: RuntimePermissionsDTO, instructions: BootstrapInstructionsDTO) {
            self.permissions = permissions
            self.instructions = instructions
            panel = NSPanel(
                contentRect: NSRect(x: 0, y: 0, width: 560, height: 300),
                styleMask: [.titled, .closable, .utilityWindow],
                backing: .buffered,
                defer: false
            )

            super.init()

            configurePanel()
            configureContent()
            update(permissions: permissions, instructions: instructions)
        }

        func update(permissions: RuntimePermissionsDTO, instructions: BootstrapInstructionsDTO) {
            self.permissions = permissions
            self.instructions = instructions
            updatePermissionText()
        }

        func show(requestImmediately: Bool, activate: Bool) {
            if panel.isVisible == false {
                panel.center()
                panel.orderFront(nil)
            } else if activate {
                panel.makeKeyAndOrderFront(nil)
            }

            if activate {
                NSApp.activate(ignoringOtherApps: true)
            }
            startPolling()

            if requestImmediately {
                DispatchQueue.main.async { [weak self] in
                    self?.requestCurrentMissingPermissions(openFirstPane: true)
                }
            }
        }

        func refreshAndCloseIfSatisfied() {
            refreshFromSystem()
        }

        func windowShouldClose(_ sender: NSWindow) -> Bool {
            true
        }

        func windowWillClose(_ notification: Notification) {
            stopPolling()
            if closingAfterGrant == false {
                onDismissed?()
            }
        }

        @objc
        private func retryRequests(_ sender: NSButton) {
            requestCurrentMissingPermissions(openFirstPane: true)
        }

        @objc
        private func openAccessibility(_ sender: NSButton) {
            if permissions.accessibility.granted == false {
                _ = AccessibilityAuthorization.isTrusted(prompt: true)
            }
            RuntimePermissionPresenter.openPrivacyPane("Privacy_Accessibility")
            refreshFromSystem()
        }

        @objc
        private func openScreenRecording(_ sender: NSButton) {
            if permissions.screenRecording.granted == false {
                _ = ScreenCaptureAuthorization.requestIfNeeded()
            }
            RuntimePermissionPresenter.openPrivacyPane("Privacy_ScreenCapture")
            refreshFromSystem()
        }

        private func configurePanel() {
            panel.title = "BackgroundComputerUse Permissions"
            panel.isFloatingPanel = true
            panel.level = .floating
            panel.hidesOnDeactivate = false
            panel.isReleasedWhenClosed = false
            panel.delegate = self
            panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
            panel.standardWindowButton(.zoomButton)?.isHidden = true
        }

        private func configureContent() {
            let titleLabel = NSTextField(labelWithString: "BackgroundComputerUse needs permissions")
            titleLabel.font = .boldSystemFont(ofSize: 17)
            titleLabel.lineBreakMode = .byWordWrapping
            titleLabel.maximumNumberOfLines = 0

            detailLabel.textColor = .secondaryLabelColor
            detailLabel.maximumNumberOfLines = 0

            accessibilityStatusLabel.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
            screenRecordingStatusLabel.font = .monospacedSystemFont(ofSize: 13, weight: .regular)

            retryButton.target = self
            retryButton.action = #selector(retryRequests(_:))
            accessibilityButton.target = self
            accessibilityButton.action = #selector(openAccessibility(_:))
            screenRecordingButton.target = self
            screenRecordingButton.action = #selector(openScreenRecording(_:))

            let statusStack = NSStackView(views: [
                accessibilityStatusLabel,
                screenRecordingStatusLabel
            ])
            statusStack.orientation = .vertical
            statusStack.spacing = 6

            let buttonStack = NSStackView(views: [
                retryButton,
                accessibilityButton,
                screenRecordingButton
            ])
            buttonStack.orientation = .horizontal
            buttonStack.spacing = 8
            buttonStack.distribution = .fill

            let stack = NSStackView(views: [
                titleLabel,
                detailLabel,
                statusStack,
                buttonStack
            ])
            stack.orientation = .vertical
            stack.alignment = .leading
            stack.spacing = 14
            stack.edgeInsets = NSEdgeInsets(top: 22, left: 24, bottom: 22, right: 24)
            stack.translatesAutoresizingMaskIntoConstraints = false

            let contentView = NSView()
            contentView.addSubview(stack)
            panel.contentView = contentView

            NSLayoutConstraint.activate([
                stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
                stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
                stack.topAnchor.constraint(equalTo: contentView.topAnchor),
                stack.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor),
                detailLabel.widthAnchor.constraint(equalToConstant: 512),
                statusStack.widthAnchor.constraint(equalTo: detailLabel.widthAnchor)
            ])
        }

        private func startPolling() {
            guard pollTimer == nil else {
                return
            }

            pollTimer = Timer.scheduledTimer(
                timeInterval: 1.0,
                target: self,
                selector: #selector(pollPermissions(_:)),
                userInfo: nil,
                repeats: true
            )
        }

        private func stopPolling() {
            pollTimer?.invalidate()
            pollTimer = nil
        }

        @objc
        private func pollPermissions(_ timer: Timer) {
            refreshFromSystem()
        }

        private func requestCurrentMissingPermissions(openFirstPane: Bool) {
            refreshFromSystem(closeWhenSatisfied: false)

            if permissions.accessibility.granted == false {
                _ = AccessibilityAuthorization.isTrusted(prompt: true)
            }

            if permissions.screenRecording.granted == false {
                _ = ScreenCaptureAuthorization.requestIfNeeded()
            }

            if openFirstPane {
                RuntimePermissionPresenter.openPrivacyPane(for: permissions)
            }

            refreshFromSystem()
        }

        private func refreshFromSystem(closeWhenSatisfied: Bool = true) {
            let currentPermissions = RuntimePermissionsSnapshot.current().dto
            permissions = currentPermissions
            updatePermissionText()

            guard closeWhenSatisfied, permissionsAreGranted(currentPermissions) else {
                return
            }

            closeAfterGrant()
        }

        private func updatePermissionText() {
            detailLabel.stringValue = [
                "The runtime has asked macOS to register each missing privacy permission. Grant the missing entries in System Settings; this window will stay open so you can retry or reopen either pane.",
                "It will close automatically after BackgroundComputerUse can verify both permissions are granted. You can also close it and continue from the bootstrap instructions. Screen Recording may require a relaunch before macOS reports the grant to this process."
            ].joined(separator: "\n\n")

            accessibilityStatusLabel.stringValue = statusLine(
                name: "Accessibility",
                granted: permissions.accessibility.granted
            )
            screenRecordingStatusLabel.stringValue = statusLine(
                name: "Screen Recording",
                granted: permissions.screenRecording.granted
            )

            let anyMissing = permissionsAreGranted(permissions) == false
            retryButton.isEnabled = anyMissing
            accessibilityButton.isEnabled = permissions.accessibility.granted == false
            screenRecordingButton.isEnabled = permissions.screenRecording.granted == false
        }

        private func closeAfterGrant() {
            guard panel.isVisible else {
                onPermissionsSatisfied?()
                return
            }

            closingAfterGrant = true
            stopPolling()
            panel.close()
            closingAfterGrant = false
            onPermissionsSatisfied?()
        }

        private func statusLine(name: String, granted: Bool) -> String {
            "\(name): \(granted ? "granted" : "missing")"
        }

        private func permissionsAreGranted(_ permissions: RuntimePermissionsDTO) -> Bool {
            permissions.accessibility.granted && permissions.screenRecording.granted
        }
    }

    private static let presentationState = PresentationState()

    @MainActor
    private static var activePanel: PermissionPanelController?

    static func showIfNeeded(permissions: RuntimePermissionsDTO, instructions: BootstrapInstructionsDTO) {
        guard instructions.ready == false else {
            presentationState.clear()
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    activePanel?.refreshAndCloseIfSatisfied()
                }
            }
            return
        }

        let signature = missingPermissionSignature(permissions: permissions)
        guard signature.isEmpty == false else {
            return
        }

        let decision = presentationState.decision(for: signature)
        guard decision.shouldPresent else {
            return
        }

        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                present(
                    permissions: permissions,
                    instructions: instructions,
                    signature: signature,
                    requestImmediately: decision.requestImmediately,
                    activate: decision.activate
                )
            }
        }
    }

    private static func missingPermissionSignature(permissions: RuntimePermissionsDTO) -> String {
        var missing: [String] = []
        if permissions.accessibility.granted == false {
            missing.append("accessibility")
        }
        if permissions.screenRecording.granted == false {
            missing.append("screenRecording")
        }
        return missing.joined(separator: ",")
    }

    @MainActor
    private static func present(
        permissions: RuntimePermissionsDTO,
        instructions: BootstrapInstructionsDTO,
        signature: String,
        requestImmediately: Bool,
        activate: Bool
    ) {
        let panel: PermissionPanelController
        let createdPanel: Bool

        if let activePanel {
            panel = activePanel
            createdPanel = false
            panel.update(permissions: permissions, instructions: instructions)
        } else {
            panel = PermissionPanelController(permissions: permissions, instructions: instructions)
            activePanel = panel
            createdPanel = true
        }

        panel.onPermissionsSatisfied = {
            presentationState.clear()
            activePanel = nil
        }
        panel.onDismissed = {
            presentationState.markDismissed(signature: signature)
            activePanel = nil
        }

        panel.show(
            requestImmediately: requestImmediately || createdPanel,
            activate: activate || createdPanel
        )
    }

    @MainActor
    private static func openPrivacyPane(for permissions: RuntimePermissionsDTO) {
        if permissions.accessibility.granted == false {
            openPrivacyPane("Privacy_Accessibility")
        } else if permissions.screenRecording.granted == false {
            openPrivacyPane("Privacy_ScreenCapture")
        }
    }

    @MainActor
    private static func openPrivacyPane(_ anchor: String) {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)") {
            NSWorkspace.shared.open(url)
        }
    }
}
