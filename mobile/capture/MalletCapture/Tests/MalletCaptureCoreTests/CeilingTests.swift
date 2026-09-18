import XCTest
@testable import MalletCaptureCore

final class CeilingTests: XCTestCase {
    func testFlatRoomDerivesAreaFromFloor() throws {
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4, openings: [])
        let estimate = CeilingEstimate.derive(floorPolygon: g.floorPolygon, walls: g.walls)
        let area = try XCTUnwrap(estimate.area)
        XCTAssertEqual(area, g.floorPolygon.area, accuracy: 1e-9)
        XCTAssertFalse(estimate.isVaulted)
        XCTAssertEqual(estimate.wallTopSpread, 0, accuracy: 1e-9)
        XCTAssertEqual(estimate.provenance, "derived_flat_from_floor")
    }

    func testOneRaisedWallTopIsFlaggedVaultedWithNoArea() throws {
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4, openings: [])
        var walls = g.walls
        // Raise wall 0's top edge by 0.6m to simulate a vaulted section.
        let raised = walls[0]
        var raisedVertices = raised.polygon.vertices
        for i in raisedVertices.indices where raisedVertices[i].z > 0 {
            raisedVertices[i].z += 0.6
        }
        walls[0] = WallGeometry(polygon: Polygon3(vertices: raisedVertices))

        let estimate = CeilingEstimate.derive(floorPolygon: g.floorPolygon, walls: walls)
        XCTAssertTrue(estimate.isVaulted)
        XCTAssertNil(estimate.area)
        XCTAssertEqual(estimate.wallTopSpread, 0.6, accuracy: 1e-9)
        XCTAssertEqual(estimate.provenance, "vaulted_needs_confirmation")
    }

    /// A wall with a sloped/gabled top edge (two distinct top-vertex heights, all other
    /// walls level) must flip `isVaulted` even though the cross-wall max-height spread
    /// alone could be masked by the midpoint-per-vertex heuristic this replaces.
    func testGabledWallTopIsFlaggedVaultedEvenWithLevelOtherWalls() throws {
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4, openings: [])
        var walls = g.walls
        let gabled = walls[0]
        var gabledVertices = gabled.polygon.vertices
        // Slope the top edge just slightly: one top vertex stays at h, the other rises
        // to h + 0.05 — well under flatnessTolerance (0.15), so the cross-wall spread
        // signal alone would NOT flag this vaulted. This wall now has 3 distinct
        // vertex heights (0, 2.4, 2.45), isolating the gable signal as the sole cause.
        gabledVertices[2].z += 0.05
        walls[0] = WallGeometry(polygon: Polygon3(vertices: gabledVertices))

        let estimate = CeilingEstimate.derive(floorPolygon: g.floorPolygon, walls: walls)
        XCTAssertTrue(estimate.isVaulted)
        XCTAssertNil(estimate.area)
        XCTAssertEqual(estimate.provenance, "vaulted_needs_confirmation")
    }

    /// Two wall-top vertices that are really the same height (RoomPlan sensor noise:
    /// 0.2mm apart in reality) but happen to straddle an arbitrary 5mm grid line
    /// (2.4024 rounds down to 2.400, 2.4026 rounds up to 2.405 under naive fixed-grid
    /// quantization). Tolerance-based clustering — comparing each sorted height only
    /// to its immediate neighbor — merges them correctly regardless of any grid
    /// boundary, so this wall must read as level, not gabled.
    func testNearEqualHeightsStraddlingAGridBoundaryClusterTogetherAsFlat() throws {
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4, openings: [])
        var walls = g.walls
        var vertices = walls[0].polygon.vertices
        vertices[2].z = 2.4024
        vertices[3].z = 2.4026
        walls[0] = WallGeometry(polygon: Polygon3(vertices: vertices))

        let estimate = CeilingEstimate.derive(floorPolygon: g.floorPolygon, walls: walls)
        XCTAssertFalse(estimate.isVaulted)
        let area = try XCTUnwrap(estimate.area)
        XCTAssertEqual(area, g.floorPolygon.area, accuracy: 1e-9)
        XCTAssertEqual(estimate.provenance, "derived_flat_from_floor")
    }

    /// Companion to the straddling-grid-boundary test above: two top-edge vertices on
    /// the SAME wall that are genuinely 60cm apart (a real gable, not sensor noise)
    /// must still be flagged vaulted — tolerance-based clustering must not swallow a
    /// real height difference just because it's more forgiving than the old 1e-6.
    func testGenuinelyDifferentTopHeights60cmApartStayFlaggedVaulted() throws {
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4, openings: [])
        var walls = g.walls
        var vertices = walls[0].polygon.vertices
        vertices[2].z = 3.0   // 0.6m higher than the other top vertex (still 2.4)
        walls[0] = WallGeometry(polygon: Polygon3(vertices: vertices))

        let estimate = CeilingEstimate.derive(floorPolygon: g.floorPolygon, walls: walls)
        XCTAssertTrue(estimate.isVaulted)
        XCTAssertNil(estimate.area)
        XCTAssertEqual(estimate.provenance, "vaulted_needs_confirmation")
    }

    /// A degenerate (zero-extent) wall polygon — every vertex collapsed onto the same
    /// height as the room's other wall tops — must not crash or produce NaN, must not
    /// register as gabled (it has only one distinct height, not more than two), and
    /// must not perturb an otherwise-flat result: its own "top" trivially agrees with
    /// every other level wall.
    func testDegenerateZeroHeightWallDoesNotCrashOrAffectResult() throws {
        let roomHeight = 2.4
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: roomHeight, openings: [])
        var walls = g.walls
        // A wall whose all four vertices sit at the same height as every other wall's
        // top — e.g. a mis-fit RoomPlan wall with no measurable vertical extent.
        let flat = walls[0].polygon.vertices
        let zeroHeightVertices = flat.map { Point3(x: $0.x, y: $0.y, z: roomHeight) }
        walls[0] = WallGeometry(polygon: Polygon3(vertices: zeroHeightVertices))

        let estimate = CeilingEstimate.derive(floorPolygon: g.floorPolygon, walls: walls)
        XCTAssertFalse(estimate.wallTopSpread.isNaN)
        XCTAssertFalse(estimate.isVaulted)
        let area = try XCTUnwrap(estimate.area)
        XCTAssertFalse(area.isNaN)
        XCTAssertEqual(area, g.floorPolygon.area, accuracy: 1e-9)
        XCTAssertEqual(estimate.wallTopSpread, 0, accuracy: 1e-9)
        XCTAssertEqual(estimate.provenance, "derived_flat_from_floor")
    }
}
