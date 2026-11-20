import Foundation
import Observation
import Supabase

/// La sessione Supabase dell'utente e le azioni di accesso.
@MainActor
@Observable
final class SessionStore {
    enum State: Equatable {
        case loading
        case signedOut
        case signedIn(userID: String, email: String?)
    }

    private(set) var state: State = .loading
    @ObservationIgnored private var listener: Task<Void, Never>?

    var email: String? {
        if case .signedIn(_, let email) = state { return email }
        return nil
    }

    /// Ascolta i cambi di sessione: accesso, rinnovo del token, uscita.
    func start() {
        guard listener == nil else { return }
        listener = Task { [weak self] in
            for await change in Backend.supabase.auth.authStateChanges {
                guard let self else { return }
                self.apply(change.session)
            }
        }
    }

    private func apply(_ session: Session?) {
        guard let session else {
            state = .signedOut
            return
        }
        let next = State.signedIn(userID: session.user.id.uuidString.lowercased(), email: session.user.email)
        if next != state { state = next }
    }

    func signIn(email: String, password: String) async throws {
        let session = try await Backend.supabase.auth.signIn(email: email, password: password)
        apply(session)
    }

    /// Restituisce `true` se l'account richiede la conferma via email.
    func signUp(email: String, password: String) async throws -> Bool {
        let response = try await Backend.supabase.auth.signUp(email: email, password: password)
        if let session = response.session {
            apply(session)
            return false
        }
        return true
    }

    func sendPasswordReset(email: String) async throws {
        try await Backend.supabase.auth.resetPasswordForEmail(email)
    }

    func signOut() async {
        do {
            try await Backend.supabase.auth.signOut()
        } catch {
            // Anche se la revoca remota fallisce, la sessione locale va chiusa.
            state = .signedOut
        }
    }
}
