import Foundation
import Testing
@testable import MalletCaptureCore

@Suite struct CaptureStoreTests {
    /// Creates a fresh temp-directory root for a single test and removes it afterward.
    final class TempRoot {
        let url: URL

        init() {
            url = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }

        deinit {
            try? FileManager.default.removeItem(at: url)
        }
    }

    static func makeCapture(
        id: UUID = UUID(),
        capturedAt: Date = Date(),
        roomName: String = "Living Room",
        payload: Data = Data([0x00, 0x01, 0xFF, 0x10])
    ) -> RawCapture {
        RawCapture(
            id: id,
            capturedAt: capturedAt,
            source: "roomplan_v1",
            roomName: roomName,
            payload: payload,
            schemaVersion: 1
        )
    }

    @Test func saveThenLoadRoundTripsByteIdenticalPayload() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)

        let payload = Data((0..<256).map { UInt8($0 % 256) })
        let capture = Self.makeCapture(payload: payload)
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])

        try store.save(capture, geometry: geometry)

        let (loadedCapture, loadedGeometry) = try store.load(capture.id)

        #expect(loadedCapture.payload == payload)
        #expect(loadedCapture.id == capture.id)
        #expect(loadedCapture.roomName == capture.roomName)
        #expect(loadedCapture.source == capture.source)
        #expect(loadedCapture.schemaVersion == capture.schemaVersion)
        #expect(loadedGeometry.floorArea == geometry.floorArea)
        #expect(loadedGeometry.walls.count == geometry.walls.count)
    }

    @Test func secondSaveWithSameIdThrowsAlreadyExists() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)

        let capture = Self.makeCapture()
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])

        try store.save(capture, geometry: geometry)

        #expect(throws: CaptureStoreError.alreadyExists(capture.id)) {
            try store.save(capture, geometry: geometry)
        }
    }

    @Test func loadOfMissingIdThrowsNotFound() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)
        let missingId = UUID()

        #expect(throws: CaptureStoreError.notFound(missingId)) {
            _ = try store.load(missingId)
        }
    }

    @Test func pendingUploadsListsOnlyUnuploadedOldestFirst() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])

        let older = Self.makeCapture(capturedAt: Date(timeIntervalSince1970: 1_000))
        let newer = Self.makeCapture(capturedAt: Date(timeIntervalSince1970: 2_000))
        let uploaded = Self.makeCapture(capturedAt: Date(timeIntervalSince1970: 1_500))

        try store.save(older, geometry: geometry)
        try store.save(newer, geometry: geometry)
        try store.save(uploaded, geometry: geometry)
        try store.markUploaded(uploaded.id)

        let pending = try store.pendingUploads()

        #expect(pending == [older.id, newer.id])
    }

    @Test func markUploadedRemovesFromPending() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])

        let capture = Self.makeCapture()
        try store.save(capture, geometry: geometry)

        #expect(try store.pendingUploads() == [capture.id])

        try store.markUploaded(capture.id)

        #expect(try store.pendingUploads() == [])
    }

    @Test func listIsSortedNewestFirst() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])

        let oldest = Self.makeCapture(capturedAt: Date(timeIntervalSince1970: 1_000), roomName: "Oldest")
        let middle = Self.makeCapture(capturedAt: Date(timeIntervalSince1970: 2_000), roomName: "Middle")
        let newest = Self.makeCapture(capturedAt: Date(timeIntervalSince1970: 3_000), roomName: "Newest")

        try store.save(middle, geometry: geometry)
        try store.save(newest, geometry: geometry)
        try store.save(oldest, geometry: geometry)

        let summaries = try store.list()

        #expect(summaries.map(\.id) == [newest.id, middle.id, oldest.id])
        #expect(summaries.map(\.roomName) == ["Newest", "Middle", "Oldest"])
        #expect(summaries.allSatisfy { !$0.uploaded })
    }

    @Test func listMarksUploadedFlagCorrectly() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])

        let capture = Self.makeCapture()
        try store.save(capture, geometry: geometry)
        try store.markUploaded(capture.id)

        let summaries = try store.list()

        #expect(summaries.count == 1)
        #expect(summaries[0].uploaded == true)
    }

    @Test func listTieBreaksByIdWhenCapturedAtIsEqual() throws {
        let root = TempRoot()
        let store = CaptureStore(root: root.url)
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])
        let sameTime = Date(timeIntervalSince1970: 5_000)

        let a = Self.makeCapture(id: UUID(), capturedAt: sameTime)
        let b = Self.makeCapture(id: UUID(), capturedAt: sameTime)
        let expectedOrder = [a, b].sorted { $0.id.uuidString < $1.id.uuidString }.map(\.id)

        try store.save(a, geometry: geometry)
        try store.save(b, geometry: geometry)

        let summaries = try store.list()

        #expect(summaries.map(\.id) == expectedOrder)
    }

    /// Simulates a `save` that was hard-killed after staging its files but before the
    /// final `moveItem` — i.e. a leftover `<root>/.staging-<uuid>/raw.json` with no
    /// corresponding `<root>/<id>/` directory ever created.
    private static func simulateCrashedStagingDirectory(
        for capture: RawCapture,
        in root: URL
    ) throws -> URL {
        let staging = root.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let rawData = try encoder.encode(capture)
        try rawData.write(to: staging.appendingPathComponent("raw.json"), options: .atomic)

        return staging
    }

    @Test func staleStagingDirectoryIsInvisibleToListingAndRemovedOnInit() throws {
        let root = TempRoot()
        let capture = Self.makeCapture()

        let staging = try Self.simulateCrashedStagingDirectory(for: capture, in: root.url)
        #expect(FileManager.default.fileExists(atPath: staging.path))

        let store = CaptureStore(root: root.url)

        #expect(try store.list().isEmpty)
        #expect(try store.pendingUploads().isEmpty)
        #expect(!FileManager.default.fileExists(atPath: staging.path))
    }

    @Test func saveSucceedsForSameIdAfterSimulatedCrashLeavesStagingDirectory() throws {
        let root = TempRoot()
        let capture = Self.makeCapture()
        let geometry = try TestFixtures.rectRoom(w: 3, d: 4, h: 2.4, openings: [])

        _ = try Self.simulateCrashedStagingDirectory(for: capture, in: root.url)

        // A fresh CaptureStore init should sweep the stale staging dir, and the
        // capture id must not have become a permanent zombie: no directory was ever
        // finalized at <root>/<id>/, so `save` for the same id must succeed.
        let store = CaptureStore(root: root.url)

        try store.save(capture, geometry: geometry)

        let (loaded, _) = try store.load(capture.id)
        #expect(loaded.id == capture.id)
        #expect(loaded.payload == capture.payload)
    }
}
