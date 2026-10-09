import { defineConfig } from "vitest/config";

export default defineConfig({
  // Match Next.js server builds so `server-only` modules load in tests (as in the worker).
  resolve: { tsconfigPaths: true, conditions: ["react-server"] },
  ssr: { resolve: { conditions: ["react-server"] } },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    environment: "node",
  },
});
