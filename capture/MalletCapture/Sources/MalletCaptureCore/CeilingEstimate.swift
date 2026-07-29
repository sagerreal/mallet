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

    /// Derives the ceiling estimate from the floor polygon and the room's wall geometry.
    ///
    /// A wall's "top" vertices are those in the top half of that wall polygon's own
    /// z-range (height axis, per `Point3`/`WallGeometry` convention). The wall-top
    /// spread is the difference between the highest and lowest top-vertex z across
    /// every wall. When that spread exceeds `flatnessTolerance`, the ceiling is flagged
    /// vaulted and no area is derived.
    public static func derive(
        floorPolygon: Polygon3,
        walls: [WallGeometry],
        flatnessTolerance: Double = 0.15
    ) -> CeilingEstimate {
        let topZs: [Double] = walls.flatMap { wall -> [Double] in
            let zs = wall.polygon.vertices.map(\.z)
            guard let zMin = zs.min(), let zMax = zs.max() else { return [] }
            let mid = (zMin + zMax) / 2
            return zs.filter { $0 > mid }
        }

        let spread: Double
        if let topMax = topZs.max(), let topMin = topZs.min() {
            spread = topMax - topMin
        } else {
            spread = 0
        }

        if spread > flatnessTolerance {
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
}
