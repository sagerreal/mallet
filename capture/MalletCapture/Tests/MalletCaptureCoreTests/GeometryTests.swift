import XCTest
@testable import MalletCaptureCore

final class GeometryTests: XCTestCase {
    func testUnitSquareArea() {
        let sq = Polygon3(vertices: [
            Point3(x: 0, y: 0, z: 0), Point3(x: 1, y: 0, z: 0),
            Point3(x: 1, y: 1, z: 0), Point3(x: 0, y: 1, z: 0)])
        XCTAssertEqual(sq.area, 1.0, accuracy: 1e-9)
        XCTAssertEqual(sq.perimeter, 4.0, accuracy: 1e-9)
    }
    func testLShapeAreaNonConvex() {
        // 2×2 square minus 1×1 notch = 3
        let l = Polygon3(vertices: [
            Point3(x: 0, y: 0, z: 0), Point3(x: 2, y: 0, z: 0),
            Point3(x: 2, y: 1, z: 0), Point3(x: 1, y: 1, z: 0),
            Point3(x: 1, y: 2, z: 0), Point3(x: 0, y: 2, z: 0)])
        XCTAssertEqual(l.area, 3.0, accuracy: 1e-9)
    }
    func testTiltedPolygonAreaIsPlaneTrue() {
        // unit square rotated 45° about x — area must still be 1, not its projection
        let s = 0.5.squareRoot()
        let sq = Polygon3(vertices: [
            Point3(x: 0, y: 0, z: 0), Point3(x: 1, y: 0, z: 0),
            Point3(x: 1, y: s, z: s), Point3(x: 0, y: s, z: s)])
        XCTAssertEqual(sq.area, 1.0, accuracy: 1e-9)
    }
    func testDegeneratePolygonAreaZero() {
        XCTAssertEqual(Polygon3(vertices: [Point3(x: 0, y: 0, z: 0), Point3(x: 1, y: 1, z: 1)]).area, 0)
    }
    func testTransformApplyTranslationAndScale() {
        let t = Transform4(m: [[2,0,0,1],[0,2,0,2],[0,0,2,3],[0,0,0,1]])
        let p = t.apply(Point3(x: 1, y: 1, z: 1))
        XCTAssertEqual(p.x, 3); XCTAssertEqual(p.y, 4); XCTAssertEqual(p.z, 5)
    }
}
