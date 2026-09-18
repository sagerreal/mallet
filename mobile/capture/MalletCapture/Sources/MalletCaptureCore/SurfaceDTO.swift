/// The kind of RoomPlan surface a `SurfaceDTO` was extracted from.
public enum SurfaceCategory: String, Codable, Sendable {
    case floor, wall, door, window, opening
}

/// A layer-1 surface payload: local-space polygon corners plus the local→world
/// transform, extracted verbatim from RoomPlan's `CapturedRoom.Surface` (or a fixture
/// standing in for one on macOS). ALL mapping/interpretation logic lives in
/// `SurfaceMapper`, never here — this type only carries data.
public struct SurfaceDTO: Codable, Sendable {
    public var category: SurfaceCategory
    /// Surface-LOCAL polygon corners (RoomPlan's `polygonCorners`), untransformed.
    public var corners: [Point3]
    /// Local→world transform, in RoomPlan's own (Y-up) world axes — see
    /// `SurfaceMapper.worldVertices` for the remap into Core's convention.
    public var transform: Transform4
    /// Index into the mapped `walls` array this door/window/opening belongs to, when
    /// RoomPlan's `parentIdentifier` was resolvable to a wall. Nil for floors and
    /// walls, or when unresolved — `SurfaceMapper` falls back to nearest-wall-by-
    /// centroid in that case.
    public var parentWallIndex: Int?
    /// RoomPlan's `dimensions` for the surface (x = width, y = height, z = depth), in the
    /// surface's local axes. Carried so `SurfaceMapper` can synthesize a rectangular outline
    /// when RoomPlan returns an EMPTY `polygonCorners` — observed on-device (Jul 29 2026):
    /// 14 of 15 walls in a real scan had no polygon corners at all. Optional so DTOs stored
    /// before this field existed still decode.
    public var dimensions: Point3?

    public init(
        category: SurfaceCategory,
        corners: [Point3],
        transform: Transform4,
        parentWallIndex: Int? = nil,
        dimensions: Point3? = nil
    ) {
        self.category = category
        self.corners = corners
        self.transform = transform
        self.parentWallIndex = parentWallIndex
        self.dimensions = dimensions
    }
}
