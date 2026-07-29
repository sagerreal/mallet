import Foundation

/// The ceiling area for a room, derived either directly from the floor polygon (flat
/// ceiling — the common case) or flagged as vaulted when wall-top heights disagree by
/// more than `flatnessTolerance`. A vaulted ceiling's true area is never approximated:
/// per the no-silent-fail rule, `area` is left `nil` and surfaced for confirm-and-edit
/// until full vaulted math ships (blocked on RoomPlan wall-top-fidelity validation).
public struct CeilingEstimate: Codable, Sendable {
    public var area: Double?
    public var isVaulted: Bool
    public var wallTopSpread: Double
    public var provenance: String

    public init(area: Double?, isVaulted: Bool, wallTopSpread: Double, provenance: String) {
        self.area = area
        self.isVaulted = isVaulted
        self.wallTopSpread = wallTopSpread
        self.provenance = provenance
    }

    /// Tolerance (in the same units as `Point3.z`) below which two vertex heights are
    /// treated as equal — used only to collapse floating-point noise, never to widen
    /// the flatness judgement itself.
    private static let heightEqualityTolerance = 1e-6

    /// Derives the ceiling estimate from the floor polygon and the room's wall geometry.
    ///
    /// Two topology-free signals feed the vaulted decision, deliberately avoiding any
    /// per-vertex "top half" heuristic (which under-counts the low-side top vertex of a
    /// sloped wall edge and can silently shrink the measured spread):
    ///
    /// 1. **Cross-wall signal** — each wall's own top height is `max(z)` over its
    ///    vertices; `wallTopSpread` is the max-minus-min of those per-wall top heights
    ///    across every wall. This needs no vertex classification at all.
    /// 2. **Single-wall gable signal** — a wall whose top edge is level has exactly two
    ///    distinct vertex heights and four vertices (the rectangular case RoomPlan
    ///    normally produces). A wall with more than four vertices, or with vertex
    ///    heights taking more than two distinct values, has a sloped/gabled top edge
    ///    and is flagged vaulted outright, regardless of `wallTopSpread`.
    ///
    /// Either signal tripping is enough to flag `isVaulted` and withhold `area` — a
    /// vaulted ceiling's true area is never approximated (no-silent-fail rule).
    public static func derive(
        floorPolygon: Polygon3,
        walls: [WallGeometry],
        flatnessTolerance: Double = 0.15
    ) -> CeilingEstimate {
        let topHeights: [Double] = walls.compactMap { $0.polygon.vertices.map(\.z).max() }

        let spread: Double
        if let topMax = topHeights.max(), let topMin = topHeights.min() {
            spread = topMax - topMin
        } else {
            spread = 0
        }

        let anyGabledWall = walls.contains { isGabled($0) }

        if spread > flatnessTolerance || anyGabledWall {
            return CeilingEstimate(
                area: nil,
                isVaulted: true,
                wallTopSpread: spread,
                provenance: "vaulted_needs_confirmation"
            )
        }

        return CeilingEstimate(
            area: floorPolygon.area,
            isVaulted: false,
            wallTopSpread: spread,
            provenance: "derived_flat_from_floor"
        )
    }

    /// A wall is gabled (non-level top edge) when it has more than four vertices, or
    /// when its vertex heights take more than two distinct values beyond
    /// `heightEqualityTolerance`. A degenerate wall (fewer than 2 vertices, or all
    /// vertices at the same height) is never gabled.
    private static func isGabled(_ wall: WallGeometry) -> Bool {
        let vertices = wall.polygon.vertices
        guard vertices.count > 2 else { return false }
        if vertices.count > 4 { return true }

        let sortedZs = vertices.map(\.z).sorted()
        var distinctZs: [Double] = []
        for z in sortedZs {
            if let last = distinctZs.last, abs(z - last) <= heightEqualityTolerance {
                continue
            }
            distinctZs.append(z)
        }
        return distinctZs.count > 2
    }
}
