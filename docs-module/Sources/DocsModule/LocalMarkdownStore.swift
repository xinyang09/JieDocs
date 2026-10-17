import Foundation

public struct LocalMarkdownDocument: Identifiable, Hashable, Sendable {
    public let url: URL
    public let relativePath: String
    public let modifiedAt: Date

    public var id: String { url.path }
    public var title: String { url.deletingPathExtension().lastPathComponent }

    public init(url: URL, relativePath: String, modifiedAt: Date) {
        self.url = url
        self.relativePath = relativePath
        self.modifiedAt = modifiedAt
    }

    public func read() -> String {
        (try? String(contentsOf: url, encoding: .utf8)) ?? ""
    }

    public static func load(from root: URL) -> [LocalMarkdownDocument] {
        guard FileManager.default.fileExists(atPath: root.path) else { return [] }
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey]
        guard let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [] }
        return enumerator.compactMap { item -> LocalMarkdownDocument? in
            guard let url = item as? URL, url.pathExtension.lowercased() == "md", let values = try? url.resourceValues(forKeys: keys), values.isRegularFile == true else { return nil }
            let relative = url.path.replacingOccurrences(of: root.path + "/", with: "")
            return LocalMarkdownDocument(url: url, relativePath: relative, modifiedAt: values.contentModificationDate ?? .distantPast)
        }.sorted { $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending }
    }
}
