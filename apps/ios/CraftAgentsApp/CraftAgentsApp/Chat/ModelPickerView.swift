// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ModelPickerView.swift
import SwiftUI
import CraftAgentKit

/// Lets the user change the session's model. Lists each configured LLM
/// connection and its selectable models (`LLM_Connection:list`), and applies
/// the choice via `session:setModel`. "Workspace default" clears the override.
struct ModelPickerView: View {
    @Bindable var viewModel: ChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else if viewModel.availableConnections.isEmpty {
                    ContentUnavailableView("No models available", systemImage: "cpu")
                } else {
                    List {
                        Section {
                            Button {
                                apply(model: nil, connection: nil)
                            } label: {
                                row(title: "Workspace default", selected: viewModel.currentModel == nil)
                            }
                        }
                        ForEach(viewModel.availableConnections) { connection in
                            Section(connection.name) {
                                ForEach(connection.selectableModels) { model in
                                    Button {
                                        apply(model: model.modelId, connection: connection.slug)
                                    } label: {
                                        row(title: model.displayName, selected: viewModel.currentModel == model.modelId)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await viewModel.loadConnections()
                isLoading = false
            }
        }
    }

    private func row(title: String, selected: Bool) -> some View {
        HStack {
            Text(title).foregroundStyle(.primary)
            Spacer()
            if selected {
                Image(systemName: "checkmark").foregroundStyle(.tint)
            }
        }
    }

    private func apply(model: String?, connection: String?) {
        Task { await viewModel.setModel(model, connection: connection) }
        dismiss()
    }
}
