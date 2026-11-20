import SwiftUI

/// Gli avvisi di prezzo: un prodotto e' sceso fino all'obiettivo.
struct AlertsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(AlertsStore.self) private var store

    @AppStorage("alerts.unreadOnly") private var unreadOnly = false
    @State private var isConfirmingCleanup = false

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.alertsPath) {
            content
                .navigationTitle("Avvisi")
                .toolbar { toolbar }
                .navigationDestination(for: AlertRoute.self) { route in
                    ProductDetailView(productID: route.productID)
                        .task { await markRead(route.alertID) }
                }
                .refreshable { await store.load() }
                .confirmationDialog("Eliminare gli avvisi già letti?", isPresented: $isConfirmingCleanup, titleVisibility: .visible) {
                    Button("Elimina avvisi letti", role: .destructive) {
                        Task { await store.deleteRead() }
                    }
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        let sections = store.sections(unreadOnly: unreadOnly)
        if !store.isLoaded {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let message = store.errorMessage, store.alerts.isEmpty {
            ContentUnavailableView {
                Label("Impossibile caricare gli avvisi", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Riprova") { Task { await store.load() } }
                    .buttonStyle(.bordered)
            }
        } else if sections.isEmpty {
            if unreadOnly && !store.alerts.isEmpty {
                ContentUnavailableView {
                    Label("Tutto letto", systemImage: "checkmark.circle")
                } description: {
                    Text("Non ci sono avvisi da leggere.")
                } actions: {
                    Button("Mostra tutti") { unreadOnly = false }
                }
            } else {
                ContentUnavailableView {
                    Label("Nessun avviso", systemImage: "bell.slash")
                } description: {
                    Text("Quando un prodotto scende fino al prezzo obiettivo che hai impostato, lo trovi qui.")
                }
            }
        } else {
            List {
                ForEach(sections) { section in
                    Section(section.title) {
                        ForEach(section.alerts) { alert in
                            NavigationLink(value: AlertRoute(alertID: alert.id, productID: alert.productID)) {
                                AlertRow(alert: alert)
                            }
                            .swipeActions(edge: .leading) {
                                Button {
                                    Task { await store.setRead(!alert.read, for: alert) }
                                } label: {
                                    if alert.read {
                                        Label("Da leggere", systemImage: "envelope.badge")
                                    } else {
                                        Label("Letto", systemImage: "envelope.open")
                                    }
                                }
                                .tint(.blue)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    Task { await store.delete(alert) }
                                } label: {
                                    Label("Elimina", systemImage: "trash")
                                }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .animation(.snappy, value: store.alerts)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Toggle(isOn: $unreadOnly) {
                    Label("Solo da leggere", systemImage: "line.3.horizontal.decrease")
                }
                Button {
                    Task { await store.markAllRead() }
                } label: {
                    Label("Segna tutti come letti", systemImage: "checkmark.circle")
                }
                .disabled(store.unreadCount == 0)
                Section {
                    Button(role: .destructive) {
                        isConfirmingCleanup = true
                    } label: {
                        Label("Elimina avvisi letti", systemImage: "trash")
                    }
                    .disabled(!store.alerts.contains(where: \.read))
                }
            } label: {
                Label("Opzioni", systemImage: "ellipsis.circle")
            }
            .disabled(store.alerts.isEmpty)
        }
    }

    private func markRead(_ alertID: String) async {
        guard let alert = store.alerts.first(where: { $0.id == alertID }), !alert.read else { return }
        await store.setRead(true, for: alert)
    }
}

private struct AlertRow: View {
    let alert: PriceAlert

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(alert.read ? Color.clear : Color.accentColor)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)

            ProductThumbnail(url: alert.imageURL, size: 52)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Label(alert.title, systemImage: alert.isDrop ? "arrow.down.right.circle.fill" : "arrow.up.right.circle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(alert.isDrop ? Theme.positive : Theme.negative)
                    Spacer(minLength: 4)
                    Text(alert.createdAt, format: .dateTime.hour().minute())
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(alert.productName)
                    .font(.subheadline.weight(alert.read ? .regular : .semibold))
                    .lineLimit(2)
                HStack(spacing: 6) {
                    if let oldPrice = alert.oldPrice {
                        Text(PriceFormatting.string(oldPrice, currency: alert.product?.currency))
                            .strikethrough()
                            .foregroundStyle(.secondary)
                    }
                    Image(systemName: "arrow.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                    Text(PriceFormatting.string(alert.newPrice, currency: alert.product?.currency))
                        .fontWeight(.semibold)
                    if let ratio = alert.changeRatio {
                        Text(PriceFormatting.percent(ratio))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(alert.isDrop ? Theme.positive : Theme.negative)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background((alert.isDrop ? Theme.positive : Theme.negative).opacity(0.14), in: .capsule)
                    }
                }
                .font(.subheadline)
                .monospacedDigit()
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityValue(alert.read ? "" : "Da leggere")
    }
}

#Preview {
    let toasts = ToastCenter()
    let store = AlertsStore(userID: "preview", toasts: toasts)
    store.seedForPreview(PreviewData.alerts)
    let products = ProductsStore(toasts: toasts)
    products.seedForPreview(PreviewData.products)
    return AlertsView()
        .environment(AppRouter())
        .environment(store)
        .environment(products)
        .environment(toasts)
}
