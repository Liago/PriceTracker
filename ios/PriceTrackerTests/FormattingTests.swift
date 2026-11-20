import Foundation
import Testing
@testable import PriceTracker

@Suite("Prezzi, date e link")
struct FormattingTests {
    private let italian = Locale(identifier: "it_IT")

    @Test("Il prezzo resta quello salvato", arguments: [
        ("379.99", "379,99"),
        ("379.9", "379,90"),
        ("1299", "1299"),
        ("0.5", "0,50"),
    ])
    func formatsPrice(raw: String, expected: String) {
        let text = PriceFormatting.string(Decimal(string: raw), currency: "EUR", locale: italian)
        #expect(text.contains(expected))
        #expect(text.contains("€"))
    }

    @Test("Un prezzo assente si mostra come trattino")
    func formatsMissingPrice() {
        #expect(PriceFormatting.string(nil, currency: "EUR") == "—")
    }

    @Test("Le differenze hanno sempre il segno")
    func formatsSignedDifference() {
        #expect(PriceFormatting.signedString(-5, currency: "EUR", locale: italian).hasPrefix("−"))
        #expect(PriceFormatting.signedString(12, currency: "EUR", locale: italian).hasPrefix("+"))
    }

    @Test("Le valute scritte come simbolo diventano codici ISO")
    func normalizesCurrency() {
        #expect(PriceFormatting.currencyCode("€") == "EUR")
        #expect(PriceFormatting.currencyCode("usd") == "USD")
        #expect(PriceFormatting.currencyCode(nil) == "EUR")
        #expect(PriceFormatting.currencyCode("euro") == "EUR")
    }

    @Test("I prezzi scritti dall'utente", arguments: [
        ("199,99", "199.99"),
        ("199.99", "199.99"),
        ("1.234,50", "1234.5"),
        (" 45 € ", "45"),
    ])
    func parsesUserInput(input: String, expected: String) {
        #expect(Decimal.parse(input) == Decimal(string: expected))
    }

    @Test("Testi che non sono prezzi")
    func rejectsInvalidInput() {
        #expect(Decimal.parse("") == nil)
        #expect(Decimal.parse("abc") == nil)
        #expect(Decimal.parse("12,3,4") == nil)
    }

    @Test("Cifre decimali di un valore")
    func countsFractionDigits() {
        #expect(Decimal(string: "380")!.fractionDigits == 0)
        #expect(Decimal(string: "379.9")!.fractionDigits == 1)
        #expect(Decimal(string: "379.99")!.fractionDigits == 2)
    }

    @Test("Date di Postgres in tutte le forme")
    func parsesDates() {
        #expect(DateParsing.date(from: "2026-11-20T10:15:30.123456+00:00") != nil)
        #expect(DateParsing.date(from: "2026-11-20T10:15:30+00:00") != nil)
        #expect(DateParsing.date(from: "2026-11-20T10:15:30.5Z") != nil)
        #expect(DateParsing.date(from: "2026-11-20T10:15:30+00") != nil)
        #expect(DateParsing.date(from: "2026-11-20") != nil)
        #expect(DateParsing.date(from: "ieri") == nil)
    }

    @Test("Il link dentro un testo condiviso")
    func extractsURL() {
        let shared = "Guarda questo prodotto: https://www.example.it/p/123?ref=app ti piace?"
        #expect(URLExtraction.firstWebURL(in: shared)?.host() == "www.example.it")
        #expect(URLExtraction.firstWebURL(in: "https://shop.it/a")?.absoluteString == "https://shop.it/a")
        #expect(URLExtraction.firstWebURL(in: "ftp://shop.it/a") == nil)
        #expect(URLExtraction.firstWebURL(in: "nessun link") == nil)
    }

    @Test("I motivi tecnici diventano messaggi")
    func translatesReasons() {
        #expect(TrackingMessages.message(for: ["price_requires_cart"])?.contains("carrello") == true)
        #expect(TrackingMessages.message(for: ["budget_esaurito"]) != nil)
        #expect(TrackingMessages.message(for: ["altro"]) == nil)
    }
}
