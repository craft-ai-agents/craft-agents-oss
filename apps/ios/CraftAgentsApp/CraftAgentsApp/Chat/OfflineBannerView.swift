import SwiftUI

struct OfflineBannerView: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "wifi.slash")
                .foregroundStyle(.orange)
            VStack(alignment: .leading, spacing: 1) {
                Text("Offline")
                    .font(.caption.weight(.semibold))
                Text("Showing cached messages. Sending and approvals are disabled.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity)
        .background(Color.orange.opacity(0.09))
        .overlay(alignment: .bottom) {
            Divider()
        }
        .accessibilityElement(children: .combine)
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
