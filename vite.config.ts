import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative, so the built app works from any path, such as GitHub Pages' /<repo>/.
  base: "./",
  worker: { format: "es" },
  optimizeDeps: { exclude: ["replicad-opencascadejs"] },
});
