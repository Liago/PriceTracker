import SwiftUI

/// Mostra il messaggio corrente di `ToastCenter` in alto, sopra ogni scheda.
struct ToastOverlay: ViewModifier {
    @Environment(ToastCenter.self) private var toasts

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) {
                if let toast = toasts.current {
                    ToastView(toast: toast)
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                        .onTapGesture { toasts.dismiss() }
                        .gesture(DragGesture(minimumDistance: 10).onEnded { value in
                            if value.translation.height < 0 { toasts.dismiss() }
                        })
                        .id(toast.id)
                }
            }
            .animation(.spring(response: 0.4, dampingFraction: 0.85), value: toasts.current)
            .sensoryFeedback(trigger: toasts.current) { _, new in
                switch new?.style {
                case .success: .success
                case .warning: .warning
                case .error: .error
                case .info, .none: nil
                }
            }
    }
}

private struct ToastView: View {
    let toast: ToastCenter.Toast

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(tint)
                .symbolRenderingMode(.hierarchical)
            VStack(alignment: .leading, spacing: 2) {
                Text(toast.title)
                    .font(.subheadline.weight(.semibold))
                if let message = toast.message {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: 520)
        .background(.regularMaterial, in: .rect(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }

    private var symbol: String {
        switch toast.style {
        case .success: "checkmark.circle.fill"
        case .info: "info.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .error: "xmark.octagon.fill"
        }
    }

    private var tint: Color {
        switch toast.style {
        case .success: .green
        case .info: .accentColor
        case .warning: .orange
        case .error: .red
        }
    }
}

extension View {
    func toastOverlay() -> some View {
        modifier(ToastOverlay())
    }
}
