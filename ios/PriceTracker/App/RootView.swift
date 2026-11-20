import SwiftUI

/// Sceglie la schermata in base alla configurazione e alla sessione.
struct RootView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        Group {
            if !AppConfig.isConfigured {
                ConfigurationMissingView()
            } else {
                switch session.state {
                case .loading:
                    LaunchView()
                case .signedOut:
                    AuthView()
                        .transition(.opacity)
                case .signedIn(let userID, _):
                    SignedInRoot(userID: userID, toasts: toasts)
                        .id(userID)
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.state)
        .task {
            if AppConfig.isConfigured { session.start() }
        }
    }
}

/// La parte dell'app riservata a chi ha effettuato l'accesso. Gli store
/// vivono qui: uscendo dall'account vengono eliminati con i loro dati.
struct SignedInRoot: View {
    let userID: String

    @Environment(\.scenePhase) private var scenePhase
    @State private var router = AppRouter()
    @State private var products: ProductsStore
    @State private var alerts: AlertsStore
    @State private var settings: SettingsStore

    init(userID: String, toasts: ToastCenter) {
        self.userID = userID
        _products = State(initialValue: ProductsStore(toasts: toasts))
        _alerts = State(initialValue: AlertsStore(userID: userID, toasts: toasts))
        _settings = State(initialValue: SettingsStore(userID: userID, toasts: toasts))
    }

    var body: some View {
        MainTabView()
            .environment(router)
            .environment(products)
            .environment(alerts)
            .environment(settings)
            .onOpenURL { router.handle($0) }
            // Il motore controlla i prezzi in background: mentre l'app e'
            // aperta si rileggono prodotti e avvisi ogni minuto.
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                await refresh()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(60))
                    guard !Task.isCancelled else { break }
                    await refresh()
                }
            }
    }

    private func refresh() async {
        await products.load()
        await alerts.load()
    }
}

struct MainTabView: View {
    @Environment(AppRouter.self) private var router
    @Environment(AlertsStore.self) private var alerts

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.tab) {
            Tab("Prodotti", systemImage: "tag", value: AppTab.products) {
                ProductsView()
            }
            Tab("Avvisi", systemImage: "bell", value: AppTab.alerts) {
                AlertsView()
            }
            .badge(alerts.unreadCount)
            Tab("Impostazioni", systemImage: "gearshape", value: AppTab.settings) {
                SettingsView()
            }
        }
    }
}

/// Schermata di avvio mentre si ripristina la sessione salvata.
private struct LaunchView: View {
    var body: some View {
        VStack(spacing: 20) {
            Image("AppLogo")
                .resizable()
                .scaledToFill()
                .frame(width: 88, height: 88)
                .clipShape(.rect(cornerRadius: 20, style: .continuous))
            ProgressView()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .accessibilityLabel("Caricamento")
    }
}

/// Mostrata quando `Config/Secrets.xcconfig` manca o e' incompleto.
struct ConfigurationMissingView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                ContentUnavailableView {
                    Label("Configurazione mancante", systemImage: "wrench.and.screwdriver")
                } description: {
                    Text("Compila **ios/Config/Secrets.xcconfig** (copiandolo da Secrets.example.xcconfig), poi in Xcode fai Product › Clean Build Folder e ricompila.")
                }

                VStack(alignment: .leading, spacing: 14) {
                    ForEach(AppConfig.problems) { problem in
                        VStack(alignment: .leading, spacing: 4) {
                            Label(problem.key, systemImage: "xmark.circle.fill")
                                .font(.subheadline.weight(.semibold).monospaced())
                                .foregroundStyle(.red)
                            Text(problem.received.isEmpty ? "Valore ricevuto: vuoto" : "Valore ricevuto: \(problem.received)")
                                .font(.footnote.monospaced())
                                .foregroundStyle(.secondary)
                            Text("Atteso, ad esempio: \(problem.hint)")
                                .font(.footnote.monospaced())
                                .foregroundStyle(.secondary)
                        }
                        .textSelection(.enabled)
                    }
                    Text("Negli URL scrivi https:/$()/ e non https://: nelle xcconfig \"//\" apre un commento e il resto della riga viene ignorato.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: 480, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16, style: .continuous))
                .padding(.horizontal)
            }
            .padding(.vertical, 40)
        }
    }
}

#Preview("Configurazione mancante") {
    ConfigurationMissingView()
}
