// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/NewSessionSheet.swift
import SwiftUI
import CraftAgentKit

struct NewSessionSheet: View {
    let workspaceId: String
    let onCreate: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 16) {
            Text("Start a new session").font(.headline)
            Button("Create") {
                onCreate(workspaceId)
                dismiss()
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
        .presentationDetents([.height(160)])
    }
}
