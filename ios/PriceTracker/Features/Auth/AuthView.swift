import SwiftUI

/// Accesso e registrazione, con email e password di Supabase.
struct AuthView: View {
    enum Mode: String, CaseIterable, Identifiable {
        case signIn, signUp
        var id: String { rawValue }
        var title: String { self == .signIn ? "Accedi" : "Registrati" }
    }

    private enum Field: Hashable { case email, password, confirmation }

    @Environment(SessionStore.self) private var session

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var infoMessage: String?
    @State private var isResettingPassword = false
    @FocusState private var focus: Field?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    header
                    Picker("Modalità", selection: $mode) {
                        ForEach(Mode.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    fields
                    messages
                    primaryButton

                    if mode == .signIn {
                        Button("Password dimenticata?") { isResettingPassword = true }
                            .font(.subheadline)
                    } else {
                        features
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 32)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(.systemGroupedBackground))
            .animation(.snappy, value: mode)
            .onChange(of: mode) {
                errorMessage = nil
                confirmation = ""
            }
            .sheet(isPresented: $isResettingPassword) {
                PasswordResetView(initialEmail: email)
                    .presentationDetents([.medium])
            }
        }
    }

    // MARK: - Sezioni

    private var header: some View {
        VStack(spacing: 14) {
            Image("AppLogo")
                .resizable()
                .scaledToFill()
                .frame(width: 92, height: 92)
                .clipShape(.rect(cornerRadius: 22, style: .continuous))
                .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
                .accessibilityHidden(true)
            Text("PriceTracker")
                .font(.largeTitle.bold())
            Text("Segui i prezzi dei prodotti che ti interessano e scopri quando è il momento giusto per comprare.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var fields: some View {
        VStack(spacing: 0) {
            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focus, equals: .email)
                .onSubmit { focus = .password }
                .padding(16)

            Divider().padding(.leading, 16)

            SecureField("Password", text: $password)
                .textContentType(mode == .signIn ? .password : .newPassword)
                .submitLabel(mode == .signIn ? .go : .next)
                .focused($focus, equals: .password)
                .onSubmit {
                    if mode == .signIn { submit() } else { focus = .confirmation }
                }
                .padding(16)

            if mode == .signUp {
                Divider().padding(.leading, 16)
                SecureField("Conferma password", text: $confirmation)
                    .textContentType(.newPassword)
                    .submitLabel(.go)
                    .focused($focus, equals: .confirmation)
                    .onSubmit(submit)
                    .padding(16)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(Color(.secondarySystemGroupedBackground), in: .rect(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private var messages: some View {
        if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.opacity)
        }
        if let infoMessage {
            Label(infoMessage, systemImage: "envelope.badge.fill")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .transition(.opacity)
        }
    }

    private var primaryButton: some View {
        Button(action: submit) {
            ZStack {
                Text(mode.title).opacity(isWorking ? 0 : 1)
                if isWorking { ProgressView() }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .disabled(!canSubmit || isWorking)
    }

    private var features: some View {
        VStack(alignment: .leading, spacing: 18) {
            FeatureRow(symbol: "chart.line.downtrend.xyaxis", tint: .accentColor, title: "Storico dei prezzi", text: "Ogni lettura viene salvata: vedi come cambia il prezzo nel tempo.")
            FeatureRow(symbol: "bell.badge.fill", tint: .orange, title: "Avvisi di prezzo", text: "Imposta un obiettivo e ricevi una notifica quando il prezzo scende.")
            FeatureRow(symbol: "storefront.fill", tint: .blue, title: "Qualsiasi negozio", text: "Incolla il link di un prodotto da quasi ogni negozio online.")
        }
        .padding(.top, 8)
        .transition(.opacity)
    }

    // MARK: - Azioni

    private var canSubmit: Bool {
        let emailOK = email.contains("@") && email.contains(".")
        switch mode {
        case .signIn: return emailOK && !password.isEmpty
        case .signUp: return emailOK && password.count >= 6 && !confirmation.isEmpty
        }
    }

    private func submit() {
        guard canSubmit, !isWorking else { return }
        if mode == .signUp, password != confirmation {
            errorMessage = "Le password non coincidono."
            return
        }
        focus = nil
        isWorking = true
        errorMessage = nil
        infoMessage = nil
        let email = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        Task {
            defer { isWorking = false }
            do {
                switch mode {
                case .signIn:
                    try await session.signIn(email: email, password: password)
                case .signUp:
                    let needsConfirmation = try await session.signUp(email: email, password: password)
                    if needsConfirmation {
                        infoMessage = "Ti abbiamo inviato un'email: conferma l'indirizzo e poi accedi."
                        mode = .signIn
                        password = ""
                    }
                }
            } catch {
                errorMessage = error.userMessage
            }
        }
    }
}

private struct FeatureRow: View {
    let symbol: String
    let tint: Color
    let title: String
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(tint)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Invio del link per reimpostare la password.
private struct PasswordResetView: View {
    let initialEmail: String

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var state: ResetState = .idle

    private enum ResetState: Equatable { case idle, sending, sent, failed(String) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Email", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    switch state {
                    case .sent:
                        Label("Controlla la posta: trovi il link per scegliere una nuova password.", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    case .failed(let message):
                        Text(message).foregroundStyle(.red)
                    default:
                        Text("Ti invieremo un link per scegliere una nuova password.")
                    }
                }
            }
            .navigationTitle("Reimposta password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Chiudi") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if state == .sending {
                        ProgressView()
                    } else {
                        Button("Invia") { send() }
                            .disabled(!email.contains("@") || state == .sent)
                    }
                }
            }
            .onAppear { if email.isEmpty { email = initialEmail } }
        }
    }

    private func send() {
        state = .sending
        Task {
            do {
                try await session.sendPasswordReset(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
                state = .sent
            } catch {
                state = .failed(error.userMessage)
            }
        }
    }
}

#Preview {
    AuthView()
        .environment(SessionStore())
}
