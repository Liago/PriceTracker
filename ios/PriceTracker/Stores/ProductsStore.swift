import Foundation
import Observation
import Supabase

/// Un'aggiunta in corso: il server legge la pagina in background, l'app
/// interroga lo stato del lavoro finche' non termina.
struct PendingImport: Identifiable, Equatable {
    enum State: Equatable {
        case running
        case failed(String)
    }

    let id = UUID()
    let request: AddProductRequest
    var state: State = .running

    var host: String {
        URL(string: request.url)?.host()?.replacingOccurrences(of: "www.", with: "") ?? request.url
    }
}

/// Filtri rapidi dell'elenco prodotti.
enum ProductFilter: String, CaseIterable, Identifiable {
    case all, atTarget, attention, unavailable

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "Tutti"
        case .atTarget: "A obiettivo"
        case .attention: "Da verificare"
        case .unavailable: "Non disponibili"
        }
    }

    var symbol: String {
        switch self {
        case .all: "tag.fill"
        case .atTarget: "target"
        case .attention: "exclamationmark.triangle.fill"
        case .unavailable: "cart.badge.minus"
        }
    }

    func matches(_ product: Product) -> Bool {
        switch self {
        case .all: true
        case .atTarget: product.reachedTarget
        case .attention: product.trackingHealth.needsAttention
        case .unavailable: product.availability.isUnavailable
        }
    }
}

enum ProductSort: String, CaseIterable, Identifiable {
    case newest, oldest, priceAscending, priceDescending, name

    var id: String { rawValue }

    var title: String {
        switch self {
        case .newest: "Aggiunti di recente"
        case .oldest: "Aggiunti per primi"
        case .priceAscending: "Prezzo crescente"
        case .priceDescending: "Prezzo decrescente"
        case .name: "Nome"
        }
    }

    var symbol: String {
        switch self {
        case .newest: "clock"
        case .oldest: "clock.arrow.circlepath"
        case .priceAscending: "arrow.up"
        case .priceDescending: "arrow.down"
        case .name: "textformat"
        }
    }

    func areInIncreasingOrder(_ lhs: Product, _ rhs: Product) -> Bool {
        switch self {
        case .newest:
            return (lhs.createdAt ?? .distantPast) > (rhs.createdAt ?? .distantPast)
        case .oldest:
            return (lhs.createdAt ?? .distantPast) < (rhs.createdAt ?? .distantPast)
        case .priceAscending:
            return (lhs.currentPrice ?? .greatestFiniteMagnitude) < (rhs.currentPrice ?? .greatestFiniteMagnitude)
        case .priceDescending:
            return (lhs.currentPrice ?? -1) > (rhs.currentPrice ?? -1)
        case .name:
            return lhs.displayName.localizedStandardCompare(rhs.displayName) == .orderedAscending
        }
    }
}

/// I prodotti dell'utente. La RLS di Supabase restituisce solo i suoi.
@MainActor
@Observable
final class ProductsStore {
    enum Phase: Equatable {
        case idle, loading, loaded
        case failed(String)
    }

    private(set) var products: [Product] = []
    private(set) var phase: Phase = .idle
    private(set) var imports: [PendingImport] = []

    @ObservationIgnored private let toasts: ToastCenter
    @ObservationIgnored private var pollers: [UUID: Task<Void, Never>] = [:]

    init(toasts: ToastCenter) {
        self.toasts = toasts
    }

    // MARK: - Lettura

    func load() async {
        if products.isEmpty { phase = .loading }
        do {
            let rows: [Product] = try await Backend.supabase
                .from("products")
                .select()
                .order("created_at", ascending: false)
                .decoded()
            products = rows
            phase = .loaded
        } catch let error where error.isCancellation {
            if phase == .loading { phase = .idle }
        } catch {
            if products.isEmpty {
                phase = .failed(error.userMessage)
            } else {
                toasts.show(.error, "Aggiornamento non riuscito", message: error.userMessage)
            }
        }
    }

    func product(id: String) -> Product? {
        products.first { $0.id == id }
    }

    var stores: [String] {
        Array(Set(products.map(\.storeName))).sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    func count(for filter: ProductFilter) -> Int {
        products.filter(filter.matches).count
    }

    func visibleProducts(filter: ProductFilter, store: String?, search: String, sort: ProductSort) -> [Product] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return products
            .filter(filter.matches)
            .filter { store == nil || $0.storeName == store }
            .filter { product in
                query.isEmpty
                    || product.displayName.localizedStandardContains(query)
                    || product.storeName.localizedStandardContains(query)
                    || (product.brand?.localizedStandardContains(query) ?? false)
            }
            .sorted(by: sort.areInIncreasingOrder)
    }

    // MARK: - Modifiche

    /// Sostituisce la copia locale con una appena letta (dal dettaglio).
    func upsert(_ product: Product) {
        if let index = products.firstIndex(where: { $0.id == product.id }) {
            products[index] = product
        } else {
            products.insert(product, at: 0)
        }
    }

    func delete(_ product: Product) async {
        let snapshot = products
        products.removeAll { $0.id == product.id }
        do {
            try await Backend.supabase.from("products").delete().eq("id", value: product.id).execute()
            toasts.show(.info, "Prodotto eliminato")
        } catch {
            products = snapshot
            toasts.show(.error, "Eliminazione non riuscita", message: error.userMessage)
        }
    }

    /// Salva prezzo obiettivo e scadenza del monitoraggio.
    func updateAlert(for product: Product, targetPrice: Decimal?, monitoringUntil: Date?) async throws {
        let update = AlertUpdate(targetPrice: targetPrice, monitoringUntil: monitoringUntil.map(DateParsing.dayString(from:)))
        try await Backend.supabase.from("products").update(update).eq("id", value: product.id).execute()
        var updated = product
        updated.targetPrice = targetPrice
        updated.monitoringUntil = monitoringUntil.map { Calendar.current.startOfDay(for: $0) }
        upsert(updated)
    }

    // MARK: - Aggiunta

    /// Accoda l'aggiunta sul server. Gli errori di validazione (link non
    /// ammesso, prezzo non valido) arrivano subito; la lettura della pagina
    /// prosegue in background e compare nell'elenco come riga "in aggiunta".
    func addProduct(_ request: AddProductRequest) async throws {
        let jobID = try await APIClient.shared.enqueueProduct(request)
        let pending = PendingImport(request: request)
        imports.insert(pending, at: 0)
        track(jobID: jobID, importID: pending.id)
    }

    func retryImport(_ pending: PendingImport) async {
        dismissImport(pending)
        var request = pending.request
        request.requestId = UUID().uuidString
        do {
            try await addProduct(request)
        } catch {
            toasts.show(.error, "Aggiunta non riuscita", message: error.userMessage)
        }
    }

    func dismissImport(_ pending: PendingImport) {
        pollers[pending.id]?.cancel()
        pollers[pending.id] = nil
        imports.removeAll { $0.id == pending.id }
    }

    private func track(jobID: String, importID: UUID) {
        pollers[importID] = Task { [weak self] in
            var failures = 0
            for _ in 0..<180 {
                if Task.isCancelled || self == nil { return }
                do {
                    let job = try await APIClient.shared.importStatus(jobID: jobID)
                    failures = 0
                    switch job.status {
                    case .done:
                        await self?.completeImport(importID, productID: job.productID)
                        return
                    case .failed:
                        self?.failImport(importID, message: job.errorMessage ?? "Aggiunta del prodotto non riuscita.")
                        return
                    case .pending, .running:
                        break
                    }
                } catch let error where error.isCancellation {
                    return
                } catch let error as APIError where error.status == 404 || error.status == 401 {
                    self?.failImport(importID, message: error.message)
                    return
                } catch {
                    // Un errore di rete non chiude il lavoro, che prosegue sul server.
                    failures += 1
                    if failures >= 10 {
                        self?.failImport(importID, message: error.userMessage)
                        return
                    }
                }
                try? await Task.sleep(for: .seconds(2))
            }
            self?.failImport(importID, message: "La lettura continua in background. Riprova più tardi con lo stesso link.")
        }
    }

    private func completeImport(_ importID: UUID, productID: String?) async {
        pollers[importID] = nil
        imports.removeAll { $0.id == importID }
        await load()
        let name = productID.flatMap(product(id:))?.displayName
        toasts.show(.success, "Prodotto aggiunto", message: name)
    }

    private func failImport(_ importID: UUID, message: String) {
        pollers[importID] = nil
        guard let index = imports.firstIndex(where: { $0.id == importID }) else { return }
        imports[index].state = .failed(message)
        toasts.show(.error, "Aggiunta non riuscita", message: message)
    }
}

private struct AlertUpdate: Encodable, Sendable {
    let targetPrice: Decimal?
    let monitoringUntil: String?

    enum CodingKeys: String, CodingKey {
        case targetPrice = "target_price"
        case monitoringUntil = "monitoring_until"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // null esplicito: togliere l'obiettivo deve azzerare la colonna.
        try container.encode(targetPrice, forKey: .targetPrice)
        try container.encode(monitoringUntil, forKey: .monitoringUntil)
    }
}

extension ProductsStore {
    /// Dati di esempio per le anteprime di Xcode.
    func seedForPreview(_ products: [Product]) {
        self.products = products
        phase = .loaded
    }
}
