import Foundation

/// Dati di esempio per le anteprime di Xcode.
enum PreviewData {
    static let products: [Product] = [
        Product(
            id: "p1",
            url: "https://www.amazon.it/dp/B0EXAMPLE",
            name: "Cuffie wireless con cancellazione attiva del rumore",
            description: "Cuffie over-ear con cancellazione del rumore adattiva, fino a 30 ore di autonomia e ricarica rapida.",
            brand: "Sonora",
            store: "Amazon",
            currentPrice: Decimal(string: "279.99"),
            targetPrice: 250,
            lastCheckedAt: .now.addingTimeInterval(-1_800),
            createdAt: .now.addingTimeInterval(-86_400 * 60),
            details: previewDetails
        ),
        Product(
            id: "p2",
            url: "https://www.mediaworld.it/product/example",
            name: "Robot aspirapolvere con stazione di svuotamento",
            store: "MediaWorld",
            currentPrice: 349,
            targetPrice: 399,
            lastCheckedAt: .now.addingTimeInterval(-7_200),
            createdAt: .now.addingTimeInterval(-86_400 * 20)
        ),
        Product(
            id: "p3",
            url: "https://www.backmarket.it/it-it/p/example",
            name: "Smartphone ricondizionato 128 GB",
            store: "Back Market",
            currentPrice: Decimal(string: "412.5"),
            lastCheckedAt: .now.addingTimeInterval(-86_400),
            createdAt: .now.addingTimeInterval(-86_400 * 5),
            trackingHealth: .degraded,
            availability: .outOfStock
        ),
    ]

    static let history: [PricePoint] = {
        let prices = ["329.99", "319.99", "329.99", "299.99", "309.99", "289.99", "279.99"]
        return prices.enumerated().map { index, price in
            PricePoint(
                id: "h\(index)",
                price: Decimal(string: price) ?? 0,
                date: .now.addingTimeInterval(-86_400 * Double(60 - index * 9))
            )
        }
    }()

    static let alerts: [PriceAlert] = [
        PriceAlert(
            id: "a1",
            productID: "p2",
            type: "price_drop",
            oldPrice: 429,
            newPrice: 349,
            read: false,
            createdAt: .now.addingTimeInterval(-3_600),
            product: .init(name: "Robot aspirapolvere con stazione di svuotamento", image: nil, url: nil, currency: "EUR")
        ),
        PriceAlert(
            id: "a2",
            productID: "p1",
            type: "price_drop",
            oldPrice: Decimal(string: "299.99"),
            newPrice: Decimal(string: "279.99"),
            read: true,
            createdAt: .now.addingTimeInterval(-86_400 * 2),
            product: .init(name: "Cuffie wireless con cancellazione attiva del rumore", image: nil, url: nil, currency: "EUR")
        ),
    ]

    private static var previewDetails: ProductDetails {
        var details = ProductDetails()
        details.features = ["Cancellazione del rumore adattiva", "30 ore di autonomia", "Ricarica rapida USB-C"]
        details.seller = "Amazon"
        details.condition = "Nuovo"
        details.variant = ["colore": "Nero"]
        return details
    }
}
