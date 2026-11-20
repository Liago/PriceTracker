import Foundation

extension Error {
    /// Una richiesta annullata perche' la vista e' sparita o l'utente ha
    /// ripetuto il gesto: non e' un errore da mostrare.
    var isCancellation: Bool {
        if self is CancellationError { return true }
        if let urlError = self as? URLError, urlError.code == .cancelled { return true }
        return (self as NSError).domain == NSURLErrorDomain && (self as NSError).code == NSURLErrorCancelled
    }

    /// Il messaggio da mostrare all'utente, in italiano.
    var userMessage: String {
        if let apiError = self as? APIError { return apiError.message }
        if let urlError = self as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                return "Sei offline. Controlla la connessione e riprova."
            case .timedOut:
                return "Il server non ha risposto in tempo. Riprova tra poco."
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed:
                return "Impossibile raggiungere il server."
            default:
                return "Errore di rete. Riprova."
            }
        }
        let text = String(describing: self) + " " + localizedDescription
        let known: [(String, String)] = [
            ("Invalid login credentials", "Email o password non corretti."),
            ("Email not confirmed", "Conferma il tuo indirizzo email prima di accedere: controlla la posta."),
            ("User already registered", "Esiste già un account con questa email."),
            ("Password should be at least", "La password deve contenere almeno 6 caratteri."),
            ("Unable to validate email address", "L'indirizzo email non è valido."),
            ("rate limit", "Troppi tentativi ravvicinati. Riprova tra qualche minuto."),
            ("JWT expired", "La sessione è scaduta. Accedi di nuovo."),
            ("sessionMissing", "La sessione è scaduta. Accedi di nuovo."),
        ]
        for (needle, message) in known where text.localizedCaseInsensitiveContains(needle) {
            return message
        }
        return "Si è verificato un errore. Riprova."
    }
}
