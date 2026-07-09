import tseslint from "typescript-eslint";

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
      "lib/**/*.ts",
      "modules/**/*.ts",
      "shared/**/*.ts",
      "trpc/**/*.ts",
      "platform/**/*.ts",
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "features/**/*.{ts,tsx}",
    ],
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module" } },
    rules: {
      "no-restricted-imports": ["error", importBoundary],
      "no-console": "warn",
      "max-lines": ["warn", { max: 800, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", 15],
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
    files: ["**/*.test.ts", "**/*.int.test.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-console": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
];
