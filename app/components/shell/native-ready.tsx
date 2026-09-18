"use client";

/**
 * components/shell/native-ready.tsx
 * Tells the native shell the web app is up, so the launch screen can go away the
 * moment there is something to look at.
 *
 * The shell previously used `launchAutoHide: true` with `launchShowDuration: 1500` —
 * a TIMED splash. Apple's HIG asks for the launch screen to be replaced as soon as
 * the app is ready, and a fixed 1.5s means a fast launch waits for nothing while a
 * slow one still flashes through to a half-built page.
 *
 * The auto-hide DELIBERATELY stays as a backstop. If this call never happens — the
 * web app fails to load, or an older bundle is cached — the splash must not become a
 * permanent white screen with no way out. So the shell's duration is now a ceiling
 * and this is the normal path.
 *
 * Renders nothing; a no-op in any browser.
 */

import { useEffect } from "react";
import { attempt } from "@/lib/native-bridge";

interface SplashScreenBridge {
  hide?: (options?: { fadeOutDuration?: number }) => Promise<void>;
}

export function NativeReady() {
  useEffect(() => {
    // A short fade rather than a hard cut, so the launch colour dissolves into the
    // app instead of blinking. Both are #FCFBF7, so this reads as one surface.
    attempt<SplashScreenBridge>("SplashScreen", (p) => p.hide?.({ fadeOutDuration: 200 }));
  }, []);
  return null;
}
