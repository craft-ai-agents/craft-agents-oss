import SwiftUI

struct OfflineBannerView: View {
    var body: some View {
        HStack {
            Image(systemName: "wifi.slash")
            Text("Offline — some features are disabled")
                .font(.caption)
        }
        .padding(8)
        .frame(maxWidth: .infinity)
        .background(Color.yellow.opacity(0.2))
    }
}

#if DEBUG
struct OfflineBannerView_Previews: PreviewProvider {
    static var previews: some View {
        OfflineBannerView()
            .previewLayout(.sizeThatFits)
    }
}
#endif
