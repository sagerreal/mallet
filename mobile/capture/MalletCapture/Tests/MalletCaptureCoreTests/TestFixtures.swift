import Foundation
@testable import MalletCaptureCore

/// Shared test-fixture builders reused across Tasks 3, 4, and 5.
enum TestFixtures {
    /// Builds a simple rectangular room `w` (x-extent) × `d` (y-extent) × `h` (wall height),
    /// with the floor polygon at z = 0 (vertices ordered counter-clockwise when viewed from
    /// above, i.e. looking down the -z axis) and four vertical wall polygons — one per edge
    /// of the floor, in edge order (wall 0 = edge from floor vertex 0 to vertex 1, etc.).
    static func rectRoom(
        w: Double,
        d: Double,
        h: Double,
        openings: [Opening]
    ) throws -> NormalizedGeometry {
        let floorVertices = [
            Point3(x: 0, y: 0, z: 0),
            Point3(x: w, y: 0, z: 0),
            Point3(x: w, y: d, z: 0),
            Point3(x: 0, y: d, z: 0),
        ]
        let floorPolygon = Polygon3(vertices: floorVertices)

        var walls: [WallGeometry] = []
        for i in 0..<floorVertices.count {
            let a = floorVertices[i]
            let b = floorVertices[(i + 1) % floorVertices.count]
            let wallVertices = [
                a,
                b,
                Point3(x: b.x, y: b.y, z: h),
                Point3(x: a.x, y: a.y, z: h),
            ]
            walls.append(WallGeometry(polygon: Polygon3(vertices: wallVertices)))
        }

        let ceiling = CeilingEstimate(
            area: w * d,
            isVaulted: false,
            wallTopSpread: 0,
            provenance: "derived_flat_from_floor"
        )

        return NormalizedGeometry(
            floorPolygon: floorPolygon,
            walls: walls,
            openings: openings,
            ceiling: ceiling
        )
    }
}
