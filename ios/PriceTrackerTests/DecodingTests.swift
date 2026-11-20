import Foundation
import Testing
@testable import PriceTracker

@Suite("Decodifica delle righe di Supabase")
struct DecodingTests {
    @Test("Un prodotto completo, con prezzi numerici e microsecondi")
    func decodesProduct() throws {
        let json = """
        {
          "id": "6f1c2b9e-0000-4000-8000-000000000001",
          "url": "https://www.example.it/p/1",
          "name": "  Sedia ergonomica  ",
          "image": "https://cdn.example.it/1.jpg",
          "store": "Example",
          "currency": "EUR",
          "current_price": 379.99,
          "target_price": "350",
          "monitoring_until": "2026-12-31",
          "last_checked_at": "2026-11-20T10:15:30.123456+00:00",
          "created_at": "2026-10-01T08:00:00+00",
          "tracking_health": "degraded",
          "availability": "out_of_stock",
          "details": {
            "features": ["Braccioli 4D", ""],
            "specs": [{"name": "Peso", "value": 18.5, "group": "Dimensioni"}, {"value": "senza nome"}],
            "rating": {"value": "4.6", "count": 120, "best": 5},
            "variant": {"colore": "Nero", "taglia": 2}
          }
        }
        """
        let product = try JSONDecoder.app.decode(Product.self, from: Data(json.utf8))

        #expect(product.name == "Sedia ergonomica")
        #expect(product.currentPrice == Decimal(string: "379.99"))
        #expect(product.targetPrice == 350)
        #expect(product.trackingHealth == .degraded)
        #expect(product.availability == .outOfStock)
        #expect(product.lastCheckedAt != nil)
        #expect(product.createdAt != nil)
        #expect(product.monitoringUntil != nil)
        #expect(product.details.features == ["Braccioli 4D"])
        #expect(product.details.specs.count == 1)
        #expect(abs((product.details.rating?.value ?? 0) - 4.6) < 0.0001)
        #expect(product.details.variant["colore"] == "Nero")
        #expect(product.reachedTarget == false)
    }

    @Test("Valori sconosciuti o assenti non fanno fallire la decodifica")
    func decodesMinimalProduct() throws {
        let json = """
        {"id": "x", "url": "https://shop.it/a", "tracking_health": "nuovo_stato", "details": "non un oggetto"}
        """
        let product = try JSONDecoder.app.decode(Product.self, from: Data(json.utf8))
        #expect(product.trackingHealth == .unknown)
        #expect(product.availability == .unknown)
        #expect(product.currentPrice == nil)
        #expect(product.details.isEmpty)
        #expect(product.displayName == "shop.it")
    }

    @Test("Un avviso con il prodotto collegato")
    func decodesAlert() throws {
        let json = """
        {"id": "n1", "product_id": "p1", "type": "price_drop", "old_price": 429, "new_price": 349,
         "read": false, "created_at": "2026-11-19T18:00:00.5+00:00",
         "products": {"name": "Robot", "image": null, "url": "https://shop.it", "currency": "EUR"}}
        """
        let alert = try JSONDecoder.app.decode(PriceAlert.self, from: Data(json.utf8))
        #expect(alert.isDrop)
        #expect(alert.productName == "Robot")
        #expect(abs((alert.changeRatio ?? 0) - (-80.0 / 429.0)) < 0.0001)
    }

    @Test("Lo stato di un'aggiunta in background")
    func decodesImportJob() throws {
        let done = try JSONDecoder.app.decode(ImportJob.self, from: Data(#"{"id":"j1","status":"done","result":{"product":{"id":"p9"},"confidence":0.9}}"#.utf8))
        #expect(done.status == .done)
        #expect(done.productID == "p9")

        let failed = try JSONDecoder.app.decode(ImportJob.self, from: Data(#"{"id":"j2","status":"failed","error":{"error":"URL non ammesso","status":400}}"#.utf8))
        #expect(failed.status == .failed)
        #expect(failed.errorMessage == "URL non ammesso")
        #expect(failed.errorStatus == 400)
    }

    @Test("Le impostazioni rispettano il minimo di 15 minuti")
    func decodesSettings() throws {
        let settings = try JSONDecoder.app.decode(UserSettings.self, from: Data(#"{"price_check_interval": 5, "scrape_delay": "2500", "max_retries": 2, "email_notifications": false}"#.utf8))
        #expect(settings.priceCheckInterval == 15)
        #expect(settings.scrapeDelay == 2500)
        #expect(settings.emailNotifications == false)
    }
}
