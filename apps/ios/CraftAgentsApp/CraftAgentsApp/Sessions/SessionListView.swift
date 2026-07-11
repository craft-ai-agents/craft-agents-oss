// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift
import SwiftUI
import CraftAgentKit

struct SessionListView: View {
    @Bindable var viewModel: SessionListViewModel
    var onReconnect: (() async -> Void)?
    var onChangeServer: (() -> Void)?
    var workspaces: [Workspace] = []
    var currentWorkspaceId: String?
    var onSwitchWorkspace: ((String) async -> Void)?
    @State private var selectedSessionId: String?
    @State private var renameTarget: Session?
    @State private var renameText = ""
    @State private var isReconnecting = false

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(selection: $selectedSessionId) {
                if viewModel.isOffline {
                    offlineSection
                }
                ForEach(viewModel.sessions) { session in
                    row(for: session)
                        .tag(session.id)
                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                            Button(role: .destructive) {
                                Task { await viewModel.deleteSession(sessionId: session.id) }
                            } label: { Label("Delete", systemImage: "trash") }
                            Button {
                                Task { await viewModel.archiveSession(sessionId: session.id) }
                            } label: { Label("Archive", systemImage: "archivebox") }
                            .tint(.orange)
                        }
                        .contextMenu {
                            Button { beginRename(session) } label: { Label("Rename", systemImage: "pencil") }
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
                                } label: { Label("Category", systemImage: "tag") }
                            }
                            Button { Task { await viewModel.archiveSession(sessionId: session.id) } } label: {
                                Label("Archive", systemImage: "archivebox")
                            }
                            Button(role: .destructive) {
                                Task { await viewModel.deleteSession(sessionId: session.id) }
                            } label: { Label("Delete", systemImage: "trash") }
                        }
                }
            }
            .navigationTitle("Sessions")
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
            .toolbar {
                if workspaces.count > 1 {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            ForEach(workspaces) { workspace in
                                Button {
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
                            HStack(spacing: 4) {
                                Image(systemName: "square.stack.3d.up")
                                Text(currentWorkspaceName).lineLimit(1)
                            }
                        }
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("New Session", systemImage: "plus") {
                        Task {
                            if let created = await viewModel.createNewSession() {
                                selectedSessionId = created.id
                            }
                        }
                    }
                }
            }
            .alert("Rename session", isPresented: renameBinding) {
                TextField("Name", text: $renameText)
                Button("Cancel", role: .cancel) { renameTarget = nil }
                Button("Save") {
                    if let target = renameTarget {
                        let newName = renameText
                        Task { await viewModel.renameSession(sessionId: target.id, name: newName) }
                    }
                    renameTarget = nil
                }
            }
        } detail: {
            if let selectedSessionId {
                ChatView(viewModel: ChatViewModel(
                    client: viewModel.clientForDetail,
                    sessionId: selectedSessionId,
                    cache: viewModel.clientCache,
                    workspaceId: viewModel.workspaceId(for: selectedSessionId)
                ))
            } else {
                Text("Select a session")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private func row(for session: Session) -> some View {
        HStack(spacing: 8) {
            if session.hasUnread == true {
                Circle().fill(Color.blue).frame(width: 8, height: 8)
            }
            VStack(alignment: .leading) {
                Text(session.name ?? session.preview ?? "Untitled session")
                    .font(.headline)
                if let statusLabel = viewModel.statusLabel(for: session.sessionStatus) {
                    Text(statusLabel).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var offlineSection: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("Offline — showing cached sessions", systemImage: "wifi.slash")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let error = viewModel.errorMessage {
                    Text(error).font(.caption2).foregroundStyle(.red)
                }
                HStack {
                    Button {
                        Task {
                            isReconnecting = true
                            await onReconnect?()
                            isReconnecting = false
                        }
                    } label: {
                        if isReconnecting { ProgressView() } else { Text("Reconnect") }
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

    private func beginRename(_ session: Session) {
        renameText = session.name ?? ""
        renameTarget = session
    }
}
