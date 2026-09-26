import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "client",
  publicDir: "public",
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8790",
      "/llms.txt": "http://localhost:8790",
      "/logo": "http://localhost:8790",
    },
  },
});
