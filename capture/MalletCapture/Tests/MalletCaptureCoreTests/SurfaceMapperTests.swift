import XCTest
@testable import MalletCaptureCore

/// Fixture DTOs standing in for a RoomPlan `CapturedRoom` capture of the same 4×3×2.4
/// room as `TestFixtures.rectRoom`, but expressed the way RoomPlan actually reports
/// geometry: LOCAL-space polygon corners plus a local→world transform, in RoomPlan's
/// own Y-up world axes.
///
/// The remap `SurfaceMapper` applies is: world (wx, wy, wz) → Core (x: wx, y: -wz,
/// z: wy) — i.e. RoomPlan's vertical (Y) axis becomes Core's height axis (z), and
/// RoomPlan's world Z becomes Core's Y (negated to preserve the floor's winding /
/// area sign). Every fixture below was hand-derived through that same remap so its
/// expected Core-space result is exactly `TestFixtures.rectRoom(w: 4, d: 3, h: 2.4)`.
final class SurfaceMapperTests: XCTestCase {

    // MARK: - Fixture (hand-derived RoomPlan-style surfaces)

    /// Floor: identity transform; corners already given in RoomPlan world space
    /// (y = 0 plane). Remaps to Core floor (0,0,0)(4,0,0)(4,3,0)(0,3,0).
    private static let floorSurface = SurfaceDTO(
        category: .floor,
        corners: [
            Point3(x: 0, y: 0, z: 0),
            Point3(x: 4, y: 0, z: 0),
            Point3(x: 4, y: 0, z: -3),
            Point3(x: 0, y: 0, z: -3),
        ],
        transform: .identity
    )

    /// Wall 0 (Core floor edge 0→1): identity transform, corners given directly in
    /// RoomPlan world space. Remaps to Core wall0 (0,0,0)(4,0,0)(4,0,2.4)(0,0,2.4).
    private static let wall0Surface = SurfaceDTO(
        category: .wall,
        corners: [
            Point3(x: 0, y: 0, z: 0),
            Point3(x: 4, y: 0, z: 0),
            Point3(x: 4, y: 2.4, z: 0),
            Point3(x: 0, y: 2.4, z: 0),
        ],
        transform: .identity
    )

    /// Wall 1 (Core floor edge 1→2): the hand-computed translation+rotation case.
    /// Local corners are a 3m(wide) × 2.4m(tall) rectangle centered at the local
    /// origin, in the local XY plane (z = 0, RoomPlan's flat-surface convention).
    /// The transform rotates 90° about the world Y axis (local +X → world -Z) then
    /// translates to (4, 1.2, -1.5) — worked by hand as follows:
    ///
    /// Rotation (θ=90°, cosθ=0, sinθ=1) in RoomPlan's right-handed Y-up convention:
    ///   x' = x·cosθ + z·sinθ = z
    ///   y' = y
    ///   z' = -x·sinθ + z·cosθ = -x
    ///
    /// local(-1.5,-1.2,0) → rotated(0,-1.2,1.5) → +T(4,1.2,-1.5) = world(4, 0, 0)
    /// local( 1.5,-1.2,0) → rotated(0,-1.2,-1.5) → +T              = world(4, 0, -3)
    /// local( 1.5, 1.2,0) → rotated(0, 1.2,-1.5) → +T              = world(4, 2.4, -3)
    /// local(-1.5, 1.2,0) → rotated(0, 1.2, 1.5) → +T              = world(4, 2.4, 0)
    ///
    /// Which remaps (Core.x=wx, Core.y=-wz, Core.z=wy) to exactly Core wall1:
    /// (4,0,0)(4,3,0)(4,3,2.4)(4,0,2.4) — matching `TestFixtures.rectRoom` wall 1.
    private static let wall1Transform = Transform4(m: [
        [0, 0, 1, 4],
        [0, 1, 0, 1.2],
        [-1, 0, 0, -1.5],
        [0, 0, 0, 1],
    ])
    private static let wall1Surface = SurfaceDTO(
        category: .wall,
        corners: [
            Point3(x: -1.5, y: -1.2, z: 0),
            Point3(x: 1.5, y: -1.2, z: 0),
            Point3(x: 1.5, y: 1.2, z: 0),
            Point3(x: -1.5, y: 1.2, z: 0),
        ],
        transform: wall1Transform
    )

    /// Wall 2 (Core floor edge 2→3) and wall 3 (edge 3→0): identity transform, world
    /// corners given directly (same derivation style as wall 0).
    private static let wall2Surface = SurfaceDTO(
        category: .wall,
        corners: [
            Point3(x: 4, y: 0, z: -3),
            Point3(x: 0, y: 0, z: -3),
            Point3(x: 0, y: 2.4, z: -3),
            Point3(x: 4, y: 2.4, z: -3),
        ],
        transform: .identity
    )
    private static let wall3Surface = SurfaceDTO(
        category: .wall,
        corners: [
            Point3(x: 0, y: 0, z: -3),
            Point3(x: 0, y: 0, z: 0),
            Point3(x: 0, y: 2.4, z: 0),
            Point3(x: 0, y: 2.4, z: -3),
        ],
        transform: .identity
    )

    /// Door on wall 0: 0.9m wide × 2.0m tall, in wall0's plane (world z = 0), with an
    /// explicit `parentWallIndex` — pins the parentIdentifier-preferred path.
    private static let doorSurface = SurfaceDTO(
        category: .door,
        corners: [
            Point3(x: 1.0, y: 0, z: 0),
            Point3(x: 1.9, y: 0, z: 0),
            Point3(x: 1.9, y: 2.0, z: 0),
            Point3(x: 1.0, y: 2.0, z: 0),
        ],
        transform: .identity,
        parentWallIndex: 0
    )

    /// Window on wall 1: 1.2m wide × 1.5m tall, in wall1's plane (world x = 4), with
    /// NO parentWallIndex — pins the nearest-wall-by-centroid fallback path (hand
    /// checked: its centroid is ~0.18 from wall1's centroid vs. 2.4+ from every
    /// other wall's).
    private static let windowSurface = SurfaceDTO(
        category: .window,
        corners: [
            Point3(x: 4, y: 0.3, z: -1.0),
            Point3(x: 4, y: 0.3, z: -2.2),
            Point3(x: 4, y: 1.8, z: -2.2),
            Point3(x: 4, y: 1.8, z: -1.0),
        ],
        transform: .identity
    )

    private static var fullRoomSurfaces: [SurfaceDTO] {
        [floorSurface, wall0Surface, wall1Surface, wall2Surface, wall3Surface, doorSurface, windowSurface]
    }

    // MARK: - Tests

    func testGeometryTotalsMatchFixtureRoom() throws {
        let expected = try TestFixtures.rectRoom(
            w: 4, d: 3, h: 2.4,
            openings: [
                Opening(kind: .door, width: 0.9, height: 2.0, wallIndex: 0),
                Opening(kind: .window, width: 1.2, height: 1.5, wallIndex: 1),
            ]
        )

        let mapped = try SurfaceMapper.geometry(from: Self.fullRoomSurfaces)

        XCTAssertEqual(mapped.floorArea, expected.floorArea, accuracy: 1e-9)
        XCTAssertEqual(mapped.floorPerimeter, expected.floorPerimeter, accuracy: 1e-9)
        XCTAssertEqual(mapped.grossWallArea, expected.grossWallArea, accuracy: 1e-9)
        XCTAssertEqual(mapped.totalOpeningWidth, expected.totalOpeningWidth, accuracy: 1e-9)
        XCTAssertEqual(mapped.totalOpeningArea, expected.totalOpeningArea, accuracy: 1e-9)
        XCTAssertEqual(mapped.walls.count, 4)
        XCTAssertFalse(mapped.ceiling.isVaulted)
        XCTAssertEqual(mapped.ceiling.area ?? -1, expected.floorArea, accuracy: 1e-9)
    }

    func testWall1RotationTranslationLandsOnHandComputedWorldPolygon() throws {
        let mapped = try SurfaceMapper.geometry(from: Self.fullRoomSurfaces)
        let expectedWall1 = [
            Point3(x: 4, y: 0, z: 0),
            Point3(x: 4, y: 3, z: 0),
            Point3(x: 4, y: 3, z: 2.4),
            Point3(x: 4, y: 0, z: 2.4),
        ]
        let actual = mapped.walls[1].polygon.vertices
        XCTAssertEqual(actual.count, expectedWall1.count)
        for (a, e) in zip(actual, expectedWall1) {
            XCTAssertEqual(a.x, e.x, accuracy: 1e-9)
            XCTAssertEqual(a.y, e.y, accuracy: 1e-9)
            XCTAssertEqual(a.z, e.z, accuracy: 1e-9)
        }
    }

    func testOpeningWidthHeightAndWallAssignment() throws {
        let mapped = try SurfaceMapper.geometry(from: Self.fullRoomSurfaces)
        let door = try XCTUnwrap(mapped.openings.first { $0.kind == .door })
        let window = try XCTUnwrap(mapped.openings.first { $0.kind == .window })

        XCTAssertEqual(door.width, 0.9, accuracy: 1e-9)
        XCTAssertEqual(door.height, 2.0, accuracy: 1e-9)
        XCTAssertEqual(door.wallIndex, 0)   // via explicit parentWallIndex

        XCTAssertEqual(window.width, 1.2, accuracy: 1e-9)
        XCTAssertEqual(window.height, 1.5, accuracy: 1e-9)
        XCTAssertEqual(window.wallIndex, 1)   // via nearest-wall-by-centroid fallback
    }

    func testNoFloorThrows() {
        let surfacesWithoutFloor = Self.fullRoomSurfaces.filter { $0.category != .floor }
        XCTAssertThrowsError(try SurfaceMapper.geometry(from: surfacesWithoutFloor)) { error in
            XCTAssertEqual(error as? MappingError, .noFloor)
        }
    }

    func testNoWallsThrows() {
        let surfacesWithoutWalls = Self.fullRoomSurfaces.filter { $0.category != .wall }
        XCTAssertThrowsError(try SurfaceMapper.geometry(from: surfacesWithoutWalls)) { error in
            XCTAssertEqual(error as? MappingError, .noWalls)
        }
    }

    /// RoomPlan sensor noise: two wall-top vertices that should be exactly level (both
    /// meant to be 2.4m) arrive as 2.4003 and 2.3997. Without quantization these would
    /// register as 3 distinct heights on wall0 (0, 2.3997, 2.4003) and flip the gable
    /// heuristic. After 5mm quantization both collapse to 2.400 and the room reads flat.
    func testSensorNoiseHeightsAreQuantizedBeforeCeilingDerivation() throws {
        let noisyWall0 = SurfaceDTO(
            category: .wall,
            corners: [
                Point3(x: 0, y: 0, z: 0),
                Point3(x: 4, y: 0.0003, z: 0),      // world y = 0.0003 noise near 0
                Point3(x: 4, y: 2.3997, z: 0),
                Point3(x: 0, y: 2.4003, z: 0),
            ],
            transform: .identity
        )
        let surfaces = [Self.floorSurface, noisyWall0, Self.wall1Surface, Self.wall2Surface, Self.wall3Surface]

        let mapped = try SurfaceMapper.geometry(from: surfaces)

        // Quantized to the nearest 5mm grid: 0.0003 → 0.000, 2.3997/2.4003 → 2.400.
        let heights = Set(mapped.walls[0].polygon.vertices.map { ($0.z / 0.005).rounded() * 0.005 })
        XCTAssertEqual(mapped.walls[0].polygon.vertices.map(\.z).sorted(), [0.0, 0.0, 2.4, 2.4], accuracy: 1e-9)
        XCTAssertEqual(heights, [0.0, 2.4])
        XCTAssertFalse(mapped.ceiling.isVaulted)
        XCTAssertEqual(mapped.ceiling.provenance, "derived_flat_from_floor")
    }

    // MARK: - Transform4(columnMajor:) transpose (pins the simd column-major fixture)

    func testColumnMajorInitTransposesIntoRowMajorStorage() {
        // simd_float4x4-style columns: columns.0 = (1,0,0,0), columns.1 = (0,2,0,0),
        // columns.2 = (0,0,3,0), columns.3 = (4,5,6,1) — an asymmetric scale+translate
        // matrix chosen so a transpose bug (row/col swap) is unmistakable.
        let columns: [[Double]] = [
            [1, 0, 0, 0],
            [0, 2, 0, 0],
            [0, 0, 3, 0],
            [4, 5, 6, 1],
        ]
        let t = Transform4(columnMajor: columns)

        XCTAssertEqual(t.m, [
            [1, 0, 0, 4],
            [0, 2, 0, 5],
            [0, 0, 3, 6],
            [0, 0, 0, 1],
        ])

        let p = t.apply(Point3(x: 1, y: 1, z: 1))
        XCTAssertEqual(p.x, 5, accuracy: 1e-9)
        XCTAssertEqual(p.y, 7, accuracy: 1e-9)
        XCTAssertEqual(p.z, 9, accuracy: 1e-9)
    }
}

private func XCTAssertEqual(
    _ expression1: [Double],
    _ expression2: [Double],
    accuracy: Double,
    file: StaticString = #filePath,
    line: UInt = #line
) {
    XCTAssertEqual(expression1.count, expression2.count, file: file, line: line)
    for (a, b) in zip(expression1, expression2) {
        XCTAssertEqual(a, b, accuracy: accuracy, file: file, line: line)
    }
}
