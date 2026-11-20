import Charts
import SwiftUI

/// Lo storico dei prezzi, in stile Borsa: si tocca o si trascina sul grafico
/// per leggere il prezzo in un giorno preciso.
///
/// La serie e' a gradini: `price_history` registra solo i cambi, e un prezzo
/// resta valido fino alla lettura successiva. Una linea inclinata
/// suggerirebbe prezzi intermedi mai esistiti.
struct PriceHistoryCard: View {
    let history: [PricePoint]
    let currentPrice: Decimal?
    let targetPrice: Decimal?
    let currency: String?

    @State private var range: ChartRange = .all
    @State private var selectedDate: Date?

    var body: some View {
        let points = PriceSeries.points(history, in: range, currentPrice: currentPrice)
        let summary = PriceSummary(points: points)
        let selected = selectedDate.flatMap { PriceSeries.point(at: $0, in: points) }

        VStack(alignment: .leading, spacing: 14) {
            CardHeader(title: "Storico prezzi", systemImage: "chart.xyaxis.line") {
                if !history.isEmpty {
                    Text(history.count == 1 ? "1 variazione" : "\(history.count) variazioni")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if points.isEmpty {
                ContentUnavailableView(
                    "Nessuna lettura",
                    systemImage: "chart.line.flattrend.xyaxis",
                    description: Text("Il grafico si riempie a ogni controllo del prezzo.")
                )
                .frame(height: 220)
            } else {
                headline(selected: selected, summary: summary)
                chart(points: points, selected: selected)
                    .frame(height: 220)

                Picker("Periodo", selection: $range) {
                    ForEach(ChartRange.allCases) { range in
                        Text(range.label)
                            .accessibilityLabel(range.accessibilityLabel)
                            .tag(range)
                    }
                }
                .pickerStyle(.segmented)

                if let summary {
                    stats(summary)
                }
            }
        }
        .card()
        .onChange(of: range) { selectedDate = nil }
        .sensoryFeedback(.selection, trigger: selected?.id)
    }

    // MARK: - Intestazione

    @ViewBuilder
    private func headline(selected: PricePoint?, summary: PriceSummary?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let selected {
                Text(PriceFormatting.string(selected.price, currency: currency))
                    .font(.title3.bold())
                    .monospacedDigit()
                Text(selected.id == "now" ? "Oggi" : DateFormatting.dayAndTime(selected.date))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if let summary {
                PriceChangeLabel(change: summary.change, ratio: summary.changeRatio, currency: currency, font: .title3)
                Text(range == .all ? "Da quando segui il prodotto" : "Variazione nel periodo")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(height: 46, alignment: .leading)
    }

    // MARK: - Grafico

    private func chart(points: [PricePoint], selected: PricePoint?) -> some View {
        let domain = Self.domain(for: points, target: targetPrice?.asDouble)
        let gradient = LinearGradient(
            colors: [Color.accentColor.opacity(0.32), Color.accentColor.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )

        return Chart {
            ForEach(points) { point in
                AreaMark(
                    x: .value("Data", point.date),
                    yStart: .value("Base", domain.lowerBound),
                    yEnd: .value("Prezzo", point.value)
                )
                .interpolationMethod(.stepEnd)
                .foregroundStyle(gradient)

                LineMark(
                    x: .value("Data", point.date),
                    y: .value("Prezzo", point.value)
                )
                .interpolationMethod(.stepEnd)
                .foregroundStyle(Color.accentColor)
                .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
            }

            if let target = targetPrice?.asDouble, domain.contains(target) {
                RuleMark(y: .value("Obiettivo", target))
                    .foregroundStyle(Theme.positive.opacity(0.85))
                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                    .annotation(position: .top, alignment: .leading, spacing: 2) {
                        Text("Obiettivo")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.positive)
                    }
            }

            if let selectedDate, let selected {
                RuleMark(x: .value("Selezione", selectedDate))
                    .foregroundStyle(Color.secondary.opacity(0.5))
                    .lineStyle(StrokeStyle(lineWidth: 1))
                PointMark(
                    x: .value("Selezione", selectedDate),
                    y: .value("Prezzo", selected.value)
                )
                .symbolSize(90)
                .foregroundStyle(Color.accentColor)
            }
        }
        .chartYScale(domain: domain)
        .chartXSelection(value: $selectedDate)
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [2, 3]))
                AxisValueLabel {
                    if let amount = value.as(Double.self) {
                        Text(axisLabel(amount))
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5))
                AxisValueLabel(format: .dateTime.day().month(.abbreviated))
            }
        }
        .accessibilityLabel("Grafico dello storico prezzi")
        .accessibilityValue(accessibilitySummary(points: points))
    }

    /// L'intervallo dell'asse verticale, con un po' di respiro sopra e sotto.
    /// L'obiettivo entra nell'intervallo solo se non schiaccia la curva.
    static func domain(for points: [PricePoint], target: Double?) -> ClosedRange<Double> {
        var values = points.map(\.value)
        guard let low = values.min(), let high = values.max() else { return 0...1 }
        if let target, target >= low * 0.6, target <= high * 1.4 { values.append(target) }
        let minimum = values.min() ?? low
        let maximum = values.max() ?? high
        let span = max(maximum - minimum, maximum * 0.04, 1)
        return max(0, minimum - span * 0.3)...(maximum + span * 0.3)
    }

    private func axisLabel(_ amount: Double) -> String {
        amount.formatted(.currency(code: PriceFormatting.currencyCode(currency)).precision(.fractionLength(0)).grouping(.never))
    }

    private func accessibilitySummary(points: [PricePoint]) -> String {
        guard let summary = PriceSummary(points: points) else { return "Nessun dato" }
        let minimum = PriceFormatting.string(summary.minimum.price, currency: currency)
        let maximum = PriceFormatting.string(summary.maximum.price, currency: currency)
        return "Minimo \(minimum), massimo \(maximum)"
    }

    // MARK: - Statistiche

    private func stats(_ summary: PriceSummary) -> some View {
        HStack(spacing: 0) {
            StatCell(title: "Minimo", value: PriceFormatting.string(summary.minimum.price, currency: currency), tint: Theme.positive)
            Divider().frame(height: 32)
            StatCell(title: "Medio", value: PriceFormatting.string(summary.average, currency: currency), tint: .primary)
            Divider().frame(height: 32)
            StatCell(title: "Massimo", value: PriceFormatting.string(summary.maximum.price, currency: currency), tint: Theme.negative)
        }
        .padding(.vertical, 10)
        .background(Color(.tertiarySystemFill).opacity(0.5), in: .rect(cornerRadius: 14, style: .continuous))
    }
}

private struct StatCell: View {
    let title: String
    let value: String
    let tint: Color

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

#Preview {
    ScrollView {
        PriceHistoryCard(
            history: PreviewData.history,
            currentPrice: 279.99,
            targetPrice: 250,
            currency: "EUR"
        )
        .padding()
    }
    .background(Color(.systemGroupedBackground))
}
