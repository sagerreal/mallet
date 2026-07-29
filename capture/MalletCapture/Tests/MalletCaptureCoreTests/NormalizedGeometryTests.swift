import XCTest
@testable import MalletCaptureCore

final class NormalizedGeometryTests: XCTestCase {
    func testRoomTotals() throws {
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4,
            openings: [Opening(kind: .door, width: 0.9, height: 2.0, wallIndex: 0),
                       Opening(kind: .window, width: 1.2, height: 1.5, wallIndex: 1)])
        XCTAssertEqual(g.floorArea, 12.0, accuracy: 1e-9)
        XCTAssertEqual(g.floorPerimeter, 14.0, accuracy: 1e-9)
        XCTAssertEqual(g.grossWallArea, 14.0 * 2.4, accuracy: 1e-9)   // gross: NO deduction
        XCTAssertEqual(g.totalOpeningWidth, 2.1, accuracy: 1e-9)
        XCTAssertEqual(g.totalOpeningArea, 0.9*2.0 + 1.2*1.5, accuracy: 1e-9)
    }

    func testJSONRoundTripSnakeCase() throws {
        let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4, openings: [])
        let data = try g.encodeJSON()
        let s = String(data: data, encoding: .utf8)!
        XCTAssertTrue(s.contains("floor_polygon"))   // snake_case on the wire
        let back = try NormalizedGeometry.decodeJSON(data)
        XCTAssertEqual(back.floorArea, g.floorArea, accuracy: 1e-9)
    }
}
