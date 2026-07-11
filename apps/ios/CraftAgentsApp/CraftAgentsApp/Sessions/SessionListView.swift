import SwiftUI
import CraftAgentKit

struct SessionListView: View {
    @Bindable var viewModel: SessionListViewModel
    var onReconnect: (() async -> Void)?
    var onChangeServer: (() -> Void)?
    var workspaces: [Workspace] = []
    var currentWorkspaceId: String?
    var onSwitchWorkspace: ((String) async -> Void)?

    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    @State private var selectedSessionId: String?
    @State private var activeChatViewModel: ChatViewModel?
    @State private var chatViewModels: [String: ChatViewModel] = [:]
    @State private var renameTarget: Session?
    @State private var renameText = ""
    @State private var isReconnecting = false

    var body: some View {
        NavigationSplitView(columnVisibility: $columnVisibility) {
            VStack(spacing: 0) {
                filterBar
                Divider()
                sessionList
            }
            .navigationTitle("Sessions")
            .searchable(
                text: $viewModel.searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search sessions"
            )
            .toolbar { sidebarToolbar }
            .alert("Rename session", isPresented: renameBinding) {
                TextField("Name", text: $renameText)
                Button("Cancel", role: .cancel) { renameTarget = nil }
                Button("Save") {
                    if let target = renameTarget {
                        let newName = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task { await viewModel.renameSession(sessionId: target.id, name: newName) }
                    }
                    renameTarget = nil
                }
                .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        } detail: {
            detail
        }
        .navigationSplitViewStyle(.balanced)
        .onChange(of: selectedSessionId) { _, sessionId in
            prepareChat(for: sessionId)
        }
        .onChange(of: viewModel.sessions.map(\.id)) { _, sessionIds in
            reconcileChatSelection(with: sessionIds)
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(SessionListFilter.allCases) { filter in
                    Button {
                        withAnimation(.easeOut(duration: 0.18)) {
                            viewModel.selectedFilter = filter
                        }
                    } label: {
                        Label(filter.title, systemImage: filter.systemImage)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 11)
                            .padding(.vertical, 7)
                            .foregroundStyle(viewModel.selectedFilter == filter ? CraftTheme.accent : .secondary)
                            .background(
                                viewModel.selectedFilter == filter
                                    ? CraftTheme.accent.opacity(0.14)
                                    : Color.primary.opacity(0.045),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(viewModel.selectedFilter == filter ? .isSelected : [])
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
        }
        .background(Color(uiColor: .systemBackground))
    }

    private var sessionList: some View {
        List(selection: $selectedSessionId) {
            if viewModel.isOffline {
                offlineSection
            }

            if viewModel.visibleSessions.isEmpty {
                emptyState
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
            } else {
                ForEach(viewModel.visibleSessions) { session in
                    row(for: session)
                        .tag(session.id)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Task { await viewModel.deleteSession(sessionId: session.id) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                Task { await viewModel.archiveSession(sessionId: session.id) }
                            } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            .tint(.orange)
                        }
                        .contextMenu { sessionMenu(for: session) }
                }
            }
        }
        .listStyle(.plain)
        .refreshable { await viewModel.load() }
        .task { await viewModel.load() }
    }

    @ViewBuilder
    private var detail: some View {
        if let selectedSessionId,
           let session = viewModel.sessions.first(where: { $0.id == selectedSessionId }),
           let activeChatViewModel,
           activeChatViewModel.sessionId == selectedSessionId {
            ChatView(
                viewModel: activeChatViewModel,
                sessionTitle: displayTitle(for: session)
            )
            .id(selectedSessionId)
        } else if selectedSessionId != nil {
            ProgressView()
        } else {
            ContentUnavailableView(
                "Select a session",
                systemImage: "bubble.left.and.bubble.right",
                description: Text("Choose a conversation from the sidebar or start a new one.")
            )
        }
    }

    @ToolbarContentBuilder
    private var sidebarToolbar: some ToolbarContent {
        if workspaces.count > 1 {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    ForEach(workspaces) { workspace in
                        Button {
                            selectedSessionId = nil
                            Task { await onSwitchWorkspace?(workspace.id) }
                        } label: {
                            if workspace.id == currentWorkspaceId {
                                Label(workspace.name, systemImage: "checkmark")
                            } else {
                                Text(workspace.name)
                            }
                        }
                    }
                } label: {
                    Label(currentWorkspaceName, systemImage: "square.stack.3d.up")
                        .labelStyle(.iconOnly)
                }
                .accessibilityLabel("Workspace: \(currentWorkspaceName)")
            }
        }

        ToolbarItem(placement: .primaryAction) {
            Button {
                Task {
                    if let created = await viewModel.createNewSession() {
                        selectedSessionId = created.id
                    }
                }
            } label: {
                Label("New Session", systemImage: "square.and.pencil")
            }
            .disabled(viewModel.isOffline)
        }
    }

    private func row(for session: Session) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(iconColor(for: session).opacity(0.13))
                    .frame(width: 34, height: 34)

                if session.isProcessing {
                    ProgressView()
                        .controlSize(.small)
                        .tint(iconColor(for: session))
                } else {
                    Image(systemName: iconName(for: session))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(iconColor(for: session))
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(displayTitle(for: session))
                        .font(.body.weight(session.hasUnread == true ? .semibold : .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    if session.isFlagged == true {
                        Image(systemName: "flag.fill")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                    }
                }

                if let preview = previewText(for: session) {
                    Text(preview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 6) {
                    if let status = viewModel.statusLabel(for: session.sessionStatus) {
                        Text(status)
                            .lineLimit(1)
                    }
                    if session.sessionStatus != nil, relativeTime(for: session) != nil {
                        Text("•")
                    }
                    if let relativeTime = relativeTime(for: session) {
                        Text(relativeTime)
                    }
                }
                .font(.caption)
                .foregroundStyle(.tertiary)
            }

            Spacer(minLength: 4)

            if session.hasUnread == true {
                Circle()
                    .fill(CraftTheme.accent)
                    .frame(width: 8, height: 8)
                    .padding(.top, 6)
                    .accessibilityLabel("Unread")
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func sessionMenu(for session: Session) -> some View {
        Button { beginRename(session) } label: {
            Label("Rename", systemImage: "pencil")
        }
        if !viewModel.statuses.isEmpty {
            Menu {
                ForEach(viewModel.statuses) { status in
                    Button {
                        Task { await viewModel.setSessionStatus(sessionId: session.id, statusId: status.id) }
                    } label: {
                        if session.sessionStatus == status.id {
                            Label(status.label, systemImage: "checkmark")
                        } else {
                            Text(status.label)
                        }
                    }
                }
            } label: {
                Label("Category", systemImage: "tag")
            }
        }
        Button {
            Task { await viewModel.archiveSession(sessionId: session.id) }
        } label: {
            Label("Archive", systemImage: "archivebox")
        }
        Button(role: .destructive) {
            Task { await viewModel.deleteSession(sessionId: session.id) }
        } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            viewModel.searchText.isEmpty ? "No sessions" : "No matching sessions",
            systemImage: viewModel.searchText.isEmpty ? "bubble.left.and.exclamationmark.bubble.right" : "magnifyingglass",
            description: Text(emptyDescription)
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }

    private var emptyDescription: String {
        if !viewModel.searchText.isEmpty {
            return "Try another search or clear the current filter."
        }
        if viewModel.selectedFilter != .all {
            return "No sessions match the \(viewModel.selectedFilter.title.lowercased()) filter."
        }
        return viewModel.isOffline
            ? "Reconnect to load sessions that are not cached on this device."
            : "Start a new conversation with the compose button."
    }

    @ViewBuilder
    private var offlineSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                Label("Offline — showing cached sessions", systemImage: "wifi.slash")
                    .font(.subheadline.weight(.semibold))
                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                HStack {
                    Button {
                        Task {
                            isReconnecting = true
                            await onReconnect?()
                            isReconnecting = false
                        }
                    } label: {
                        if isReconnecting {
                            ProgressView()
                        } else {
                            Text("Reconnect")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(isReconnecting || onReconnect == nil)

                    if let onChangeServer {
                        Button("Change Server", action: onChangeServer)
                            .buttonStyle(.bordered)
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var renameBinding: Binding<Bool> {
        Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })
    }

    private var currentWorkspaceName: String {
        workspaces.first(where: { $0.id == currentWorkspaceId })?.name ?? "Workspace"
    }

    private func displayTitle(for session: Session) -> String {
        session.name ?? session.preview ?? "Untitled session"
    }

    private func previewText(for session: Session) -> String? {
        guard let preview = session.preview,
              !preview.isEmpty,
              preview != session.name else {
            return nil
        }
        return preview
    }

    private func relativeTime(for session: Session) -> String? {
        guard session.lastMessageAt > 0 else { return nil }
        let seconds = session.lastMessageAt > 10_000_000_000
            ? session.lastMessageAt / 1_000
            : session.lastMessageAt
        return Date(timeIntervalSince1970: seconds)
            .formatted(.relative(presentation: .numeric, unitsStyle: .abbreviated))
    }

    private func iconName(for session: Session) -> String {
        guard let status = session.sessionStatus?.lowercased() else {
            return "bubble.left.fill"
        }
        if status.contains("done") || status.contains("complete") {
            return "checkmark"
        }
        if status.contains("review") {
            return "eyes"
        }
        if status.contains("cancel") {
            return "xmark"
        }
        if status.contains("backlog") {
            return "tray"
        }
        return "circle.fill"
    }

    private func iconColor(for session: Session) -> Color {
        if session.isProcessing {
            return CraftTheme.accent
        }
        guard let status = session.sessionStatus?.lowercased() else {
            return .secondary
        }
        if status.contains("done") || status.contains("complete") {
            return .green
        }
        if status.contains("review") {
            return .orange
        }
        if status.contains("cancel") {
            return .secondary
        }
        return CraftTheme.accent
    }

    private func beginRename(_ session: Session) {
        renameText = session.name ?? ""
        renameTarget = session
    }

    private func prepareChat(for sessionId: String?) {
        guard let sessionId else {
            activeChatViewModel = nil
            return
        }
        if let existing = chatViewModels[sessionId] {
            activeChatViewModel = existing
            return
        }
        let created = ChatViewModel(
            client: viewModel.clientForDetail,
            sessionId: sessionId,
            cache: viewModel.clientCache,
            workspaceId: viewModel.workspaceId(for: sessionId)
        )
        chatViewModels[sessionId] = created
        activeChatViewModel = created
    }

    private func reconcileChatSelection(with sessionIds: [String]) {
        let availableIds = Set(sessionIds)
        chatViewModels = chatViewModels.filter { availableIds.contains($0.key) }
        guard let selectedSessionId, !availableIds.contains(selectedSessionId) else {
            return
        }
        self.selectedSessionId = nil
        activeChatViewModel = nil
    }
}
