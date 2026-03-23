import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ["buffer"],
      globals: { Buffer: true },
    }),
  ],
  define: {
    "process.env": {},
  },
  build: {
    outDir: "dist",
  },
});
