import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/api": {
        target: "http://localhost:8001",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (req.url?.includes("/stream")) {
              proxyReq.setHeader("Accept", "text/event-stream");
              proxyReq.setHeader("Cache-Control", "no-cache");
            }
          });
          proxy.on("proxyRes", (proxyRes, req) => {
            if (req.url?.includes("/stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["connection"] = "keep-alive";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});