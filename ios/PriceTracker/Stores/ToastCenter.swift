import Foundation
import Observation

/// Messaggi brevi e non bloccanti, mostrati in alto sopra ogni schermata.
@MainActor
@Observable
final class ToastCenter {
    struct Toast: Identifiable, Equatable {
        enum Style: Equatable { case success, info, warning, error }

        let id = UUID()
        let style: Style
        let title: String
        let message: String?
    }

    private(set) var current: Toast?
    @ObservationIgnored private var dismissTask: Task<Void, Never>?

    func show(_ style: Toast.Style, _ title: String, message: String? = nil) {
        let toast = Toast(style: style, title: title, message: message)
        current = toast
        dismissTask?.cancel()
        let duration: Duration = message == nil ? .seconds(2.5) : .seconds(4.5)
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled, self?.current?.id == toast.id else { return }
            self?.current = nil
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        current = nil
    }
}
