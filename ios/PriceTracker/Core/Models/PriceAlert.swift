import Foundation

/// Una riga di `notifications`: un cambio di prezzo notificato all'utente.
struct PriceAlert: Identifiable, Hashable, Sendable, Decodable {
    struct ProductSummary: Hashable, Sendable {
        let name: String?
        let image: String?
        let url: String?
        let currency: String?
    }

    let id: String
    let productID: String
    let type: String
    let oldPrice: Decimal?
    let newPrice: Decimal?
    var read: Bool
    let createdAt: Date
    let product: ProductSummary?

    private enum CodingKeys: String, CodingKey {
        case id, type, read, products
        case productID = "product_id"
        case oldPrice = "old_price"
        case newPrice = "new_price"
        case createdAt = "created_at"
    }

    private enum ProductKeys: String, CodingKey { case name, image, url, currency }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        productID = try container.decode(String.self, forKey: .productID)
        type = container.decodeText(forKey: .type) ?? "price_drop"
        oldPrice = container.decodeDecimal(forKey: .oldPrice)
        newPrice = container.decodeDecimal(forKey: .newPrice)
        read = (try? container.decode(Bool.self, forKey: .read)) ?? false
        createdAt = container.decodeDate(forKey: .createdAt) ?? .now
        if let nested = try? container.nestedContainer(keyedBy: ProductKeys.self, forKey: .products) {
            product = ProductSummary(
                name: nested.decodeText(forKey: .name),
                image: nested.decodeText(forKey: .image),
                url: nested.decodeText(forKey: .url),
                currency: nested.decodeText(forKey: .currency)
            )
        } else {
            product = nil
        }
    }

    init(id: String, productID: String, type: String, oldPrice: Decimal?, newPrice: Decimal?, read: Bool, createdAt: Date, product: ProductSummary?) {
        self.id = id
        self.productID = productID
        self.type = type
        self.oldPrice = oldPrice
        self.newPrice = newPrice
        self.read = read
        self.createdAt = createdAt
        self.product = product
    }

    var isDrop: Bool {
        if let oldPrice, let newPrice { return newPrice < oldPrice }
        return type == "price_drop"
    }

    var title: String { isDrop ? "Obiettivo raggiunto" : "Prezzo cambiato" }

    var changeRatio: Double? {
        guard let oldPrice, let newPrice, oldPrice != 0 else { return nil }
        return ((newPrice - oldPrice) / oldPrice).asDouble
    }

    var productName: String { product?.name ?? "Prodotto" }
    var imageURL: URL? { product?.image.flatMap(URL.init(string:)) }
}
