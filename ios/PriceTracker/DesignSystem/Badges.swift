import SwiftUI

/// Un'etichetta a capsula colorata, per stati e disponibilita'.
struct StatusBadge: View {
    let title: String
    let systemImage: String
    var tint: Color = .secondary

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .labelStyle(.titleAndIcon)
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(tint.opacity(0.14), in: .capsule)
    }
}

/// La variazione di un prezzo, con freccia e colore: verde se scende.
struct PriceChangeLabel: View {
    let change: Decimal
    let ratio: Double?
    let currency: String?
    var font: Font = .subheadline

    var body: some View {
        let isDown = change < 0
        let tint: Color = change == 0 ? .secondary : (isDown ? Theme.positive : Theme.negative)
        HStack(spacing: 4) {
            Image(systemName: change == 0 ? "equal" : (isDown ? "arrow.down.right" : "arrow.up.right"))
                .fontWeight(.bold)
            Text(PriceFormatting.signedString(change, currency: currency))
            if let ratio, change != 0 {
                Text("(\(PriceFormatting.percent(ratio)))")
            }
        }
        .font(font.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(tint)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        if change == 0 { return "Prezzo invariato" }
        let amount = PriceFormatting.string(change < 0 ? -change : change, currency: currency)
        return change < 0 ? "Sceso di \(amount)" : "Salito di \(amount)"
    }
}
