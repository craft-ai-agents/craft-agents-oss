// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/SessionNotesView.swift
import SwiftUI
import CraftAgentKit

/// Edits the session's notes.md via `sessions:getNotes` / `sessions:setNotes`.
struct SessionNotesView: View {
    @Bindable var viewModel: ChatViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                } else {
                    TextEditor(text: $text)
                        .padding(8)
                }
            }
            .navigationTitle("Notes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let content = text
                        Task { await viewModel.saveNotes(content) }
                        dismiss()
                    }
                    .disabled(isLoading)
                }
            }
            .task {
                text = await viewModel.loadNotes()
                isLoading = false
            }
        }
    }
}
