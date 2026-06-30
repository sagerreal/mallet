import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    // Mirror the tsconfig path aliases (longest prefix first).
    alias: [
      { find: /^@mallet\/shared\/(.*)$/, replacement: resolve(root, "shared/$1") },
      { find: /^@mallet\/platform\/(.*)$/, replacement: resolve(root, "platform/$1") },
      { find: /^@mallet\/workflows\/(.*)$/, replacement: resolve(root, "workflows/$1") },
      { find: /^@mallet\/(.*)$/, replacement: resolve(root, "modules/$1") },
      { find: /^@\/(.*)$/, replacement: resolve(root, "$1") },
    ],
  },
});
