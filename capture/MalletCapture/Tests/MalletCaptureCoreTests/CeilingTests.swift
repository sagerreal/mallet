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
}
