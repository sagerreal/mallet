# Android — Play Store submission runbook

Companion to [app-store-submission.md](app-store-submission.md). The Android shell is the
same Capacitor wrapper as iOS (`shell/android/`), pointed at the same
`https://app.trymallet.com`. This doc is everything between "the debug APK builds" and
"Owen's phone installs it from the Play Store", including the parts only a human with the
Play Console login can do.

---

## OWEN CHECKLIST — in order

1. **Play Console developer account — $25 one-time.** <https://play.google.com/console/signup>.
   Two account types, and the choice matters:
   - **Organization account** (recommended): needs the legal entity + a D-U-N-S number.
     The Atlas incorporation gives you both once it lands. Org accounts publish to
     production directly.
   - **Personal account**: instant, but personal accounts created after Nov 2023 must run a
     **closed test with at least 12 testers continuously for 14 days** before Google will
     accept a production release. Fine if the near-term goal is just "Mallet on my/techs'
     phones via internal testing" (internal testing has no such gate, 100 testers max) —
     but plan the org account before any public launch.

2. **Create the upload keystore** (one time, on your Mac — do NOT regenerate later; losing
   it is recoverable only because Play App Signing holds the real key):

   ```bash
   keytool -genkeypair -v \
     -keystore ~/mallet-upload.keystore \
     -alias mallet-upload \
     -keyalg RSA -keysize 2048 -validity 10000 \
     -dname "CN=Mallet, O=Mallet, C=US"
   ```

   It prompts for a keystore password — put the password and the file in your password
   manager. This key only signs *uploads*; Google re-signs what users download.

3. **Enroll in Play App Signing** (default for new apps — just accept it when creating the
   app in the Console). Google mints the real app-signing key; the keystore from step 2 is
   registered as the upload key on your first upload.

4. **Build and upload the first release** (internal testing track first):

   ```bash
   cd shell/android
   JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
   ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
   ./gradlew bundleRelease
   ```

   then sign the AAB with the upload key — either add a `signingConfigs.release` block to
   `app/build.gradle` reading the keystore path/password from `~/.gradle/gradle.properties`
   (never commit credentials), or sign the bundle manually:

   ```bash
   jarsigner -keystore ~/mallet-upload.keystore \
     app/build/outputs/bundle/release/app-release.aab mallet-upload
   ```

   Upload `app-release.aab` at Play Console → Testing → Internal testing → Create release.

5. **assetlinks.json — the deep-link half that lives in the WEB repo, not this one.**
   The manifest declares App Links for `/i/<token>` and `/q/<token>`, but Android only
   auto-opens them once `https://app.trymallet.com/.well-known/assetlinks.json` exists.
   In `mallet-app`, add `public/.well-known/assetlinks.json`:

   ```json
   [
     {
       "relation": ["delegate_permission/common.handle_all_urls"],
       "target": {
         "namespace": "android_app",
         "package_name": "com.trymallet.app",
         "sha256_cert_fingerprints": [
           "<PLAY-APP-SIGNING-KEY-SHA256>",
           "<DEBUG-CERT-SHA256>"
         ]
       }
     }
   ]
   ```

   - `<PLAY-APP-SIGNING-KEY-SHA256>`: Play Console → Setup → App signing → App signing key
     certificate → SHA-256 (available only after step 3/4). This is the one that matters
     for store installs.
   - `<DEBUG-CERT-SHA256>` (so side-loaded debug builds verify too):

     ```bash
     keytool -list -v -keystore ~/.android/debug.keystore \
       -alias androiddebugkey -storepass android | grep 'SHA256:'
     ```

   - Next.js serves anything in `public/` verbatim; `/.well-known/assetlinks.json` must
     return 200 with `Content-Type: application/json`, no redirect. Verify with
     <https://developers.google.com/digital-asset-links/tools/generator>.
   - Until this file ships, tapped links fall back to the browser/app chooser — nothing
     breaks, App Links just aren't automatic.

6. **Data safety form** (Play Console → App content). Honest answers for the shell:
   collects account identifiers (email), customer names/addresses/phone numbers, photos
   (job photos), and financial/payment data (invoices; card payments run through Stripe) —
   all collected, not shared, encrypted in transit, deletable on request. No location, no
   ads, no third-party data sale.

7. **Privacy policy URL** — required before any release, even internal testing review.
   Publish one on trymallet.com (e.g. `https://trymallet.com/privacy`) and paste the URL in
   App content → Privacy policy.

8. **Store listing minimums** (needed before the release goes live even on closed tracks'
   review): app name, short + full description, the 512×1024… assets — concretely: 512×512
   icon (already have: `shell/assets/icon-only.png` is 1024, export at 512), a 1024×500
   feature graphic, and at least 2 phone screenshots. Plus content-rating questionnaire and
   target-audience declaration (18+, business tool).

9. **Add testers** to the internal testing track (email list), send them the opt-in link.
   `adb install app-debug.apk` works for your own phone without any of the above.

---

## What the Android release does NOT include (deliberate)

- **Room scan / LiDAR** — skipped on Android by decision (no LiDAR on the vast majority of
  Android hardware; ARCore Depth is a different, worse instrument). The web app gates the
  scan entry point on `roomScanAvailable()`, which is `false` when the `MalletRoomScan`
  plugin is absent — so on Android the scan button simply never renders. No dead button,
  no error state, nothing to configure.
- **Tap to Pay** — the plugin does not exist on either platform yet.
- **Push notifications** — iOS doesn't register a push plugin, so Android doesn't either.
  Plugin parity is exact: Haptics, Keyboard, SplashScreen.

## Signing model recap

| Key | Where it lives | Signs what |
|---|---|---|
| Debug key | `~/.android/debug.keystore` (auto-generated) | `assembleDebug` APKs, side-loads |
| Upload key | `~/mallet-upload.keystore` (step 2 — back it up) | AABs you upload to Play |
| App signing key | Google's HSM (Play App Signing) | What users actually install |

The app signing key's SHA-256 — not the upload key's — is the one `assetlinks.json` needs
for store installs.
