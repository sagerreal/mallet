# App Store submission — `shell/` (Mallet, `com.trymallet.app`)

Everything needed to archive, export and upload the iOS shell, plus the reasoning behind each
submission-facing setting so nobody has to re-derive it at 11pm the night before a review reply.

| | |
|---|---|
| App Store name | **Mallet** |
| Bundle id | `com.trymallet.app` |
| Team | `6SMLK52FUJ` — **Mallet Technologies, Inc** (organization account) |
| Version / build | `MARKETING_VERSION` 1.0 / `CURRENT_PROJECT_VERSION` 1 |
| Devices | iPhone only (`TARGETED_DEVICE_FAMILY = 1`) |
| Minimum OS | iOS 17.0 |
| Orientation | Portrait only |

---

## 1. Build and upload

### Prerequisites (once per machine)

```bash
cd shell
npm install          # npm, NOT pnpm — Package.swift hardcodes ../../../node_modules paths
npx cap sync ios     # regenerates ios/App/App/public/ + the generated capacitor.config.json
```

`cap sync` is required after **any** change under `shell/www/` (the offline screen lives there).
It never touches `Info.plist`, `App.xcodeproj`, or the plugin Swift files.

### Archive (verified working — this exact command produced `** ARCHIVE SUCCEEDED **`)

Run from the repo root:

```bash
xcodebuild -project shell/ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/Mallet.xcarchive \
  archive
```

There is no `.xcworkspace` — Capacitor 8 uses SwiftPM, not CocoaPods. `-scheme App` resolves to
the autocreated scheme; the other schemes in the project (`CapacitorHaptics`, `CapacitorKeyboard`,
`CapacitorSplashScreen`, `CapApp-SPM`) are dependency schemes and must not be archived.

The archive step signs with **Apple Development** and runs Xcode's own
`builtin-validationUtility -validate-for-store` on the bundle. Distribution re-signing happens in
the export step below — that is normal Xcode behaviour, not a misconfiguration.

### Export for the App Store

```bash
cat > build/ExportOptions-appstore.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>teamID</key>
	<string>6SMLK52FUJ</string>
	<key>uploadSymbols</key>
	<true/>
	<key>destination</key>
	<string>export</string>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath build/Mallet.xcarchive \
  -exportOptionsPlist build/ExportOptions-appstore.plist \
  -exportPath build/export \
  -allowProvisioningUpdates
```

**This step is currently blocked, and the blocker is a credential, not code:**

```
error: exportArchive No signing certificate "iOS Distribution" found
error: exportArchive No profiles for 'com.trymallet.app' were found
```

The only identity in the keychain is `Apple Development: Owen Duggan (M9Z94ZVZHL)`, and the only
profile is the wildcard `iOS Team Provisioning Profile: *` (development, expires 2027-07-27). An
**Apple Distribution** certificate plus an App Store provisioning profile for `com.trymallet.app`
have to be created once, signed in as the Account Holder — Xcode → Settings → Accounts → Manage
Certificates → **+ → Apple Distribution** (or let `-allowProvisioningUpdates` mint it after the
account is signed in to Xcode). That is deliberately a human step; it accepts agreements and
touches the developer account.

### Upload

Once the distribution certificate exists, either use Xcode's Organizer → Distribute App, or from
the CLI with an App Store Connect API key (no interactive password):

```bash
xcrun altool --upload-app \
  --type ios \
  --file build/export/App.ipa \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID"
```

The `.p8` key must sit at `~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8`.

### Every subsequent upload

`CURRENT_PROJECT_VERSION` must strictly increase per upload (`1` → `2` → …) even if
`MARKETING_VERSION` stays `1.0`. App Store Connect rejects a duplicate build number.

---

## 2. What each `Info.plist` key is for

`shell/ios/App/App/Info.plist` is hand-maintained — `cap sync` does not generate or overwrite it.

| Key | Value | Why it is there |
|---|---|---|
| `CFBundleDisplayName` | `Mallet` | The home-screen label. This is the only user-visible name in the binary; the App Store listing name is separate metadata in App Store Connect. |
| `CFBundleName` | `$(PRODUCT_NAME)` → `App` | **Do not "fix" this to Mallet.** `PRODUCT_NAME` also drives `PRODUCT_MODULE_NAME`, and `Main.storyboard` names the bridge controller as `customClass="MalletViewController" customModule="App"`. Renaming the product breaks that lookup and the app launches to a blank webview. `CFBundleDisplayName` is what users read. |
| `CFBundleShortVersionString` | `$(MARKETING_VERSION)` → `1.0` | Public version. |
| `CFBundleVersion` | `$(CURRENT_PROJECT_VERSION)` → `1` | Build number. Must increment per upload. |
| `ITSAppUsesNonExemptEncryption` | `false` | Export compliance. Asserts the app uses no non-exempt encryption, which stops App Store Connect asking the encryption question on every single upload. See §4. |
| `LSRequiresIPhoneOS` | `true` | Standard for an iOS app bundle. |
| `NSCameraUsageDescription` | "Mallet uses the camera and LiDAR sensor to measure rooms and to take job photos." | Required twice over: RoomPlan **hard-crashes** without it, and the webview's `<input type="file" accept="image/*" capture="environment">` job-photo pickers use the camera. |
| `NSMicrophoneUsageDescription` | "Mallet uses the microphone when you hold the mic button to dictate a question to the job copilot." | The field copilot's push-to-talk mic (`features/field-copilot/use-push-to-talk.ts` in `mallet-app`) uses WebKit speech recognition, which goes through `AVAudioSession` in the host app. |
| `NSSpeechRecognitionUsageDescription` | "Mallet turns your dictated question into text so the job copilot can answer it." | Same feature. WebKit's `SpeechRecognition` in a `WKWebView` is backed by `SFSpeechRecognizer`, which requires this key from the **embedding app** — a missing key is a crash or a hard `not-allowed`, not a graceful degrade. |
| `NSPhotoLibraryUsageDescription` | "Mallet attaches photos you pick from your library to jobs and quotes." | The same file inputs offer "Photo Library". Modern WebKit routes that through the out-of-process `PHPicker` (which needs no authorisation), so this is belt-and-braces — but the sentence is true of what a user actually does, and the alternative is discovering the exception in review. |
| `UILaunchStoryboardName` | `LaunchScreen` | Required: an app with no launch storyboard gets flagged, and this one is what stops the white flash (§5). |
| `UIMainStoryboardFile` | `Main` | Hosts `MalletViewController`, which is where the RoomPlan plugin registers itself. |
| `UIRequiredDeviceCapabilities` | `arm64` | Was the template's stale `armv7`, which describes a 32-bit binary this has never been. Every device that can run iOS 17 is arm64. **Do not add `arkit` or a LiDAR capability here** — non-Pro iPhones must still be able to install the app; the plugin answers `available: false` and the web hides the Scan-room button. |
| `UISupportedInterfaceOrientations` | Portrait | Capacitor reads orientation from `Info.plist` and ignores the web app's manifest. The CSS is phone-portrait-first. |
| `UIViewControllerBasedStatusBarAppearance` | `true` | Capacitor template default; the bridge controller owns the status bar. |
| `CAPACITOR_DEBUG` | `$(CAPACITOR_DEBUG)` | Set to `true` only by `shell/ios/debug.xcconfig`, which is the Debug configuration's base config. Release leaves it empty. |

### Deliberately absent usage strings

Adding a purpose string for an API the app cannot reach is noise; missing one for an API it *can*
reach is a crash. The line was drawn by auditing every native framework the binary links and every
browser API the hosted web app calls:

| Not declared | Why it is not reachable |
|---|---|
| `NSLocationWhenInUseUsageDescription` | No `navigator.geolocation` anywhere in `mallet-app`, and no `CoreLocation` in the shell or in `capture/`. If the web app ever adds geolocation, this key becomes mandatory — WebKit will silently deny the request without it. |
| `NSContactsUsageDescription` | No `Contacts` framework, no contact picker. |
| `NSFaceIDUsageDescription` | No `LocalAuthentication`, no WebAuthn/passkeys — auth is Supabase email/password. |
| `NSLocalNetworkUsageDescription` | No Bonjour/`NWBrowser`/`NetService`. Note: pointing `server.url` at a Mac LAN IP for local development *will* trigger the local-network prompt on device; that is a dev-only config that is never committed and never shipped. |
| `NSPhotoLibraryAddUsageDescription` | Nothing writes to the photo library. |
| `NSMotionUsageDescription` | ARKit/RoomPlan do not require it (that key is for `CMMotionActivity`/pedometer data). |
| Push notifications | No `@capacitor/push-notifications`, no service worker, no `Notification.requestPermission`. |

Installed Capacitor plugins are `@capacitor/haptics`, `@capacitor/keyboard`,
`@capacitor/splash-screen` — none of the three requires a usage description. The only other native
capability is `MalletRoomScan` (RoomPlan → camera, already covered).

One near-miss worth recording: the browser softphone (`lib/calls/browser-device.ts`) calls
`getUserMedia`, which would need the microphone string — but `browserCallingSupported()` returns
`false` on any `(pointer: coarse)` device on purpose, so it is unreachable from the phone. The
microphone string above is earned by push-to-talk, not by the softphone.

---

## 3. iPad: dropped for v1

`TARGETED_DEVICE_FAMILY` went from `"1,2"` to `"1"`; the now-dead
`UISupportedInterfaceOrientations~ipad` array was removed with it (it allowed landscape, which
nothing in the CSS is built for). The archived bundle's `UIDeviceFamily` is `[1]`.

Why: shipping iPad support obliges a full set of iPad screenshots *and* puts an untested iPad
layout in front of a reviewer, on a web app whose CSS is phone-portrait-first. Two ways to lose a
review, in exchange for a device nobody in the pilot uses.

Fully reversible: set the value back to `"1,2"`, restore the `~ipad` orientation array, and add
iPad screenshots. Nothing else in the project assumes either answer.

Expected leftover: the asset catalog still emits `AppIcon76x76@2x~ipad.png` and a
`CFBundleIcons~ipad` dictionary because the single 1024 icon uses the `universal` idiom (that is
the required shape for a modern one-size app icon). It is inert — `UIDeviceFamily` is what the App
Store filters on.

---

## 4. Export compliance: `ITSAppUsesNonExemptEncryption = false`

Verified before asserting it. The binary links Capacitor, Cordova (shim), and
`MalletCaptureCore`/`MalletCaptureRoomPlan`. Across `shell/ios/App/App/*.swift` and
`capture/MalletCapture/Sources/` there is no `CryptoKit`, no `CommonCrypto`, no `SecKey`/Keychain
use, no hand-rolled cipher — grep for those returns nothing. All encryption in play is the
platform's own HTTPS/TLS, used by `WKWebView` to load `https://app.trymallet.com`, which is exempt
under the standard "only uses encryption provided by the operating system" exemption.

If that ever stops being true (custom crypto, a bundled crypto library, proprietary key exchange),
this key must be removed and the encryption questionnaire answered honestly instead.

---

## 5. Launch and offline: what a reviewer sees

**Launch.** `LaunchScreen.storyboard` is a full-screen image view whose background is the literal
`#FCFBF7` (`red 0.98823 green 0.98431 blue 0.96862`, sRGB) — not `systemBackgroundColor`, which
renders black in dark mode. It shows `Splash.imageset`, verified as `#FCFBF7` (sampled corner =
`FCFBF7`) with the dark sparkle tile centred. `capacitor.config.json` sets
`ios.backgroundColor: "#FCFBF7"` and `MalletViewController` paints the view, webview, scroll view
and window the same cream, so launch → splash → web content is one continuous surface with no white
or black flash at any step.

**Offline.** `server.errorPath: "offline.html"` resolves to `shell/www/offline.html`, copied by
`cap sync` to `ios/App/App/public/offline.html` and verified present in the archived bundle. It is a
finished screen, not a stub: "No connection" / "Mallet needs a network connection to load. Check
your signal and try again." / a **Try again** button that is a same-frame `<a href>` (a
`window.open` or `target="_blank"` would be handed to Safari by Capacitor and never come back).
Tokens and plain CSS, system font only — there is no network in this state, so a webfont would
render as nothing.

It is light-only on purpose, and must stay that way: it is the only HTML surface behind the shell,
and a `prefers-color-scheme: dark` override would make a dark-mode phone launch cream and then flip
to near-black the instant this screen replaced the splash.

Known limit (unchanged, accepted): `errorPath` only fires on a **main-frame navigation** failure, so
this is a cold-start screen. There is no service worker, so losing signal mid-session still breaks
the SPA.

---

## 6. Guideline 4.2 (minimum functionality / "this is a web wrapper")

The defence is native LiDAR room capture, and it must not be weakened: `RoomScanPlugin.swift`
(`CAPPlugin`, jsName `MalletRoomScan`), `RoomScanViewController.swift` (hosts `RoomCaptureView`),
`MalletViewController.swift` (registers the plugin in `capacitorDidLoad()`), and the
`capture/MalletCapture` SwiftPM package it drives. This is the reason the app is on the App Store at
all rather than being a bookmark.

Wording for a Resolution Center reply:

> Mallet is not a repackaged website. The app performs LiDAR room measurement on device using
> Apple's RoomPlan framework: tapping "Scan room" presents a native, full-screen `RoomCaptureView`
> with our own capture coaching and Done/Cancel chrome, and the resulting `CapturedRoom` is
> processed entirely on device by our Swift package (`MalletCapture`) into wall, opening, floor and
> ceiling geometry that is then priced in the estimate. None of this is possible in a browser —
> RoomPlan has no web API, and it requires the LiDAR sensor and ARKit. Captures are also written to
> an on-device store first, so a scan survives losing the network or the app being killed mid-flow.
> The web content is the business record (customers, jobs, quotes, invoices) that the measurement
> feeds; the measurement itself is native and is the reason the app exists on iPhone.
>
> On an iPhone without LiDAR the app reports the capability as unavailable and hides the entry
> point, so the app installs and works on every supported device. To see the native capture flow,
> please review on an iPhone Pro (12 Pro or later).

Two facts to have ready if pushed: RoomPlan cannot run in the Simulator at all (no ARKit, no
LiDAR), and the scan pipeline is unit-tested on macOS through `MalletCaptureCore` independently of
the webview.

---

## 7. Still Owen's, by design — not automatable from here

Each of these accepts an agreement, enters credentials, or is judgement about the listing:

1. **Apple Distribution certificate + App Store provisioning profile** for `com.trymallet.app`
   (the §1 export blocker).
2. **App Store Connect app record** — name "Mallet", primary language, category (Business),
   bundle id `com.trymallet.app`.
3. **A demo account in App Review Notes.** This is the single most likely rejection after 4.2: the
   app opens straight into a login at `app.trymallet.com`, and a reviewer with no credentials sees a
   sign-in wall. Sign-up and password reset both leave the app via Mail → Safari, so "just make an
   account" is not a path a reviewer can take. Provide a working email/password on a seeded org.
4. **Screenshots** — iPhone sizes only (6.9" / 6.5" required), portrait, since the app is
   iPhone-only.
5. **App Privacy questionnaire** — the data the hosted app collects (customer names, addresses,
   phone numbers, photos, and room geometry) is declared there, not in this repo.
6. **Support URL / privacy policy URL** on `trymallet.com`.

---

## 8. Verification record (2026-08-03)

- `plutil -lint shell/ios/App/App/Info.plist` → OK.
- Archive: `** ARCHIVE SUCCEEDED **` with the §1 command; Xcode's `-validate-for-store` pass ran
  clean; signed `Apple Development: Owen Duggan (M9Z94ZVZHL)`, team `6SMLK52FUJ`, identifier
  `com.trymallet.app`.
- Archived bundle: `CFBundleDisplayName = Mallet`, `CFBundleShortVersionString = 1.0`,
  `CFBundleVersion = 1`, `MinimumOSVersion = 17.0`, `UIDeviceFamily = [1]`,
  `ITSAppUsesNonExemptEncryption = false`, all four `NS*UsageDescription` strings present,
  `public/offline.html` present.
- App icon `AppIcon-512@2x.png`: 1024×1024, PNG, 8-bit RGB **with no alpha channel**, sRGB, square
  with no baked rounded corners — a full-bleed near-black field with the cream sparkle. Passes every
  mechanical App Store icon rule. One caveat inherited from the README: it is a 2× upscale of
  `mallet-app/public/icon-512.png`, which is the largest source that exists in either repo. At 1:1
  the edges are clean (the mark is a smooth four-point star with no text), so this is an aesthetic
  nicety rather than a submission risk — a true 1024 export from the original design file would
  still be the better asset.
- Export for App Store: **fails**, `No signing certificate "iOS Distribution" found` — see §1.
