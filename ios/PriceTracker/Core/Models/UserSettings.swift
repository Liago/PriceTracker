import Foundation

/// Una riga di `user_settings`.
struct UserSettings: Hashable, Sendable, Codable {
    /// Minuti tra un controllo automatico e il successivo (minimo 15).
    var priceCheckInterval: Int = 360
    /// Pausa tra le richieste allo stesso negozio, in millisecondi.
    var scrapeDelay: Int = 2000
    var maxRetries: Int = 1
    var emailNotifications: Bool = true

    private enum CodingKeys: String, CodingKey {
        case priceCheckInterval = "price_check_interval"
        case scrapeDelay = "scrape_delay"
        case maxRetries = "max_retries"
        case emailNotifications = "email_notifications"
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        priceCheckInterval = max(15, container.decodeLossyInt(forKey: .priceCheckInterval) ?? 360)
        scrapeDelay = container.decodeLossyInt(forKey: .scrapeDelay) ?? 2000
        maxRetries = container.decodeLossyInt(forKey: .maxRetries) ?? 1
        emailNotifications = (try? container.decodeIfPresent(Bool.self, forKey: .emailNotifications)) ?? true
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(priceCheckInterval, forKey: .priceCheckInterval)
        try container.encode(scrapeDelay, forKey: .scrapeDelay)
        try container.encode(maxRetries, forKey: .maxRetries)
        try container.encode(emailNotifications, forKey: .emailNotifications)
    }

    /// Le frequenze proposte, in minuti.
    static let intervalOptions: [Int] = [15, 30, 60, 180, 360, 720, 1440]

    static func intervalLabel(_ minutes: Int) -> String {
        switch minutes {
        case ..<60: "Ogni \(minutes) minuti"
        case 60: "Ogni ora"
        case 1440: "Una volta al giorno"
        default: minutes % 60 == 0 ? "Ogni \(minutes / 60) ore" : "Ogni \(minutes) minuti"
        }
    }
}
