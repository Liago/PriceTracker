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
        let value = string(for: key)
        guard !value.isEmpty, let url = URL(string: value), url.scheme?.hasPrefix("http") == true, url.host() != nil else {
            return nil
        }
        return url
    }
}
