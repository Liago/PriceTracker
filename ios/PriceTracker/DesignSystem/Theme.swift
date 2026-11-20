import SwiftUI

/// Costanti visive dell'app. I colori sono semantici, cosi' seguono
/// automaticamente chiaro/scuro e il contrasto elevato.
enum Theme {
    static let cornerRadius: CGFloat = 22
    static let smallCornerRadius: CGFloat = 12
    static let spacing: CGFloat = 16

    /// Prezzo sceso, obiettivo raggiunto.
    static let positive = Color.green
    /// Prezzo salito, errore.
    static let negative = Color.red
    /// Da verificare.
    static let warning = Color.orange

    static func tint(for health: TrackingHealth) -> Color {
        switch health {
        case .healthy: .green
        case .degraded: .orange
        case .broken, .blocked: .red
        case .unknown: .secondary
        }
    }

    static func tint(for filter: ProductFilter) -> Color {
        switch filter {
        case .all: .accentColor
        case .atTarget: .green
        case .attention: .orange
        case .unavailable: .gray
        }
    }
}

/// Una superficie raggruppata, come le celle di un elenco inset.
struct CardBackground: ViewModifier {
    var padding: CGFloat = Theme.spacing

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: Theme.cornerRadius, style: .continuous))
    }
}

extension View {
    func card(padding: CGFloat = Theme.spacing) -> some View {
        modifier(CardBackground(padding: padding))
    }
}

/// Il titolo di una card, con simbolo e azione facoltativa.
struct CardHeader<Trailing: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Label(title, systemImage: systemImage)
                .font(.headline)
                .labelStyle(.titleAndIcon)
            Spacer(minLength: 8)
            trailing
        }
    }
}

extension CardHeader where Trailing == EmptyView {
    init(title: String, systemImage: String) {
        self.init(title: title, systemImage: systemImage) { EmptyView() }
    }
}
