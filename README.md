# Mallet Scanner — demo app

A one-screen iOS app that scans a room with RoomPlan and prints the measurements an estimator bids
from. It exists to prove four things on real hardware in one go:

1. The Apple Developer account, signing and provisioning work.
2. The device has LiDAR and RoomPlan runs on it.
3. The measurements we care about come out the other end.
4. **`polygonCorners` beats `dimensions`** — the screen shows both wall areas side by side and the
   percentage between them. That contrast is the reason this demo exists.

⚠️ **Not yet compiled.** These files were written before Xcode was installed, so they are
ready-to-build, not verified-to-build. Expect to fix a small thing or two on first compile.

---

## Setup (~10 minutes once Xcode is installed)

### 1. Install Xcode

Mac App Store → search **Xcode** → Install (~15 GB). Then open it once and accept the licence, and
point the command line at it:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version          # confirm
```

### 2. Create the project

Xcode → **File → New → Project… → iOS → App**

| Field | Value |
|---|---|
| Product Name | `MalletScanner` |
| Team | your Apple Developer team |
| Organization Identifier | `com.trymallet` |
| Bundle Identifier | `com.trymallet.scanner` *(auto-filled)* |
| Interface | **SwiftUI** |
| Language | **Swift** |
| Storage | None |
| Testing System | None (for now) |

Save it into `mallet-ios/` — **not** into a subfolder — so it sits beside the existing
`MalletScanner/` source directory.

### 3. Replace the generated sources

Xcode generates `MalletScannerApp.swift` and `ContentView.swift`. Delete both from the project
(**Move to Trash**), then drag these four files from `MalletScanner/` into the project navigator with
*Copy items if needed* unchecked and *Add to target: MalletScanner* checked:

- `MalletScannerApp.swift`
- `ContentView.swift`
- `RoomScanner.swift`
- `RoomMeasurements.swift`

### 4. Camera permission — the app crashes without this

Select the project → **Info** tab → add:

| Key | Value |
|---|---|
| `NSCameraUsageDescription` | `Mallet uses the camera and LiDAR sensor to measure rooms.` |

RoomPlan will hard-crash on launch of the scanner if this string is missing. It is not optional and
it is not a warning.

### 5. Deployment target

Set **Minimum Deployments → iOS 17.0**.

RoomPlan itself is iOS 16+, but `polygonCorners` — the thing that makes wall areas honest rather
than bounding boxes — is iOS 17. The code degrades gracefully to bounding boxes below 17, but there
is no reason to ship that.

### 6. Run on the phone

Plug in the iPhone Pro → select it as the run destination → **⌘R**.

First run will need:
- **Trust this computer** on the phone
- On the phone: **Settings → General → VPN & Device Management → trust your developer certificate**
- Xcode → Signing & Capabilities → **Automatically manage signing**, with your team selected

> The Simulator cannot run this. There is no AR and no LiDAR in the Simulator — it must be a real
> device.

---

## What to check on the first real scan

Scan a room you can also measure by hand. The demo is only useful if you compare it to a tape.

1. **Wall area (polygon) vs (bounding box)** — the "Difference" row. In a room with a flat ceiling
   these should be close. In a room with a **sloped or vaulted** ceiling, the bounding box should be
   visibly larger, because it squares off the slope. That is the whole `polygonCorners` argument,
   demonstrated on your own wall.
2. **Floor area vs a tape measure.** This is the number that decides the product. Published RoomPlan
   accuracy ranges from half an inch to 37 cm on a 6.45 m wall, and nobody has published a real
   figure. **Ours will be the real figure.**
3. **Openings.** Does it find every door and window? Does it merge a double door into one?
4. **Try to break it deliberately.** A blank white wall (this should trip RoomPlan's `lowTexture`
   state — LiDAR does *not* remove the blank-wall problem), an unlit room, a room with a big mirror,
   and a long scan to see whether it thermally throttles.

Record the results. Ten rooms against a laser is the validation gate before any more app work — it
decides whether a scan can be the price basis or only ever a draft the estimator confirms.

---

## What this is not

No upload, no auth, no Mallet API, no exterior scanning, no persistence. One screen, one scan, one
set of numbers on screen. Each of those is a later module and none of them should be started until
the accuracy question above is answered.
