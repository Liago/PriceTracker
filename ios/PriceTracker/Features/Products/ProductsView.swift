import SwiftUI

/// L'elenco dei prodotti seguiti, con filtri rapidi, ricerca e ordinamento.
struct ProductsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(ProductsStore.self) private var store

    @State private var search = ""
    @State private var filter: ProductFilter = .all
    @State private var storeFilter: String?
    @AppStorage("products.sort") private var sort: ProductSort = .newest
    @State private var pendingDeletion: Product?
    @State private var safariURL: IdentifiableURL?
    @Namespace private var transition

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.productsPath) {
            content
                .navigationTitle("Prodotti")
                .searchable(text: $search, prompt: "Cerca per nome, marca o negozio")
                .toolbar { toolbar }
                .navigationDestination(for: ProductRoute.self) { route in
                    ProductDetailView(productID: route.id)
                        .navigationTransition(.zoom(sourceID: route.id, in: transition))
                }
                .sheet(isPresented: $router.isAddingProduct) {
                    AddProductView()
                }
                .sheet(item: $safariURL) { item in
                    SafariView(url: item.url).ignoresSafeArea()
                }
                .confirmationDialog(
                    "Eliminare il prodotto?",
                    isPresented: Binding(get: { pendingDeletion != nil }, set: { if !$0 { pendingDeletion = nil } }),
                    titleVisibility: .visible,
                    presenting: pendingDeletion
                ) { product in
                    Button("Elimina", role: .destructive) {
                        Task { await store.delete(product) }
                    }
                } message: { product in
                    Text("«\(product.displayName)» e il suo storico dei prezzi verranno eliminati.")
                }
                .onChange(of: store.stores) {
                    if let storeFilter, !store.stores.contains(storeFilter) { self.storeFilter = nil }
                }
        }
    }

    private var visibleProducts: [Product] {
        store.visibleProducts(filter: filter, store: storeFilter, search: search, sort: sort)
    }

    // MARK: - Contenuto

    @ViewBuilder
    private var content: some View {
        if store.products.isEmpty && store.imports.isEmpty {
            switch store.phase {
            case .failed(let message):
                ContentUnavailableView {
                    Label("Impossibile caricare i prodotti", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Riprova") { Task { await store.load() } }
                        .buttonStyle(.bordered)
                }
            case .loaded:
                ContentUnavailableView {
                    Label("Nessun prodotto", systemImage: "tag")
                } description: {
                    Text("Incolla il link di un prodotto da qualsiasi negozio online per iniziare a seguirne il prezzo.")
                } actions: {
                    Button {
                        router.presentAddProduct()
                    } label: {
                        Label("Aggiungi prodotto", systemImage: "plus")
                            .padding(.horizontal, 4)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                }
            case .idle, .loading:
                placeholderList
            }
        } else {
            list
        }
    }

    private var list: some View {
        let products = visibleProducts
        return List {
            if search.isEmpty {
                Section {
                    FilterGrid(selection: $filter)
                }
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
            }

            if !store.imports.isEmpty {
                Section("In aggiunta") {
                    ForEach(store.imports) { pending in
                        PendingImportRow(pending: pending)
                    }
                }
            }

            Section {
                ForEach(products) { product in
                    NavigationLink(value: ProductRoute(id: product.id)) {
                        ProductRow(product: product)
                            .matchedTransitionSource(id: product.id, in: transition)
                    }
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            pendingDeletion = product
                        } label: {
                            Label("Elimina", systemImage: "trash")
                        }
                    }
                    .swipeActions(edge: .leading) {
                        if let url = product.productURL {
                            Button {
                                safariURL = IdentifiableURL(url: url)
                            } label: {
                                Label("Apri", systemImage: "safari")
                            }
                            .tint(.blue)
                        }
                    }
                    .contextMenu {
                        if let url = product.productURL {
                            Button {
                                safariURL = IdentifiableURL(url: url)
                            } label: {
                                Label("Apri nel negozio", systemImage: "safari")
                            }
                            ShareLink(item: url, subject: Text(product.displayName)) {
                                Label("Condividi link", systemImage: "square.and.arrow.up")
                            }
                        }
                        Divider()
                        Button(role: .destructive) {
                            pendingDeletion = product
                        } label: {
                            Label("Elimina", systemImage: "trash")
                        }
                    } preview: {
                        ProductPreviewCard(product: product)
                    }
                }
            } header: {
                if !products.isEmpty {
                    Text(sectionTitle(count: products.count))
                }
            }

            if products.isEmpty && !store.products.isEmpty {
                Section {
                    emptyFilterState
                        .frame(maxWidth: .infinity)
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await store.load() }
        .animation(.snappy, value: products.map(\.id))
        .animation(.snappy, value: store.imports)
    }

    @ViewBuilder
    private var emptyFilterState: some View {
        if !search.isEmpty {
            ContentUnavailableView.search(text: search)
        } else {
            ContentUnavailableView {
                Label("Nessun prodotto", systemImage: filter.symbol)
            } description: {
                Text(emptyFilterDescription)
            } actions: {
                Button("Mostra tutti") {
                    withAnimation(.snappy) {
                        filter = .all
                        storeFilter = nil
                    }
                }
            }
        }
    }

    private var emptyFilterDescription: String {
        switch filter {
        case .all: "Nessun prodotto di questo negozio."
        case .atTarget: "Nessun prodotto ha ancora raggiunto il prezzo obiettivo."
        case .attention: "Tutti i prodotti vengono letti correttamente."
        case .unavailable: "Tutti i prodotti risultano disponibili."
        }
    }

    private func sectionTitle(count: Int) -> String {
        let noun = count == 1 ? "prodotto" : "prodotti"
        if let storeFilter { return "\(count) \(noun) · \(storeFilter)" }
        return "\(count) \(noun)"
    }

    private var placeholderList: some View {
        List {
            ForEach(0..<6, id: \.self) { _ in
                ProductRow(product: .placeholder)
            }
        }
        .listStyle(.insetGrouped)
        .redacted(reason: .placeholder)
        .disabled(true)
        .accessibilityLabel("Caricamento dei prodotti")
    }

    // MARK: - Barra

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Menu {
                Picker("Ordina per", selection: $sort) {
                    ForEach(ProductSort.allCases) { option in
                        Label(option.title, systemImage: option.symbol).tag(option)
                    }
                }
                if store.stores.count > 1 {
                    Picker(selection: $storeFilter) {
                        Text("Tutti i negozi").tag(String?.none)
                        ForEach(store.stores, id: \.self) { name in
                            Text(name).tag(String?.some(name))
                        }
                    } label: {
                        Label("Negozio", systemImage: "storefront")
                    }
                    .pickerStyle(.menu)
                }
            } label: {
                Label("Ordina e filtra", systemImage: storeFilter == nil ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
            }
            .disabled(store.products.isEmpty)
        }
        ToolbarItem(placement: .primaryAction) {
            Button {
                router.presentAddProduct()
            } label: {
                Label("Aggiungi prodotto", systemImage: "plus")
            }
        }
    }
}

// MARK: - Filtri rapidi

/// Quattro riquadri in stile Promemoria: conteggio e filtro in un tocco.
private struct FilterGrid: View {
    @Binding var selection: ProductFilter
    @Environment(ProductsStore.self) private var store

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(ProductFilter.allCases) { filter in
                FilterTile(filter: filter, count: store.count(for: filter), isSelected: selection == filter) {
                    withAnimation(.snappy) {
                        selection = selection == filter && filter != .all ? .all : filter
                    }
                }
            }
        }
        .sensoryFeedback(.selection, trigger: selection)
    }
}

private struct FilterTile: View {
    let filter: ProductFilter
    let count: Int
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        let tint = Theme.tint(for: filter)
        Button(action: action) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    Image(systemName: filter.symbol)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(tint, in: .circle)
                    Spacer()
                    Text(count, format: .number)
                        .font(.title2.bold())
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(count)))
                }
                Text(filter.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                isSelected ? AnyShapeStyle(tint.opacity(0.16)) : AnyShapeStyle(Color(.secondarySystemGroupedBackground)),
                in: .rect(cornerRadius: 16, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(isSelected ? tint : .clear, lineWidth: 2)
            }
            .contentShape(.rect(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(filter.title): \(count)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

// MARK: - Righe

struct ProductRow: View {
    let product: Product

    var body: some View {
        HStack(spacing: 14) {
            ProductThumbnail(url: product.imageURL, size: 64)

            VStack(alignment: .leading, spacing: 5) {
                Text(product.displayName)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(2)
                HStack(spacing: 5) {
                    if product.trackingHealth.needsAttention {
                        Image(systemName: product.trackingHealth.symbol)
                            .foregroundStyle(Theme.tint(for: product.trackingHealth))
                            .accessibilityLabel(product.trackingHealth.label)
                    }
                    Text(product.storeName)
                        .lineLimit(1)
                }
                .font(.caption)
                .foregroundStyle(.secondary)

                if product.reachedTarget {
                    Label("Obiettivo raggiunto", systemImage: "checkmark.seal.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.positive)
                } else if let availability = product.availability.label {
                    Text(availability)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.warning)
                }
            }

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 4) {
                Text(PriceFormatting.string(product.currentPrice, currency: product.currency))
                    .font(.headline)
                    .monospacedDigit()
                    .foregroundStyle(product.availability.isUnavailable ? .secondary : .primary)
                if let target = product.targetPrice {
                    Label(PriceFormatting.string(target, currency: product.currency), systemImage: "target")
                        .font(.caption2)
                        .monospacedDigit()
                        .foregroundStyle(product.reachedTarget ? Theme.positive : Color.secondary)
                        .accessibilityLabel("Obiettivo \(PriceFormatting.string(target, currency: product.currency))")
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct PendingImportRow: View {
    let pending: PendingImport
    @Environment(ProductsStore.self) private var store

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: Theme.smallCornerRadius, style: .continuous)
                    .fill(Color(.tertiarySystemFill))
                switch pending.state {
                case .running:
                    ProgressView()
                case .failed:
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.title3)
                        .foregroundStyle(Theme.warning)
                }
            }
            .frame(width: 64, height: 64)

            VStack(alignment: .leading, spacing: 4) {
                switch pending.state {
                case .running:
                    Text("Lettura della pagina…")
                        .font(.subheadline.weight(.semibold))
                    Text(pending.host)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Può richiedere fino a un minuto. Puoi continuare a usare l'app.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                case .failed(let message):
                    Text("Aggiunta non riuscita")
                        .font(.subheadline.weight(.semibold))
                    Text(pending.host)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack {
                        Button("Riprova") { Task { await store.retryImport(pending) } }
                            .buttonStyle(.bordered)
                        Button("Rimuovi", role: .destructive) { store.dismissImport(pending) }
                            .buttonStyle(.bordered)
                    }
                    .controlSize(.small)
                    .padding(.top, 4)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

/// L'anteprima mostrata tenendo premuto un prodotto.
private struct ProductPreviewCard: View {
    let product: Product

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RemoteProductImage(url: product.imageURL, placeholderFont: .largeTitle)
                .padding(20)
                .frame(height: 220)
                .frame(maxWidth: .infinity)
                .background(.white)
            VStack(alignment: .leading, spacing: 6) {
                Text(product.storeName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Text(product.displayName)
                    .font(.headline)
                    .lineLimit(3)
                Text(PriceFormatting.string(product.currentPrice, currency: product.currency))
                    .font(.title2.bold())
                    .monospacedDigit()
            }
            .padding([.horizontal, .bottom], 16)
        }
        .frame(width: 320)
        .background(Color(.systemBackground))
    }
}

extension Product {
    static let placeholder = Product(
        id: "placeholder",
        url: "https://example.com",
        name: "Nome del prodotto in caricamento",
        store: "Negozio",
        currentPrice: 199.99
    )
}

#Preview {
    let toasts = ToastCenter()
    let store = ProductsStore(toasts: toasts)
    store.seedForPreview(PreviewData.products)
    return ProductsView()
        .environment(AppRouter())
        .environment(store)
        .environment(toasts)
}
