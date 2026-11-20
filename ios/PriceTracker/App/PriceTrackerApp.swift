import SwiftUI

@main
struct PriceTrackerApp: App {
    @State private var session = SessionStore()
    @State private var toasts = ToastCenter()

    init() {
        // Le immagini dei prodotti tornano spesso: AsyncImage usa la cache di
        // URLSession, qui piu' capiente del predefinito.
        URLCache.shared = URLCache(memoryCapacity: 50 * 1024 * 1024, diskCapacity: 300 * 1024 * 1024)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .toastOverlay()
                .environment(session)
                .environment(toasts)
        }
    }
}
