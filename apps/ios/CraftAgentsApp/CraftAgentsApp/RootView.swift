import SwiftUI
import CraftAgentKit

struct RootView: View {
    @State private var hasSavedConnection = false
    @State private var connectionViewModel = ServerConnectionViewModel(
        store: ServerConnectionStore(keychain: KeychainStore())
    )
    @State private var appClientProvider = AppClientProvider(
        store: ServerConnectionStore(keychain: KeychainStore())
    )

    var body: some View {
        Group {
            if hasSavedConnection {
                SessionListView(viewModel: SessionListViewModel(client: appClientProvider.client))
            } else {
                NavigationStack {
                    ServerConnectionSetupView(viewModel: connectionViewModel) {
                        hasSavedConnection = true
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
