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
  experimental: {
    // Frame/background uploads go through Server Actions (up to 20 MB, SPEC §8).
    serverActions: { bodySizeLimit: "25mb" },
    // The proxy buffers bodies on /admin; match the upload limit.
    proxyClientMaxBodySize: "25mb",
  },
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
