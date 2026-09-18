import Foundation

/// The kind of aperture cut into a wall.
public enum OpeningKind: String, Codable, Sendable {
    case door
    case window
    case opening
}

/// A single aperture (door, window, or generic opening) in the room, as a raw schedule
/// entry — no deduction logic lives here.
public struct Opening: Codable, Sendable {
    public var kind: OpeningKind
    public var width: Double
    public var height: Double
    public var wallIndex: Int?

    public var area: Double { width * height }

    private enum CodingKeys: String, CodingKey {
        case kind, width, height, wallIndex
    }

    public init(kind: OpeningKind, width: Double, height: Double, wallIndex: Int? = nil) {
        self.kind = kind
        self.width = width
        self.height = height
        self.wallIndex = wallIndex
    }
}

/// A single wall's 3D footprint, reported as a gross area with no opening deductions.
public struct WallGeometry: Codable, Sendable {
    public var polygon: Polygon3

    public var grossArea: Double { polygon.area }

    public init(polygon: Polygon3) {
        self.polygon = polygon
    }
}

/// The trade-neutral layer-2 model: raw floor/wall/opening/ceiling geometry with no
/// trade-specific interpretation (e.g. no opening deductions from wall area).
public struct NormalizedGeometry: Codable, Sendable {
    public var floorPolygon: Polygon3
    public var walls: [WallGeometry]
    public var openings: [Opening]
    public var ceiling: CeilingEstimate

    public init(
        floorPolygon: Polygon3,
        walls: [WallGeometry],
        openings: [Opening],
        ceiling: CeilingEstimate
    ) {
        self.floorPolygon = floorPolygon
        self.walls = walls
        self.openings = openings
        self.ceiling = ceiling
    }

    public var floorArea: Double { floorPolygon.area }

    public var floorPerimeter: Double { floorPolygon.perimeter }

    /// Sum of every wall's gross area — NO opening deductions.
    public var grossWallArea: Double { walls.reduce(0) { $0 + $1.grossArea } }

    public var totalOpeningWidth: Double { openings.reduce(0) { $0 + $1.width } }

    public var totalOpeningArea: Double { openings.reduce(0) { $0 + $1.area } }

    public func encodeJSON() throws -> Data {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    public static func decodeJSON(_ data: Data) throws -> NormalizedGeometry {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(NormalizedGeometry.self, from: data)
    }
}
