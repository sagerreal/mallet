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
device demo; both matter the day this stops being one.

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
  hard-crashes without it.
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

---

## `scanner/` — the RoomPlan accuracy instrument

⚠️ **Not yet compiled.** Written before Xcode existed on this machine. Ready-to-build, not
verified-to-build. There is no `.xcodeproj` yet; create one as an iOS App (SwiftUI, Swift, no
storage, no tests), add the four files from `scanner/MalletScanner/`, set
`NSCameraUsageDescription`, and set **Minimum Deployments → iOS 17.0**.

RoomPlan itself is iOS 16+, but `polygonCorners` is iOS 17 — and that is the whole point.
`dimensions` is a **bounding box**; every "RoomPlan only makes rectangles" complaint online is
self-inflicted by using it. The app computes wall area **both ways** and shows the percentage
between them, so the difference is visible on a real wall instead of theoretical. In a flat
room they should be close; in a **vaulted or sloped** room the bounding box should be visibly
larger, because it squares off the slope.

The Simulator cannot run this. No AR, no LiDAR — it must be an iPhone Pro (12 Pro or later) or
a LiDAR iPad Pro.

### The validation gate — do this before any more scanning work

**Ten real rooms, RoomPlan vs a tape measure.** Record error on wall length, wall height and
opening dimensions.

A tape is accurate to ~1/8″ over 15 ft. We are looking for 2% error, which on a 12 ft wall is
~3 inches — far larger than tape error, so a tape settles this.

Published RoomPlan accuracy spans *half an inch* to *37 cm on a 6.45 m wall*: a 30× spread with
zero peer-reviewed measurements. **Nobody has published this number.** Ours will be the real one.

- error **< 2%** → a scan can be the price basis
- error **> 2%** → a scan is a *draft* the estimator confirms, and confirm-and-edit becomes the
  core UX rather than a nicety

Either way we ship, but we design differently — so measure first.

Also try to break it deliberately: a blank white wall (this should trip RoomPlan's `lowTexture`
state — **LiDAR does not remove the blank-wall problem**), an unlit room, a room with a large
mirror, and a long scan to see whether it thermally throttles.

Two numbers on the results screen are **derived, not measured**, and are labelled as such in
the app: ceiling area (RoomPlan has no ceiling concept at all — `Surface.Category` has exactly
five cases, and deriving from the floor is wrong for exactly the vaulted rooms worth the most),
and baseboard run (subtracts door widths only, not cased openings).
