import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), basicSsl()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "https://localhost:62626",
        secure: false,
      },
      "/assets/3d": {
        target: "https://localhost:62626",
        secure: false,
      },
      "/socket.io": {
        target: "https://localhost:62626",
        ws: true,
        secure: false,
      },
      "/novnc": {
        target: "https://localhost:62626",
        secure: false,
      },
      "/desktop/ws": {
        target: "https://localhost:62626",
        ws: true,
        secure: false,
      },
    },
  },
});
