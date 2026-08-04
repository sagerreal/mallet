# mallet-ios

Two separate iOS apps. They stay separate until the accuracy question below is answered.

| | | |
|---|---|---|
| `shell/` | **Mallet on your phone** | Capacitor + WKWebView pointed at the hosted app. `com.trymallet.app` |
| `scanner/` | **RoomPlan accuracy instrument** | Standalone SwiftUI, measures a room and prints the numbers. `com.trymallet.scanner` |

`mallet-app` is **not modified by any of this**. That is deliberate and worth preserving.

---

## `shell/` — the Capacitor app

### Why it points at a URL instead of bundling the web app

`mallet-app` cannot be statically exported: it has a `middleware.ts` doing Supabase SSR
session refresh on every route, plus route handlers and dynamic public pages. More decisive,
the tRPC client uses a **relative** URL — `"/api/trpc"` in `lib/trpc/provider.tsx` and
`lib/trpc/vanilla.ts`. Bundle the assets locally and that resolves to
`capacitor://localhost/api/trpc`, which 404s. Point the webview at the real origin and every
line of existing code works unchanged, cookies and auth included.

This costs nothing later: the Capacitor JS bridge is injected with a `WKUserScript` at
document-start, which is scoped to the **webview, not the origin**. So
`window.Capacitor.Plugins.RoomPlan.startScan()` will work from `app.trymallet.com`. Remote
`server.url` does not foreclose native plugins — it is how Ionic live-reload works.

Two honest limits: Capacitor's own types mark `server.url` *"not intended for use in
production"*, and App Store review §4.2 rejects pure webview wrappers. Neither matters for a
device demo; both matter the day this stops being one. The §4.2 answer is the native RoomPlan
scan below — spelled out, in reviewer-reply words, in
[docs/app-store-submission.md](docs/app-store-submission.md), along with the archive/upload
commands and every submission-facing setting.

### Setup

Requires Xcode 26.0+ (Capacitor 8 minimum) and an active Apple Developer membership.

```bash
cd shell
npm install          # npm, NOT pnpm — see below
npx cap sync ios
npx cap open ios
```

In Xcode: **Signing & Capabilities → Team**, then run on a device.

### Things that will waste your time if you don't know them

- **Capacitor 8 uses Swift Package Manager, not CocoaPods.** The published docs still say
  CocoaPods. There is no Podfile; dependencies live in `ios/App/CapApp-SPM/Package.swift`, and
  you open `App.xcodeproj` — there is no `.xcworkspace`.
- **Use npm, not pnpm.** `Package.swift` hardcodes `path: "../../../node_modules/@capacitor/…"`.
  pnpm's symlinked layout fights that.
- **`capacitor.config.ts` hard-fails** if TypeScript isn't installed in this package. Hence
  `capacitor.config.json`.
- **`cap sync` overwrites** `ios/App/App/public/` and `ios/App/App/capacitor.config.json` on
  every run. Never hand-edit those. It does **not** touch `Info.plist`, so the settings below
  are safe.
- **Plugin registration is a static manifest,** not runtime class discovery. `packageClassList`
  in the generated `capacitor.config.json` is built by `cap sync` from installed **npm**
  packages. Dropping a `.swift` file into the target registers nothing, and hand-editing that
  JSON gets wiped. Register from a `CAPBridgeViewController` subclass's `capacitorDidLoad()`
  via `bridge?.registerPluginInstance(...)`.
- **Never enable `CapacitorHttp`.** It monkey-patches `fetch` and `XMLHttpRequest`, which
  breaks the tRPC `httpBatchLink` + superjson pipeline.

### What was changed from the generated template, and why

- `Info.plist` — portrait only. Capacitor reads orientation from Info.plist and **ignores**
  `app/manifest.ts`; the template allows landscape and the CSS is phone-portrait-first.
- `Info.plist` — `NSCameraUsageDescription`, added ahead of the RoomPlan work. RoomPlan
  hard-crashes without it. Three more usage strings (microphone, speech recognition, photo
  library) and `ITSAppUsesNonExemptEncryption` were added for submission; the audit of what is
  and isn't reachable — and therefore what must and must not be declared — is in
  [docs/app-store-submission.md](docs/app-store-submission.md).
- `TARGETED_DEVICE_FAMILY` — iPhone only (`"1"`, was the template's `"1,2"`). iPad support
  obliges iPad screenshots and an untested iPad layout in review. Reversible; see the
  submission doc.
- `LaunchScreen.storyboard` — background was `systemBackgroundColor`, which renders **black**
  on a phone in dark mode. Now literal `#FCFBF7`. Mallet is light-only (`color-scheme:light`;
  dark is an explicit `[data-theme]` opt-in), so this is correct in every case.
- `Assets.xcassets/Splash.imageset` — the template ships white; now `#FCFBF7`, so launch reads
  as one continuous surface into the webview instead of a white-then-cream flash.
- `Assets.xcassets/AppIcon` — the Mallet sparkle, from `mallet-app/public/icon-512.png`.
  ⚠️ Xcode wants 1024 and the only source is 512, so this is a 2× upscale. Acceptable for a
  smooth mark with no text; replace with a real 1024 export before submission.
- `capacitor.config.json` — `ios.backgroundColor` (else Capacitor falls back to
  `UIColor.systemBackground`, black in dark mode), `allowsLinkPreview: false`, and
  `Keyboard.resize: "native"` (without it the webview does not resize and the keyboard covers
  the bottom-fixed Ask-Mallet bar).

### Iterating against a local dev server

`server.url` points at production, so web changes need a deploy. To work against your Mac:
set `server.url` to `http://<mac-lan-ip>:3000` with `"cleartext": true`, and run the web app
with `next dev -H 0.0.0.0`.

### Known, accepted

- **Offline is a cold-start splash only.** `server.errorPath` fires on network-layer failures
  during main-frame navigation, so a launch with no signal shows `www/offline.html`. It does
  **not** fire once the SPA has loaded — there is no service worker, so mid-session signal loss
  still breaks. The demo needs live connectivity.
- **`window.open` always leaves the app**, even same-origin — Capacitor's `createWebViewWith`
  hands every one to Safari. Hits the quote preview in `composer/page.tsx` and `sidebar.tsx`.
- **Signup and password reset leave the app** — those emails open in Mail → Safari. Log in
  with an existing account; don't demo signup.

### `MalletRoomScan` — the native room-scan plugin

The native half of the scan bridge. Tapping "Scan room" in Mallet on the phone calls a
Capacitor plugin that presents a full-screen RoomPlan capture screen and hands the result back
to the webview — no App Store round trip, no separate app.

**Files:** `ios/App/App/RoomScanPlugin.swift` (the `CAPPlugin`), `RoomScanViewController.swift`
(the `RoomCaptureView` host + Done/Cancel chrome + coaching label), `MalletViewController.swift`
(registration, see below). Links `capture/MalletCapture` (`MalletCaptureCore` +
`MalletCaptureRoomPlan`) as a local SPM package.

**Contract** (source of truth is `lib/native/room-scan.ts` in `mallet-app`'s
`feat/scan-bridge`, not this repo):
- `available()` resolves `{ available: boolean, reason?: string }`.
- `captureRoom({ roomName: string })` resolves `{ status: "done", rawPayload: string,
  geometry: string, capturedAt: string }` — `rawPayload` is the verbatim `CapturedRoom` JSON,
  `geometry` is the snake_case `NormalizedGeometry` wire format, both encoded as JSON strings
  so they cross the bridge untouched — or `{ status: "cancelled" }`. It rejects on hard errors
  (no LiDAR, no `roomName`, a scan already open, an unrecoverable capture failure).
- All Apple-type interpretation (RoomPlan → surfaces → geometry) happens in
  `MalletCapture`, never in the plugin or the view controller — see `capture/` below.

**Registration is code, not the generated manifest — and that's deliberate.**
`packageClassList` in the generated `capacitor.config.json` is minted by `cap sync` from
installed **npm** packages only. `MalletRoomScan` isn't an npm package (it's a local
`.swift` file + a local SPM package), so it can never appear there, and dropping the file into
the target registers nothing on its own. Instead `MalletViewController` (a
`CAPBridgeViewController` subclass, wired into `Main.storyboard` via `customClass`) overrides
`capacitorDidLoad()` and calls `bridge?.registerPluginInstance(RoomScanPlugin())` directly. This
means `cap sync` can never break plugin registration — it only touches `public/`, the generated
`capacitor.config.json`, and `CapApp-SPM/Package.swift` (see the deployment-target note below),
none of which registration depends on. Verified: running `npm run sync` leaves
`RoomScanPlugin.swift`, `RoomScanViewController.swift`, `MalletViewController.swift`, and
`App.xcodeproj/project.pbxproj` byte-for-byte untouched.

**MalletCapture is a project-level SPM reference, not a `CapApp-SPM` dependency.**
`ios/App/CapApp-SPM/Package.swift` is stamped "DO NOT MODIFY — managed by Capacitor CLI" and is
regenerated by every `cap sync` — anything added there gets silently wiped on the next sync,
and (until this plugin) it pinned `platforms: [.iOS(.v15)]`, below MalletCapture's iOS 17 floor.
So `MalletCapture` is instead added directly to `App.xcodeproj` as an
`XCLocalSwiftPackageReference` (`relativePath = "../../../capture/MalletCapture"`) with
`MalletCaptureCore`/`MalletCaptureRoomPlan` as product dependencies on the `App` target — a
reference `cap sync` never touches because it isn't Capacitor's to manage.

**iOS 17 deployment target — read before assuming this still installs everywhere.**
`App`'s deployment target is now 17.0 (RoomPlan's `polygonCorners` / MalletCapture's floor).
`cap sync` also bumped the generated `CapApp-SPM/Package.swift` from `.iOS(.v15)` to
`.iOS(.v17)` to match — that's an expected, harmless side effect of this change, not something
to revert. The consequence: **the shell app no longer installs on iOS 15 or 16, on any
device** — this isn't scoped to non-LiDAR phones. A non-Pro iPhone still gets the app (it just
sees `available: false` from the plugin and the web hides the Scan-room button); an iPhone
stuck below iOS 17 does not get the app at all.

**Installing to Owen's iPhone once it's reconnected:**

```bash
xcrun devicectl device install app --device 350BF3A6-686B-569D-A3D2-663D3670390F \
  /path/to/DerivedData/App-*/Build/Products/Debug-iphoneos/App.app
```

RoomPlan cannot run in any simulator (no AR, no LiDAR) — the live test is always on-device.

---

## `scanner/` — the RoomPlan accuracy instrument

**It builds.** `project.yml` is the source of truth; the `.xcodeproj` is generated from it and
committed so the repo builds without XcodeGen installed. If you edit `project.yml` (add a file,
change a setting), regenerate:

```bash
cd scanner && xcodegen generate   # xcodegen 2.46
```

To run: open `scanner/MalletScanner.xcodeproj`, set your signing team under **Signing &
Capabilities**, and run on an iPhone Pro (12 Pro or later) or a LiDAR iPad Pro.

RoomPlan itself is iOS 16+, but `polygonCorners` is iOS 17 — and that is the whole point.
`dimensions` is a **bounding box**; every "RoomPlan only makes rectangles" complaint online is
self-inflicted by using it. The app computes wall area **both ways** and shows the percentage
between them, so the difference is visible on a real wall instead of theoretical. In a flat
room they should be close; in a **vaulted or sloped** room the bounding box should be visibly
larger, because it squares off the slope.

The Simulator cannot run this. No AR, no LiDAR — it must be an iPhone Pro (12 Pro or later) or
a LiDAR iPad Pro.

### The validation gate — do this before any more scanning work

**The ten-room validation walk.** Ten real rooms, RoomPlan vs a laser distance meter. For each
room:

1. Scan the room with the instrument.
2. Measure the **same** walls and openings with a laser distance meter.
3. Enter the laser numbers into the app's laser-entry fields.
4. Export `validation-<room>.json` via the share sheet — it combines the scan geometry and the
   laser numbers in one file.

Default convention: laser the room's **longest wall** and its **entry door**. If you measure
something else, say so in the "Which wall (label)" field — the exported `wall_label` is what
lets the offline comparison know which wall/opening the numbers belong to.

A laser meter is accurate to a few millimeters at these ranges — far tighter than the 2% error
band we're measuring, so it settles this cleanly (a tape would too, but the app is built around
typed laser entry, not tape reads).

Published RoomPlan accuracy spans *half an inch* to *37 cm on a 6.45 m wall*: a 30× spread with
zero peer-reviewed measurements. **Nobody has published this number.** Ours will be the real one.

The decision rule, verbatim from the plan:

- error **< 2%** → the scan can be the price basis
- error **> 2%** → the scan is a *draft* the estimator confirms, and the confirm-and-edit step
  becomes the core UX

Either way we ship — but we design differently, so measure first.

Also try to break it deliberately: a blank white wall (this should trip RoomPlan's `lowTexture`
state — **LiDAR does not remove the blank-wall problem**), an unlit room, a room with a large
mirror, and a long scan to see whether it thermally throttles.

Two numbers on the results screen are **derived, not measured**, and are labelled as such in
the app: ceiling area (RoomPlan has no ceiling concept at all — `Surface.Category` has exactly
five cases, and deriving from the floor is wrong for exactly the vaulted rooms worth the most),
and baseboard run (subtracts door widths only, not cased openings).

---

## `capture/` — the MalletCapture package

The real (non-instrument) capture pipeline. A local SPM package, `capture/MalletCapture`,
consumed by `shell/` via a RoomPlan Capacitor plugin — not by `scanner/`, which stays a
standalone accuracy probe.

| Target | Platform | What it is |
|---|---|---|
| `MalletCaptureCore` | iOS 17 + **macOS 14** | All geometry, mapping, coaching copy, and the crash-safe capture store. No RoomPlan import. |
| `MalletCaptureRoomPlan` | iOS 17 only, `#if canImport(RoomPlan)` | A thin adapter: pulls `CapturedRoom.Surface` data out of RoomPlan's Apple types and hands it to Core as plain DTOs. No mapping logic lives here. |

### The port/adapter boundary

All coordinate math, wall/opening derivation, and ceiling estimation lives in
`MalletCaptureCore` and is exercised by `swift test` **on macOS** — no device, no RoomPlan
entitlement, no simulator needed to change or verify this logic. `MalletCaptureRoomPlan` only
extracts RoomPlan's own struct fields (`polygonCorners`, never `dimensions` — same reasoning as
`scanner/`) into `SurfaceDTO` and calls into Core. Because it touches Apple's RoomPlan types it
can't run on macOS; it's compile-checked instead:

```bash
xcodebuild -scheme MalletCapture-Package -destination "generic/platform=iOS" build
```

That split is deliberate: the target that's hard to unit-test (RoomPlan) does as little as
possible, and the target that does the real work (Core) is fully testable without a device.

### Axis convention

Core is **z-up**: `x`/`y` are the horizontal plane, `z` is height. RoomPlan's world space is
**Y-up**. The remap happens once, in `SurfaceMapper.worldVertices(of:)`
(`MalletCaptureCore/SurfaceMapper.swift`):

```swift
// RoomPlan world (wx, wy, wz) → Core Point3(x: wx, y: -wz, z: wy)
```

Everything downstream of the mapper — walls, openings, `CeilingEstimate`'s 5mm height
clustering — assumes z-up. Get this remap backwards and every derived number is silently wrong
in a way no compiler will catch.

### The immutable 2-layer store

`CaptureStore` persists two layers per capture, both immutable once written:

- **Layer 1 — raw** (`raw.json`): the verbatim scanner payload plus capture metadata, exactly
  as it came off-device.
- **Layer 2 — normalized** (`geometry.json`): the trade-neutral `NormalizedGeometry` — floor
  polygon, walls, openings, ceiling — in snake_case JSON.

Per-trade derivation (paint gallons, drywall sheets, flooring waste factor, and so on) is
**layer 3, and it is server-side** — out of this repo entirely. Nothing in `capture/` knows
what trade it's being used for; that's the point of the trade-neutral model.

The store writes atomically to a staging path and renames into place, so a crash mid-write
never leaves a corrupt or partial capture on disk. A filesystem-backed upload queue (a
`.uploaded` marker file per capture) tracks what's already been sent.
