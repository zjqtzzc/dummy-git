import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    environment: "node",
    // 整轮建一次 fixture 仓库，见该文件里的说明
    globalSetup: ["./vitest.globalSetup.ts"],
    // 集成测试要起 git 子进程，默认 5s 在冷缓存下不够
    testTimeout: 20_000,
  },
});
