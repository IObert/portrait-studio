import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts", "**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
    environment: "node",
  },
});
