import { defineConfig } from "vite";

export default defineConfig({
  base: "/companion/",
  server: {
    host: true,
    port: 4319,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:3100", ws: true },
      "/api": { target: "http://127.0.0.1:3100" },
      "/art": { target: "http://127.0.0.1:3100" },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
