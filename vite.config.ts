import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  build: {
    outDir: "dist/client",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/u,
              priority: 20,
            },
            {
              name: "ui-vendor",
              test: /node_modules[\\/]/u,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    allowedHosts: ["terminal.local"],
  },
  plugins: [react()],
});
