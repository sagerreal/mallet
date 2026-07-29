public struct Point3: Codable, Hashable, Sendable {
    public var x, y, z: Double
    public init(x: Double, y: Double, z: Double) { self.x = x; self.y = y; self.z = z }
    func distance(to o: Point3) -> Double {
        ((x-o.x)*(x-o.x) + (y-o.y)*(y-o.y) + (z-o.z)*(z-o.z)).squareRoot()
    }
}

public struct Polygon3: Codable, Sendable {
    public var vertices: [Point3]
    public init(vertices: [Point3]) { self.vertices = vertices }

    /// Newell's method: |Σ vᵢ × vᵢ₊₁| / 2 — plane-true area for any planar polygon.
    public var area: Double {
        guard vertices.count >= 3 else { return 0 }
        var nx = 0.0, ny = 0.0, nz = 0.0
        for i in 0..<vertices.count {
            let a = vertices[i], b = vertices[(i + 1) % vertices.count]
            nx += (a.y - b.y) * (a.z + b.z)
            ny += (a.z - b.z) * (a.x + b.x)
            nz += (a.x - b.x) * (a.y + b.y)
        }
        return (nx*nx + ny*ny + nz*nz).squareRoot() / 2
    }

    public var perimeter: Double {
        guard vertices.count >= 2 else { return 0 }
        return (0..<vertices.count).reduce(0) {
            $0 + vertices[$1].distance(to: vertices[($1 + 1) % vertices.count])
        }
    }
}

public struct Transform4: Codable, Sendable {
    public var m: [[Double]]  // 4×4 row-major
    public init(m: [[Double]]) { precondition(m.count == 4 && m.allSatisfy { $0.count == 4 }); self.m = m }
    public static let identity = Transform4(m: [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]])
    public func apply(_ p: Point3) -> Point3 {
        Point3(x: m[0][0]*p.x + m[0][1]*p.y + m[0][2]*p.z + m[0][3],
               y: m[1][0]*p.x + m[1][1]*p.y + m[1][2]*p.z + m[1][3],
               z: m[2][0]*p.x + m[2][1]*p.y + m[2][2]*p.z + m[2][3])
    }

    /// Builds a Transform4 from 4 COLUMN vectors — the layout `simd_float4x4` uses
    /// (`columns.0` … `columns.3`, each a full column top-to-bottom). Transform4 itself
    /// stores row-major, so this transposes. Kept Core-side (rather than only in the
    /// RoomPlan target's `Transform4(simd:)` convenience init) so the transpose math is
    /// pinned by a macOS-runnable unit test — the RoomPlan target can't be tested here,
    /// and getting this transpose wrong silently corrupts every captured room.
    public init(columnMajor columns: [[Double]]) {
        precondition(columns.count == 4 && columns.allSatisfy { $0.count == 4 })
        var rows = [[Double]](repeating: [Double](repeating: 0, count: 4), count: 4)
        for col in 0..<4 {
            for row in 0..<4 {
                rows[row][col] = columns[col][row]
            }
        }
        self.init(m: rows)
    }
}
