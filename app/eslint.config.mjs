import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import ui from "./eslint-rules/index.mjs";

// Architectural boundary: a module's internals (domain/app/infra/api) are private. Other code
// imports a module ONLY through its index barrel (@mallet/<module>). Intra-module files use
// relative paths and are unaffected; @mallet/shared/* and @/trpc/* stay open by design.
const importBoundary = {
  patterns: [
    {
      group: ["@mallet/*/domain/*", "@mallet/*/app/*", "@mallet/*/infra/*", "@mallet/*/api/*"],
      message: "Import a module only through its index (@mallet/<module>), not its internals.",
    },
  ],
};

export default [
  {
    ignores: [
      ".next/**",
      ".claude/**",
      "node_modules/**",
      "coverage/**",
      "shared/db/migrations/**",
      "next-env.d.ts",
    ],
  },
  {
    files: [
      "lib/**/*.{ts,tsx}",
      "modules/**/*.ts",
      "shared/**/*.ts",
      "trpc/**/*.ts",
      "platform/**/*.ts",
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "features/**/*.{ts,tsx}",
    ],
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module" } },
    plugins: { ui },
    rules: {
      "no-restricted-imports": ["error", importBoundary],
      "no-console": "warn",
      "max-lines": ["warn", { max: 800, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", 15],
      // Design-system locks (eslint-rules/). no-raw-style is at 0 → ERROR (a stray
      // `fontSize: 13` now fails CI, locking the token discipline). The other two
      // still carry adoption debt (bare fields, ad-hoc cards) → WARN until cleared.
      "ui/no-raw-style": "error",
      "ui/no-adhoc-card": "warn",
      "ui/no-bare-field": "warn",
    },
  },
  {
    // THE HOOK-ORDER GATE. Every page and modal in this app is a client component reading a
    // Zustand store, and `setJobs`/`setLeads` REPLACE their collections — so a by-id selector
    // going undefined mid-session is an ordinary event, not an edge case. A hook declared below
    // the `if (!x) return null` guard that follows it changes the hook COUNT when that happens,
    // and React answers by throwing "Rendered fewer hooks than expected" and rebuilding the tree:
    // on screen it is a sheet that blinks and comes back, and a tap that appears to do nothing.
    // It cost a live-testing session to find one instance by hand (tech-job-modal). ERROR, so the
    // next one costs a lint run instead.
    //
    // exhaustive-deps stays a WARNING: it carries a small adoption debt (10 at time of writing)
    // and its failure mode is a stale closure, not a crash.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "features/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module", ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Static accessibility gate on the JSX surfaces (complements the runtime axe net).
    files: ["app/**/*.tsx", "components/**/*.tsx", "features/**/*.tsx", "lib/**/*.tsx"],
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module", ecmaFeatures: { jsx: true } } },
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // These static rules conflict with the app's VERIFIED-accessible patterns —
      // the runtime axe net (0 violations / 25 routes, enforcing) is the accurate
      // gate for them here, and it sees what jsx-a11y's static pass can't:
      //   .rowopen — a clickable row keeps its mouse onClick but delegates keyboard
      //     access to a focusable child <button> (axe confirms it's operable);
      //   .field — label + control as siblings, associated by the container;
      //   autoFocus — a deliberate first-field focus when a modal opens.
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/no-autofocus": "off",
    },
  },
  {
    // tRPC router factories are a declarative list of thin procedures, not one imperative
    // function — the per-procedure resolvers are what must stay small (and do). The aggregate
    // length rule doesn't fit them.
    files: ["modules/**/api/*-router.ts"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    // Tests legitimately reach into module internals and run long; relax the gates there.
    files: ["**/*.test.{ts,tsx}", "**/*.int.test.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-console": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
];
