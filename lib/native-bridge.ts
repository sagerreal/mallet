"use client";

/**
 * lib/native-bridge.ts
 * The one way this web app reaches a native Capacitor plugin, and the one place that
 * knows the bridge might not be there.
 *
 * The native shell loads this app over `server.url`, and Capacitor injects the bridge
 * with a `WKUserScript` scoped to the WEBVIEW rather than to an origin — so
 * `window.Capacitor.Plugins.X` is already present and callable without shipping
 * `@capacitor/core` to every browser user. See mallet-ios/README.md.
 *
 * Everything here is BEST EFFORT by design. On the web there is no bridge; on a device
 * a plugin can reject because the user turned the capability off. Neither is an error
 * this app can act on, so `attempt` swallows both. That is the documented exception to
 * the no-silent-failures rule: it applies to work that was supposed to happen, not to
 * a capability that does not exist. Anything whose FAILURE MATTERS must not use this.
 */

type PluginMap = Record<string, Record<string, (...args: never[]) => Promise<unknown>> | undefined>;
type MaybeCapacitor = { Capacitor?: { Plugins?: PluginMap } };

/** True when running inside the native shell. */
export function isNativeShell(): boolean {
  return typeof window !== "undefined" && !!(window as unknown as MaybeCapacitor).Capacitor?.Plugins;
}

/** A named native plugin, or null on the web / before the bridge is injected. */
export function nativePlugin<T>(name: string): T | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as MaybeCapacitor).Capacitor?.Plugins?.[name] as T | undefined) ?? null;
}

/**
 * Call a native plugin and forget about it. Never throws, never rejects: a missing
 * bridge, a missing plugin, a synchronous throw and an async rejection all resolve to
 * "nothing happened".
 */
export function attempt<T>(name: string, call: (plugin: T) => Promise<unknown> | undefined): void {
  const plugin = nativePlugin<T>(name);
  if (!plugin) return;
  try {
    void Promise.resolve(call(plugin)).catch(() => {});
  } catch {
    /* a bridge that throws synchronously is still just an absent capability */
  }
}
