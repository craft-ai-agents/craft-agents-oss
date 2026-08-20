import SwiftUI
import SwiftData
import CraftAgentKit

struct RootView: View {
    @State private var hasSavedConnection = false
    @State private var connectionViewModel = ServerConnectionViewModel(
        store: ServerConnectionStore(keychain: KeychainStore())
    )
    @State private var appClientProvider = AppClientProvider(
        store: ServerConnectionStore(keychain: KeychainStore())
    )
    private let cache = SessionCacheRepository(
        modelContainer: try! ModelContainer(for: Schema([CachedSession.self, CachedMessage.self]))
    )

    var body: some View {
        Group {
            if hasSavedConnection {
                SessionListView(
                    viewModel: SessionListViewModel(client: appClientProvider.client, cache: cache, workspaceId: appClientProvider.workspaceId),
                    onReconnect: { await appClientProvider.connectToSavedServer() },
                    onChangeServer: { hasSavedConnection = false },
                    workspaces: appClientProvider.workspaces,
                    currentWorkspaceId: appClientProvider.workspaceId,
                    onSwitchWorkspace: { await appClientProvider.switchWorkspace(to: $0) }
                )
                // Rebuild view models whenever the provider replaces its RPC
                // client so no session remains bound to a disconnected transport.
                .id("\(appClientProvider.workspaceId ?? "none")-\(appClientProvider.connectionRevision)")
            } else {
                NavigationStack {
                    ServerConnectionSetupView(viewModel: connectionViewModel) {
                        Task {
                            await appClientProvider.connectToSavedServer()
                            hasSavedConnection = true
                        }
                    }
                }
            }
        }
        .task {
            let hasSaved = !((try? await ServerConnectionStore(keychain: KeychainStore()).list()) ?? []).isEmpty
            if hasSaved {
                await appClientProvider.connectToSavedServer()
            }
            hasSavedConnection = hasSaved
        }
    }
}

#Preview {
    RootView()
}
