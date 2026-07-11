import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom"],
  // Ensures frameworks like Next.js App Router treat the bundle as a
  // client-only module without consumers needing their own wrapper.
  banner: { js: '"use client";' },
})
