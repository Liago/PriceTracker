import SwiftUI

/// Account e preferenze di controllo dei prezzi.
struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SettingsStore.self) private var store
    @Environment(ProductsStore.self) private var products

    @State private var isConfirmingSignOut = false
    @State private var safariURL: IdentifiableURL?

    var body: some View {
        NavigationStack {
            Group {
                switch store.phase {
                case .loading:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failed(let message):
                    ContentUnavailableView {
                        Label("Impostazioni non disponibili", systemImage: "gearshape.2")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Riprova") { Task { await store.load() } }
                            .buttonStyle(.bordered)
                    }
                case .loaded:
                    form
                }
            }
            .navigationTitle("Impostazioni")
            .toolbar {
                if store.isSaving {
                    ToolbarItem(placement: .topBarTrailing) {
                        ProgressView()
                    }
                }
            }
            .task {
                if store.phase != .loaded { await store.load() }
            }
            .sheet(item: $safariURL) { item in
                SafariView(url: item.url).ignoresSafeArea()
            }
            .confirmationDialog("Vuoi uscire dall'account?", isPresented: $isConfirmingSignOut, titleVisibility: .visible) {
                Button("Esci", role: .destructive) {
                    Task { await session.signOut() }
                }
            } message: {
                Text("I prodotti restano salvati e continuano a essere controllati.")
            }
        }
    }

    private var form: some View {
        @Bindable var store = store
        return Form {
            Section {
                HStack(spacing: 14) {
                    Text(initials)
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 56, height: 56)
                        .background(
                            LinearGradient(colors: [Color.accentColor, Color.accentColor.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: .circle
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(session.email ?? "Account")
                            .font(.headline)
                            .lineLimit(1)
                        Text(products.products.count == 1 ? "1 prodotto seguito" : "\(products.products.count) prodotti seguiti")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }

            Section {
                Picker(selection: $store.settings.priceCheckInterval) {
                    ForEach(intervalOptions, id: \.self) { minutes in
                        Text(UserSettings.intervalLabel(minutes)).tag(minutes)
                    }
                } label: {
                    Label("Frequenza", systemImage: "clock.arrow.circlepath")
                }
            } header: {
                Text("Controllo dei prezzi")
            } footer: {
                Text("Ogni quanto il server rilegge le pagine dei tuoi prodotti. Controlli più frequenti trovano prima i ribassi, ma alcuni negozi limitano le richieste ravvicinate.")
            }

            Section {
                Toggle(isOn: $store.settings.emailNotifications) {
                    Label("Email quando scatta un avviso", systemImage: "envelope.badge")
                }
            } header: {
                Text("Notifiche")
            } footer: {
                Text("Gli avvisi compaiono sempre nella scheda Avvisi. Con questa opzione ricevi anche un'email.")
            }

            Section {
                Stepper(value: $store.settings.scrapeDelay, in: 1000...10000, step: 500) {
                    LabeledContent {
                        Text(delayLabel(store.settings.scrapeDelay))
                            .monospacedDigit()
                    } label: {
                        Label("Pausa tra le richieste", systemImage: "hourglass")
                    }
                }
                Stepper(value: $store.settings.maxRetries, in: 0...5) {
                    LabeledContent {
                        Text("\(store.settings.maxRetries)")
                            .monospacedDigit()
                    } label: {
                        Label("Tentativi in caso di errore", systemImage: "arrow.triangle.2.circlepath")
                    }
                }
            } header: {
                Text("Avanzate")
            } footer: {
                Text("Una pausa più lunga riduce il rischio che un negozio blocchi le letture. I tentativi aggiuntivi rendono i controlli più affidabili ma più lenti.")
            }

            Section {
                if let web = AppConfig.webURL {
                    Button {
                        safariURL = IdentifiableURL(url: web)
                    } label: {
                        Label("Apri PriceTracker sul web", systemImage: "safari")
                    }
                }
                LabeledContent {
                    Text(AppConfig.appVersion)
                } label: {
                    Label("Versione", systemImage: "info.circle")
                }
            } header: {
                Text("Informazioni")
            }

            Section {
                Button(role: .destructive) {
                    isConfirmingSignOut = true
                } label: {
                    Label("Esci", systemImage: "rectangle.portrait.and.arrow.right")
                        .foregroundStyle(.red)
                }
            }
        }
        .refreshable { await store.load() }
    }

    /// Le frequenze proposte, piu' quella salvata se non e' tra queste.
    private var intervalOptions: [Int] {
        var options = UserSettings.intervalOptions
        let current = store.settings.priceCheckInterval
        if !options.contains(current) {
            options.append(current)
            options.sort()
        }
        return options
    }

    private func delayLabel(_ milliseconds: Int) -> String {
        let seconds = Double(milliseconds) / 1000
        return seconds.formatted(.number.precision(.fractionLength(1))) + " s"
    }

    private var initials: String {
        guard let email = session.email, let first = email.first else { return "?" }
        return String(first).uppercased()
    }
}
