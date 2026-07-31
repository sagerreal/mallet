import type { MetadataRoute } from "next";

/**
 * app/manifest.ts
 * The PWA web manifest — makes Mallet installable ("Add to Home Screen") and
 * open full-screen (standalone), no browser chrome. Next serves this at
 * /manifest.webmanifest and auto-links it. The same icons/theme are what the
 * Capacitor native shell will consume later. Warm Mallet palette.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Elas",
    short_name: "Elas",
    description: "AI-native operating system for service businesses.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FCFBF7",
    theme_color: "#FCFBF7",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
