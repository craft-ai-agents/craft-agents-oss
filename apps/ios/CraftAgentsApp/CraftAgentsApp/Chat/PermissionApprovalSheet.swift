import SwiftUI
import CraftAgentKit

struct PermissionApprovalSheet: View {
    let request: PermissionRequest
    let onRespond: (_ allowed: Bool, _ alwaysAllow: Bool) -> Void

    @State private var isConfirmingAlwaysAllow = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top, spacing: 14) {
                        ZStack {
                            Circle()
                                .fill(Color.orange.opacity(0.13))
                                .frame(width: 44, height: 44)
                            Image(systemName: "hand.raised.fill")
                                .foregroundStyle(.orange)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            Text(request.toolName)
                                .font(.title3.bold())
                            Text("An agent is waiting for your approval.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Text(request.description)
                        .font(.body)

                    if let command = request.command {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Command")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            ScrollView(.horizontal, showsIndicators: false) {
                                Text(command)
                                    .font(.system(.callout, design: .monospaced))
                                    .textSelection(.enabled)
                                    .padding(12)
                            }
                            .background(
                                Color.primary.opacity(0.055),
                                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
                            )
                        }
                    }

                    VStack(spacing: 10) {
                        Button {
                            onRespond(true, false)
                        } label: {
                            Label("Allow Once", systemImage: "checkmark")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)

                        Button {
                            isConfirmingAlwaysAllow = true
                        } label: {
                            Label("Always Allow", systemImage: "key")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)

                        Button("Deny", role: .cancel) {
                            onRespond(false, false)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 2)
                    }

                    Text("Always Allow changes future approval behavior. Use it only for tools and commands you trust.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(20)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("Permission required")
            .navigationBarTitleDisplayMode(.inline)
        }
        .confirmationDialog(
            "Always allow \(request.toolName)?",
            isPresented: $isConfirmingAlwaysAllow,
            titleVisibility: .visible
        ) {
            Button("Always Allow") {
                onRespond(true, true)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Future matching requests may run without asking again.")
        }
    }
}
