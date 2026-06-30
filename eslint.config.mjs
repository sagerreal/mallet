// Minimal flat config for T0.1. The real module-boundary rules
// (eslint-plugin-boundaries, max-lines-per-function, etc.) are added in T0.2.
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "shared/db/migrations/**",
      "next-env.d.ts",
    ],
  },
];
