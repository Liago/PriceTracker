import SwiftUI

/// L'immagine di un prodotto su fondo bianco: le foto dei negozi sono quasi
/// sempre scontornate su bianco e su fondo scuro risulterebbero ritagliate.
struct ProductThumbnail: View {
    let url: URL?
    var size: CGFloat = 60
    var cornerRadius: CGFloat = Theme.smallCornerRadius

    var body: some View {
        RemoteProductImage(url: url, placeholderFont: size > 80 ? .largeTitle : .title3)
            .padding(size * 0.08)
            .frame(width: size, height: size)
            .background(.white, in: .rect(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5)
            }
            .accessibilityHidden(true)
    }
}

/// Un'immagine remota adattata allo spazio, con segnaposto e stato di errore.
struct RemoteProductImage: View {
    let url: URL?
    var placeholderFont: Font = .title3

    var body: some View {
        AsyncImage(url: url, transaction: Transaction(animation: .easeOut(duration: 0.2))) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFit()
            case .failure:
                placeholder
            case .empty:
                if url == nil { placeholder } else { ProgressView().tint(.gray) }
            @unknown default:
                placeholder
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var placeholder: some View {
        Image(systemName: "photo")
            .font(placeholderFont)
            .foregroundStyle(Color.gray.opacity(0.6))
    }
}
