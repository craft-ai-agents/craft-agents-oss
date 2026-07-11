import SwiftUI
import CraftAgentKit

struct PermissionApprovalSheet: View {
    let request: PermissionRequest
    let onRespond: (_ allowed: Bool, _ alwaysAllow: Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(request.toolName).font(.title2.bold())
            Text(request.description)
            if let command = request.command {
                Text(command)
                    .font(.system(.body, design: .monospaced))
                    .padding(8)
                    .background(Color.gray.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            HStack {
                Button("Deny") { onRespond(false, false) }
                    .buttonStyle(.bordered)
                Spacer()
                Button("Allow Once") { onRespond(true, false) }
                    .buttonStyle(.bordered)
                Button("Always Allow") { onRespond(true, true) }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding()
    }
}
