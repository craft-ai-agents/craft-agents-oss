import CryptoKit
import Foundation

enum StateToken {
    private static let alphabet = Array("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    static func make(
        windowID: String,
        title: String,
        frame: CGRect,
        projectedTree: AXProjectedTreeDTO,
        selectionSummary: AXFocusSelectionSnapshotDTO?,
        pixelWidth: Int?,
        pixelHeight: Int?
    ) -> String {
        make(payloadComponents: [
            "window:\(windowID)",
            "title:\(title)",
            "frame:\(frameComponent(frame))",
            "pixels:\(pixelWidth.map(String.init) ?? "nil")x\(pixelHeight.map(String.init) ?? "nil")",
            "profile:\(projectedTree.profile)",
            "focusedCanonical:\(projectedTree.focusedCanonicalIndex.map(String.init) ?? "nil")",
            "focusedProjected:\(projectedTree.focusedProjectedIndex.map(String.init) ?? "nil")",
            "focusedDisplay:\(projectedTree.focusedDisplayIndex.map(String.init) ?? "nil")",
            "selectedCanonical:\(selectionSummary?.selectedCanonicalIndices.sorted().map(String.init).joined(separator: ",") ?? "")",
            "selectedNodes:\(selectionSummary?.selectedNodeIDs.sorted().joined(separator: ",") ?? "")",
            "selectedText:\(selectionSummary?.selectedText ?? "")",
            "rendered:\(projectedTree.renderedText)",
            "lines:\(lineMappingComponent(projectedTree.lineMappings))",
            "nodes:\(projectedNodeComponent(projectedTree.nodes))"
        ])
    }

    private static func make(payloadComponents: [String]) -> String {
        let payload = payloadComponents.joined(separator: "|")
        let digest = SHA256.hash(data: Data(payload.utf8))

        var value: UInt64 = 0
        for byte in digest.prefix(8) {
            value = (value << 8) | UInt64(byte)
        }

        var characters = Array(repeating: Character("0"), count: 13)
        for index in stride(from: 12, through: 0, by: -1) {
            characters[index] = alphabet[Int(value & 31)]
            value >>= 5
        }

        return "st_\(String(characters))"
    }

    private static func frameComponent(_ frame: CGRect) -> String {
        [
            stableNumber(frame.minX),
            stableNumber(frame.minY),
            stableNumber(frame.width),
            stableNumber(frame.height)
        ].joined(separator: ",")
    }

    private static func stableNumber(_ value: CGFloat) -> String {
        String(format: "%.3f", Double(value))
    }

    private static func stableNumber(_ value: Double) -> String {
        String(format: "%.3f", value)
    }

    private static func lineMappingComponent(_ mappings: [AXV2VisibleLineMappingDTO]) -> String {
        mappings
            .map {
                [
                    String($0.displayIndex),
                    String($0.projectedIndex),
                    String($0.primaryCanonicalIndex),
                    $0.canonicalIndices.map(String.init).joined(separator: ","),
                    $0.kind
                ].joined(separator: ":")
            }
            .joined(separator: ";")
    }

    private static func projectedNodeComponent(_ nodes: [AXProjectedNodeDTO]) -> String {
        nodes.map(projectedNodeComponent).joined(separator: ";")
    }

    private static func projectedNodeComponent(_ node: AXProjectedNodeDTO) -> String {
        let parent = node.parentProjectedIndex.map(String.init) ?? "nil"
        let canonicalIndices = node.canonicalIndices.map(String.init).joined(separator: ",")
        let metadata = node.metadata.sorted().joined(separator: ",")
        let flags = node.flags.sorted().joined(separator: ",")
        let secondaryActions = node.secondaryActions.sorted().joined(separator: ",")
        let frame = node.frameAppKit.map(rectComponent) ?? "nil"
        let childIndices = node.childProjectedIndices.map(String.init).joined(separator: ",")

        return [
            String(node.projectedIndex),
            parent,
            String(node.primaryCanonicalIndex),
            canonicalIndices,
            node.displayRole,
            node.label ?? "",
            metadata,
            flags,
            secondaryActions,
            frame,
            childIndices
        ].joined(separator: ":")
    }

    private static func rectComponent(_ rect: RectDTO) -> String {
        [
            stableNumber(rect.x),
            stableNumber(rect.y),
            stableNumber(rect.width),
            stableNumber(rect.height)
        ].joined(separator: ",")
    }
}
