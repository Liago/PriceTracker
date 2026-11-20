import Foundation
import Observation
import Supabase

/// Le notifiche di cambio prezzo dell'utente.
@MainActor
@Observable
final class AlertsStore {
    private(set) var alerts: [PriceAlert] = []
    private(set) var isLoaded = false
    private(set) var errorMessage: String?

    @ObservationIgnored private let userID: String
    @ObservationIgnored private let toasts: ToastCenter

    init(userID: String, toasts: ToastCenter) {
        self.userID = userID
        self.toasts = toasts
    }

    var unreadCount: Int { alerts.lazy.filter { !$0.read }.count }

    /// Le notifiche raggruppate per giorno, dalla piu' recente.
    func sections(unreadOnly: Bool) -> [AlertSection] {
        let visible = unreadOnly ? alerts.filter { !$0.read } : alerts
        var order: [String] = []
        var groups: [String: [PriceAlert]] = [:]
        for alert in visible {
            let title = DateFormatting.sectionTitle(for: alert.createdAt)
            if groups[title] == nil { order.append(title) }
            groups[title, default: []].append(alert)
        }
        return order.map { AlertSection(title: $0, alerts: groups[$0] ?? []) }
    }

    func load() async {
        do {
            let rows: [PriceAlert] = try await Backend.supabase
                .from("notifications")
                .select("*, products(name, image, url, currency)")
                .eq("user_id", value: userID)
                .order("created_at", ascending: false)
                .limit(200)
                .decoded()
            alerts = rows
            errorMessage = nil
        } catch let error where error.isCancellation {
            return
        } catch {
            errorMessage = error.userMessage
        }
        isLoaded = true
    }

    func setRead(_ read: Bool, for alert: PriceAlert) async {
        guard let index = alerts.firstIndex(where: { $0.id == alert.id }), alerts[index].read != read else { return }
        alerts[index].read = read
        do {
            try await Backend.supabase.from("notifications").update(ReadUpdate(read: read)).eq("id", value: alert.id).execute()
        } catch {
            if let index = alerts.firstIndex(where: { $0.id == alert.id }) { alerts[index].read = !read }
            toasts.show(.error, "Modifica non riuscita", message: error.userMessage)
        }
    }

    func markAllRead() async {
        guard unreadCount > 0 else { return }
        let snapshot = alerts
        for index in alerts.indices { alerts[index].read = true }
        do {
            try await Backend.supabase.from("notifications")
                .update(ReadUpdate(read: true))
                .eq("user_id", value: userID)
                .eq("read", value: "false")
                .execute()
        } catch {
            alerts = snapshot
            toasts.show(.error, "Modifica non riuscita", message: error.userMessage)
        }
    }

    func delete(_ alert: PriceAlert) async {
        let snapshot = alerts
        alerts.removeAll { $0.id == alert.id }
        do {
            try await Backend.supabase.from("notifications").delete().eq("id", value: alert.id).execute()
        } catch {
            alerts = snapshot
            toasts.show(.error, "Eliminazione non riuscita", message: error.userMessage)
        }
    }

    func deleteRead() async {
        let snapshot = alerts
        let removed = alerts.filter(\.read).count
        guard removed > 0 else { return }
        alerts.removeAll(where: \.read)
        do {
            try await Backend.supabase.from("notifications")
                .delete()
                .eq("user_id", value: userID)
                .eq("read", value: "true")
                .execute()
            toasts.show(.info, removed == 1 ? "1 avviso eliminato" : "\(removed) avvisi eliminati")
        } catch {
            alerts = snapshot
            toasts.show(.error, "Eliminazione non riuscita", message: error.userMessage)
        }
    }
}

struct AlertSection: Identifiable {
    let title: String
    let alerts: [PriceAlert]
    var id: String { title }
}

private struct ReadUpdate: Encodable, Sendable {
    let read: Bool
}

extension AlertsStore {
    /// Dati di esempio per le anteprime di Xcode.
    func seedForPreview(_ alerts: [PriceAlert]) {
        self.alerts = alerts
        isLoaded = true
    }
}
