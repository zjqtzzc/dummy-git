import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

/**
 * 把 codicons 的样式表与字体原样放进产物。
 *
 * vscode-elements 的图标组件要在页面里找到 `id="vscode-codicon-stylesheet"` 的 `<link>`，
 * 再在自己的 Shadow DOM 里引用同一个样式表——字体进不了 Shadow DOM，只能这样。
 * 所以它必须是一个独立的文件（由 `vscode/webviewView.ts` 拼进 HTML），不能被打进 webview.css。
 * 只复制这两个文件，不复制整个 dist 目录。
 */
function codicons(): Plugin {
  const require = createRequire(import.meta.url);
  const dist = (name: string): string => require.resolve(`@vscode/codicons/dist/${name}`);
  return {
    name: "codicons",
    generateBundle() {
      for (const fileName of ["codicon.css", "codicon.ttf"]) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(dist(fileName)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    codicons(),
    vue({
      // `vscode-` 开头的是 vscode-elements 的自定义元素，交给浏览器，不当成 Vue 组件解析。
      template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("vscode-") } },
    }),
  ],
  // 产物里的资源地址写成相对路径。webview 里 `/` 指向的是 webview 的根，不是 dist/webview/——
  // 写成绝对路径时 CSS 里的字体（`url(/webview.woff)`）加载不到，图标一片空白。
  base: "./",
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
        // 固定名字之后，HTML 由 `vscode/webviewView.ts` 用 TypeScript 直接拼，
        // 顺带把 CSP 的 nonce 也一起塞进去——那是**改写别人生成的 HTML 做不干净**的事。
        entryFileNames: "webview.js",
        assetFileNames: "webview.[ext]",
      },
    },
  },
});
