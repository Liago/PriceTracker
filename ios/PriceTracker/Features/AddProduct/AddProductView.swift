import SwiftUI

/// Il foglio per aggiungere un prodotto da un link.
///
/// Il foglio si chiude appena il server ha accettato la richiesta: la lettura
/// della pagina continua in background e compare nell'elenco come riga
/// "in aggiunta", cosi' l'utente non resta ad aspettare.
struct AddProductView: View {
    private enum Field: Hashable { case url, target }

    @Environment(AppRouter.self) private var router
    @Environment(ProductsStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var urlText = ""
    @State private var targetText = ""
    @State private var hasDeadline = false
    @State private var deadline = Calendar.current.date(byAdding: .month, value: 1, to: .now) ?? .now
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @State private var duplicate: Product?
    @FocusState private var focus: Field?

    private var detectedURL: URL? { URLExtraction.firstWebURL(in: urlText) }

    var body: some View {
        NavigationStack {
            Form {
                linkSection
                targetSection
                deadlineSection
                if errorMessage != nil || duplicate != nil {
                    errorSection
                }
            }
            .navigationTitle("Nuovo prodotto")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Aggiungi", action: submit)
                            .disabled(detectedURL == nil)
                    }
                }
            }
            .interactiveDismissDisabled(isSubmitting)
            .onAppear {
                if let link = router.consumeAddProductURL(), !link.isEmpty {
                    urlText = link
                } else {
                    focus = .url
                }
            }
            .onChange(of: urlText) {
                errorMessage = nil
                duplicate = nil
            }
        }
    }

    // MARK: - Sezioni

    private var linkSection: some View {
        Section {
            HStack(alignment: .center, spacing: 12) {
                TextField("https://www.negozio.it/prodotto", text: $urlText, axis: .vertical)
                    .lineLimit(1...3)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focus, equals: .url)
                    .submitLabel(.done)
                if urlText.isEmpty {
                    PasteButton(payloadType: String.self) { strings in
                        guard let text = strings.first else { return }
                        Task { @MainActor in
                            urlText = URLExtraction.firstWebURL(in: text)?.absoluteString ?? text
                        }
                    }
                    .labelStyle(.iconOnly)
                    .buttonBorderShape(.capsule)
                } else {
                    Button {
                        urlText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancella link")
                }
            }

            if let url = detectedURL, let host = url.host() {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(host.replacingOccurrences(of: "www.", with: ""))
                            .font(.subheadline.weight(.semibold))
                        Text("Prezzo, disponibilità e scheda verranno letti dalla pagina.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "storefront.fill")
                        .foregroundStyle(Color.accentColor)
                }
                .transition(.opacity)
            }
        } header: {
            Text("Link del prodotto")
        } footer: {
            Text("Copia il link dalla pagina del prodotto in Safari o nell'app del negozio. Funziona con quasi tutti i negozi online.")
        }
    }

    private var targetSection: some View {
        Section {
            HStack {
                TextField("Facoltativo", text: $targetText)
                    .keyboardType(.decimalPad)
                    .focused($focus, equals: .target)
                    .monospacedDigit()
                Text(PriceFormatting.symbol(for: "EUR"))
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Prezzo obiettivo")
        } footer: {
            Text("Ricevi un avviso quando il prezzo scende fino a questo valore. Puoi impostarlo anche più avanti, dopo aver visto il prezzo attuale.")
        }
    }

    private var deadlineSection: some View {
        Section {
            Toggle("Termina il monitoraggio", isOn: $hasDeadline.animation())
            if hasDeadline {
                DatePicker(
                    "Fino al",
                    selection: $deadline,
                    in: Calendar.current.startOfDay(for: .now)...,
                    displayedComponents: .date
                )
            }
        }
    }

    private var errorSection: some View {
        Section {
            if let duplicate {
                VStack(alignment: .leading, spacing: 10) {
                    Label("Stai già seguendo questo prodotto.", systemImage: "info.circle.fill")
                        .foregroundStyle(Color.accentColor)
                    Button("Apri «\(duplicate.displayName)»") {
                        let id = duplicate.id
                        dismiss()
                        router.showProduct(id: id)
                    }
                    .font(.subheadline.weight(.semibold))
                }
            } else if let errorMessage {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
            }
        }
    }

    // MARK: - Invio

    private func submit() {
        guard let url = detectedURL else {
            errorMessage = "Inserisci un link valido che inizi con https://"
            return
        }
        if let existing = store.products.first(where: { $0.url == url.absoluteString }) {
            duplicate = existing
            return
        }

        let trimmedTarget = targetText.trimmingCharacters(in: .whitespacesAndNewlines)
        var target: Decimal?
        if !trimmedTarget.isEmpty {
            guard let parsed = Decimal.parse(trimmedTarget), parsed > 0 else {
                errorMessage = "Il prezzo obiettivo non è valido. Usa un numero come 199,99."
                return
            }
            target = parsed
        }

        focus = nil
        isSubmitting = true
        errorMessage = nil
        let request = AddProductRequest(
            url: url.absoluteString,
            targetPrice: target,
            monitoringUntil: hasDeadline ? DateParsing.dayString(from: deadline) : nil
        )
        Task {
            defer { isSubmitting = false }
            do {
                try await store.addProduct(request)
                toasts.show(.info, "Lettura della pagina in corso", message: "Il prodotto compare nell'elenco appena è pronto.")
                dismiss()
            } catch {
                errorMessage = error.userMessage
            }
        }
    }
}

#Preview {
    let toasts = ToastCenter()
    return AddProductView()
        .environment(AppRouter())
        .environment(ProductsStore(toasts: toasts))
        .environment(toasts)
}
