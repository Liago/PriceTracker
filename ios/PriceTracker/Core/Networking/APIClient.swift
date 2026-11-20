import Foundation

/// Errore di una chiamata al server, con stato HTTP e codice applicativo.
struct APIError: LocalizedError, Equatable {
    let message: String
    let status: Int
    let code: String?

    var errorDescription: String? { message }
}

/// Le chiamate al server Express (o alle funzioni Netlify) che il client
/// web usa per tutto cio' che richiede lo scraping: aggiunta, aggiornamento,
/// stato di salute e segnalazioni.
///
/// Ogni richiesta porta il token della sessione Supabase: e' il server a
/// decidere cosa scrivere, l'app non tocca `price_history`.
struct APIClient: Sendable {
    static let shared = APIClient()

    private let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 60
        configuration.waitsForConnectivity = true
        return URLSession(configuration: configuration)
    }()

    // MARK: - Endpoint

    /// Accoda l'aggiunta di un prodotto e restituisce l'id del lavoro.
    func enqueueProduct(_ request: AddProductRequest) async throws -> String {
        let response: EnqueueResponse = try await send("products", method: "POST", body: request, timeout: 20)
        return response.jobId
    }

    /// Lo stato di un'aggiunta in corso.
    func importStatus(jobID: String) async throws -> ImportJob {
        try await send("product-imports/\(jobID)", timeout: 10)
    }

    /// Aggiorna un prodotto adesso, con la stessa validazione del controllo automatico.
    func refreshProduct(id: String) async throws -> RefreshResult {
        try await send("products/\(id)/refresh", method: "POST", body: EmptyBody(), timeout: 90)
    }

    /// Stato di salute del tracking, con l'ultimo esito e i motivi.
    func productHealth(id: String) async throws -> ProductHealth {
        try await send("products/\(id)/health", timeout: 20)
    }

    /// Segnala un prezzo letto male. Il server mette in quarantena la ricetta
    /// del dominio, cosi' il prossimo controllo rianalizza la pagina.
    func reportWrongPrice(productID: String, expected: Decimal?) async throws {
        let body = FeedbackRequest(productId: productID, field: "price", reported: "wrong", expectedValue: expected.map { "\($0)" })
        let _: IgnoredResponse = try await send("feedback", method: "POST", body: body, timeout: 20)
    }

    // MARK: - Trasporto

    private func send<Response: Decodable>(
        _ path: String,
        method: String = "GET",
        body: (any Encodable)? = nil,
        timeout: TimeInterval
    ) async throws -> Response {
        guard let base = AppConfig.apiBaseURL else {
            throw APIError(message: "Indirizzo del server non configurato.", status: 0, code: "NOT_CONFIGURED")
        }
        var request = URLRequest(url: base.appending(path: path), timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.app.encode(body)
        }
        let token = try await Backend.accessToken()
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .timedOut {
            throw APIError(message: "Il server non ha risposto in tempo. Riprova tra poco.", status: 504, code: "TIMEOUT")
        } catch let error as URLError where error.code == .notConnectedToInternet {
            throw APIError(message: "Sei offline. Controlla la connessione e riprova.", status: 0, code: "OFFLINE")
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let payload = try? JSONDecoder.app.decode(ErrorPayload.self, from: data)
            let fallback: String = switch status {
            case 401: "La sessione e' scaduta. Accedi di nuovo."
            case 429: "Troppe richieste ravvicinate. Riprova tra poco."
            case 504: "Il server non ha risposto in tempo. Riprova tra poco."
            default: "Richiesta non riuscita (\(status))."
            }
            throw APIError(message: payload?.error ?? fallback, status: status, code: payload?.code)
        }
        return try JSONDecoder.app.decode(Response.self, from: data)
    }
}

// MARK: - Corpi delle richieste

struct AddProductRequest: Encodable, Sendable, Hashable {
    var url: String
    var targetPrice: Decimal?
    /// `yyyy-MM-dd`, come si aspetta il server.
    var monitoringUntil: String?
    var requestId: String = UUID().uuidString
    /// L'aggiunta avviene in un lavoro in background sul server.
    var runsInBackground: Bool = true

    enum CodingKeys: String, CodingKey {
        case url, targetPrice, monitoringUntil, requestId
        case runsInBackground = "async"
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(url, forKey: .url)
        // null esplicito: il server distingue "nessun obiettivo" da un valore.
        try container.encode(targetPrice, forKey: .targetPrice)
        try container.encode(monitoringUntil, forKey: .monitoringUntil)
        try container.encode(requestId, forKey: .requestId)
        try container.encode(runsInBackground, forKey: .runsInBackground)
    }
}

private struct FeedbackRequest: Encodable {
    let productId: String
    let field: String
    let reported: String
    let expectedValue: String?

    enum CodingKeys: String, CodingKey { case productId, field, reported, expectedValue }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(productId, forKey: .productId)
        try container.encode(field, forKey: .field)
        try container.encode(reported, forKey: .reported)
        try container.encode(expectedValue, forKey: .expectedValue)
    }
}

private struct EmptyBody: Encodable {}
private struct IgnoredResponse: Decodable {}

private struct ErrorPayload: Decodable {
    let error: String?
    let code: String?
}

private struct EnqueueResponse: Decodable {
    let jobId: String
}

// MARK: - Risposte

struct ImportJob: Decodable, Sendable {
    enum Status: String, Decodable, Sendable { case pending, running, done, failed }

    let id: String
    let status: Status
    let productID: String?
    let errorMessage: String?
    let errorStatus: Int?

    private enum CodingKeys: String, CodingKey { case id, status, result, error }
    private enum ResultKeys: String, CodingKey { case product }
    private enum ProductKeys: String, CodingKey { case id }
    private enum ErrorKeys: String, CodingKey { case error, status }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        status = (try? container.decode(Status.self, forKey: .status)) ?? .pending
        let product = try? container.nestedContainer(keyedBy: ResultKeys.self, forKey: .result)
            .nestedContainer(keyedBy: ProductKeys.self, forKey: .product)
        productID = product?.decodeText(forKey: .id)
        let error = try? container.nestedContainer(keyedBy: ErrorKeys.self, forKey: .error)
        errorMessage = error?.decodeText(forKey: .error)
        errorStatus = error?.decodeLossyInt(forKey: .status)
    }
}

struct RefreshResult: Decodable, Sendable {
    let accepted: Bool
    let priceChanged: Bool
    let price: Decimal?
    let previousPrice: Decimal?
    let reasons: [String]

    private enum CodingKeys: String, CodingKey { case accepted, priceChanged, price, previousPrice, reasons }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        accepted = (try? container.decode(Bool.self, forKey: .accepted)) ?? false
        priceChanged = (try? container.decode(Bool.self, forKey: .priceChanged)) ?? false
        price = container.decodeDecimal(forKey: .price)
        previousPrice = container.decodeDecimal(forKey: .previousPrice)
        reasons = (try? container.decode([String].self, forKey: .reasons)) ?? []
    }
}

struct ProductHealth: Decodable, Sendable {
    let reasons: [String]

    private enum CodingKeys: String, CodingKey { case latestRun }
    private enum RunKeys: String, CodingKey { case validation }
    private enum ValidationKeys: String, CodingKey { case reasons }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let validation = try? container.nestedContainer(keyedBy: RunKeys.self, forKey: .latestRun)
            .nestedContainer(keyedBy: ValidationKeys.self, forKey: .validation)
        reasons = (try? validation?.decode([String].self, forKey: .reasons)) ?? []
    }
}
