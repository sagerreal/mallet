# MalletCapture — interior capture core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The shell-agnostic `MalletCapture` Swift package — normalized geometry model, immutable capture store, and the RoomPlan interior adapter — plus a buildable scanner instrument for the ten-room laser validation gate.

**Architecture:** Pure-Swift SPM package with two library targets: `MalletCaptureCore` (platform-agnostic geometry math, data model, capture store — unit-tested on macOS with `swift test`) and `MalletCaptureRoomPlan` (iOS-only, a thin extraction layer that flattens Apple's `CapturedRoom` into plain DTOs; every line of mapping logic lives in Core where it is testable). RoomPlan is one adapter behind a port, per the hexagonal pattern used across Mallet. The existing `scanner/` instrument gets a real `.xcodeproj` and links the package, so the item-0 validation walk can happen on Owen's iPhone 17 Pro.

**Tech Stack:** Swift 6.3 / SPM · RoomPlan (iOS 17+ `polygonCorners`) · XCTest on macOS for Core · `xcodebuild` compile-check against `iphoneos` SDK for the RoomPlan target.

**Spec:** `prospecting/research/2026-07-26-measurement-BUILD-PATH.md` (MODULES 1 & 3, order-of-work items 0, 2, 3). Owen overruled rev 3 on Jul 28 2026: we ARE building capture.

## Global Constraints

- **Use `polygonCorners`, never `dimensions`** — `dimensions` is a bounding box; this one line is the difference between a toy and a takeoff.
- **There is no ceiling in RoomPlan** (5 categories: floor/wall/door/window/opening). Ceiling derivation is OUR code and a first-class feature.
- The four RoomPlan instructions (`lowTexture`, `turnOnLight`, `deviceTooHot`, `exceedSceneSizeLimit`) are **UI states, not errors** — normal case for our users.
- **Scan per-room, not whole-house, for v1.** No `StructureBuilder`/MultiRoom.
- **Capture layer is immutable** — raw payload stored verbatim, never written by downstream, never overwritten.
- Normalized geometry is **trade-neutral**: no waste, no rounding, no deductions. Raw AND deducted opening values are never conflated (Xactimate `WOSF` vs `WOSFD`).
- Units: **SI internally** (meters, m²). Imperial is a display concern, out of scope here.
- JSON wire format: `snake_case` keys (matches the web app's ingest expectations later).
- Min deployment iOS 17.0 (`polygonCorners`). The Simulator cannot run RoomPlan; device-only.
- No shell code (Capacitor or SwiftUI app) in this plan — the framework is shell-agnostic by design.
- Repo: `mallet-ios/` (local git, `master`). Commit style: `feat:`/`fix:`/`test:`/`chore:`.

## Not in this plan (separate plans, in dependency order)

1. **Exterior scanner** (ARKit corner-walk, loop-closure QA gate, overhang-corrected heights, relocalization abort) — after this framework exists.
2. **Web ingest + 3-layer data model + confirm-and-edit UI** (mallet-app; migrations are single-writer — needs its own coordinated branch).
3. **Rate-card pricing engine + tiered proposal** (mallet-app, parallel track, no Swift).
4. **Shell decision** (Capacitor plugin vs standalone SwiftUI) — deliberately deferred; blocked on 1 & this plan.
5. **The ten-room validation walk itself** — Owen + laser meter + iPhone 17 Pro; this plan delivers the buildable instrument for it.

---

### Task 1: Package skeleton

**Files:**
- Create: `capture/MalletCapture/Package.swift`
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/Placeholder.swift` (deleted in Task 2)
- Create: `capture/MalletCapture/Tests/MalletCaptureCoreTests/SmokeTests.swift`

**Interfaces:**
- Produces: an SPM package where `swift test` runs Core tests on macOS, and target `MalletCaptureRoomPlan` exists but is empty until Task 6.

- [ ] **Step 1: Write Package.swift**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MalletCapture",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MalletCaptureCore", targets: ["MalletCaptureCore"]),
        .library(name: "MalletCaptureRoomPlan", targets: ["MalletCaptureRoomPlan"]),
    ],
    targets: [
        .target(name: "MalletCaptureCore"),
        .target(
            name: "MalletCaptureRoomPlan",
            dependencies: ["MalletCaptureCore"]
        ),
        .testTarget(name: "MalletCaptureCoreTests", dependencies: ["MalletCaptureCore"]),
    ]
)
```

`MalletCaptureRoomPlan` needs a placeholder source dir too (`Sources/MalletCaptureRoomPlan/Placeholder.swift`, `// filled in Task 6`) or SPM errors.

- [ ] **Step 2: Write the smoke test**

```swift
import XCTest
@testable import MalletCaptureCore

final class SmokeTests: XCTestCase {
    func testPackageBuilds() { XCTAssertTrue(true) }
}
```

- [ ] **Step 3: Run `swift test` from `capture/MalletCapture/` — expect PASS (1 test)**
- [ ] **Step 4: Commit** — `chore(capture): MalletCapture package skeleton, Core tests run on macOS`

---

### Task 2: Geometry primitives — planar polygon math

**Files:**
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/Geometry.swift`
- Delete: `Sources/MalletCaptureCore/Placeholder.swift`
- Test: `capture/MalletCapture/Tests/MalletCaptureCoreTests/GeometryTests.swift`

**Interfaces:**
- Produces:
  - `struct Point3: Codable, Hashable, Sendable { var x, y, z: Double }`
  - `struct Polygon3: Codable, Sendable { var vertices: [Point3] }` with `var area: Double` (Newell's method — correct for any planar polygon in 3D, convex or not), `var perimeter: Double`
  - `struct Transform4 { var m: [[Double]] /* 4x4 row-major */ }` with `func apply(_ p: Point3) -> Point3`

- [ ] **Step 1: Write failing tests**

```swift
import XCTest
@testable import MalletCaptureCore

final class GeometryTests: XCTestCase {
    func testUnitSquareArea() {
        let sq = Polygon3(vertices: [
            Point3(x: 0, y: 0, z: 0), Point3(x: 1, y: 0, z: 0),
            Point3(x: 1, y: 1, z: 0), Point3(x: 0, y: 1, z: 0)])
        XCTAssertEqual(sq.area, 1.0, accuracy: 1e-9)
        XCTAssertEqual(sq.perimeter, 4.0, accuracy: 1e-9)
    }
    func testLShapeAreaNonConvex() {
        // 2×2 square minus 1×1 notch = 3
        let l = Polygon3(vertices: [
            Point3(x: 0, y: 0, z: 0), Point3(x: 2, y: 0, z: 0),
            Point3(x: 2, y: 1, z: 0), Point3(x: 1, y: 1, z: 0),
            Point3(x: 1, y: 2, z: 0), Point3(x: 0, y: 2, z: 0)])
        XCTAssertEqual(l.area, 3.0, accuracy: 1e-9)
    }
    func testTiltedPolygonAreaIsPlaneTrue() {
        // unit square rotated 45° about x — area must still be 1, not its projection
        let s = 0.5.squareRoot()
        let sq = Polygon3(vertices: [
            Point3(x: 0, y: 0, z: 0), Point3(x: 1, y: 0, z: 0),
            Point3(x: 1, y: s, z: s), Point3(x: 0, y: s, z: s)])
        XCTAssertEqual(sq.area, 1.0, accuracy: 1e-9)
    }
    func testDegeneratePolygonAreaZero() {
        XCTAssertEqual(Polygon3(vertices: [Point3(x: 0, y: 0, z: 0), Point3(x: 1, y: 1, z: 1)]).area, 0)
    }
    func testTransformApplyTranslationAndScale() {
        let t = Transform4(m: [[2,0,0,1],[0,2,0,2],[0,0,2,3],[0,0,0,1]])
        let p = t.apply(Point3(x: 1, y: 1, z: 1))
        XCTAssertEqual(p.x, 3); XCTAssertEqual(p.y, 4); XCTAssertEqual(p.z, 5)
    }
}
```

- [ ] **Step 2: Run — expect FAIL (types undefined)**
- [ ] **Step 3: Implement**

```swift
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
}
```

- [ ] **Step 4: Run — expect PASS (5 tests)**
- [ ] **Step 5: Commit** — `feat(capture): planar 3D polygon math (Newell area, perimeter, 4x4 transform)`

---

### Task 3: NormalizedGeometry — the trade-neutral layer-2 model

**Files:**
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/NormalizedGeometry.swift`
- Test: `capture/MalletCapture/Tests/MalletCaptureCoreTests/NormalizedGeometryTests.swift`

**Interfaces:**
- Produces:
  - `enum OpeningKind: String, Codable, Sendable { case door, window, opening }`
  - `struct Opening: Codable, Sendable { var kind: OpeningKind; var width: Double; var height: Double; var area: Double { width * height }; var wallIndex: Int? }`
  - `struct WallGeometry: Codable, Sendable { var polygon: Polygon3; var grossArea: Double { polygon.area } }`
  - `struct NormalizedGeometry: Codable, Sendable` with: `floorPolygon: Polygon3`, `walls: [WallGeometry]`, `openings: [Opening]`, `ceiling: CeilingEstimate`, computed `floorArea`, `grossWallArea` (Σ wall gross — NO deductions), `floorPerimeter`, `totalOpeningWidth`, `totalOpeningArea`
  - JSON via `JSONEncoder` with `.convertToSnakeCase` wrapped in `NormalizedGeometry.encodeJSON()` / `.decodeJSON(_:)`
- Consumes: `Polygon3`, `Point3` from Task 2.

- [ ] **Step 1: Write failing tests** — a 4m × 3m room, 2.4m walls, one 0.9×2.0 door + one 1.2×1.5 window:

```swift
func testRoomTotals() throws {
    let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4,
        openings: [Opening(kind: .door, width: 0.9, height: 2.0, wallIndex: 0),
                   Opening(kind: .window, width: 1.2, height: 1.5, wallIndex: 1)])
    XCTAssertEqual(g.floorArea, 12.0, accuracy: 1e-9)
    XCTAssertEqual(g.floorPerimeter, 14.0, accuracy: 1e-9)
    XCTAssertEqual(g.grossWallArea, 14.0 * 2.4, accuracy: 1e-9)   // gross: NO deduction
    XCTAssertEqual(g.totalOpeningWidth, 2.1, accuracy: 1e-9)
    XCTAssertEqual(g.totalOpeningArea, 0.9*2.0 + 1.2*1.5, accuracy: 1e-9)
}
func testJSONRoundTripSnakeCase() throws {
    let g = try TestFixtures.rectRoom(w: 4, d: 3, h: 2.4, openings: [])
    let data = try g.encodeJSON()
    let s = String(data: data, encoding: .utf8)!
    XCTAssertTrue(s.contains("floor_polygon"))   // snake_case on the wire
    let back = try NormalizedGeometry.decodeJSON(data)
    XCTAssertEqual(back.floorArea, g.floorArea, accuracy: 1e-9)
}
```

`TestFixtures.rectRoom` builds the floor polygon at z=0 and four vertical wall polygons — write it in the test target, it is reused by Tasks 4 and 5.

- [ ] **Step 2: Run — FAIL** · **Step 3: Implement** (model exactly as in Interfaces; `encodeJSON` sets `keyEncodingStrategy = .convertToSnakeCase`, decode mirrors) · **Step 4: Run — PASS** · **Step 5: Commit** — `feat(capture): trade-neutral NormalizedGeometry (gross areas, raw opening schedule, snake_case wire)`

---

### Task 4: Ceiling derivation — flat + vaulted detection

**Files:**
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/CeilingEstimate.swift`
- Test: `capture/MalletCapture/Tests/MalletCaptureCoreTests/CeilingTests.swift`

**Interfaces:**
- Produces:
  - `struct CeilingEstimate: Codable, Sendable { var area: Double?; var isVaulted: Bool; var wallTopSpread: Double; var provenance: String }`
  - `static func derive(floorPolygon: Polygon3, walls: [WallGeometry], flatnessTolerance: Double = 0.15) -> CeilingEstimate`
- Rule (from spec): flat ceiling → `area = floorPolygon.area`, `provenance: "derived_flat_from_floor"`. If the spread between the highest and lowest wall-top vertex exceeds `flatnessTolerance` → `isVaulted = true`, **`area = nil`** and `provenance: "vaulted_needs_confirmation"` — a vaulted ceiling area we cannot yet compute is surfaced for the confirm-and-edit step, never silently approximated (no-silent-fail rule). Full vaulted math comes after the validation gate tells us RoomPlan's real wall-top fidelity.

- [ ] **Step 1: Failing tests** — flat room → `area == floorArea`, `isVaulted == false`; one wall with top vertices 0.6m higher → `isVaulted == true`, `area == nil`, `wallTopSpread ≈ 0.6`.
- [ ] **Step 2: Run — FAIL** · **Step 3: Implement** (wall-top vertex = vertices in the top half of each wall polygon's z-range; spread = max top z − min top z across all walls) · **Step 4: Run — PASS** · **Step 5: Commit** — `feat(capture): ceiling derivation — flat from floor polygon, vaulted flagged for confirm, never silently approximated`

---

### Task 5: CaptureStore — immutable layer-1 persistence + upload queue

**Files:**
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/CaptureStore.swift`
- Test: `capture/MalletCapture/Tests/MalletCaptureCoreTests/CaptureStoreTests.swift`

**Interfaces:**
- Produces:
  - `struct RawCapture: Codable, Sendable { let id: UUID; let capturedAt: Date; let source: String /* "roomplan_v1" */; let roomName: String; let payload: Data /* verbatim */; let schemaVersion: Int }`
  - `final class CaptureStore` (init with a root `URL`; tests use a temp dir):
    - `func save(_ c: RawCapture, geometry: NormalizedGeometry) throws` — writes `<root>/<id>/raw.json` + `<root>/<id>/geometry.json`; **throws `CaptureStoreError.alreadyExists` if the id directory exists** (immutability)
    - `func list() throws -> [CaptureSummary]` (id, capturedAt, roomName, uploaded: Bool) sorted newest-first
    - `func load(_ id: UUID) throws -> (RawCapture, NormalizedGeometry)`
    - `func pendingUploads() throws -> [UUID]` / `func markUploaded(_ id: UUID) throws` (a `.uploaded` marker file — the actual uploader arrives with the web-ingest plan; the queue survives relaunch by construction because it IS the filesystem)
- Consumes: `NormalizedGeometry` (Task 3).

- [ ] **Step 1: Failing tests** — save→load round-trips byte-identical `payload`; second `save` with same id throws `alreadyExists`; `pendingUploads` lists unuploaded only; `markUploaded` removes from pending; `list` sorted newest-first.
- [ ] **Step 2: Run — FAIL** · **Step 3: Implement** (FileManager, atomic writes via `.atomic`) · **Step 4: Run — PASS** · **Step 5: Commit** — `feat(capture): immutable CaptureStore with filesystem-backed upload queue`

---

### Task 6: RoomPlan adapter — thin extraction, tested mapping

**Files:**
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/SurfaceDTO.swift`
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/SurfaceMapper.swift`
- Replace: `capture/MalletCapture/Sources/MalletCaptureRoomPlan/Placeholder.swift` → `RoomPlanAdapter.swift`
- Test: `capture/MalletCapture/Tests/MalletCaptureCoreTests/SurfaceMapperTests.swift`

**Interfaces:**
- Produces (Core — fully tested on macOS):
  - `enum SurfaceCategory: String, Codable, Sendable { case floor, wall, door, window, opening }`
  - `struct SurfaceDTO: Codable, Sendable { var category: SurfaceCategory; var corners: [Point3] /* surface-LOCAL polygonCorners */; var transform: Transform4 /* local→world */ }`
  - `enum SurfaceMapper { static func geometry(from surfaces: [SurfaceDTO]) throws -> NormalizedGeometry }` — applies each surface's transform to its corners (world space), floor → `floorPolygon`, walls → `[WallGeometry]`, door/window/opening → `Opening` (width/height from the transformed polygon's bounding extent in the wall plane; `wallIndex` = nearest wall by centroid distance), ceiling via `CeilingEstimate.derive`. Throws `MappingError.noFloor` / `.noWalls` — a capture with no floor is a failed scan, surfaced not swallowed.
- Produces (RoomPlan target — iOS-only, deliberately too thin to need tests):

```swift
import RoomPlan
import MalletCaptureCore

@available(iOS 17.0, *)
public enum RoomPlanExtractor {
    /// The ONLY code that touches Apple types. polygonCorners, never dimensions.
    public static func surfaces(from room: CapturedRoom) -> [SurfaceDTO] {
        var out: [SurfaceDTO] = []
        for s in room.floors   { out.append(dto(.floor, s)) }
        for s in room.walls    { out.append(dto(.wall, s)) }
        for s in room.doors    { out.append(dto(.door, s)) }
        for s in room.windows  { out.append(dto(.window, s)) }
        for s in room.openings { out.append(dto(.opening, s)) }
        return out
    }
    private static func dto(_ c: SurfaceCategory, _ s: CapturedRoom.Surface) -> SurfaceDTO {
        SurfaceDTO(category: c,
                   corners: s.polygonCorners.map { Point3(x: Double($0.x), y: Double($0.y), z: Double($0.z)) },
                   transform: Transform4(simd: s.transform))
    }
    public static func rawPayload(from room: CapturedRoom) throws -> Data {
        try JSONEncoder().encode(room)   // CapturedRoom is Codable — verbatim layer-1 payload
    }
}
```

  plus a `Transform4(simd: simd_float4x4)` convenience init in the RoomPlan target (simd is column-major — transpose into row-major; get this wrong and every room is garbage, so the Core tests in Step 1 pin a known column-major fixture).
- Consumes: everything from Tasks 2–5.

- [ ] **Step 1: Failing tests (Core)** — build `[SurfaceDTO]` for the 4×3×2.4 fixture room with local-space corners + real transforms (including one wall whose transform is a translation+rotation, with the expected world polygon hand-computed); assert `geometry(from:)` totals match Task 3's expected numbers; assert `noFloor` throws; assert the simd column-major transpose fixture.
- [ ] **Step 2: Run — FAIL** · **Step 3: Implement mapper** · **Step 4: Run — PASS**
- [ ] **Step 5: Compile-check the iOS target**: `xcodebuild -scheme MalletCapture-Package -destination "generic/platform=iOS" build` from `capture/MalletCapture/` — expect BUILD SUCCEEDED (RoomPlan cannot run here, but it must compile).
- [ ] **Step 6: Commit** — `feat(capture): RoomPlan adapter — thin Apple-type extraction, all mapping logic in tested Core`

---

### Task 7: Capture coaching states

**Files:**
- Create: `capture/MalletCapture/Sources/MalletCaptureCore/CaptureCoaching.swift`
- Test: `capture/MalletCapture/Tests/MalletCaptureCoreTests/CaptureCoachingTests.swift`

**Interfaces:**
- Produces: `enum CaptureCoaching: String, Codable, Sendable { case lowTexture, turnOnLight, deviceTooHot, sceneTooLarge }` with `var guidance: String` — copy verbatim from the spec table, functional register:
  - `lowTexture` → `"Blank wall — aim at a corner or an edge and keep moving."`
  - `turnOnLight` → `"Too dark to scan. Turn on the lights or open a door."`
  - `deviceTooHot` → `"Phone is overheating. Pause here — the scan is saved. Let it cool."`
  - `sceneTooLarge` → `"This space is too big for one scan. Finish this room and scan the next separately."`
  - plus (RoomPlan target) `CaptureCoaching(instruction: RoomCaptureSession.Instruction)` failable init mapping Apple's enum.
- [ ] **Steps: test copy + Codable (FAIL→implement→PASS)** · **Commit** — `feat(capture): coaching states — RoomPlan instructions as UI states, not errors`

---

### Task 8: Scanner instrument builds and links the framework

**Files:**
- Create: `scanner/project.yml` (xcodegen spec) — `brew install xcodegen` first; if brew fails, fall back to the README's manual 5-minute Xcode-GUI project creation and commit the resulting `.xcodeproj`
- Modify: `scanner/MalletScanner/RoomMeasurements.swift` — replace its ad-hoc math with `MalletCaptureCore` (`RoomPlanExtractor.surfaces` → `SurfaceMapper.geometry`), keeping its both-ways display (`polygonCorners` area vs `dimensions` bounding box, with % delta — that comparison IS the instrument)
- Modify: `scanner/MalletScanner/ContentView.swift` — add a per-room laser-entry field trio (wall length, wall height, opening w×h as measured by laser) and an export button that writes a `validation-<room>.json` combining scan geometry + laser numbers, shareable via the share sheet — this is the artifact of the ten-room gate

**project.yml:**

```yaml
name: MalletScanner
options: { bundleIdPrefix: com.trymallet, deploymentTarget: { iOS: "17.0" } }
packages:
  MalletCapture: { path: ../capture/MalletCapture }
targets:
  MalletScanner:
    type: application
    platform: iOS
    sources: [MalletScanner]
    dependencies:
      - package: MalletCapture
        products: [MalletCaptureCore, MalletCaptureRoomPlan]
    info:
      path: MalletScanner/Info.plist
      properties:
        NSCameraUsageDescription: "Mallet measures the room with the camera to price the work."
        UISupportedInterfaceOrientations: [UIInterfaceOrientationPortrait]
```

- [ ] **Step 1: `xcodegen generate` in `scanner/`** — expect `MalletScanner.xcodeproj` created
- [ ] **Step 2: Wire the framework into the two modified files**
- [ ] **Step 3: Compile-check**: `xcodebuild -project scanner/MalletScanner.xcodeproj -scheme MalletScanner -destination "generic/platform=iOS" build CODE_SIGNING_ALLOWED=NO` — expect BUILD SUCCEEDED
- [ ] **Step 4: Commit** — `feat(scanner): instrument builds against MalletCapture; laser-entry + JSON export for the ten-room gate`

---

### Task 9: Docs + handoff

**Files:**
- Modify: `README.md` — scanner section: it now builds; the validation-walk procedure (10 rooms, laser meter, export JSONs, the <2% / >2% decision rule from the spec); `capture/` section describing the package and the port/adapter boundary.

- [ ] **Step 1: Write it** · **Step 2: `swift test` one final full run + both xcodebuild compile checks green** · **Step 3: Commit** — `docs: capture framework + validation-gate runbook`

---

## Self-review notes

- Spec coverage: MODULE 1 (polygonCorners ✓ Task 6, ceiling ✓ Task 4, 4 UI states ✓ Task 7, per-room ✓ constraint, port ✓ Task 6, validation gate ✓ Task 8); MODULE 3 layer-1 ✓ Task 5, layer-2 ✓ Task 3 (layer-3 per-trade tables live in the web ingest plan — they are server-side); order-of-work 0 ✓ Task 8, 2 ✓ Tasks 1+5, 3 ✓ Tasks 6+7. Exterior (MODULE 2) and MODULE 4 are explicitly out (separate plans).
- The `wallIndex`-by-centroid heuristic in Task 6 is v1; RoomPlan actually parents openings to walls via `parentIdentifier` — if present in the payload, prefer it (implementer: check `CapturedRoom.Surface.parentIdentifier` first, fall back to centroid).
- Simulator cannot run RoomPlan; nothing in this plan requires a device until the validation walk itself.
