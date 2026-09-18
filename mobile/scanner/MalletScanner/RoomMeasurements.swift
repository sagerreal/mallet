import Foundation
import MalletCaptureCore
import MalletCaptureRoomPlan
import RoomPlan

/// Turns a `CapturedRoom` into the quantities an estimator actually bids from.
///
/// Two things here are the whole point of the demo:
///
/// 1. **Polygon vs bounding box.** All real geometry (`wallAreaSqFt`, `floorAreaSqFt`,
///    `ceilingAreaSqFtDerived`, openings) comes from `MalletCaptureCore` via
///    `RoomPlanExtractor.surfaces` → `SurfaceMapper.geometry` — the same pipeline the real app
///    uses, built on `polygonCorners`, the real outline. `wallAreaBoundingBoxSqFt` is kept purely
///    as a second, INSTRUMENT-ONLY number (`RoomPlanExtractor.boundingBoxWallArea`, `dimensions`
///    width × height) so the gap between the two is visible on a real room instead of
///    theoretical. Never bid from the bounding-box number.
///
/// 2. **There is no ceiling in RoomPlan.** `CapturedRoom.Surface.Category` has exactly five
///    cases: floor, wall, door, window, opening. Ceiling area is a billed line item for painters,
///    so `MalletCaptureCore.CeilingEstimate` derives it from the floor for a flat ceiling and
///    withholds it (never approximates) when the room reads as vaulted.
///
/// RoomPlan and `NormalizedGeometry` work in METRES. Contractors bid in feet. Convert once, here,
/// at the UI boundary.
@available(iOS 17.0, *)
struct RoomMeasurements {
    let wallCount: Int
    /// Wall area from the real polygon outline (`SurfaceMapper.geometry`) — the honest number.
    let wallAreaSqFt: Double
    /// Wall area from the bounding box, for comparison only. Never bid from this.
    let wallAreaBoundingBoxSqFt: Double
    let floorAreaSqFt: Double
    /// Derived, not measured. `nil` when the room reads as vaulted — see `CeilingEstimate`.
    let ceilingAreaSqFtDerived: Double?
    let isVaulted: Bool
    let floorPerimeterFt: Double
    let doors: [Opening]
    let windows: [Opening]
    let otherOpenings: [Opening]
    /// The normalized geometry this view was built from — the source for the JSON export.
    let geometry: NormalizedGeometry

    struct Opening {
        let widthFt: Double
        let heightFt: Double
        var areaSqFt: Double { widthFt * heightFt }
    }

    /// Total width of every door opening. Baseboard does not run across a doorway, so trim
    /// linear feet is perimeter MINUS this — not a multiplier on perimeter.
    var totalDoorWidthFt: Double { doors.reduce(0) { $0 + $1.widthFt } }

    /// Gross wall area minus every opening. Whether a shop actually deducts — and above what size —
    /// is a rate-card decision, not a property of the geometry, so this stays a raw number and the
    /// deduction rule is applied downstream.
    var totalOpeningAreaSqFt: Double {
        (doors + windows + otherOpenings).reduce(0) { $0 + $1.areaSqFt }
    }

    /// Percent difference between the bounding-box wall area and the true polygon wall area —
    /// the number the ten-room walk is validating.
    var boundingBoxDeltaPercent: Double? {
        guard wallAreaBoundingBoxSqFt > 0 else { return nil }
        return (wallAreaBoundingBoxSqFt - wallAreaSqFt) / wallAreaBoundingBoxSqFt * 100
    }
}

// MARK: - Extraction

@available(iOS 17.0, *)
extension RoomMeasurements {
    private static let mToFt = 3.280839895
    private static let sqMToSqFt = 10.763910417

    /// Throws whatever `SurfaceMapper.geometry(from:)` throws (`MappingError.noFloor` /
    /// `.noWalls`) — a capture RoomPlan couldn't resolve into walls and a floor is a failed scan,
    /// surfaced to the caller rather than silently defaulted.
    init(_ room: CapturedRoom) throws {
        let surfaces = RoomPlanExtractor.surfaces(from: room)
        let geometry = try SurfaceMapper.geometry(from: surfaces)
        self.geometry = geometry

        wallCount = geometry.walls.count
        wallAreaSqFt = geometry.grossWallArea * Self.sqMToSqFt
        wallAreaBoundingBoxSqFt = RoomPlanExtractor.boundingBoxWallArea(from: room) * Self.sqMToSqFt
        floorAreaSqFt = geometry.floorArea * Self.sqMToSqFt
        ceilingAreaSqFtDerived = geometry.ceiling.area.map { $0 * Self.sqMToSqFt }
        isVaulted = geometry.ceiling.isVaulted
        floorPerimeterFt = geometry.floorPerimeter * Self.mToFt

        func openings(of kind: OpeningKind) -> [Opening] {
            geometry.openings
                .filter { $0.kind == kind }
                .map { Opening(widthFt: $0.width * Self.mToFt, heightFt: $0.height * Self.mToFt) }
        }
        doors = openings(of: .door)
        windows = openings(of: .window)
        otherOpenings = openings(of: .opening)
    }
}
