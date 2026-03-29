import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      "@tomzydev/winkeymap/dist/index.json": "@tomzydev/winkeymap"
    }
  }
});
