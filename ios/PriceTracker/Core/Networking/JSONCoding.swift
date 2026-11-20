import Foundation

extension JSONDecoder {
    /// Decoder unico per le risposte di Supabase e del server.
    static var app: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            guard let date = DateParsing.date(from: text) else {
                throw DecodingError.dataCorruptedError(in: container, debugDescription: "Data non valida: \(text)")
            }
            return date
        }
        return decoder
    }
}

extension JSONEncoder {
    static var app: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

/// Le date di Postgres: `timestamptz` arriva come ISO 8601 con fino a sei
/// decimali dei secondi, `date` come `yyyy-MM-dd`.
enum DateParsing {
    private static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func date(from text: String) -> Date? {
        if text.count == 10 { return day(from: text) }
        if let date = withFraction.date(from: text) ?? plain.date(from: text) { return date }
        // Microsecondi: si tengono i millisecondi e si riprova.
        if let normalized = trimmingFraction(text), let date = withFraction.date(from: normalized) ?? plain.date(from: normalized) {
            return date
        }
        // Postgres puo' scrivere il fuso come "+00" senza minuti.
        if let match = text.range(of: #"[+-]\d{2}$"#, options: .regularExpression) {
            let fixed = text.replacingCharacters(in: match, with: String(text[match]) + ":00")
            return date(from: fixed)
        }
        return day(from: text)
    }

    /// Una data senza ora (`yyyy-MM-dd`), nel fuso del dispositivo.
    static func day(from text: String) -> Date? {
        dayFormatter.date(from: String(text.prefix(10)))
    }

    static func dayString(from date: Date) -> String {
        dayFormatter.string(from: date)
    }

    private static func trimmingFraction(_ text: String) -> String? {
        guard let range = text.range(of: #"\.\d+"#, options: .regularExpression) else { return nil }
        let digits = text[range].dropFirst()
        let millis = String(digits.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0)
        return text.replacingCharacters(in: range, with: "." + millis)
    }
}

extension KeyedDecodingContainer {
    /// Un `numeric` di Postgres, come numero o come stringa, senza perdere
    /// decimali: 379.99 resta 379.99 e non diventa 379.98999999.
    func decodeDecimal(forKey key: Key) -> Decimal? {
        if let text = try? decodeIfPresent(String.self, forKey: key) {
            return Decimal.parse(text)
        }
        if let number = try? decodeIfPresent(Double.self, forKey: key), number.isFinite {
            return Decimal(string: String(number), locale: Locale(identifier: "en_US_POSIX"))
        }
        return nil
    }

    /// Un intero che puo' arrivare anche come stringa o con decimali.
    func decodeLossyInt(forKey key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Double.self, forKey: key), value.isFinite { return Int(value) }
        if let text = try? decodeIfPresent(String.self, forKey: key) { return Int(text) ?? Double(text).map { Int($0) } }
        return nil
    }

    /// Una stringa non vuota, oppure nil.
    func decodeText(forKey key: Key) -> String? {
        guard let value = try? decodeIfPresent(String.self, forKey: key) else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    func decodeDate(forKey key: Key) -> Date? {
        guard let text = try? decodeIfPresent(String.self, forKey: key) else { return nil }
        return DateParsing.date(from: text)
    }
}

extension Decimal {
    /// Interpreta un prezzo scritto dall'utente o dal server: accetta sia la
    /// virgola sia il punto come separatore decimale.
    static func parse(_ text: String) -> Decimal? {
        var cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "€", with: "")
        guard !cleaned.isEmpty else { return nil }
        // "1.234,56" -> "1234.56"; "1,5" -> "1.5"
        if cleaned.contains(",") {
            cleaned = cleaned.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".")
        }
        guard cleaned.range(of: #"^-?\d+(\.\d+)?$"#, options: .regularExpression) != nil else { return nil }
        return Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX"))
    }

    var asDouble: Double { NSDecimalNumber(decimal: self).doubleValue }

    /// Quanti decimali ha il valore cosi' come e' scritto (379.9 -> 1, 380 -> 0).
    var fractionDigits: Int {
        var value = self
        var rounded = Decimal()
        for digits in 0...4 {
            NSDecimalRound(&rounded, &value, digits, .plain)
            if rounded == value { return digits }
        }
        return 4
    }
}
