import Foundation
import Observation
import Supabase

/// Le preferenze di `user_settings`, salvate automaticamente a ogni modifica.
@MainActor
@Observable
final class SettingsStore {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    var settings = UserSettings() {
        didSet { if phase == .loaded, !isApplyingRemote, settings != oldValue { scheduleSave() } }
    }
    private(set) var phase: Phase = .loading
    private(set) var isSaving = false

    @ObservationIgnored private let userID: String
    @ObservationIgnored private let toasts: ToastCenter
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var isApplyingRemote = false

    init(userID: String, toasts: ToastCenter) {
        self.userID = userID
        self.toasts = toasts
    }

    func load() async {
        do {
            var rows: [UserSettings] = try await query()
            if rows.isEmpty {
                // Primo accesso: la riga con i valori predefiniti si crea qui,
                // come fa il client web.
                try await Backend.supabase.from("user_settings").insert(NewSettingsRow(userID: userID)).execute()
                rows = try await query()
            }
            let loaded = rows.first ?? UserSettings()
            isApplyingRemote = true
            settings = loaded
            isApplyingRemote = false
            phase = .loaded
        } catch let error where error.isCancellation {
            return
        } catch {
            phase = .failed(error.userMessage)
        }
    }

    private func query() async throws -> [UserSettings] {
        try await Backend.supabase
            .from("user_settings")
            .select()
            .eq("user_id", value: userID)
            .limit(1)
            .decoded()
    }

    /// Raggruppa le modifiche ravvicinate (uno stepper premuto piu' volte) in
    /// un solo salvataggio.
    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = settings
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled else { return }
            await self?.save(snapshot)
        }
    }

    private func save(_ snapshot: UserSettings) async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await Backend.supabase
                .from("user_settings")
                .update(SettingsUpdate(settings: snapshot, updatedAt: .now))
                .eq("user_id", value: userID)
                .execute()
        } catch {
            toasts.show(.error, "Impostazioni non salvate", message: error.userMessage)
        }
    }
}

private struct NewSettingsRow: Encodable, Sendable {
    let userID: String
    enum CodingKeys: String, CodingKey { case userID = "user_id" }
}

private struct SettingsUpdate: Encodable, Sendable {
    let settings: UserSettings
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case updatedAt = "updated_at"
    }

    func encode(to encoder: Encoder) throws {
        try settings.encode(to: encoder)
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ISO8601DateFormatter().string(from: updatedAt), forKey: .updatedAt)
    }
}
