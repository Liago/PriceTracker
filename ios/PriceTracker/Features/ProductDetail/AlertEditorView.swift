import SwiftUI

/// Prezzo obiettivo e scadenza del monitoraggio di un prodotto.
struct AlertEditorView: View {
    let product: Product

    @Environment(ProductsStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var targetText: String
    @State private var hasDeadline: Bool
    @State private var deadline: Date
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var isTargetFocused: Bool

    init(product: Product) {
        self.product = product
        _targetText = State(initialValue: PriceFormatting.editableString(product.targetPrice))
        _hasDeadline = State(initialValue: product.monitoringUntil != nil)
        let defaultDeadline = Calendar.current.date(byAdding: .month, value: 1, to: .now) ?? .now
        _deadline = State(initialValue: product.monitoringUntil ?? defaultDeadline)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        TextField("Nessun obiettivo", text: $targetText)
                            .keyboardType(.decimalPad)
                            .focused($isTargetFocused)
                            .font(.title3.weight(.semibold))
                            .monospacedDigit()
                        Text(PriceFormatting.symbol(for: product.currency))
                            .foregroundStyle(.secondary)
                    }
                    if let current = product.currentPrice {
                        suggestions(for: current)
                    }
                } header: {
                    Text("Prezzo obiettivo")
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        if let current = product.currentPrice {
                            Text("Il prezzo attuale è \(PriceFormatting.string(current, currency: product.currency)). Ricevi un avviso quando scende fino all'obiettivo e il prodotto è disponibile.")
                        }
                        if let errorMessage {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }
                }

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
                } footer: {
                    Text("Dopo questa data il prezzo non viene più controllato. Utile per gli acquisti con una scadenza, come un regalo.")
                }

                if product.targetPrice != nil || product.monitoringUntil != nil {
                    Section {
                        Button("Rimuovi avviso e scadenza", role: .destructive) {
                            targetText = ""
                            hasDeadline = false
                            save()
                        }
                    }
                }
            }
            .navigationTitle("Avviso di prezzo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Salva", action: save)
                    }
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
        .presentationDetents([.medium, .large])
    }

    private func suggestions(for current: Decimal) -> some View {
        HStack(spacing: 8) {
            ForEach([5, 10, 20], id: \.self) { percent in
                Button("−\(percent)%") {
                    var value = current * Decimal(100 - percent) / 100
                    var rounded = Decimal()
                    NSDecimalRound(&rounded, &value, 2, .plain)
                    targetText = PriceFormatting.editableString(rounded)
                    errorMessage = nil
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .controlSize(.small)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Suggerimenti di obiettivo")
    }

    private func save() {
        let trimmed = targetText.trimmingCharacters(in: .whitespacesAndNewlines)
        var target: Decimal?
        if !trimmed.isEmpty {
            guard let parsed = Decimal.parse(trimmed), parsed > 0 else {
                errorMessage = "Inserisci un prezzo valido, ad esempio 199,99."
                return
            }
            target = parsed
        }
        errorMessage = nil
        isSaving = true
        Task {
            defer { isSaving = false }
            do {
                try await store.updateAlert(for: product, targetPrice: target, monitoringUntil: hasDeadline ? deadline : nil)
                toasts.show(.success, target == nil ? "Avviso rimosso" : "Avviso salvato")
                dismiss()
            } catch {
                errorMessage = error.userMessage
            }
        }
    }
}
