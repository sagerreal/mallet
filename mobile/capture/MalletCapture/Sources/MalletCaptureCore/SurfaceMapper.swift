import Foundation

/// Failure modes for `SurfaceMapper.geometry(from:)`. A capture missing a floor or any
/// walls is a failed scan — surfaced to the caller, never defaulted or swallowed.
public enum MappingError: Error, Equatable {
    case noFloor
    case noWalls
}

/// Maps layer-1 `SurfaceDTO`s (RoomPlan's local-space surfaces + transforms) into the
/// trade-neutral layer-2 `NormalizedGeometry` model. Every piece of RoomPlan
/// interpretation lives here — the RoomPlan target itself only extracts Apple types
/// and is deliberately too thin to need iOS-only tests.
public enum SurfaceMapper {

    public static func geometry(from surfaces: [SurfaceDTO]) throws -> NormalizedGeometry {
        guard let floorSurface = surfaces.first(where: { $0.category == .floor }) else {
            throw MappingError.noFloor
        }
        let wallSurfaces = surfaces.filter { $0.category == .wall }
        guard !wallSurfaces.isEmpty else { throw MappingError.noWalls }

        // RoomPlan sensor noise (near-equal but not-quite-equal vertex heights on what
        // should be a level wall top) is handled downstream by `CeilingEstimate`'s
        // tolerance-based height clustering, NOT by quantizing vertices here — a fixed
        // grid-snap would corrupt the very vertices areas are computed from, and still
        // mis-cluster two noisy heights that straddle a grid boundary.
        let floorPolygon = Polygon3(vertices: worldVertices(of: floorSurface))
        let walls = wallSurfaces.map { surface in
            WallGeometry(polygon: Polygon3(vertices: worldVertices(of: surface)))
        }
        let wallCentroids = walls.map { centroid(of: $0.polygon.vertices) }

        let openingSurfaces = surfaces.filter { [.door, .window, .opening].contains($0.category) }
        let openings = openingSurfaces.map { surface -> Opening in
            let worldCorners = worldVertices(of: surface)
            let xs = worldCorners.map(\.x), ys = worldCorners.map(\.y), zs = worldCorners.map(\.z)
            // Width = horizontal extent within the wall plane (a straight-line
            // bounding diagonal across x/y is exact here since an opening's corners
            // vary along a single horizontal direction). Height = extent along the
            // height axis (z, after the remap below).
            let width = hypot((xs.max() ?? 0) - (xs.min() ?? 0), (ys.max() ?? 0) - (ys.min() ?? 0))
            let height = (zs.max() ?? 0) - (zs.min() ?? 0)

            let wallIndex: Int?
            if let parent = surface.parentWallIndex, walls.indices.contains(parent) {
                wallIndex = parent
            } else {
                wallIndex = nearestWallIndex(to: centroid(of: worldCorners), among: wallCentroids)
            }

            return Opening(kind: openingKind(for: surface.category), width: width, height: height, wallIndex: wallIndex)
        }

        let ceiling = CeilingEstimate.derive(floorPolygon: floorPolygon, walls: walls)

        return NormalizedGeometry(floorPolygon: floorPolygon, walls: walls, openings: openings, ceiling: ceiling)
    }

    /// Applies the surface's local→world transform to its local corners, then remaps
    /// RoomPlan's Y-up world axes into Core's convention (x/y horizontal, z = height —
    /// the convention `CeilingEstimate` and the Task-3 fixtures already assume):
    /// RoomPlan world (wx, wy, wz) → Core Point3(x: wx, y: -wz, z: wy).
    private static func worldVertices(of surface: SurfaceDTO) -> [Point3] {
        effectiveLocalCorners(of: surface).map { local in
            let world = surface.transform.apply(local)
            return Point3(x: world.x, y: -world.z, z: world.y)
        }
    }

    /// RoomPlan's `polygonCorners` is routinely EMPTY for wall (and sometimes opening)
    /// surfaces on real devices — a Jul 29 2026 on-device scan returned 14 of 15 walls with
    /// no corners. When that happens, fall back to a rectangle synthesized from the
    /// surface's `dimensions`, centered at the local origin in the local x (width) /
    /// y (height) plane at z = 0 — exactly the plane RoomPlan's own polygon corners live
    /// in, so the local→world transform applies unchanged. A degenerate polygon with no
    /// usable dimensions passes through as-is; the server's derivation marks the room
    /// needs_confirm rather than guessing.
    private static func effectiveLocalCorners(of surface: SurfaceDTO) -> [Point3] {
        if surface.corners.count >= 3 { return surface.corners }
        guard let d = surface.dimensions, d.x > 0, d.y > 0 else { return surface.corners }
        let hw = d.x / 2, hh = d.y / 2
        return [
            Point3(x: -hw, y: -hh, z: 0),
            Point3(x: hw, y: -hh, z: 0),
            Point3(x: hw, y: hh, z: 0),
            Point3(x: -hw, y: hh, z: 0),
        ]
    }

    private static func centroid(of vertices: [Point3]) -> Point3 {
        guard !vertices.isEmpty else { return Point3(x: 0, y: 0, z: 0) }
        let n = Double(vertices.count)
        let sum = vertices.reduce(Point3(x: 0, y: 0, z: 0)) {
            Point3(x: $0.x + $1.x, y: $0.y + $1.y, z: $0.z + $1.z)
        }
        return Point3(x: sum.x / n, y: sum.y / n, z: sum.z / n)
    }

    private static func nearestWallIndex(to point: Point3, among centroids: [Point3]) -> Int? {
        guard !centroids.isEmpty else { return nil }
        return centroids.indices.min { point.distance(to: centroids[$0]) < point.distance(to: centroids[$1]) }
    }

    private static func openingKind(for category: SurfaceCategory) -> OpeningKind {
        switch category {
        case .door: return .door
        case .window: return .window
        default: return .opening
        }
    }
}
