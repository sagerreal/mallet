#if canImport(RoomPlan)
import Foundation
import RoomPlan
import simd
import MalletCaptureCore

@available(iOS 17.0, *)
public enum RoomPlanExtractor {
    /// The ONLY code that touches Apple types. polygonCorners, never dimensions.
    public static func surfaces(from room: CapturedRoom) -> [SurfaceDTO] {
        // Maps each wall's identifier to its position in `room.walls` so door/window/
        // opening surfaces can resolve `parentIdentifier` → `parentWallIndex`. All
        // interpretation of that mapping (vs. falling back to nearest-wall-by-
        // centroid) lives in MalletCaptureCore's SurfaceMapper, never here.
        let wallIndexByIdentifier: [UUID: Int] = Dictionary(
            room.walls.enumerated().map { ($1.identifier, $0) },
            uniquingKeysWith: { first, _ in first }
        )

        var out: [SurfaceDTO] = []
        for s in room.floors   { out.append(dto(.floor, s, wallIndexByIdentifier)) }
        for s in room.walls    { out.append(dto(.wall, s, wallIndexByIdentifier)) }
        for s in room.doors    { out.append(dto(.door, s, wallIndexByIdentifier)) }
        for s in room.windows  { out.append(dto(.window, s, wallIndexByIdentifier)) }
        for s in room.openings { out.append(dto(.opening, s, wallIndexByIdentifier)) }
        return out
    }

    private static func dto(
        _ c: SurfaceCategory,
        _ s: CapturedRoom.Surface,
        _ wallIndexByIdentifier: [UUID: Int]
    ) -> SurfaceDTO {
        SurfaceDTO(category: c,
                   corners: s.polygonCorners.map { Point3(x: Double($0.x), y: Double($0.y), z: Double($0.z)) },
                   transform: Transform4(simd: s.transform),
                   parentWallIndex: s.parentIdentifier.flatMap { wallIndexByIdentifier[$0] })
    }

    public static func rawPayload(from room: CapturedRoom) throws -> Data {
        try JSONEncoder().encode(room)   // CapturedRoom is Codable — verbatim layer-1 payload
    }
}

@available(iOS 17.0, *)
extension CaptureCoaching {
    /// Maps a RoomPlan `RoomCaptureSession.Instruction` to a `CaptureCoaching` state if the
    /// instruction is a user-facing coaching hint (not a transient motion hint). Returns `nil`
    /// for transient hints like `.normal`, `.moveCloseToWall`, `.moveAwayFromWall`, `.slowDown`.
    public init?(instruction: RoomCaptureSession.Instruction) {
        switch instruction {
        case .lowTexture:
            self = .lowTexture
        case .turnOnLight:
            self = .turnOnLight
        case .normal, .moveCloseToWall, .moveAwayFromWall, .slowDown:
            return nil
        @unknown default:
            return nil
        }
    }
}

@available(iOS 17.0, *)
extension Transform4 {
    /// `simd_float4x4` is column-major (`columns.0` … `columns.3`, each a full column
    /// top-to-bottom); `Transform4` stores row-major. Delegates to the Core-side
    /// `Transform4(columnMajor:)` transpose, which IS pinned by a macOS-runnable unit
    /// test — this target cannot be tested on macOS, so no transpose logic lives here.
    public init(simd m: simd_float4x4) {
        self.init(columnMajor: [
            [Double(m.columns.0.x), Double(m.columns.0.y), Double(m.columns.0.z), Double(m.columns.0.w)],
            [Double(m.columns.1.x), Double(m.columns.1.y), Double(m.columns.1.z), Double(m.columns.1.w)],
            [Double(m.columns.2.x), Double(m.columns.2.y), Double(m.columns.2.z), Double(m.columns.2.w)],
            [Double(m.columns.3.x), Double(m.columns.3.y), Double(m.columns.3.z), Double(m.columns.3.w)],
        ])
    }
}
#endif
