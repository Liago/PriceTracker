import Foundation
import Observation

enum AppTab: Hashable {
    case products, alerts, settings
}

struct ProductRoute: Hashable {
    let id: String
}

struct AlertRoute: Hashable {
    let alertID: String
    let productID: String
}

/// Lo stato della navigazione: scheda selezionata, percorsi delle pile e
/// presentazione del foglio di aggiunta. Tenerlo qui permette ai link
/// esterni (`pricetracker://…`) di portare l'utente nel punto giusto.
@MainActor
@Observable
final class AppRouter {
    var tab: AppTab = .products
    var productsPath: [ProductRoute] = []
    var alertsPath: [AlertRoute] = []
    var isAddingProduct = false
    /// Il link con cui precompilare il foglio di aggiunta.
    private(set) var addProductURL: String?

    func presentAddProduct(url: String? = nil) {
        addProductURL = url
        tab = .products
        isAddingProduct = true
    }

    func consumeAddProductURL() -> String? {
        defer { addProductURL = nil }
        return addProductURL
    }

    func showProduct(id: String) {
        tab = .products
        productsPath = [ProductRoute(id: id)]
    }

    /// `pricetracker://add?url=https://…` apre il foglio di aggiunta;
    /// `pricetracker://product/<id>` apre un prodotto.
    func handle(_ url: URL) {
        guard url.scheme == "pricetracker" else { return }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        switch url.host() ?? "" {
        case "add":
            let link = components?.queryItems?.first(where: { $0.name == "url" })?.value
            presentAddProduct(url: link)
        case "product":
            if let id = url.pathComponents.dropFirst().first, !id.isEmpty { showProduct(id: id) }
        case "alerts":
            tab = .alerts
        default:
            break
        }
    }
}
