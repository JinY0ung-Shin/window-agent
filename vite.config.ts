import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");

          if (!normalized.includes("/node_modules/")) {
            return undefined;
          }

          if (
            normalized.includes("/node_modules/react/") ||
            normalized.includes("/node_modules/react-dom/") ||
            normalized.includes("/node_modules/scheduler/")
          ) {
            return "vendor-react";
          }

          if (
            normalized.includes("/node_modules/react-markdown/") ||
            normalized.includes("/node_modules/remark-gfm/") ||
            normalized.includes("/node_modules/rehype-highlight/") ||
            normalized.includes("/node_modules/unified/") ||
            normalized.includes("/node_modules/mdast-util-") ||
            normalized.includes("/node_modules/micromark") ||
            normalized.includes("/node_modules/hast-util-") ||
            normalized.includes("/node_modules/remark-") ||
            normalized.includes("/node_modules/rehype-")
          ) {
            return "vendor-markdown";
          }

          if (normalized.includes("/node_modules/d3-")) {
            return "vendor-d3";
          }

          if (
            normalized.includes("/node_modules/i18next/") ||
            normalized.includes("/node_modules/react-i18next/")
          ) {
            return "vendor-i18n";
          }

          if (normalized.includes("/node_modules/@tauri-apps/")) {
            return "vendor-tauri";
          }

          if (normalized.includes("/node_modules/lucide-react/")) {
            return "vendor-icons";
          }

          return "vendor";
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
