import SwiftUI
import CraftAgentKit

struct ServerConnectionSetupView: View {
    @Bindable var viewModel: ServerConnectionViewModel
    var onConnected: () -> Void

    @FocusState private var focusedField: Field?

    private enum Field {
        case server
        case token
    }

    private var connectButtonTitle: String {
        if viewModel.isConnecting {
            return "Connecting..."
        }
        if viewModel.hasVerifiedConnection {
            return "Connected"
        }
        return "Connect"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                hero
                connectionCard

                if let errorMessage = viewModel.errorMessage {
                    errorCard(errorMessage)
                }

                if viewModel.hasVerifiedConnection, !viewModel.workspaces.isEmpty {
                    workspacePicker
                }

                Label("Your token is stored securely in this device's Keychain.", systemImage: "lock.shield")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: 520)
            .padding(.horizontal, 24)
            .padding(.top, 36)
            .padding(.bottom, 48)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Color(uiColor: .systemGroupedBackground).ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
    }

    private var hero: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(CraftTheme.accentGradient)
                    .frame(width: 76, height: 76)
                    .shadow(color: CraftTheme.accent.opacity(0.25), radius: 18, y: 8)

                Image(systemName: "sparkles")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.white)
            }

            VStack(spacing: 8) {
                Text("Craft Agents")
                    .font(.largeTitle.bold())

                Text("Connect to your server to monitor agents, continue conversations, and approve work from anywhere.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 430)
            }
        }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                Label("Server address", systemImage: "network")
                    .font(.subheadline.weight(.semibold))
                TextField("agents.example.com:9100", text: $viewModel.serverURLText)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .server)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .token }
                    .padding(12)
                    .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 12))
            }

            VStack(alignment: .leading, spacing: 8) {
                Label("Access token", systemImage: "key")
                    .font(.subheadline.weight(.semibold))
                SecureField("Paste your server token", text: $viewModel.token)
                    .textContentType(.password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focusedField, equals: .token)
                    .submitLabel(.go)
                    .onSubmit(connectIfReady)
                    .padding(12)
                    .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 12))
            }

            Button {
                focusedField = nil
                Task { await viewModel.testConnectionAndFetchWorkspaces() }
            } label: {
                HStack(spacing: 8) {
                    if viewModel.isConnecting {
                        ProgressView()
                            .tint(.white)
                    } else if viewModel.hasVerifiedConnection {
                        Image(systemName: "checkmark")
                    } else {
                        Image(systemName: "arrow.right")
                    }
                    Text(connectButtonTitle)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 28)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!viewModel.canConnect)
        }
        .padding(20)
        .background(CraftTheme.cardBackground, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(CraftTheme.hairline)
        }
    }

    private func errorCard(_ message: String) -> some View {
        Label {
            Text(message)
                .frame(maxWidth: .infinity, alignment: .leading)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
        }
        .font(.callout)
        .foregroundStyle(.red)
        .padding(14)
        .background(Color.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
    }

    private var workspacePicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Choose a workspace", systemImage: "square.stack.3d.up")
                    .font(.headline)
                Text("Your sessions and server settings are scoped to this workspace.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 0) {
                ForEach(Array(viewModel.workspaces.enumerated()), id: \.element.id) { index, workspace in
                    Button {
                        select(workspace)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "folder")
                                .foregroundStyle(CraftTheme.accent)
                                .frame(width: 24)
                            Text(workspace.name)
                                .foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if index < viewModel.workspaces.count - 1 {
                        Divider()
                            .padding(.leading, 52)
                    }
                }
            }
            .background(CraftTheme.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(CraftTheme.hairline)
            }
        }
    }

    private func connectIfReady() {
        guard viewModel.canConnect else { return }
        focusedField = nil
        Task { await viewModel.testConnectionAndFetchWorkspaces() }
    }

    private func select(_ workspace: Workspace) {
        Task {
            do {
                try await viewModel.saveAndConnect(workspaceId: workspace.id)
                onConnected()
            } catch {
                viewModel.errorMessage = "Could not save this connection: \(error.localizedDescription)"
            }
        }
    }
}
