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

    public init(
        category: SurfaceCategory,
        corners: [Point3],
        transform: Transform4,
        parentWallIndex: Int? = nil
    ) {
        self.category = category
        self.corners = corners
        self.transform = transform
        self.parentWallIndex = parentWallIndex
    }
}
