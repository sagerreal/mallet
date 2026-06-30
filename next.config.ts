import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Module boundaries are enforced by ESLint (see T0.2), not by separate packages — one deployable.
  reactStrictMode: true,
};

export default nextConfig;
