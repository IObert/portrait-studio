import path from "node:path";
import type { NextConfig } from "next";
import { loadRootEnv } from "./lib/load-env";

// One env file for the whole repo: /.env.local (see README).
loadRootEnv();

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // Trace from the monorepo root so pnpm's hoisted store is included.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
