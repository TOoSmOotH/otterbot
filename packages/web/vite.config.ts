import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/assets/3d": { target: API_TARGET, changeOrigin: true },
      "/socket.io": { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
});
