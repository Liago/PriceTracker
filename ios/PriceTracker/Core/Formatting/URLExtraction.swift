import Foundation

enum URLExtraction {
    /// Il primo link http(s) in un testo: le app di shopping condividono
    /// spesso "Guarda questo prodotto: https://…".
    static func firstWebURL(in text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: trimmed), isWebURL(url) { return url }
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(trimmed.startIndex..., in: trimmed)
        return detector.matches(in: trimmed, range: range)
            .compactMap(\.url)
            .first(where: isWebURL)
    }

    static func isWebURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return false }
        guard let host = url.host(), host.contains(".") else { return false }
        return true
    }
}
