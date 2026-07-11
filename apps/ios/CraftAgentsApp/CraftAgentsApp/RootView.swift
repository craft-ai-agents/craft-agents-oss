import SwiftUI
import CraftAgentKit

struct RootView: View {
    @State private var hasSavedConnection = false
    @State private var connectionViewModel = ServerConnectionViewModel(
        store: ServerConnectionStore(keychain: KeychainStore())
    )

    var body: some View {
        NavigationStack {
            if hasSavedConnection {
                Text("Session list goes here (Task 11)")
            } else {
                ServerConnectionSetupView(viewModel: connectionViewModel) {
                    hasSavedConnection = true
                }
            }
        }
        .task {
            hasSavedConnection = !((try? await ServerConnectionStore(keychain: KeychainStore()).list()) ?? []).isEmpty
        }
    }
}

#Preview {
    RootView()
}
