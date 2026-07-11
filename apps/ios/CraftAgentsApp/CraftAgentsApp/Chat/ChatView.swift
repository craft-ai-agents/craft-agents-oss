// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift
import SwiftUI
import CraftAgentKit
import PhotosUI

struct ChatView: View {
    @Bindable var viewModel: ChatViewModel
    @State private var photoPickerItem: PhotosPickerItem?

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isOffline { OfflineBannerView() }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(viewModel.messages) { message in
                            Group {
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
                            .id(message.id)
                        }
                        Color.clear.frame(height: 1).id(Self.scrollAnchor)
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _, _ in scrollToBottom(proxy) }
                .onChange(of: viewModel.messages.last?.content) { _, _ in scrollToBottom(proxy) }
                .onAppear { scrollToBottom(proxy, animated: false) }
            }
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage).foregroundStyle(.red).font(.caption).padding(.horizontal)
            }
            if !viewModel.pendingAttachments.isEmpty {
                Text("\(viewModel.pendingAttachments.count) attachment(s) ready to send")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal)
            }
            HStack(spacing: 8) {
                TextField("Message", text: $viewModel.draftText, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                PhotosPicker(selection: $photoPickerItem, matching: .images) {
                    Image(systemName: "paperclip")
                }
                .disabled(viewModel.isOffline)
                .onChange(of: photoPickerItem) { _, newItem in
                    Task {
                        guard let newItem, let data = try? await newItem.loadTransferable(type: Data.self) else { return }
                        viewModel.pendingAttachments.append(
                            FileAttachment.image(named: "photo.jpg", data: data, mimeType: "image/jpeg")
                        )
                        photoPickerItem = nil
                    }
                }
                Button("Send") { Task { await viewModel.send() } }
                    .disabled((viewModel.draftText.isEmpty && viewModel.pendingAttachments.isEmpty) || viewModel.isOffline)
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

    private static let scrollAnchor = "chat-bottom-anchor"

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        guard !viewModel.messages.isEmpty else { return }
        if animated {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(Self.scrollAnchor, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(Self.scrollAnchor, anchor: .bottom)
        }
    }
}
