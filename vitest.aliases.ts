import { resolve } from "node:path";

// Mirror the tsconfig path aliases (longest prefix first). Shared by the unit and integration
// vitest configs so they never drift.
export const malletAliases = (root: string): Array<{ find: RegExp; replacement: string }> => [
  // Not a tsconfig path — `server-only` is resolved by Next at build time and is not a dependency,
  // so without this any module carrying the guard is unimportable from a test. See the stub.
  { find: /^server-only$/, replacement: resolve(root, "shared/testing/server-only-stub.ts") },
  { find: /^@mallet\/shared\/(.*)$/, replacement: resolve(root, "shared/$1") },
  { find: /^@mallet\/platform\/(.*)$/, replacement: resolve(root, "platform/$1") },
  { find: /^@mallet\/workflows\/(.*)$/, replacement: resolve(root, "workflows/$1") },
  { find: /^@mallet\/(.*)$/, replacement: resolve(root, "modules/$1") },
  { find: /^@\/(.*)$/, replacement: resolve(root, "$1") },
];
