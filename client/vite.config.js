import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
  plugins: [react()],
  // Load HEXCLAVE / VITE_* vars from the repo root .env (not only client/).
  envDir: rootDir,
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
});
