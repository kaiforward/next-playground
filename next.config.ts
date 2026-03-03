import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Expose server-side UNIVERSE_SCALE to client bundles so tile grid math
    // (lib/engine/tiles.ts → lib/constants/universe-gen.ts) uses the same
    // MAP_SIZE on both sides. Without this, the client defaults to 7000
    // while the server may use 25000, causing tile coordinate mismatches.
    UNIVERSE_SCALE: process.env.UNIVERSE_SCALE,
  },
  // esbuild contains native binaries that Turbopack can't bundle.
  // It's only used at runtime by the tick engine to compile the worker.
  serverExternalPackages: ["esbuild"],
};

export default nextConfig;
