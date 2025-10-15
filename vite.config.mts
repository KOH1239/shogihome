/// <reference types="vitest" />
import { resolve } from "node:path";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { htmlTemplate } from "./plugins/html_template";

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: "/src" }],
  },
  plugins: [
    vue(),
    htmlTemplate({
      APP_VERSION: `${process.env.npm_package_version}`,
    }),
  ],
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        prompt: resolve(import.meta.dirname, "prompt.html"),
        monitor: resolve(import.meta.dirname, "monitor.html"),
        "layout-manager": resolve(import.meta.dirname, "layout-manager.html"),
      },
    },
    outDir: resolve(import.meta.dirname, "dist"),
    chunkSizeWarningLimit: 5000000,
  },
  server: {
    port: 5173,
    strictPort: true,
    // Development proxy to avoid CORS when calling local backend (e.g. FastAPI on :8081)
    proxy: {
      // Forward requests starting with /explain to the backend
      "/explain": {
        target: "http://localhost:8081",
        changeOrigin: true,
        secure: false,
      },
      "/stream_explain": {
        target: "http://localhost:8081",
        changeOrigin: true,
        secure: false,
      },
      // Optional: forward API namespace
      "/api": {
        target: "http://localhost:8081",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    dir: "./src/tests",
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
    coverage: {
      exclude: [
        "docs",
        "plugins",
        "scripts",
        "dist",
        "dev-dist",

        // テストコード
        "src/tests",

        // 設定ファイル
        "vite.config.mts",
        "vite.config-pwa.mts",
        "webpack.config.mjs",
        ".*.*",
        "**/*.d.ts",
        "**/*.vue",

        // 定義/設定
        "src/common/ipc/**/*.ts",
        "src/common/control/**/*.ts",
        "src/common/i18n/**/*.ts",
        "src/command/common/preload.ts",

        // IPC
        "src/renderer/ipc/api.ts",
        "src/renderer/ipc/bridge.ts",
        "src/renderer/ipc/preload.ts",
        "src/renderer/ipc/web.ts",
        "src/renderer/ipc/setup.ts",

        // UI/Window
        "src/background/index.ts",
        "src/background/window/ipc.ts",
        "src/background/window/main.ts",
        "src/background/window/menu.ts",
        "src/background/window/prompt.ts",
        "src/background/window/layout.ts",
        "src/renderer/index.ts",
        "src/renderer/assets/icons.ts",
        "src/renderer/devices/audio.ts",
        "src/renderer/devices/hotkey.ts",

        // コマンド
        "src/command/usi-csa-bridge/index.ts",
      ],
    },
  },
});
