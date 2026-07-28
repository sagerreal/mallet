import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, Space_Grotesk, Space_Mono } from "next/font/google";
import { TrpcProvider } from "@/lib/trpc/provider";
import "./globals.css";
import "./prototype.css";
import { NativeReady } from "@/components/shell/native-ready";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
});

export const metadata: Metadata = {
  title: "Mallet",
  description: "AI-native operating system for service businesses.",
  applicationName: "Mallet",
  // Launch full-screen (no Safari chrome) when added to the iPhone home screen.
  appleWebApp: {
    capable: true,
    title: "Mallet",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-icon.png",
  },
};

// Edge-to-edge on notched phones (Capacitor/iOS) — CSS uses env(safe-area-inset-*)
// to keep the topbar/tab-bar clear of the notch + home indicator.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // When the on-screen keyboard opens, shrink the LAYOUT viewport rather than only
  // sliding the visual one. Without this the page keeps its full height behind the
  // keyboard, so `position:fixed` bottom chrome — #mobiletabs and the .cmdline Ask
  // Mallet bar at bottom:60px — stays pinned underneath it and the focused field can
  // end up hidden. The native shell gets this from Capacitor's Keyboard
  // resize:"native"; this is the same behaviour for mobile web, which had nothing.
  interactiveWidget: "resizes-content",
  themeColor: "#FCFBF7",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <head>
        {/* Resolves stored-choice-or-system onto data-theme BEFORE first paint. A React
            effect runs after paint, which is exactly the cream flash this avoids on a
            system-dark phone. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NativeReady />
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
