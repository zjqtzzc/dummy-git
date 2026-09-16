import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    // 产物直接落到扩展包的 dist 下，由扩展以本地资源方式加载
    outDir: "../extension/dist/webview",
    emptyOutDir: true,
    target: "es2022",
  },
});
