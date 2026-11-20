import Foundation

/// Valori letti da Info.plist, che a sua volta li riceve da `Config/Secrets.xcconfig`.
///
/// Sono tutti pubblici: URL di Supabase, chiave publishable e indirizzo delle
/// API. La protezione dei dati e' la RLS di Supabase, come per il client web.
enum AppConfig {
    static let supabaseURL: URL? = url(for: "SupabaseURL")
    static let supabaseKey: String = string(for: "SupabaseKey")
    static let apiBaseURL: URL? = url(for: "APIBaseURL")

    /// L'indirizzo del sito web, ricavato da quello delle API (`…/api`).
    static var webURL: URL? {
        guard let apiBaseURL else { return nil }
        return apiBaseURL.lastPathComponent == "api" ? apiBaseURL.deletingLastPathComponent() : apiBaseURL
    }

    static var isConfigured: Bool {
        supabaseURL != nil && !supabaseKey.isEmpty && apiBaseURL != nil
    }

    /// Un valore mancante o non valido, con quello che l'app ha ricevuto
    /// davvero: e' il modo piu' rapido per accorgersi di un "//" letto come
    /// commento nella xcconfig.
    struct Problem: Identifiable {
        let key: String
        let received: String
        let hint: String
        var id: String { key }
    }

    static var problems: [Problem] {
        var result: [Problem] = []
        if supabaseURL == nil {
            result.append(Problem(key: "SUPABASE_URL", received: string(for: "SupabaseURL"), hint: "https:/$()/xxxx.supabase.co"))
        }
        if supabaseKey.isEmpty {
            result.append(Problem(key: "SUPABASE_KEY", received: "", hint: "sb_publishable_…"))
        }
        if apiBaseURL == nil {
            result.append(Problem(key: "API_BASE_URL", received: string(for: "APIBaseURL"), hint: "https:/$()/tuo-sito.netlify.app/api"))
        }
        return result
    }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    private static func string(for key: String) -> String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: key) as? String) ?? ""
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // Una variabile non sostituita resta letterale: "$(SUPABASE_URL)".
        return value.hasPrefix("$(") ? "" : value
    }

    private static func url(for key: String) -> URL? {
        var value = string(for: key)
        // "https:/host" (una sola barra) e' un errore di battitura comune
        // scrivendo l'URL con $(): lo si corregge invece di rifiutarlo.
        if let range = value.range(of: #"^https?:/(?!/)"#, options: .regularExpression) {
            value.replaceSubrange(range, with: value[range] + "/")
        }
        guard !value.isEmpty, let url = URL(string: value), url.scheme?.hasPrefix("http") == true, url.host() != nil else {
            return nil
        }
        return url
    }
}
