// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift
import SwiftUI
import CraftAgentKit

struct ChatView: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(viewModel.messages) { message in
                        if message.role == .tool {
                            ToolCallCardView(message: message)
                        } else {
                            Text(message.content)
                                .padding(10)
                                .background(message.role == .user ? Color.blue.opacity(0.15) : Color.gray.opacity(0.15))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                                .frame(maxWidth: .infinity, alignment: message.role == .user ? .trailing : .leading)
                        }
                    }
                }
                .padding()
            }
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.caption).padding(.horizontal)
            }
            HStack {
                TextField("Message", text: $viewModel.draftText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Button("Send") { Task { await viewModel.send() } }
                    .disabled(viewModel.draftText.isEmpty)
            }
            .padding()
        }
        .task { await viewModel.load() }
        .navigationTitle("Chat")
    }
}
