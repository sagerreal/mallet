import Foundation
import RoomPlan
import simd

/// Turns a `CapturedRoom` into the quantities an estimator actually bids from.
///
/// Two things here are the whole point of the demo:
///
/// 1. **`polygonCorners` vs `dimensions`.** `dimensions` is a BOUNDING BOX — it is why the internet
///    says "RoomPlan only makes rectangles". `polygonCorners` (iOS 17) is the real outline and is
///    what represents non-uniform wall heights, i.e. vaulted and sloped ceilings. We compute both
///    and show them side by side so the difference is visible on a real room instead of theoretical.
///
/// 2. **There is no ceiling in RoomPlan.** `CapturedRoom.Surface.Category` has exactly five cases:
///    floor, wall, door, window, opening. Ceiling area is a billed line item for painters, so we
///    derive it — and we mark it as derived, because deriving it from the floor is correct only for
///    a flat ceiling and wrong for exactly the vaulted rooms that are worth the most.
///
/// RoomPlan works in METRES. Contractors bid in feet. Convert once, here, at the boundary.
struct RoomMeasurements {
    let wallCount: Int
    /// Wall area from `polygonCorners` — the honest number.
    let wallAreaSqFt: Double
    /// Wall area from the bounding box, for comparison only. Never bid from this.
    let wallAreaBoundingBoxSqFt: Double
    let floorAreaSqFt: Double
    /// Derived, not measured. True only for a flat ceiling.
    let ceilingAreaSqFtDerived: Double
    let floorPerimeterFt: Double
    let doors: [Opening]
    let windows: [Opening]
    let otherOpenings: [Opening]
    /// True when the device gave us real outlines. On iOS 16 we only have bounding boxes.
    let hasPolygonData: Bool

    struct Opening {
        let widthFt: Double
        let heightFt: Double
        var areaSqFt: Double { widthFt * heightFt }
    }

    /// Total width of every opening in a wall. Baseboard does not run across a doorway, so trim
    /// linear feet is perimeter MINUS this — not a multiplier on perimeter.
    var totalDoorWidthFt: Double { doors.reduce(0) { $0 + $1.widthFt } }

    /// Gross wall area minus every opening. Whether a shop actually deducts — and above what size —
    /// is a rate-card decision, not a property of the geometry, so this stays a raw number and the
    /// deduction rule is applied downstream.
    var totalOpeningAreaSqFt: Double {
        (doors + windows + otherOpenings).reduce(0) { $0 + $1.areaSqFt }
    }
}

// MARK: - Extraction

extension RoomMeasurements {
    init(_ room: CapturedRoom) {
        let polygonsAvailable: Bool
        if #available(iOS 17.0, *) {
            polygonsAvailable = room.walls.contains { !$0.polygonCorners.isEmpty }
        } else {
            polygonsAvailable = false
        }
        hasPolygonData = polygonsAvailable

        wallCount = room.walls.count

        // Bounding-box area: width × height per wall. This is the naive read.
        let bboxSqM = room.walls.reduce(0.0) { total, wall in
            total + Double(wall.dimensions.x * wall.dimensions.y)
        }
        wallAreaBoundingBoxSqFt = bboxSqM * Self.sqMToSqFt

        // Polygon area: the true outline, which captures a sloped wall top. Falls back to the
        // bounding box on iOS 16 or when a wall has no polygon.
        let polySqM = room.walls.reduce(0.0) { total, wall in
            total + Self.surfaceAreaSqM(wall)
        }
        wallAreaSqFt = polySqM * Self.sqMToSqFt

        let floorSqM = room.floors.reduce(0.0) { $0 + Self.surfaceAreaSqM($1) }
        floorAreaSqFt = floorSqM * Self.sqMToSqFt

        // Derived — see the type doc. Correct for flat ceilings only.
        ceilingAreaSqFtDerived = floorAreaSqFt

        floorPerimeterFt = room.floors.reduce(0.0) { $0 + Self.perimeterM($1) } * Self.mToFt

        doors = room.doors.map(Self.opening)
        windows = room.windows.map(Self.opening)
        otherOpenings = room.openings.map(Self.opening)
    }

    private static let mToFt = 3.280839895
    private static let sqMToSqFt = 10.763910417

    private static func opening(_ surface: CapturedRoom.Surface) -> Opening {
        Opening(
            widthFt: Double(surface.dimensions.x) * mToFt,
            heightFt: Double(surface.dimensions.y) * mToFt
        )
    }

    /// Area of a surface in square metres, preferring the real polygon over the bounding box.
    private static func surfaceAreaSqM(_ surface: CapturedRoom.Surface) -> Double {
        if #available(iOS 17.0, *) {
            let corners = surface.polygonCorners
            if corners.count >= 3 { return polygonAreaSqM(corners) }
        }
        return Double(surface.dimensions.x * surface.dimensions.y)
    }

    private static func perimeterM(_ surface: CapturedRoom.Surface) -> Double {
        if #available(iOS 17.0, *) {
            let corners = surface.polygonCorners
            if corners.count >= 3 {
                var total = 0.0
                for i in corners.indices {
                    let a = corners[i]
                    let b = corners[(i + 1) % corners.count]
                    total += Double(simd_distance(a, b))
                }
                return total
            }
        }
        // Bounding-box fallback: treat the floor as a rectangle.
        return Double(2 * (surface.dimensions.x + surface.dimensions.y))
    }

    /// Area of an arbitrary planar polygon in 3D, via Newell's method.
    ///
    /// Deliberately NOT a 2D shoelace on a hardcoded axis pair: `polygonCorners` lies in the
    /// surface's own local plane, and a wall's plane and a floor's plane do not use the same two
    /// axes. Summing the edge cross-products gives a vector whose length is twice the area,
    /// whatever the plane's orientation — so this is correct for walls, floors, and anything else
    /// without special-casing.
    private static func polygonAreaSqM(_ corners: [simd_float3]) -> Double {
        var cross = simd_float3(repeating: 0)
        for i in corners.indices {
            let a = corners[i]
            let b = corners[(i + 1) % corners.count]
            cross += simd_cross(a, b)
        }
        return Double(simd_length(cross)) / 2.0
    }
}
