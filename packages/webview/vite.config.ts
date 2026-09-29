import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  build: {
    // 产物直接落到扩展包的 dist 下，由扩展以本地资源方式加载。
    outDir: "../extension/dist/webview",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      output: {
        // **固定文件名，不带内容 hash。**
        //
        // hash 是给 HTTP 缓存用的：文件名一变，浏览器就不会用旧缓存。
        // 而 webview 从磁盘按 `vscode-resource:` URI 加载，缓存由 VSCode 管，
        // 我们自己拼 URI——hash 在这里不解决任何问题，只带来一个麻烦：
        // 扩展侧得去解析 vite 生成的 index.html 才知道文件叫什么。
        //
        // 固定名字之后，HTML 由 `vscode/panel.ts` 用 TypeScript 直接拼，
        // 顺带把 CSP 的 nonce 也一起塞进去——那是**改写别人生成的 HTML 做不干净**的事。
        entryFileNames: "webview.js",
        assetFileNames: "webview.[ext]",
      },
    },
  },
});
