import { build, context } from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * 打印格式原样抄自官方 esbuild-sample（vscode-extension-samples）。
 * .vscode/tasks.json 里 watch:extension 的内联 matcher 认的就是这两行标记
 * 和这个错误格式，改一边要改另一边。
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      }
      console.log("[watch] build finished");
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node20",
  // vscode 由宿主在运行时提供，不能打包进来
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  // watch 模式交给插件打印标记，把 esbuild 自己的原生日志静音，
  // 避免两路日志混在一起、且首轮和重建轮文案不一致，正则对不上。
  logLevel: watch ? "silent" : "info",
  plugins: watch ? [esbuildProblemMatcherPlugin] : [],
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
