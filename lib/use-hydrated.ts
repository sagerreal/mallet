"use client";

import { useEffect, useState } from "react";

/**
 * True only once React has attached on the client.
 *
 * Exists to close a credential leak, not for cosmetics. Every auth form is a real
 * `<form>` whose `onSubmit` handler does not exist until hydration. Submit before
 * then and the browser performs its DEFAULT submission — and with no `method=`
 * that is a GET, so the password lands in the URL, the history entry, the
 * `Referer` header and every access log along the way.
 *
 * The window is not theoretical: measured 48 ms on fast wifi but **630 ms** on a
 * 4x-CPU-throttled phone over 1.5 Mbps — a mid-tier phone on LTE, which is the
 * actual fleet. The form is fully painted and looks ready for that whole time.
 *
 * Gate the submit control on this so the form cannot be submitted before it works.
 * Pair it with `method="post"` on the form as defence in depth: if a submission
 * somehow still escapes, a POST body keeps the password out of the URL.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
