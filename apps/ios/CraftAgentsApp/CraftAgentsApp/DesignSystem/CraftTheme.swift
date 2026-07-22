import SwiftUI

enum CraftTheme {
    static var accent: Color {
        Color(red: 0.48, green: 0.38, blue: 0.76)
    }

    static var accentGradient: LinearGradient {
        LinearGradient(
            colors: [accent, Color(red: 0.35, green: 0.28, blue: 0.62)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    static var cardBackground: Color {
        Color(uiColor: .secondarySystemGroupedBackground)
    }

    static var hairline: Color {
        Color.primary.opacity(0.08)
    }

    static let chatMaxWidth: CGFloat = 760
}
