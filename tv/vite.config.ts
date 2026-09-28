import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 4317,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:3100", ws: true },
      "/api": { target: "http://127.0.0.1:3100" },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/pixi.js") || id.includes("node_modules/@pixi")) return "pixi";
          return undefined;
        },
      },
    },
  },
});
