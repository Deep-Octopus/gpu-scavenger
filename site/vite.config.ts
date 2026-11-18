import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxy = { "/functions/v1/app": "http://127.0.0.1:8000" };

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    dedupe: ["react", "react-dom", "three", "@react-three/fiber", "@react-three/drei"],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "three",
      "three/examples/jsm/utils/BufferGeometryUtils.js",
      "@react-three/fiber",
      "@react-three/drei",
    ],
  },
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three") || id.includes("@react-three")) {
            return "vendor-three";
          }
          if (id.includes("node_modules/echarts") || id.includes("node_modules/zrender")) {
            return "vendor-echarts";
          }
          if (id.includes("@xyflow/react")) {
            return "vendor-xyflow";
          }
          if (id.includes("node_modules/gsap") || id.includes("node_modules/lenis")) {
            return "vendor-motion";
          }
        },
      },
    },
  },
});
