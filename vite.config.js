import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env": {},
    global: "globalThis",
  },
  resolve: {
    alias: {
      buffer: "buffer",
    },
  },
  build: {
    outDir: "dist",
  },
});
