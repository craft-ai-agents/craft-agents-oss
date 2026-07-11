// apps/ios/CraftAgentsApp/CraftAgentsApp/Onboarding/ServerConnectionSetupView.swift
import SwiftUI
import CraftAgentKit

struct ServerConnectionSetupView: View {
    @Bindable var viewModel: ServerConnectionViewModel
    var onConnected: () -> Void

    var body: some View {
        Form {
            Section("Server") {
                TextField("wss://myserver.example.com:9100", text: $viewModel.serverURLText)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                SecureField("******", text: $viewModel.token)
            }

            if let errorMessage = viewModel.errorMessage {
                Section {
                    Text(errorMessage).foregroundStyle(.red)
                }
            }

            Section {
                Button("Test Connection") {
                    Task { await viewModel.testConnectionAndFetchWorkspaces() }
                }
            }

            if !viewModel.workspaces.isEmpty {
                Section("Choose a workspace") {
                    ForEach(viewModel.workspaces) { workspace in
                        Button(workspace.name) {
                            Task {
                                do {
                                    try await viewModel.saveAndConnect(workspaceId: workspace.id)
                                    onConnected()
                                } catch {
                                    viewModel.errorMessage = "Failed to save connection: \(error)"
                                }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Connect to Server")
    }
}
