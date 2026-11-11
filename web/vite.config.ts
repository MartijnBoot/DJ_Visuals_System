// The web app's build. `pnpm build` runs `vite build web` from the root; `pnpm dev` starts the
// dev server through Vite's JavaScript API in scripts/dev.ts, which adds the /api proxy there
// (plan PD9: this file reads no environment).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
