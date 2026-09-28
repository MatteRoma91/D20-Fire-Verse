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
  },
});
