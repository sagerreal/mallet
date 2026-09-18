import Foundation

/// The verbatim layer-1 capture as it came off-device — the raw scanner payload plus
/// enough metadata to route and display it before any geometry processing happens.
public struct RawCapture: Codable, Sendable {
    public let id: UUID
    public let capturedAt: Date
    /// e.g. "roomplan_v1" — identifies the capture pipeline that produced `payload`.
    public let source: String
    public let roomName: String
    /// The verbatim scanner payload, stored byte-for-byte with no reinterpretation.
    public let payload: Data
    public let schemaVersion: Int

    public init(
        id: UUID,
        capturedAt: Date,
        source: String,
        roomName: String,
        payload: Data,
        schemaVersion: Int
    ) {
        self.id = id
        self.capturedAt = capturedAt
        self.source = source
        self.roomName = roomName
        self.payload = payload
        self.schemaVersion = schemaVersion
    }
}

/// Lightweight metadata for a stored capture, cheap enough to list in bulk without
/// decoding the full raw payload or geometry for every entry.
public struct CaptureSummary: Codable, Sendable {
    public let id: UUID
    public let capturedAt: Date
    public let roomName: String
    public let uploaded: Bool

    public init(id: UUID, capturedAt: Date, roomName: String, uploaded: Bool) {
        self.id = id
        self.capturedAt = capturedAt
        self.roomName = roomName
        self.uploaded = uploaded
    }
}

/// Errors raised by `CaptureStore`. Every failure mode is surfaced explicitly — a
/// missing or corrupt capture is never reported as an empty/nil result.
public enum CaptureStoreError: Error, Equatable {
    /// `save` was called for an id whose directory already exists (captures are immutable).
    case alreadyExists(UUID)
    /// `load` was called for an id with no on-disk directory.
    case notFound(UUID)
    /// A capture directory exists but its contents could not be read or decoded.
    case corrupt(UUID, String)
}

/// Immutable, filesystem-backed persistence for layer-1 captures, doubling as the
/// upload queue: a capture is "pending" until its `.uploaded` marker file exists, so
/// the queue survives relaunch by construction — it IS the filesystem.
///
/// Layout: `<root>/<id>/raw.json`, `<root>/<id>/geometry.json`, `<root>/<id>/.uploaded`.
public final class CaptureStore {
    private let root: URL
    private let fileManager: FileManager
    private static let stagingPrefix = ".staging-"

    public init(root: URL, fileManager: FileManager = .default) {
        self.root = root
        self.fileManager = fileManager
        cleanupStaleStagingDirectories()
    }

    /// Persists a capture and its derived geometry under `<root>/<id>/`. Throws
    /// `CaptureStoreError.alreadyExists` if the id has already been saved — captures
    /// are write-once.
    ///
    /// Writes go to a same-volume staging directory first, then are moved into place
    /// with a single `rename(2)`-backed `moveItem`, which is atomic on APFS. This
    /// means a hard kill (not just a thrown error) between "directory created" and
    /// "files written" can never leave a zombie `<root>/<id>/` — either the staging
    /// directory is orphaned (harmless garbage, invisible to list/pendingUploads, and
    /// swept up on the next `init`) or the final directory exists complete.
    public func save(_ capture: RawCapture, geometry: NormalizedGeometry) throws {
        let dir = captureDirectory(for: capture.id)

        guard !fileManager.fileExists(atPath: dir.path) else {
            throw CaptureStoreError.alreadyExists(capture.id)
        }

        let staging = stagingDirectory()

        do {
            try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)

            let rawData = try makeRawEncoder().encode(capture)
            try writeAtomically(rawData, to: rawURL(in: staging))

            let geometryData = try geometry.encodeJSON()
            try writeAtomically(geometryData, to: geometryURL(in: staging))
        } catch {
            try? fileManager.removeItem(at: staging)
            throw CaptureStoreError.corrupt(capture.id, "save failed while staging: \(error)")
        }

        do {
            try fileManager.moveItem(at: staging, to: dir)
        } catch {
            try? fileManager.removeItem(at: staging)
            // The only expected concurrent-move failure is the destination having
            // appeared in the meantime (another save/process won the race).
            if fileManager.fileExists(atPath: dir.path) {
                throw CaptureStoreError.alreadyExists(capture.id)
            }
            throw CaptureStoreError.corrupt(capture.id, "save failed while finalizing: \(error)")
        }
    }

    /// Loads a previously saved capture and its geometry. Throws `notFound` if no
    /// directory exists for `id`, or `corrupt` if the directory exists but its
    /// contents can't be read/decoded.
    public func load(_ id: UUID) throws -> (RawCapture, NormalizedGeometry) {
        let dir = captureDirectory(for: id)

        guard fileManager.fileExists(atPath: dir.path) else {
            throw CaptureStoreError.notFound(id)
        }

        let rawData: Data
        do {
            rawData = try Data(contentsOf: rawURL(in: dir))
        } catch {
            throw CaptureStoreError.corrupt(id, "unreadable raw.json: \(error)")
        }

        let capture: RawCapture
        do {
            capture = try makeRawDecoder().decode(RawCapture.self, from: rawData)
        } catch {
            throw CaptureStoreError.corrupt(id, "undecodable raw.json: \(error)")
        }

        let geometryData: Data
        do {
            geometryData = try Data(contentsOf: geometryURL(in: dir))
        } catch {
            throw CaptureStoreError.corrupt(id, "unreadable geometry.json: \(error)")
        }

        let geometry: NormalizedGeometry
        do {
            geometry = try NormalizedGeometry.decodeJSON(geometryData)
        } catch {
            throw CaptureStoreError.corrupt(id, "undecodable geometry.json: \(error)")
        }

        return (capture, geometry)
    }

    /// Lists all stored captures, newest-first by `capturedAt` (ties broken by
    /// `id.uuidString` ascending, for a deterministic order).
    public func list() throws -> [CaptureSummary] {
        let ids = try captureIds()

        let summaries: [CaptureSummary] = try ids.map { id in
            let (capture, _) = try loadSummaryFields(id)
            return CaptureSummary(
                id: id,
                capturedAt: capture.capturedAt,
                roomName: capture.roomName,
                uploaded: isUploaded(id)
            )
        }

        return summaries.sorted { lhs, rhs in
            if lhs.capturedAt != rhs.capturedAt {
                return lhs.capturedAt > rhs.capturedAt
            }
            return lhs.id.uuidString < rhs.id.uuidString
        }
    }

    /// Ids of captures with no `.uploaded` marker, oldest-first — upload in capture order.
    public func pendingUploads() throws -> [UUID] {
        let ids = try captureIds()

        let pending: [(id: UUID, capturedAt: Date)] = try ids
            .filter { !isUploaded($0) }
            .map { id in
                let (capture, _) = try loadSummaryFields(id)
                return (id: id, capturedAt: capture.capturedAt)
            }

        return pending
            .sorted { lhs, rhs in
                if lhs.capturedAt != rhs.capturedAt {
                    return lhs.capturedAt < rhs.capturedAt
                }
                return lhs.id.uuidString < rhs.id.uuidString
            }
            .map(\.id)
    }

    /// Drops an empty `.uploaded` marker file in the capture's directory, removing it
    /// from `pendingUploads()`.
    public func markUploaded(_ id: UUID) throws {
        let dir = captureDirectory(for: id)

        guard fileManager.fileExists(atPath: dir.path) else {
            throw CaptureStoreError.notFound(id)
        }

        let marker = uploadedMarkerURL(in: dir)
        guard fileManager.createFile(atPath: marker.path, contents: Data()) else {
            throw CaptureStoreError.corrupt(id, "failed to create .uploaded marker")
        }
    }

    // MARK: - Paths

    private func captureDirectory(for id: UUID) -> URL {
        root.appendingPathComponent(id.uuidString, isDirectory: true)
    }

    private func rawURL(in dir: URL) -> URL {
        dir.appendingPathComponent("raw.json")
    }

    private func geometryURL(in dir: URL) -> URL {
        dir.appendingPathComponent("geometry.json")
    }

    private func uploadedMarkerURL(in dir: URL) -> URL {
        dir.appendingPathComponent(".uploaded")
    }

    /// A same-volume-as-`root` scratch directory for `save`'s staging step. Living
    /// under `root` (not `FileManager.default.temporaryDirectory`) guarantees the
    /// final `moveItem` is a same-volume `rename(2)` — atomic on APFS — rather than a
    /// cross-volume copy+delete.
    private func stagingDirectory() -> URL {
        root.appendingPathComponent("\(Self.stagingPrefix)\(UUID().uuidString)", isDirectory: true)
    }

    // MARK: - Helpers

    /// Best-effort removal of any `.staging-*` directories left behind by a `save`
    /// that was killed before its final `moveItem`. They are garbage by definition —
    /// nothing ever reads from them — so failures here are swallowed rather than
    /// surfaced; a store that can't clean up stale staging dirs should still be usable.
    private func cleanupStaleStagingDirectories() {
        guard fileManager.fileExists(atPath: root.path) else { return }

        guard let entries = try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil,
            options: []
        ) else {
            return
        }

        for entry in entries where entry.lastPathComponent.hasPrefix(Self.stagingPrefix) {
            try? fileManager.removeItem(at: entry)
        }
    }

    private func captureIds() throws -> [UUID] {
        guard fileManager.fileExists(atPath: root.path) else {
            return []
        }

        let entries: [URL]
        do {
            entries = try fileManager.contentsOfDirectory(
                at: root,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
        } catch {
            throw CaptureStoreError.corrupt(UUID(), "unreadable store root: \(error)")
        }

        return entries
            .filter { !$0.lastPathComponent.hasPrefix(Self.stagingPrefix) }
            .compactMap { UUID(uuidString: $0.lastPathComponent) }
    }

    /// Reads only what's needed for `list`/`pendingUploads`: the raw metadata, not geometry.
    private func loadSummaryFields(_ id: UUID) throws -> (RawCapture, Void) {
        let dir = captureDirectory(for: id)

        let rawData: Data
        do {
            rawData = try Data(contentsOf: rawURL(in: dir))
        } catch {
            throw CaptureStoreError.corrupt(id, "unreadable raw.json: \(error)")
        }

        do {
            let capture = try makeRawDecoder().decode(RawCapture.self, from: rawData)
            return (capture, ())
        } catch {
            throw CaptureStoreError.corrupt(id, "undecodable raw.json: \(error)")
        }
    }

    private func isUploaded(_ id: UUID) -> Bool {
        fileManager.fileExists(atPath: uploadedMarkerURL(in: captureDirectory(for: id)).path)
    }

    /// Writes `data` to `url` via a temp-file-then-move so a crash mid-write never
    /// leaves a half-written file behind at `url`.
    private func writeAtomically(_ data: Data, to url: URL) throws {
        try data.write(to: url, options: .atomic)
    }

    private func makeRawEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private func makeRawDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
