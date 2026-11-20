import Foundation

/// Prezzi mostrati come li salva il database.
///
/// La regola e' quella del client web: "nessun numero cambia". Un prezzo letto
/// come 379.99 resta 379,99: niente arrotondamenti e niente separatori delle
/// migliaia. Si aggiungono solo il simbolo della valuta e, se il valore ha
/// decimali, almeno due cifre (379.9 -> 379,90).
enum PriceFormatting {
    static func currencyCode(_ raw: String?) -> String {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return "EUR" }
        switch raw {
        case "€": return "EUR"
        case "$": return "USD"
        case "£": return "GBP"
        default: return raw.count == 3 ? raw.uppercased() : "EUR"
        }
    }

    static func string(_ value: Decimal?, currency: String?, locale: Locale = .current) -> String {
        guard let value else { return "—" }
        let digits = value.fractionDigits
        let fraction = digits == 0 ? 0 : max(2, digits)
        return value.formatted(
            .currency(code: currencyCode(currency))
                .precision(.fractionLength(fraction))
                .grouping(.never)
                .locale(locale)
        )
    }

    /// Una differenza con il segno sempre esplicito: "+12,00 €", "−5,50 €".
    static func signedString(_ value: Decimal, currency: String?, locale: Locale = .current) -> String {
        let magnitude = string(value < 0 ? -value : value, currency: currency, locale: locale)
        if value == 0 { return magnitude }
        return (value < 0 ? "−" : "+") + magnitude
    }

    static func percent(_ ratio: Double, locale: Locale = .current) -> String {
        ratio.formatted(.percent.precision(.fractionLength(0...1)).sign(strategy: .always(includingZero: false)).locale(locale))
    }

    /// Il simbolo della valuta, per i campi di inserimento.
    static func symbol(for currency: String?, locale: Locale = .current) -> String {
        let code = currencyCode(currency)
        var components = Locale.Components(locale: locale)
        components.currency = Locale.Currency(code)
        return Locale(components: components).currencySymbol ?? code
    }

    /// Un prezzo da mostrare in un campo modificabile: "199,99".
    static func editableString(_ value: Decimal?, locale: Locale = .current) -> String {
        guard let value else { return "" }
        let digits = value.fractionDigits
        return value.formatted(.number.precision(.fractionLength(digits == 0 ? 0 : max(2, digits))).grouping(.never).locale(locale))
    }
}

enum DateFormatting {
    static func relative(_ date: Date, now: Date = .now) -> String {
        if abs(now.timeIntervalSince(date)) < 60 { return "adesso" }
        return date.formatted(.relative(presentation: .named, unitsStyle: .wide))
    }

    static func day(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }

    static func dayAndTime(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }

    /// Il titolo di una sezione di elenco: "Oggi", "Ieri" o la data.
    static func sectionTitle(for date: Date, calendar: Calendar = .current) -> String {
        if calendar.isDateInToday(date) { return "Oggi" }
        if calendar.isDateInYesterday(date) { return "Ieri" }
        if let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: .now)).day, days < 7 {
            return date.formatted(.dateTime.weekday(.wide)).capitalized
        }
        return date.formatted(.dateTime.day().month(.wide).year())
    }
}
