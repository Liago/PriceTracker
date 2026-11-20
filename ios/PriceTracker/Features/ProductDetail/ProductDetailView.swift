import SwiftUI
import Supabase
import UIKit

/// La pagina di un prodotto: prezzo, storico, avviso e scheda.
struct ProductDetailView: View {
    let productID: String

    @Environment(ProductsStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var loaded: Product?
    @State private var history: [PricePoint] = []
    @State private var reasons: [String] = []
    @State private var loadError: String?
    @State private var isRefreshing = false
    @State private var isEditingAlert = false
    @State private var isReporting = false
    @State private var isConfirmingDeletion = false
    @State private var isShowingImage = false
    @State private var safariURL: IdentifiableURL?
    @Namespace private var imageNamespace

    /// La copia dello store e' sempre la piu' recente (anche dopo una modifica
    /// dell'avviso); quella letta qui serve finche' lo store non la conosce.
    private var product: Product? { store.product(id: productID) ?? loaded }

    var body: some View {
        Group {
            if let product {
                content(product)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Prodotto non disponibile", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(loadError)
                } actions: {
                    Button("Riprova") { Task { await load() } }
                        .buttonStyle(.bordered)
                }
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(product?.storeName ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task { await load() }
        .sheet(isPresented: $isEditingAlert) {
            if let product { AlertEditorView(product: product) }
        }
        .sheet(isPresented: $isReporting) {
            if let product { ReportPriceView(product: product) }
        }
        .sheet(item: $safariURL) { item in
            SafariView(url: item.url).ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $isShowingImage) {
            ImageViewer(url: product?.imageURL)
                .navigationTransition(.zoom(sourceID: "hero", in: imageNamespace))
        }
        .confirmationDialog("Eliminare il prodotto?", isPresented: $isConfirmingDeletion, titleVisibility: .visible) {
            Button("Elimina", role: .destructive) {
                guard let product else { return }
                Task {
                    await store.delete(product)
                    dismiss()
                }
            }
        } message: {
            Text("Verranno eliminati anche lo storico dei prezzi e gli avvisi di questo prodotto.")
        }
    }

    // MARK: - Contenuto

    private func content(_ product: Product) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                hero(product)
                titleBlock(product)
                PriceCard(
                    product: product,
                    history: history,
                    shortReason: TrackingMessages.shortLabel(for: reasons),
                    openStore: openStore
                )
                if product.trackingHealth.needsAttention {
                    HealthNotice(health: product.trackingHealth, message: TrackingMessages.message(for: reasons)) {
                        isReporting = true
                    }
                }
                PriceHistoryCard(
                    history: history,
                    currentPrice: product.currentPrice,
                    targetPrice: product.targetPrice,
                    currency: product.currency
                )
                AlertCard(product: product) { isEditingAlert = true }
                ProductInfoSection(product: product)
                footer(product)
            }
            .padding(.horizontal)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await load() }
    }

    private func hero(_ product: Product) -> some View {
        Button {
            isShowingImage = true
        } label: {
            RemoteProductImage(url: product.imageURL, placeholderFont: .system(size: 48))
                .padding(24)
                .frame(height: 280)
                .frame(maxWidth: .infinity)
                .background(.white, in: .rect(cornerRadius: Theme.cornerRadius, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if product.imageURL != nil {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(8)
                            .background(.ultraThinMaterial, in: .circle)
                            .padding(12)
                    }
                }
        }
        .buttonStyle(.plain)
        .matchedTransitionSource(id: "hero", in: imageNamespace)
        .disabled(product.imageURL == nil)
        .accessibilityLabel("Immagine del prodotto")
        .accessibilityHint("Tocca due volte per ingrandire")
    }

    private func titleBlock(_ product: Product) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(product.storeName)
                    .foregroundStyle(Color.accentColor)
                if let brand = product.brand, brand.caseInsensitiveCompare(product.storeName) != .orderedSame {
                    Text("·").foregroundStyle(.tertiary)
                    Text(brand).foregroundStyle(.secondary)
                }
            }
            .font(.caption.weight(.semibold))
            .textCase(.uppercase)

            Text(product.displayName)
                .font(.title2.bold())
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            if !product.details.breadcrumbs.isEmpty {
                Text(product.details.breadcrumbs.joined(separator: " › "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
        }
        .padding(.horizontal, 4)
    }

    private func footer(_ product: Product) -> some View {
        VStack(spacing: 4) {
            if let createdAt = product.createdAt {
                Text("Seguito dal \(DateFormatting.day(createdAt))")
            }
            if let host = product.host {
                Text(host)
            }
        }
        .font(.caption)
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    // MARK: - Barra

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if let product {
            ToolbarItem(placement: .topBarTrailing) {
                if isRefreshing {
                    ProgressView()
                } else {
                    Button(action: refresh) {
                        Label("Aggiorna prezzo", systemImage: "arrow.clockwise")
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if let url = product.productURL {
                        Button(action: openStore) {
                            Label("Apri nel negozio", systemImage: "safari")
                        }
                        ShareLink(item: url, subject: Text(product.displayName)) {
                            Label("Condividi", systemImage: "square.and.arrow.up")
                        }
                        Button {
                            UIPasteboard.general.url = url
                            toasts.show(.info, "Link copiato")
                        } label: {
                            Label("Copia link", systemImage: "link")
                        }
                    }
                    Section {
                        Button { isEditingAlert = true } label: {
                            Label("Avviso di prezzo", systemImage: "bell.badge")
                        }
                        Button { isReporting = true } label: {
                            Label("Segnala prezzo errato", systemImage: "exclamationmark.bubble")
                        }
                    }
                    Section {
                        Button(role: .destructive) { isConfirmingDeletion = true } label: {
                            Label("Elimina prodotto", systemImage: "trash")
                        }
                    }
                } label: {
                    Label("Altre azioni", systemImage: "ellipsis.circle")
                }
            }
        }
    }

    // MARK: - Azioni

    private func openStore() {
        guard let url = product?.productURL else { return }
        safariURL = IdentifiableURL(url: url)
    }

    private func load() async {
        do {
            let fresh: Product = try await Backend.supabase
                .from("products")
                .select()
                .eq("id", value: productID)
                .single()
                .decoded()
            loaded = fresh
            store.upsert(fresh)
            loadError = nil

            let rows: [LossyElement<PricePoint>] = try await Backend.supabase
                .from("price_history")
                .select("id, price, recorded_at")
                .eq("product_id", value: productID)
                .order("recorded_at", ascending: true)
                .decoded()
            history = rows.compactMap(\.value)

            if fresh.trackingHealth != .healthy {
                reasons = (try? await APIClient.shared.productHealth(id: productID).reasons) ?? []
            } else {
                reasons = []
            }
        } catch let error where error.isCancellation {
            return
        } catch {
            if product == nil {
                loadError = String(describing: error).contains("PGRST116")
                    ? "Il prodotto è stato eliminato."
                    : error.userMessage
            } else {
                toasts.show(.error, "Aggiornamento non riuscito", message: error.userMessage)
            }
        }
    }

    private func refresh() {
        guard !isRefreshing else { return }
        isRefreshing = true
        Task {
            defer { isRefreshing = false }
            do {
                let result = try await APIClient.shared.refreshProduct(id: productID)
                let currency = product?.currency
                if !result.accepted {
                    toasts.show(
                        .warning,
                        "Prezzo non aggiornato",
                        message: TrackingMessages.message(for: result.reasons)
                            ?? "Il controllo non ha prodotto un prezzo attendibile: resta quello precedente."
                    )
                } else if result.priceChanged {
                    let before = PriceFormatting.string(result.previousPrice, currency: currency)
                    let after = PriceFormatting.string(result.price, currency: currency)
                    toasts.show(.success, "Prezzo aggiornato", message: "\(before) → \(after)")
                } else {
                    toasts.show(.success, "Prezzo invariato", message: "Il controllo è andato a buon fine.")
                }
                await load()
            } catch {
                toasts.show(.error, "Aggiornamento non riuscito", message: error.userMessage)
            }
        }
    }
}

// MARK: - Prezzo

private struct PriceCard: View {
    let product: Product
    let history: [PricePoint]
    let shortReason: String?
    let openStore: () -> Void

    var body: some View {
        let summary = PriceSummary(points: history)
        VStack(alignment: .leading, spacing: 12) {
            Text("Prezzo attuale")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text(PriceFormatting.string(product.currentPrice, currency: product.currency))
                .font(.system(.largeTitle, design: .rounded, weight: .bold))
                .monospacedDigit()
                .foregroundStyle(product.availability.isUnavailable ? .secondary : .primary)
                .contentTransition(.numericText())
                .animation(.snappy, value: product.currentPrice)

            if let summary, let current = product.currentPrice, history.count > 1 {
                let change = current - summary.first.price
                let ratio = summary.first.price == 0 ? nil : (change / summary.first.price).asDouble
                HStack(spacing: 6) {
                    PriceChangeLabel(change: change, ratio: ratio, currency: product.currency, font: .subheadline)
                    Text("dal \(DateFormatting.day(summary.first.date))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            badges

            if let checked = product.lastCheckedAt {
                Label("Controllato \(DateFormatting.relative(checked))", systemImage: "clock")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if product.productURL != nil {
                Button(action: openStore) {
                    Label("Vai al negozio", systemImage: "bag")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .controlSize(.large)
                .padding(.top, 4)
            }
        }
        .card()
    }

    @ViewBuilder
    private var badges: some View {
        let items = badgeItems
        if !items.isEmpty {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    ForEach(items) { StatusBadge(title: $0.title, systemImage: $0.symbol, tint: $0.tint) }
                }
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(items) { StatusBadge(title: $0.title, systemImage: $0.symbol, tint: $0.tint) }
                }
            }
        }
    }

    private struct BadgeItem: Identifiable {
        let title: String
        let symbol: String
        let tint: Color
        var id: String { title }
    }

    private var badgeItems: [BadgeItem] {
        var items: [BadgeItem] = []
        if product.reachedTarget {
            items.append(BadgeItem(title: "Obiettivo raggiunto", symbol: "checkmark.seal.fill", tint: Theme.positive))
        }
        if let label = product.availability.label {
            items.append(BadgeItem(title: label, symbol: product.availability.isUnavailable ? "cart.badge.minus" : "shippingbox", tint: Theme.warning))
        }
        if product.trackingHealth.needsAttention {
            items.append(BadgeItem(title: product.trackingHealth.label, symbol: product.trackingHealth.symbol, tint: Theme.tint(for: product.trackingHealth)))
        }
        if let shortReason {
            items.append(BadgeItem(title: shortReason, symbol: "cart", tint: .secondary))
        }
        if product.isMonitoringExpired {
            items.append(BadgeItem(title: "Monitoraggio terminato", symbol: "calendar.badge.exclamationmark", tint: .secondary))
        }
        return items
    }
}

/// Spiega perche' il prezzo potrebbe non essere aggiornato.
private struct HealthNotice: View {
    let health: TrackingHealth
    let message: String?
    let report: () -> Void

    var body: some View {
        let tint = Theme.tint(for: health)
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: health.symbol)
                .font(.title3)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 6) {
                Text(health.label)
                    .font(.subheadline.weight(.semibold))
                Text(message ?? health.detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Il prezzo è sbagliato?", action: report)
                    .font(.footnote.weight(.semibold))
            }
        }
        .padding(Theme.spacing)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.12), in: .rect(cornerRadius: Theme.cornerRadius, style: .continuous))
    }
}

// MARK: - Avviso

private struct AlertCard: View {
    let product: Product
    let edit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardHeader(title: "Avviso di prezzo", systemImage: "bell.badge") {
                Button(product.targetPrice == nil ? "Imposta" : "Modifica", action: edit)
                    .font(.subheadline.weight(.semibold))
            }

            if let target = product.targetPrice {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Obiettivo")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(PriceFormatting.string(target, currency: product.currency))
                            .font(.title3.bold())
                            .monospacedDigit()
                    }
                    Spacer()
                    if product.reachedTarget {
                        StatusBadge(title: "Raggiunto", systemImage: "checkmark.seal.fill", tint: Theme.positive)
                    } else if let distance = product.distanceToTarget {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("Mancano")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(PriceFormatting.string(distance, currency: product.currency))
                                .font(.subheadline.weight(.semibold))
                                .monospacedDigit()
                                .foregroundStyle(Theme.warning)
                        }
                    }
                }
                if let progress {
                    ProgressView(value: progress)
                        .tint(product.reachedTarget ? Theme.positive : Color.accentColor)
                        .accessibilityLabel("Vicinanza all'obiettivo")
                        .accessibilityValue(progress.formatted(.percent.precision(.fractionLength(0))))
                }
                Text("Ricevi un avviso quando il prezzo scende fino all'obiettivo e il prodotto è disponibile.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("Imposta un prezzo obiettivo: ti avvisiamo quando il prezzo scende fino a quel valore.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button(action: edit) {
                    Label("Imposta obiettivo", systemImage: "target")
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            }

            Divider()

            Label(monitoringText, systemImage: "calendar")
                .font(.footnote)
                .foregroundStyle(product.isMonitoringExpired ? Theme.warning : Color.secondary)
        }
        .card()
    }

    /// Quanto il prezzo attuale e' vicino all'obiettivo (1 = raggiunto).
    private var progress: Double? {
        guard let current = product.currentPrice, let target = product.targetPrice, current > 0 else { return nil }
        return min(max((target / current).asDouble, 0), 1)
    }

    private var monitoringText: String {
        guard let until = product.monitoringUntil else { return "Monitoraggio senza scadenza" }
        return product.isMonitoringExpired
            ? "Monitoraggio terminato il \(DateFormatting.day(until))"
            : "Monitoraggio fino al \(DateFormatting.day(until))"
    }
}

// MARK: - Immagine a schermo intero

private struct ImageViewer: View {
    let url: URL?

    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        NavigationStack {
            RemoteProductImage(url: url, placeholderFont: .largeTitle)
                .padding(24)
                .scaleEffect(scale)
                .offset(offset)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect)
                .gesture(
                    MagnifyGesture()
                        .onChanged { value in
                            scale = min(max(lastScale * value.magnification, 1), 5)
                        }
                        .onEnded { _ in
                            lastScale = scale
                            if scale <= 1 { reset() }
                        }
                )
                .simultaneousGesture(
                    DragGesture()
                        .onChanged { value in
                            guard scale > 1 else { return }
                            offset = CGSize(
                                width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height
                            )
                        }
                        .onEnded { value in
                            if scale <= 1, value.translation.height > 120 {
                                dismiss()
                            } else {
                                lastOffset = offset
                            }
                        }
                )
                .onTapGesture(count: 2) {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                        if scale > 1 {
                            reset()
                        } else {
                            scale = 2.5
                            lastScale = 2.5
                        }
                    }
                }
                .background(.white)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            dismiss()
                        } label: {
                            Label("Chiudi", systemImage: "xmark")
                        }
                    }
                }
                .accessibilityHint("Pizzica o tocca due volte per ingrandire")
        }
        .environment(\.colorScheme, .light)
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}

#Preview {
    let toasts = ToastCenter()
    let store = ProductsStore(toasts: toasts)
    store.seedForPreview(PreviewData.products)
    return NavigationStack {
        ProductDetailView(productID: PreviewData.products[0].id)
    }
    .environment(store)
    .environment(toasts)
}
