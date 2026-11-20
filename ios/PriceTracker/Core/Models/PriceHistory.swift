import Foundation

/// Una lettura di `price_history`.
struct PricePoint: Identifiable, Hashable, Sendable, Decodable {
    let id: String
    let price: Decimal
    let date: Date

    private enum CodingKeys: String, CodingKey {
        case id, price
        case recordedAt = "recorded_at"
    }

    init(id: String, price: Decimal, date: Date) {
        self.id = id
        self.price = price
        self.date = date
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? container.decode(String.self, forKey: .id)) ?? UUID().uuidString
        guard let price = container.decodeDecimal(forKey: .price), let date = container.decodeDate(forKey: .recordedAt) else {
            throw DecodingError.dataCorruptedError(forKey: .price, in: container, debugDescription: "Lettura incompleta")
        }
        self.price = price
        self.date = date
    }

    var value: Double { price.asDouble }
}

/// Riepilogo di una serie di prezzi, per il grafico e le statistiche.
struct PriceSummary: Sendable, Equatable {
    let minimum: PricePoint
    let maximum: PricePoint
    let average: Decimal
    let first: PricePoint
    let last: PricePoint

    init?(points: [PricePoint]) {
        guard let first = points.first, let last = points.last,
              let minimum = points.min(by: { $0.price < $1.price }),
              let maximum = points.max(by: { $0.price < $1.price }) else { return nil }
        self.first = first
        self.last = last
        self.minimum = minimum
        self.maximum = maximum
        let total = points.reduce(Decimal.zero) { $0 + $1.price }
        var average = total / Decimal(points.count)
        var rounded = Decimal()
        NSDecimalRound(&rounded, &average, 2, .plain)
        self.average = rounded
    }

    /// Variazione dal primo all'ultimo valore.
    var change: Decimal { last.price - first.price }

    /// Variazione percentuale dal primo all'ultimo valore.
    var changeRatio: Double? {
        guard first.price != 0 else { return nil }
        return (change / first.price).asDouble
    }
}

/// Le finestre temporali del grafico.
enum ChartRange: String, CaseIterable, Identifiable, Sendable {
    case week, month, quarter, year, all

    var id: String { rawValue }

    var label: String {
        switch self {
        case .week: "7G"
        case .month: "1M"
        case .quarter: "3M"
        case .year: "1A"
        case .all: "Tutto"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .week: "Ultimi 7 giorni"
        case .month: "Ultimo mese"
        case .quarter: "Ultimi 3 mesi"
        case .year: "Ultimo anno"
        case .all: "Tutto lo storico"
        }
    }

    func startDate(relativeTo now: Date = .now) -> Date? {
        let calendar = Calendar.current
        switch self {
        case .week: return calendar.date(byAdding: .day, value: -7, to: now)
        case .month: return calendar.date(byAdding: .month, value: -1, to: now)
        case .quarter: return calendar.date(byAdding: .month, value: -3, to: now)
        case .year: return calendar.date(byAdding: .year, value: -1, to: now)
        case .all: return nil
        }
    }
}

enum PriceSeries {
    /// I punti da disegnare in una finestra.
    ///
    /// Il prezzo resta valido fino alla lettura successiva, quindi la serie e'
    /// a gradini: l'ultimo valore precedente alla finestra viene riportato
    /// all'inizio, e il prezzo attuale viene esteso fino a oggi.
    static func points(_ history: [PricePoint], in range: ChartRange, currentPrice: Decimal?, now: Date = .now) -> [PricePoint] {
        let sorted = history.sorted { $0.date < $1.date }
        var result: [PricePoint]
        if let start = range.startDate(relativeTo: now) {
            result = sorted.filter { $0.date >= start }
            if let carried = sorted.last(where: { $0.date < start }) {
                result.insert(PricePoint(id: "start-\(carried.id)", price: carried.price, date: start), at: 0)
            }
        } else {
            result = sorted
        }
        if let lastPrice = currentPrice ?? result.last?.price, let last = result.last, last.date < now {
            result.append(PricePoint(id: "now", price: lastPrice, date: now))
        } else if result.isEmpty, let currentPrice {
            result = [PricePoint(id: "now", price: currentPrice, date: now)]
        }
        return result
    }

    /// Il punto valido in un istante: l'ultimo prima o in quella data.
    static func point(at date: Date, in points: [PricePoint]) -> PricePoint? {
        points.last(where: { $0.date <= date }) ?? points.first
    }
}
