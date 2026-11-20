import Foundation

/// Una riga di `products`, come la legge l'app.
struct Product: Identifiable, Hashable, Sendable, Decodable {
    let id: String
    var url: String
    var name: String?
    var image: String?
    var description: String?
    var brand: String?
    var store: String?
    var currency: String?
    var currentPrice: Decimal?
    var targetPrice: Decimal?
    /// Giorno (`yyyy-MM-dd`) dopo il quale il prodotto non viene piu' controllato.
    var monitoringUntil: Date?
    var lastCheckedAt: Date?
    var lastSuccessAt: Date?
    var createdAt: Date?
    var trackingHealth: TrackingHealth
    var availability: Availability
    var details: ProductDetails

    private enum CodingKeys: String, CodingKey {
        case id, url, name, image, description, brand, store, currency, details, availability
        case currentPrice = "current_price"
        case targetPrice = "target_price"
        case monitoringUntil = "monitoring_until"
        case lastCheckedAt = "last_checked_at"
        case lastSuccessAt = "last_success_at"
        case createdAt = "created_at"
        case trackingHealth = "tracking_health"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        url = container.decodeText(forKey: .url) ?? ""
        name = container.decodeText(forKey: .name)
        image = container.decodeText(forKey: .image)
        description = container.decodeText(forKey: .description)
        brand = container.decodeText(forKey: .brand)
        store = container.decodeText(forKey: .store)
        currency = container.decodeText(forKey: .currency)
        currentPrice = container.decodeDecimal(forKey: .currentPrice)
        targetPrice = container.decodeDecimal(forKey: .targetPrice)
        monitoringUntil = container.decodeText(forKey: .monitoringUntil).flatMap(DateParsing.day(from:))
        lastCheckedAt = container.decodeDate(forKey: .lastCheckedAt)
        lastSuccessAt = container.decodeDate(forKey: .lastSuccessAt)
        createdAt = container.decodeDate(forKey: .createdAt)
        trackingHealth = container.decodeText(forKey: .trackingHealth).flatMap(TrackingHealth.init(rawValue:)) ?? .unknown
        availability = container.decodeText(forKey: .availability).flatMap(Availability.init(rawValue:)) ?? .unknown
        details = (try? container.decodeIfPresent(ProductDetails.self, forKey: .details)) ?? ProductDetails()
    }

    init(
        id: String, url: String, name: String?, image: String? = nil, description: String? = nil, brand: String? = nil,
        store: String?, currency: String? = "EUR", currentPrice: Decimal?, targetPrice: Decimal? = nil,
        monitoringUntil: Date? = nil, lastCheckedAt: Date? = nil, lastSuccessAt: Date? = nil, createdAt: Date? = nil,
        trackingHealth: TrackingHealth = .healthy, availability: Availability = .inStock, details: ProductDetails = ProductDetails()
    ) {
        self.id = id
        self.url = url
        self.name = name
        self.image = image
        self.description = description
        self.brand = brand
        self.store = store
        self.currency = currency
        self.currentPrice = currentPrice
        self.targetPrice = targetPrice
        self.monitoringUntil = monitoringUntil
        self.lastCheckedAt = lastCheckedAt
        self.lastSuccessAt = lastSuccessAt
        self.createdAt = createdAt
        self.trackingHealth = trackingHealth
        self.availability = availability
        self.details = details
    }

    // MARK: - Derivati

    var displayName: String { name ?? host ?? "Prodotto senza nome" }

    var productURL: URL? { URL(string: url) }

    var imageURL: URL? { image.flatMap(URL.init(string:)) }

    var host: String? {
        productURL?.host()?.replacingOccurrences(of: "www.", with: "")
    }

    var storeName: String { store ?? host ?? "Negozio" }

    /// Il prezzo attuale e' pari o inferiore all'obiettivo.
    var reachedTarget: Bool {
        guard let currentPrice, let targetPrice else { return false }
        return currentPrice <= targetPrice
    }

    /// Quanto manca all'obiettivo (positivo se il prezzo e' ancora sopra).
    var distanceToTarget: Decimal? {
        guard let currentPrice, let targetPrice else { return nil }
        return currentPrice - targetPrice
    }

    var isMonitoringExpired: Bool {
        guard let monitoringUntil else { return false }
        return Calendar.current.startOfDay(for: .now) > monitoringUntil
    }
}

/// Lo stato del tracking: distingue "prezzo stabile" da "non riesco piu' a
/// leggere questa pagina".
enum TrackingHealth: String, Sendable, Hashable, CaseIterable {
    case healthy, degraded, broken, blocked, unknown

    var label: String {
        switch self {
        case .healthy: "Tracking ok"
        case .degraded: "Da verificare"
        case .broken: "Non leggibile"
        case .blocked: "Lettura bloccata"
        case .unknown: "Mai controllato"
        }
    }

    var detail: String {
        switch self {
        case .healthy: "L'ultimo controllo è andato a buon fine."
        case .degraded: "L'ultimo controllo non ha prodotto un prezzo attendibile. Il prezzo mostrato è l'ultimo valido."
        case .broken: "Il prezzo non viene letto da diversi controlli. Il valore mostrato potrebbe non essere aggiornato."
        case .blocked: "L'ultima richiesta al negozio è stata bloccata. Il prezzo mostrato è l'ultimo verificato."
        case .unknown: "Non ci sono ancora controlli per questo prodotto."
        }
    }

    var symbol: String {
        switch self {
        case .healthy: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .broken: "xmark.octagon.fill"
        case .blocked: "hand.raised.fill"
        case .unknown: "questionmark.circle.fill"
        }
    }

    /// Gli stati che chiedono un'azione all'utente.
    var needsAttention: Bool { self == .degraded || self == .broken || self == .blocked }
}

/// La disponibilita' letta dal motore. `unknown` non e' "esaurito": uno stato
/// ignoto non merita un'etichetta.
enum Availability: String, Sendable, Hashable {
    case inStock = "in_stock"
    case outOfStock = "out_of_stock"
    case discontinued
    case preorder
    case backorder
    case unknown

    var label: String? {
        switch self {
        case .outOfStock: "Non disponibile"
        case .discontinued: "Fuori produzione"
        case .preorder: "Preordine"
        case .backorder: "In riassortimento"
        case .inStock, .unknown: nil
        }
    }

    var isUnavailable: Bool { self == .outOfStock || self == .discontinued }
}
