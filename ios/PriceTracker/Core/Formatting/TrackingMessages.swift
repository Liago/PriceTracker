import Foundation

/// I motivi tecnici del motore, tradotti per l'utente.
enum TrackingMessages {
    static func message(for reasons: [String]) -> String? {
        if reasons.contains("prezzo_non_caricato") {
            return "La scheda è stata caricata, ma il prezzo non è diventato disponibile nel tempo di attesa. Riprova tra poco."
        }
        if reasons.contains("price_requires_cart") {
            return "Amazon mostra il prezzo di questa offerta solo nel carrello. Il valore mostrato è l'ultimo verificato; i prezzi degli altri venditori non vengono usati al suo posto."
        }
        if reasons.contains("main_price_unavailable") {
            return "Amazon non espone un prezzo per l'offerta principale. Il valore mostrato è l'ultimo verificato."
        }
        if reasons.contains("identita_cambiata") {
            return "La pagina mostra una configurazione diversa da quella monitorata. Verifica il link della variante: memoria, colore, condizione e batteria."
        }
        let budget: Set<String> = ["budget_insufficiente", "budget_esaurito", "budget_speso_nell_avvio", "navigazione_troncata"]
        if reasons.contains(where: budget.contains) {
            return "La lettura non è terminata nel tempo disponibile. Il prezzo mostrato è l'ultimo verificato; riprova tra poco."
        }
        return nil
    }

    static func shortLabel(for reasons: [String]) -> String? {
        reasons.contains("price_requires_cart") ? "Prezzo solo nel carrello" : nil
    }
}
