// apps/ios/CraftAgentsApp/CraftAgentsApp/Sessions/SessionListView.swift
import SwiftUI
import CraftAgentKit

struct SessionListView: View {
    @Bindable var viewModel: SessionListViewModel
    @State private var selectedSessionId: String?

    var body: some View {
        NavigationSplitView {
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
        } detail: {
            if let selectedSessionId {
                ChatView(viewModel: ChatViewModel(client: viewModel.clientForDetail, sessionId: selectedSessionId, cache: viewModel.clientCache))
            } else {
                Text("Select a session")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
