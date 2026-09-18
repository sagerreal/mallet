import XCTest
@testable import MalletCaptureCore

/// The wire-contract corpus: every edge-shape the Swift encoder can legitimately put on the
/// wire, written as committed JSON files that mallet-app's server test suite must parse.
///
/// WHY THIS EXISTS: the vaulted-ceiling incident (Jul 29 2026). Swift's `JSONEncoder` omits
/// nil optionals entirely, the server's zod schema required the key, and the first real
/// on-device scan of a vaulted room failed to save — a wire-drift class no amount of
/// hand-testing individual rooms would have predicted. This corpus makes the drift a CI
/// failure instead of a field failure.
///
/// REGENERATING: `MALLET_WRITE_WIRE_CORPUS=1 swift test --filter WireCorpusTests` rewrites
/// `Tests/MalletCaptureCoreTests/WireCorpus/*.json`, then copy the folder into mallet-app's
/// `modules/measurements/domain/__fixtures__/wire-corpus/` — its `wire-corpus.test.ts`
/// asserts every file parses. Any encoder or schema change that breaks the contract now
/// fails one side's suite before it can reach a device.
final class WireCorpusTests: XCTestCase {

    private static let rect = Polygon3(vertices: [
        Point3(x: 0, y: 0, z: 0),
        Point3(x: 4, y: 0, z: 0),
        Point3(x: 4, y: 3, z: 0),
        Point3(x: 0, y: 3, z: 0),
    ])

    private static let wall = WallGeometry(polygon: Polygon3(vertices: [
        Point3(x: 0, y: 0, z: 0),
        Point3(x: 4, y: 0, z: 0),
        Point3(x: 4, y: 0, z: 2.4),
        Point3(x: 0, y: 0, z: 2.4),
    ]))

    /// name → geometry. Add a case here whenever the wire model grows a new optional or a
    /// new legitimate degenerate shape; never remove one without a matching server change.
    private static let corpus: [(name: String, geometry: NormalizedGeometry)] = [
        ("flat-ceiling-baseline", NormalizedGeometry(
            floorPolygon: rect,
            walls: [wall],
            openings: [Opening(kind: .door, width: 0.9, height: 2.0, wallIndex: 0)],
            ceiling: CeilingEstimate(area: 12, isVaulted: false, wallTopSpread: 0.002, provenance: "wall_top_flat")
        )),
        // THE Jul-29 killer: nil area encodes as NO key at all.
        ("vaulted-ceiling-nil-area", NormalizedGeometry(
            floorPolygon: rect,
            walls: [wall],
            openings: [],
            ceiling: CeilingEstimate(area: nil, isVaulted: true, wallTopSpread: 0.4, provenance: "vaulted_needs_confirmation")
        )),
        // nil wallIndex also omits its key.
        ("opening-nil-wall-index", NormalizedGeometry(
            floorPolygon: rect,
            walls: [wall],
            openings: [Opening(kind: .window, width: 1.2, height: 1.5, wallIndex: nil)],
            ceiling: CeilingEstimate(area: 12, isVaulted: false, wallTopSpread: 0, provenance: "wall_top_flat")
        )),
        // Empty wall polygons — what RoomPlan actually returned for 14/15 walls on-device.
        ("degenerate-empty-wall-polygons", NormalizedGeometry(
            floorPolygon: rect,
            walls: [WallGeometry(polygon: Polygon3(vertices: [])), wall],
            openings: [],
            ceiling: CeilingEstimate(area: nil, isVaulted: true, wallTopSpread: 0, provenance: "vaulted_needs_confirmation")
        )),
        ("no-openings", NormalizedGeometry(
            floorPolygon: rect,
            walls: [wall],
            openings: [],
            ceiling: CeilingEstimate(area: 12, isVaulted: false, wallTopSpread: 0, provenance: "wall_top_flat")
        )),
        ("minimal-triangle-floor", NormalizedGeometry(
            floorPolygon: Polygon3(vertices: [
                Point3(x: 0, y: 0, z: 0),
                Point3(x: 3, y: 0, z: 0),
                Point3(x: 0, y: 4, z: 0),
            ]),
            walls: [wall],
            openings: [Opening(kind: .opening, width: 2.0, height: 2.1, wallIndex: 0)],
            ceiling: CeilingEstimate(area: 6, isVaulted: false, wallTopSpread: 0, provenance: "wall_top_flat")
        )),
    ]

    private static var corpusDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("WireCorpus")
    }

    /// Every corpus case encodes, round-trips through the Swift decoder, and matches the
    /// committed file byte-for-byte (sortedKeys makes the encoding deterministic). Set
    /// MALLET_WRITE_WIRE_CORPUS=1 to (re)write the committed files instead of comparing.
    func testCorpusFilesMatchEncoderOutput() throws {
        let write = ProcessInfo.processInfo.environment["MALLET_WRITE_WIRE_CORPUS"] == "1"
        if write {
            try FileManager.default.createDirectory(at: Self.corpusDir, withIntermediateDirectories: true)
        }
        for (name, geometry) in Self.corpus {
            let encoded = try geometry.encodeJSON()
            let decoded = try NormalizedGeometry.decodeJSON(encoded)
            XCTAssertEqual(decoded.walls.count, geometry.walls.count, name)
            XCTAssertEqual(decoded.ceiling.area, geometry.ceiling.area, name)

            let file = Self.corpusDir.appendingPathComponent("\(name).json")
            if write {
                try encoded.write(to: file)
            } else {
                let committed = try Data(contentsOf: file)
                XCTAssertEqual(encoded, committed, "\(name): encoder output drifted from the committed corpus — regenerate AND update mallet-app's copy")
            }
        }
    }

    /// The vaulted case must NOT contain an "area" key — that omission IS the contract fact
    /// the server schema has to accept. If Swift ever starts writing explicit nulls, this
    /// pins the change so the corpus (and server expectations) get updated deliberately.
    func testVaultedCaseOmitsAreaKey() throws {
        let vaulted = Self.corpus.first { $0.name == "vaulted-ceiling-nil-area" }!
        let json = String(data: try vaulted.geometry.encodeJSON(), encoding: .utf8)!
        XCTAssertFalse(json.contains("\"area\""))
        XCTAssertTrue(json.contains("\"is_vaulted\":true"))
    }
}
