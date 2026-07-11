// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift
import SwiftUI
import CraftAgentKit
import PhotosUI

struct ChatView: View {
    @Bindable var viewModel: ChatViewModel
    @State private var photoPickerItem: PhotosPickerItem?

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
            PhotosPicker(selection: $photoPickerItem, matching: .images) {
                Image(systemName: "paperclip")
            }
            .onChange(of: photoPickerItem) { _, newItem in
                Task {
                    guard let newItem, let data = try? await newItem.loadTransferable(type: Data.self) else { return }
                    viewModel.pendingAttachments.append(
                        FileAttachment.image(named: "photo.jpg", data: data, mimeType: "image/jpeg")
                    )
                    photoPickerItem = nil
                }
            }
            if !viewModel.pendingAttachments.isEmpty {
                Text("\(viewModel.pendingAttachments.count) attachment(s) ready to send")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                TextField("Message", text: $viewModel.draftText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                Button("Send") { Task { await viewModel.send() } }
                    .disabled(viewModel.draftText.isEmpty && viewModel.pendingAttachments.isEmpty)
            }
            .padding()
        }
        .task { await viewModel.load() }
        .navigationTitle("Chat")
        .sheet(item: $viewModel.pendingPermissionRequest) { request in
            PermissionApprovalSheet(request: request) { allowed, alwaysAllow in
                Task { await viewModel.respond(allowed: allowed, alwaysAllow: alwaysAllow) }
            }
            .presentationDetents([.medium])
        }
    }
}
