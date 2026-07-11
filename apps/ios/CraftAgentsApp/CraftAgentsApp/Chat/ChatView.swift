import SwiftUI
import CraftAgentKit
import PhotosUI
import UniformTypeIdentifiers

struct ChatView: View {
    @Bindable var viewModel: ChatViewModel
    let sessionTitle: String

    @State private var photoPickerItem: PhotosPickerItem?
    @State private var isShowingPhotoPicker = false
    @State private var isShowingNotes = false
    @State private var isShowingFiles = false
    @State private var isShowingModelPicker = false
    @State private var isShowingFileImporter = false
    @State private var isNearBottom = true
    @State private var hasUnseenMessages = false

    var body: some View {
        VStack(spacing: 0) {
            if viewModel.isOffline {
                OfflineBannerView()
            }
            conversation
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composer
        }
        .task { await viewModel.load() }
        .navigationTitle(sessionTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { chatToolbar }
        .sheet(isPresented: $isShowingModelPicker) {
            ModelPickerView(viewModel: viewModel)
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
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $viewModel.pendingCredentialRequest) { request in
            CredentialInputSheet(request: request) { response in
                Task { await viewModel.respondToCredential(response) }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .photosPicker(
            isPresented: $isShowingPhotoPicker,
            selection: $photoPickerItem,
            matching: .images
        )
        .onChange(of: photoPickerItem) { _, newItem in
            loadPhoto(newItem)
        }
        .fileImporter(
            isPresented: $isShowingFileImporter,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true,
            onCompletion: handleFileImport
        )
    }

    private var conversation: some View {
        ScrollViewReader { proxy in
            GeometryReader { geometry in
                ZStack(alignment: .bottom) {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 14) {
                            if viewModel.messages.isEmpty {
                                ContentUnavailableView(
                                    "Start a conversation",
                                    systemImage: "sparkles",
                                    description: Text("Ask Craft Agents to research, create, review, or continue work from your Mac.")
                                )
                                .frame(maxWidth: .infinity)
                                .frame(minHeight: max(geometry.size.height - 80, 320))
                            } else {
                                ForEach(viewModel.messages) { message in
                                    Group {
                                        if message.role == .tool {
                                            ToolCallCardView(message: message)
                                        } else {
                                            MessageBubble(message: message)
                                                .frame(
                                                    maxWidth: .infinity,
                                                    alignment: message.role == .user ? .trailing : .leading
                                                )
                                        }
                                    }
                                    .id(message.id)
                                }
                            }

                            GeometryReader { anchorGeometry in
                                Color.clear.preference(
                                    key: ChatBottomOffsetPreferenceKey.self,
                                    value: anchorGeometry.frame(in: .named(Self.scrollSpace)).maxY
                                )
                            }
                            .frame(height: 1)
                            .id(Self.scrollAnchor)
                        }
                        .frame(maxWidth: CraftTheme.chatMaxWidth)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 16)
                        .padding(.top, 20)
                        .padding(.bottom, 24)
                    }
                    .coordinateSpace(name: Self.scrollSpace)
                    .scrollDismissesKeyboard(.interactively)
                    .onPreferenceChange(ChatBottomOffsetPreferenceKey.self) { bottomOffset in
                        let nearBottom = bottomOffset <= geometry.size.height + 120
                        isNearBottom = nearBottom
                        if nearBottom {
                            hasUnseenMessages = false
                        }
                    }

                    if hasUnseenMessages && !isNearBottom {
                        Button {
                            scrollToBottom(proxy, animated: true)
                        } label: {
                            Label("New messages", systemImage: "arrow.down")
                                .font(.caption.weight(.semibold))
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .padding(.bottom, 12)
                        .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                    }
                }
                .onChange(of: viewModel.messages.count) { oldCount, newCount in
                    guard newCount > oldCount else { return }
                    if isNearBottom || viewModel.messages.last?.role == .user {
                        scrollToBottom(proxy, animated: true)
                    } else {
                        hasUnseenMessages = true
                    }
                }
                .onChange(of: viewModel.messages.last?.content) { _, _ in
                    if isNearBottom {
                        scrollToBottom(proxy, animated: false)
                    } else if viewModel.isProcessing {
                        hasUnseenMessages = true
                    }
                }
                .onAppear {
                    scrollToBottom(proxy, animated: false)
                }
            }
        }
    }

    private var composer: some View {
        ChatComposer(
            text: $viewModel.draftText,
            attachments: $viewModel.pendingAttachments,
            isOffline: viewModel.isOffline,
            isProcessing: viewModel.isProcessing,
            statusMessage: viewModel.statusMessage,
            errorMessage: viewModel.errorMessage,
            model: viewModel.currentModel,
            permissionMode: viewModel.permissionMode,
            onShowPhotoPicker: { isShowingPhotoPicker = true },
            onShowFileImporter: { isShowingFileImporter = true },
            onShowModelPicker: { isShowingModelPicker = true },
            onSetPermissionMode: { mode in
                Task { await viewModel.setPermissionMode(mode) }
            },
            onClearError: {
                viewModel.errorMessage = nil
            },
            onSend: {
                Task { await viewModel.send() }
            },
            onStop: {
                Task { await viewModel.stop() }
            }
        )
    }

    @ToolbarContentBuilder
    private var chatToolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            VStack(spacing: 1) {
                Text(sessionTitle)
                    .font(.headline)
                    .lineLimit(1)
                if let model = viewModel.currentModel {
                    Text(compactModelName(model))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .accessibilityElement(children: .combine)
        }

        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button {
                    isShowingModelPicker = true
                } label: {
                    Label("Model", systemImage: "cpu")
                }
                Menu("Permission mode") {
                    ForEach(PermissionMode.allCases, id: \.self) { mode in
                        Button {
                            Task { await viewModel.setPermissionMode(mode) }
                        } label: {
                            if viewModel.permissionMode == mode.rawValue {
                                Label(mode.displayName, systemImage: "checkmark")
                            } else {
                                Text(mode.displayName)
                            }
                        }
                    }
                }
                Button {
                    isShowingNotes = true
                } label: {
                    Label("Notes", systemImage: "note.text")
                }
                Button {
                    Task { await viewModel.loadFiles() }
                    isShowingFiles = true
                } label: {
                    Label("Files", systemImage: "folder")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .disabled(viewModel.isOffline)
            .accessibilityLabel("Session actions")
        }
    }

    private static let scrollAnchor = "chat-bottom-anchor"
    private static let scrollSpace = "chat-scroll-space"

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        Task { @MainActor in
            await Task.yield()
            if animated {
                withAnimation(.easeOut(duration: 0.22)) {
                    proxy.scrollTo(Self.scrollAnchor, anchor: .bottom)
                }
            } else {
                proxy.scrollTo(Self.scrollAnchor, anchor: .bottom)
            }
            isNearBottom = true
            hasUnseenMessages = false
        }
    }

    private func loadPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task { @MainActor in
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    viewModel.errorMessage = "The selected photo could not be loaded."
                    return
                }
                viewModel.pendingAttachments.append(
                    FileAttachment.image(named: "photo.jpg", data: data, mimeType: "image/jpeg")
                )
                photoPickerItem = nil
            } catch {
                viewModel.errorMessage = "Could not attach the selected photo: \(error.localizedDescription)"
            }
        }
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        switch result {
        case .failure(let error):
            viewModel.errorMessage = "Could not import the selected file: \(error.localizedDescription)"
        case .success(let urls):
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer {
                    if scoped {
                        url.stopAccessingSecurityScopedResource()
                    }
                }
                do {
                    let data = try Data(contentsOf: url)
                    let name = url.lastPathComponent
                    let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/octet-stream"
                    viewModel.pendingAttachments.append(
                        FileAttachment.document(named: name, data: data, mimeType: mimeType)
                    )
                } catch {
                    viewModel.errorMessage = "Could not attach \(url.lastPathComponent): \(error.localizedDescription)"
                }
            }
        }
    }
}

private struct ChatComposer: View {
    @Binding var text: String
    @Binding var attachments: [FileAttachment]

    let isOffline: Bool
    let isProcessing: Bool
    let statusMessage: String?
    let errorMessage: String?
    let model: String?
    let permissionMode: String?
    let onShowPhotoPicker: () -> Void
    let onShowFileImporter: () -> Void
    let onShowModelPicker: () -> Void
    let onSetPermissionMode: (PermissionMode) -> Void
    let onClearError: () -> Void
    let onSend: () -> Void
    let onStop: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            if let statusMessage {
                HStack(spacing: 7) {
                    ProgressView()
                        .controlSize(.mini)
                    Text(statusMessage)
                        .lineLimit(2)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: CraftTheme.chatMaxWidth, alignment: .leading)
                .frame(maxWidth: .infinity)
            }

            if let errorMessage {
                HStack(spacing: 8) {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    Button(action: onClearError) {
                        Image(systemName: "xmark")
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss error")
                }
                    .font(.caption)
                    .foregroundStyle(.red)
                    .frame(maxWidth: CraftTheme.chatMaxWidth)
                    .frame(maxWidth: .infinity)
            }

            VStack(alignment: .leading, spacing: 8) {
                if !attachments.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(attachments.enumerated()), id: \.offset) { index, attachment in
                                PendingAttachmentChip(attachment: attachment) {
                                    attachments.remove(at: index)
                                }
                            }
                        }
                    }
                }

                TextField("Message Craft Agents...", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...6)
                    .disabled(isOffline)

                HStack(spacing: 8) {
                    Menu {
                        Button(action: onShowPhotoPicker) {
                            Label("Photo Library", systemImage: "photo")
                        }
                        Button(action: onShowFileImporter) {
                            Label("File", systemImage: "doc")
                        }
                    } label: {
                        composerIcon("paperclip")
                    }
                    .disabled(isOffline)
                    .accessibilityLabel("Add attachment")

                    Button(action: onShowModelPicker) {
                        Label(compactModelName(model), systemImage: "cpu")
                            .font(.caption.weight(.medium))
                            .lineLimit(1)
                            .frame(maxWidth: 132)
                            .padding(.horizontal, 9)
                            .frame(height: 30)
                            .background(Color.primary.opacity(0.055), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isOffline)

                    Menu {
                        ForEach(PermissionMode.allCases, id: \.self) { mode in
                            Button {
                                onSetPermissionMode(mode)
                            } label: {
                                if selectedPermissionMode == mode {
                                    Label(mode.displayName, systemImage: "checkmark")
                                } else {
                                    Text(mode.displayName)
                                }
                            }
                        }
                    } label: {
                        Label(selectedPermissionMode.displayName, systemImage: permissionModeIcon)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(permissionModeColor)
                            .padding(.horizontal, 9)
                            .frame(height: 30)
                            .background(permissionModeColor.opacity(0.1), in: Capsule())
                    }
                    .disabled(isOffline)
                    .accessibilityLabel("Permission mode: \(selectedPermissionMode.displayName)")

                    Spacer(minLength: 0)

                    Button(action: isProcessing ? onStop : onSend) {
                        Image(systemName: isProcessing ? "stop.fill" : "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(actionEnabled ? Color.white : Color.secondary)
                            .frame(width: 34, height: 34)
                            .background(
                                actionEnabled ? CraftTheme.accent : Color.primary.opacity(0.08),
                                in: Circle()
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(!actionEnabled)
                    .accessibilityLabel(isProcessing ? "Stop response" : "Send message")
                }
            }
            .padding(10)
            .frame(maxWidth: CraftTheme.chatMaxWidth)
            .frame(maxWidth: .infinity)
            .background(
                CraftTheme.cardBackground,
                in: RoundedRectangle(cornerRadius: 20, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(CraftTheme.hairline)
            }
            .shadow(color: .black.opacity(0.06), radius: 10, y: 3)
        }
        .padding(.horizontal, 10)
        .padding(.top, 8)
        .padding(.bottom, 6)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Divider()
        }
    }

    private var selectedPermissionMode: PermissionMode {
        PermissionMode(rawValue: permissionMode ?? "") ?? .ask
    }

    private var permissionModeColor: Color {
        switch selectedPermissionMode {
        case .safe: .secondary
        case .ask: .orange
        case .allowAll: CraftTheme.accent
        }
    }

    private var permissionModeIcon: String {
        switch selectedPermissionMode {
        case .safe: "eye"
        case .ask: "hand.raised.fill"
        case .allowAll: "bolt.fill"
        }
    }

    private var hasContent: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty
    }

    private var actionEnabled: Bool {
        !isOffline && (isProcessing || hasContent)
    }

    private func composerIcon(_ systemName: String) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 15, weight: .medium))
            .frame(width: 30, height: 30)
            .background(Color.primary.opacity(0.055), in: Circle())
    }
}

private struct ChatBottomOffsetPreferenceKey: PreferenceKey {
    static let defaultValue = CGFloat.greatestFiniteMagnitude

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private func compactModelName(_ model: String?) -> String {
    guard let model, !model.isEmpty else { return "Model" }
    guard model.count > 22 else { return model }
    return "\(model.prefix(19))..."
}
