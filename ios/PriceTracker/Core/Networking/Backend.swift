import Foundation
import Supabase

/// Il client Supabase condiviso: autenticazione e letture/scritture con RLS.
enum Backend {
    static let supabase: SupabaseClient = {
        // Se la configurazione manca l'app non arriva mai a usare il client:
        // RootView mostra prima la schermata di configurazione.
        let url = AppConfig.supabaseURL ?? URL(string: "https://configurazione-mancante.invalid")!
        let key = AppConfig.supabaseKey.isEmpty ? "configurazione-mancante" : AppConfig.supabaseKey
        return SupabaseClient(supabaseURL: url, supabaseKey: key)
    }()

    /// Il token della sessione corrente, rinnovato se scaduto.
    static func accessToken() async throws -> String {
        try await supabase.auth.session.accessToken
    }
}

extension PostgrestBuilder {
    /// Esegue la query e decodifica la risposta con il decoder dell'app.
    ///
    /// Il decoder e' nostro, non quello di supabase-swift, per controllare due
    /// cose che altrimenti dipenderebbero dalla versione della libreria: i
    /// prezzi `numeric` (letti senza perdere decimali) e le date di Postgres
    /// (con o senza microsecondi).
    func decoded<T: Decodable>(_ type: T.Type = T.self) async throws -> T {
        let response = try await execute()
        return try JSONDecoder.app.decode(T.self, from: response.data)
    }
}
