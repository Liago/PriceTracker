import SwiftUI

/// La scheda del prodotto letta dalla pagina del negozio: valutazione,
/// dati di vendita, descrizione, caratteristiche e specifiche.
struct ProductInfoSection: View {
    let product: Product

    @State private var isDescriptionExpanded = false
    @State private var showsAllFeatures = false

    private var details: ProductDetails { product.details }

    var body: some View {
        if hasOverview {
            overview
        }
        if !details.specs.isEmpty {
            SpecsCard(groups: details.groupedSpecs)
        }
    }

    private var hasOverview: Bool {
        product.description != nil || details.rating != nil || !facts.isEmpty || !details.features.isEmpty
    }

    private var facts: [(label: String, value: String)] {
        var result: [(label: String, value: String)] = []
        if let seller = details.seller { result.append(("Venditore", seller)) }
        if let condition = details.condition { result.append(("Condizione", condition)) }
        for key in details.variant.keys.sorted() {
            if let value = details.variant[key] { result.append((key.capitalized, value)) }
        }
        if let category = details.category { result.append(("Categoria", category)) }
        return result
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 16) {
            CardHeader(title: "Scheda prodotto", systemImage: "doc.text.magnifyingglass")

            if let rating = details.rating {
                RatingView(rating: rating)
            }

            if !facts.isEmpty {
                VStack(spacing: 10) {
                    ForEach(facts.indices, id: \.self) { index in
                        LabeledContent(facts[index].label) {
                            Text(facts[index].value)
                                .multilineTextAlignment(.trailing)
                        }
                        .font(.subheadline)
                        if index < facts.count - 1 { Divider() }
                    }
                }
            }

            if let description = product.description {
                VStack(alignment: .leading, spacing: 6) {
                    Text(description)
                        .font(.subheadline)
                        .lineLimit(isDescriptionExpanded ? nil : 4)
                        .textSelection(.enabled)
                    if description.count > 220 {
                        Button(isDescriptionExpanded ? "Mostra meno" : "Mostra altro") {
                            withAnimation(.snappy) { isDescriptionExpanded.toggle() }
                        }
                        .font(.subheadline.weight(.semibold))
                    }
                }
            }

            if !details.features.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Caratteristiche")
                        .font(.subheadline.weight(.semibold))
                    let visible = showsAllFeatures ? details.features : Array(details.features.prefix(5))
                    ForEach(visible, id: \.self) { feature in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.caption)
                                .foregroundStyle(Color.accentColor)
                            Text(feature)
                                .font(.subheadline)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if details.features.count > 5 {
                        Button(showsAllFeatures ? "Mostra meno" : "Mostra tutte (\(details.features.count))") {
                            withAnimation(.snappy) { showsAllFeatures.toggle() }
                        }
                        .font(.subheadline.weight(.semibold))
                    }
                }
            }
        }
        .card()
    }
}

private struct RatingView: View {
    let rating: ProductRating

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 2) {
                ForEach(0..<5, id: \.self) { index in
                    Image(systemName: symbol(for: index))
                }
            }
            .foregroundStyle(.yellow)
            .font(.subheadline)
            Text(rating.normalized.formatted(.number.precision(.fractionLength(1))))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
            if let count = rating.count {
                Text(count == 1 ? "(1 recensione)" : "(\(count.formatted()) recensioni)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Valutazione \(rating.normalized.formatted(.number.precision(.fractionLength(1)))) su 5")
    }

    private func symbol(for index: Int) -> String {
        let value = rating.normalized
        if value >= Double(index) + 0.75 { return "star.fill" }
        if value >= Double(index) + 0.25 { return "star.leadinghalf.filled" }
        return "star"
    }
}

private struct SpecsCard: View {
    let groups: [SpecGroup]

    @State private var expanded: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardHeader(title: "Specifiche", systemImage: "list.bullet.rectangle")
            ForEach(groups) { group in
                DisclosureGroup(isExpanded: binding(for: group.name)) {
                    VStack(spacing: 10) {
                        ForEach(group.specs) { spec in
                            LabeledContent(spec.name) {
                                Text(spec.value)
                                    .multilineTextAlignment(.trailing)
                                    .textSelection(.enabled)
                            }
                            .font(.subheadline)
                        }
                    }
                    .padding(.top, 8)
                } label: {
                    Text(group.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                }
                if group.name != groups.last?.name { Divider() }
            }
        }
        .card()
        .onAppear {
            if expanded.isEmpty, let first = groups.first?.name { expanded = [first] }
        }
    }

    private func binding(for group: String) -> Binding<Bool> {
        Binding(
            get: { expanded.contains(group) },
            set: { isExpanded in
                withAnimation(.snappy) {
                    if isExpanded { expanded.insert(group) } else { expanded.remove(group) }
                }
            }
        )
    }
}
