import Foundation
import Testing
@testable import PriceTracker

@Suite("Serie del grafico")
struct PriceSeriesTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func point(_ id: String, _ price: Decimal, daysAgo: Double) -> PricePoint {
        PricePoint(id: id, price: price, date: now.addingTimeInterval(-86_400 * daysAgo))
    }

    @Test("Il prezzo precedente alla finestra viene riportato all'inizio")
    func carriesPriceIntoRange() {
        let history = [point("a", 100, daysAgo: 30), point("b", 90, daysAgo: 3)]
        let points = PriceSeries.points(history, in: .week, currentPrice: 90, now: now)

        #expect(points.first?.price == 100)
        #expect(points.first?.id == "start-a")
        #expect(points.map(\.price) == [100, 90, 90])
        #expect(points.last?.id == "now")
    }

    @Test("Senza storico si usa il prezzo attuale")
    func usesCurrentPriceWhenEmpty() {
        let points = PriceSeries.points([], in: .all, currentPrice: 42, now: now)
        #expect(points.count == 1)
        #expect(points.first?.price == 42)
    }

    @Test("Il punto selezionato e' l'ultimo valido in quella data")
    func selectsStepValue() {
        let points = [point("a", 100, daysAgo: 10), point("b", 80, daysAgo: 5)]
        let selected = PriceSeries.point(at: now.addingTimeInterval(-86_400 * 7), in: points)
        #expect(selected?.id == "a")
    }

    @Test("Minimo, massimo, media e variazione")
    func summarizes() throws {
        let summary = try #require(PriceSummary(points: [
            point("a", 100, daysAgo: 3),
            point("b", 80, daysAgo: 2),
            point("c", 90, daysAgo: 1),
        ]))
        #expect(summary.minimum.id == "b")
        #expect(summary.maximum.id == "a")
        #expect(summary.average == 90)
        #expect(summary.change == -10)
        #expect(abs((summary.changeRatio ?? 0) + 0.1) < 0.0001)
    }

    @Test("L'obiettivo lontano non schiaccia la curva")
    func domainIgnoresFarTarget() {
        let points = [point("a", 500, daysAgo: 2), point("b", 520, daysAgo: 1)]
        let withFarTarget = PriceHistoryCard.domain(for: points, target: 50)
        let withNearTarget = PriceHistoryCard.domain(for: points, target: 450)
        #expect(withFarTarget.lowerBound > 400)
        #expect(withNearTarget.lowerBound < 450)
    }
}

@Suite("Elenco e navigazione")
@MainActor
struct ListAndRoutingTests {
    @Test("Filtri e ordinamenti dei prodotti")
    func filtersProducts() {
        let store = ProductsStore(toasts: ToastCenter())
        store.seedForPreview(PreviewData.products)

        #expect(store.count(for: .all) == 3)
        #expect(store.count(for: .atTarget) == 1)
        #expect(store.count(for: .attention) == 1)
        #expect(store.count(for: .unavailable) == 1)

        let cheapest = store.visibleProducts(filter: .all, store: nil, search: "", sort: .priceAscending)
        #expect(cheapest.map(\.id) == ["p1", "p2", "p3"])

        let search = store.visibleProducts(filter: .all, store: nil, search: "cuffie", sort: .newest)
        #expect(search.map(\.id) == ["p1"])

        let byStore = store.visibleProducts(filter: .all, store: "Back Market", search: "", sort: .newest)
        #expect(byStore.map(\.id) == ["p3"])
    }

    @Test("I link pricetracker:// aprono la schermata giusta")
    func handlesDeepLinks() throws {
        let router = AppRouter()
        router.tab = .settings

        router.handle(try #require(URL(string: "pricetracker://add?url=https%3A%2F%2Fshop.it%2Fa")))
        #expect(router.tab == .products)
        #expect(router.isAddingProduct)
        #expect(router.consumeAddProductURL() == "https://shop.it/a")
        #expect(router.consumeAddProductURL() == nil)

        router.handle(try #require(URL(string: "pricetracker://product/abc")))
        #expect(router.productsPath == [ProductRoute(id: "abc")])

        router.handle(try #require(URL(string: "pricetracker://alerts")))
        #expect(router.tab == .alerts)
    }
}
