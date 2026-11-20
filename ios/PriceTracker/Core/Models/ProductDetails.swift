import Foundation

/// Il JSON di `products.details`: le informazioni della scheda prodotto.
/// Possono mancare tutte, e ogni campo si legge in modo indipendente: un
/// valore malformato non deve far sparire l'intero prodotto.
struct ProductDetails: Hashable, Sendable, Decodable {
    var features: [String] = []
    var specs: [ProductSpec] = []
    var rating: ProductRating?
    var breadcrumbs: [String] = []
    var category: String?
    var seller: String?
    var condition: String?
    var variant: [String: String] = [:]

    private enum CodingKeys: String, CodingKey {
        case features, specs, rating, breadcrumbs, category, seller, condition, variant
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        features = ((try? container.decodeIfPresent([String].self, forKey: .features)) ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        specs = ((try? container.decodeIfPresent([LossyElement<ProductSpec>].self, forKey: .specs)) ?? []).compactMap(\.value)
        rating = try? container.decodeIfPresent(ProductRating.self, forKey: .rating)
        breadcrumbs = (try? container.decodeIfPresent([String].self, forKey: .breadcrumbs)) ?? []
        category = container.decodeText(forKey: .category)
        seller = container.decodeText(forKey: .seller)
        condition = container.decodeText(forKey: .condition)
        if let values = try? container.decodeIfPresent([String: LossyString].self, forKey: .variant) {
            variant = values.compactMapValues(\.value)
        }
    }

    var isEmpty: Bool {
        features.isEmpty && specs.isEmpty && rating == nil && seller == nil && condition == nil && variant.isEmpty
    }

    /// Le specifiche raggruppate, nell'ordine in cui compaiono.
    var groupedSpecs: [SpecGroup] {
        var order: [String] = []
        var groups: [String: [ProductSpec]] = [:]
        for spec in specs {
            let key = spec.group ?? "Generali"
            if groups[key] == nil { order.append(key) }
            groups[key, default: []].append(spec)
        }
        return order.map { SpecGroup(name: $0, specs: groups[$0] ?? []) }
    }
}

struct SpecGroup: Identifiable, Hashable, Sendable {
    let name: String
    let specs: [ProductSpec]
    var id: String { name }
}

struct ProductSpec: Hashable, Sendable, Decodable, Identifiable {
    let name: String
    let value: String
    let group: String?

    var id: String { "\(group ?? "")|\(name)|\(value)" }

    private enum CodingKeys: String, CodingKey { case name, value, group }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let name = container.decodeText(forKey: .name) else {
            throw DecodingError.dataCorruptedError(forKey: .name, in: container, debugDescription: "Specifica senza nome")
        }
        self.name = name
        if let text = container.decodeText(forKey: .value) {
            value = text
        } else if let number = try? container.decode(Double.self, forKey: .value) {
            value = number.formatted()
        } else {
            value = "—"
        }
        group = container.decodeText(forKey: .group)
    }
}

struct ProductRating: Hashable, Sendable, Decodable {
    let value: Double
    let count: Int?
    let best: Double?

    private enum CodingKeys: String, CodingKey { case value, count, best }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let value = container.decodeDecimal(forKey: .value)?.asDouble else {
            throw DecodingError.dataCorruptedError(forKey: .value, in: container, debugDescription: "Valutazione mancante")
        }
        self.value = value
        count = container.decodeLossyInt(forKey: .count)
        best = container.decodeDecimal(forKey: .best)?.asDouble
    }

    /// La valutazione riportata su una scala da 0 a 5.
    var normalized: Double {
        let scale = (best ?? 5) > 0 ? (best ?? 5) : 5
        return min(max(value / scale * 5, 0), 5)
    }
}

/// Un elemento di un array che, se malformato, viene scartato invece di far
/// fallire l'intero array.
struct LossyElement<Value: Decodable>: Decodable {
    let value: Value?
    init(from decoder: Decoder) throws {
        value = try? Value(from: decoder)
    }
}

/// Un valore qualunque letto come testo, se possibile.
struct LossyString: Decodable {
    let value: String?
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) {
            value = text
        } else if let number = try? container.decode(Double.self) {
            value = number.formatted()
        } else if let flag = try? container.decode(Bool.self) {
            value = flag ? "Sì" : "No"
        } else {
            value = nil
        }
    }
}
