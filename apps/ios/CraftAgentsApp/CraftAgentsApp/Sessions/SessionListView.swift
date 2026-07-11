// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift
import SwiftUI
import CraftAgentKit

struct SessionListView: View {
    @Bindable var viewModel: SessionListViewModel
    @State private var selectedSessionId: String?
    @State private var isShowingNewSessionSheet = false
    @State private var newSessionWorkspaceId: String?

    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(viewModel.sessions, selection: $selectedSessionId) { session in
                VStack(alignment: .leading) {
                    Text(session.name ?? session.preview ?? "Untitled session")
                        .font(.headline)
                    if let sessionStatus = session.sessionStatus {
                        Text(sessionStatus).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .tag(session.id)
            }
            .navigationTitle("Sessions")
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button("New Session", systemImage: "plus") {
                        Task {
                            newSessionWorkspaceId = await viewModel.resolveWorkspaceIdForNewSession()
                            isShowingNewSessionSheet = true
                        }
                    }
                }
            }
            .sheet(isPresented: $isShowingNewSessionSheet) {
                if let workspaceId = newSessionWorkspaceId {
                    NewSessionSheet(workspaceId: workspaceId) { workspaceId in
                        Task {
                            if let created = await viewModel.createSession(workspaceId: workspaceId) {
                                selectedSessionId = created.id
                            }
                        }
                    }
                } else {
                    Text("No workspace available")
                        .foregroundStyle(.secondary)
                        .padding()
                }
            }
        } detail: {
            if let selectedSessionId {
                ChatView(viewModel: ChatViewModel(client: viewModel.clientForDetail, sessionId: selectedSessionId, cache: viewModel.clientCache))
            } else {
                Text("Select a session")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}
