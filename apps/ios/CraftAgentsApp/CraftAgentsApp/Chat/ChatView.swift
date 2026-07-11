// apps/ios/CraftAgentsApp/CraftAgentsApp/Chat/ChatView.swift
import SwiftUI
import CraftAgentKit
import PhotosUI

struct ChatView: View {
    @Bindable var viewModel: ChatViewModel
    @State private var photoPickerItem: PhotosPickerItem?
    @State private var isShowingNotes = false
    @State private var isShowingFiles = false

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
            if let statusMessage = viewModel.statusMessage {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.mini)
                    Text(statusMessage).font(.caption).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
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
                if viewModel.isProcessing {
                    Button(role: .destructive) { Task { await viewModel.stop() } } label: {
                        Image(systemName: "stop.circle.fill")
                    }
                    .disabled(viewModel.isOffline)
                } else {
                    Button("Send") { Task { await viewModel.send() } }
                        .disabled((viewModel.draftText.isEmpty && viewModel.pendingAttachments.isEmpty) || viewModel.isOffline)
                }
            }
            .padding()
        }
        .task { await viewModel.load() }
        .navigationTitle("Chat")
        .toolbar {
            if let model = viewModel.currentModel {
                ToolbarItem(placement: .principal) {
                    Text(model).font(.caption).foregroundStyle(.secondary)
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Menu("Permission mode") {
                        ForEach(PermissionMode.allCases, id: \.self) { mode in
                            Button {
                                Task { await viewModel.setPermissionMode(mode) }
                            } label: {
                                if viewModel.permissionMode == mode.rawValue {
                                    Label(mode.rawValue, systemImage: "checkmark")
                                } else {
                                    Text(mode.rawValue)
                                }
                            }
                        }
                    }
                    Button { isShowingNotes = true } label: { Label("Notes", systemImage: "note.text") }
                    Button {
                        Task { await viewModel.loadFiles() }
                        isShowingFiles = true
                    } label: { Label("Files", systemImage: "folder") }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .disabled(viewModel.isOffline)
            }
        }
        .sheet(isPresented: $isShowingNotes) {
            SessionNotesView(viewModel: viewModel)
        }
        .sheet(isPresented: $isShowingFiles) {
            SessionFilesView(files: viewModel.files)
        }
        .sheet(item: $viewModel.pendingPermissionRequest) { request in
            PermissionApprovalSheet(request: request) { allowed, alwaysAllow in
                Task { await viewModel.respond(allowed: allowed, alwaysAllow: alwaysAllow) }
            }
            .presentationDetents([.medium])
        }
        .sheet(item: $viewModel.pendingCredentialRequest) { request in
            CredentialInputSheet(request: request) { response in
                Task { await viewModel.respondToCredential(response) }
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
