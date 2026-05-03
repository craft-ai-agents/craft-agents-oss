import Darwin
import Foundation

struct NativeWindowServerPreparationResult {
    let psnStatus: Int32?
    let targetFocusStatus: Int32?
    let keyWindowStatuses: [Int32]
    let notes: [String]
    let warnings: [String]

    var rawStatus: String {
        [
            psnStatus.map { "psn=\($0)" } ?? "psn=not_attempted",
            targetFocusStatus.map { "targetFocus=\($0)" } ?? "targetFocus=not_attempted",
            keyWindowStatuses.isEmpty
                ? "keyWindow=not_attempted"
                : "keyWindow=\(keyWindowStatuses.map(String.init).joined(separator: ","))",
        ].joined(separator: "; ")
    }

    func preparedTargetWindow(requireKeyWindowRecords: Bool) -> Bool {
        guard psnStatus == 0, targetFocusStatus == 0 else {
            return false
        }
        guard requireKeyWindowRecords else {
            return true
        }
        return keyWindowStatuses.count == 2 && keyWindowStatuses.allSatisfy { $0 == 0 }
    }
}

enum NativeWindowServerPreparation {
    typealias GetProcessForPIDFn = @convention(c) (pid_t, UnsafeMutableRawPointer) -> Int32
    typealias SLPSPostEventRecordToFn = @convention(c) (UnsafeRawPointer, UnsafePointer<UInt8>) -> Int32

    static let loadedSkyLight: Bool = {
        dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY) != nil
    }()

    static let getProcessForPID: GetProcessForPIDFn? = loadOptional("GetProcessForPID", as: GetProcessForPIDFn.self)
    static let slpsPostEventRecordTo: SLPSPostEventRecordToFn? = loadOptional("SLPSPostEventRecordTo", as: SLPSPostEventRecordToFn.self)

    static func targetOnlyFocus(pid: pid_t, windowNumber: Int) -> NativeWindowServerPreparationResult {
        prepare(pid: pid, windowNumber: windowNumber, includeKeyWindowRecords: false)
    }

    static func targetOnlyFocusAndKeyWindow(pid: pid_t, windowNumber: Int) -> NativeWindowServerPreparationResult {
        prepare(pid: pid, windowNumber: windowNumber, includeKeyWindowRecords: true)
    }

    private static func prepare(
        pid: pid_t,
        windowNumber: Int,
        includeKeyWindowRecords: Bool
    ) -> NativeWindowServerPreparationResult {
        guard loadedSkyLight else {
            return NativeWindowServerPreparationResult(
                psnStatus: nil,
                targetFocusStatus: nil,
                keyWindowStatuses: [],
                notes: ["WindowServer input preflight skipped because SkyLight could not be loaded."],
                warnings: ["WindowServer input preflight skipped; falling back to app-pid event posting only."]
            )
        }
        guard let getProcessForPID, let slpsPostEventRecordTo else {
            return NativeWindowServerPreparationResult(
                psnStatus: nil,
                targetFocusStatus: nil,
                keyWindowStatuses: [],
                notes: ["WindowServer input preflight skipped because required SkyLight symbols were unavailable."],
                warnings: ["WindowServer input preflight skipped; falling back to app-pid event posting only."]
            )
        }

        var targetPSN = [UInt32](repeating: 0, count: 2)
        let psnStatus = targetPSN.withUnsafeMutableBytes { raw in
            getProcessForPID(pid, raw.baseAddress!)
        }
        guard psnStatus == 0 else {
            return NativeWindowServerPreparationResult(
                psnStatus: psnStatus,
                targetFocusStatus: nil,
                keyWindowStatuses: [],
                notes: ["WindowServer input preflight could not resolve pid \(pid) to a process serial number; GetProcessForPID status=\(psnStatus)."],
                warnings: ["WindowServer input preflight skipped; falling back to app-pid event posting only."]
            )
        }

        let targetFocusStatus = targetPSN.withUnsafeBytes { psnRaw in
            targetOnlyFocusRecord(windowNumber: windowNumber).withUnsafeBufferPointer { bytes in
                slpsPostEventRecordTo(psnRaw.baseAddress!, bytes.baseAddress!)
            }
        }
        let keyWindowStatuses: [Int32]
        if includeKeyWindowRecords {
            keyWindowStatuses = targetPSN.withUnsafeBytes { psnRaw in
                keyWindowRecords(windowNumber: windowNumber).map { record in
                    record.withUnsafeBufferPointer { bytes in
                        slpsPostEventRecordTo(psnRaw.baseAddress!, bytes.baseAddress!)
                    }
                }
            }
        } else {
            keyWindowStatuses = []
        }

        var notes = [
            "WindowServer input preflight sent target-only focus for pid \(pid), window \(windowNumber), status=\(targetFocusStatus).",
        ]
        if includeKeyWindowRecords {
            notes.append("WindowServer input preflight sent key-window records for window \(windowNumber), statuses=\(keyWindowStatuses.map(String.init).joined(separator: ",")).")
        }
        notes.append("No previous-frontmost defocus record was sent.")

        var warnings: [String] = []
        if targetFocusStatus != 0 || keyWindowStatuses.contains(where: { $0 != 0 }) {
            warnings.append("WindowServer input preflight returned non-zero status; event dispatch continued.")
            notes.append("WindowServer input preflight non-zero status means target-window preparation may not have taken effect.")
        }

        return NativeWindowServerPreparationResult(
            psnStatus: psnStatus,
            targetFocusStatus: targetFocusStatus,
            keyWindowStatuses: keyWindowStatuses,
            notes: notes,
            warnings: warnings
        )
    }

    private static func targetOnlyFocusRecord(windowNumber: Int) -> [UInt8] {
        var record = [UInt8](repeating: 0, count: 0xF8)
        record[0x04] = 0xF8
        record[0x08] = 0x0D
        stamp(windowNumber: windowNumber, into: &record, offset: 0x3C)
        record[0x8A] = 0x01
        return record
    }

    private static func keyWindowRecords(windowNumber: Int) -> [[UInt8]] {
        var template = [UInt8](repeating: 0, count: 0x100)
        template[0x04] = 0xF8
        template[0x3A] = 0x10
        for index in 0x20..<0x30 {
            template[index] = 0xFF
        }
        stamp(windowNumber: windowNumber, into: &template, offset: 0x3C)
        return [UInt8(0x01), UInt8(0x02)].map { phase in
            var record = template
            record[0x08] = phase
            return record
        }
    }

    private static func stamp(windowNumber: Int, into record: inout [UInt8], offset: Int) {
        let windowID = UInt32(windowNumber)
        record[offset] = UInt8(windowID & 0xFF)
        record[offset + 1] = UInt8((windowID >> 8) & 0xFF)
        record[offset + 2] = UInt8((windowID >> 16) & 0xFF)
        record[offset + 3] = UInt8((windowID >> 24) & 0xFF)
    }

    private static func loadOptional<T>(_ name: String, as _: T.Type) -> T? {
        _ = loadedSkyLight
        guard let pointer = dlsym(UnsafeMutableRawPointer(bitPattern: -2), name) else {
            return nil
        }
        return unsafeBitCast(pointer, to: T.self)
    }
}
