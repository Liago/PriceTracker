import SwiftUI

/// "Questo prezzo non è corretto".
///
/// La segnalazione non corregge solo questo prodotto: mette in dubbio la
/// configurazione di lettura dell'intero sito, che al prossimo controllo
/// viene rianalizzata invece di ripetere lo stesso errore.
struct ReportPriceView: View {
    let product: Product

    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss
    @State private var expected = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Prezzo letto") {
                        Text(PriceFormatting.string(product.currentPrice, currency: product.currency))
                            .monospacedDigit()
                    }
                    HStack {
                        TextField("Prezzo corretto (facoltativo)", text: $expected)
                            .keyboardType(.decimalPad)
                            .monospacedDigit()
                        Text(PriceFormatting.symbol(for: product.currency))
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Al prossimo controllo la pagina del negozio verrà rianalizzata da capo. Se conosci il prezzo giusto, indicarlo aiuta a riconoscerlo.")
                        if let errorMessage {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle("Segnala prezzo errato")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSending {
                        ProgressView()
                    } else {
                        Button("Invia", action: send)
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func send() {
        let trimmed = expected.trimmingCharacters(in: .whitespacesAndNewlines)
        var value: Decimal?
        if !trimmed.isEmpty {
            guard let parsed = Decimal.parse(trimmed), parsed > 0 else {
                errorMessage = "Il prezzo indicato non è valido."
                return
            }
            value = parsed
        }
        isSending = true
        errorMessage = nil
        Task {
            defer { isSending = false }
            do {
                try await APIClient.shared.reportWrongPrice(productID: product.id, expected: value)
                toasts.show(.success, "Segnalazione inviata", message: "Il prossimo controllo rianalizzerà la pagina.")
                dismiss()
            } catch {
                errorMessage = error.userMessage
            }
        }
    }
}
