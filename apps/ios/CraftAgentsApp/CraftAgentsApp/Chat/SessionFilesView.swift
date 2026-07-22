// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/SessionFilesView.swift
import SwiftUI
import CraftAgentKit

/// Read-only browser for the session file tree (`sessions:getFiles`).
struct SessionFilesView: View {
    let files: [SessionFile]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if files.isEmpty {
                    ContentUnavailableView("No files", systemImage: "folder")
                } else {
                    List(files, children: \.children) { file in
                        Label {
                            Text(file.name)
                        } icon: {
                            Image(systemName: file.isDirectory ? "folder" : "doc")
                        }
                    }
                }
            }
            .navigationTitle("Files")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
