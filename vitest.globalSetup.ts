import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 整轮测试开始前，把 fixture 仓库建一次。
 *
 * ## 为什么共享而不是每个测试自己建
 *
 * 建 5 个仓库约 0.5 秒。几十个测试各建一次就是几十秒，
 * 而全量 `pnpm test` 的预算是 10 秒（见 `.notes/design/testing.md` §4.4）。
 * 这些仓库**只读**，共享是安全的；需要写的测试用 `makeTempRepo()` 自建（见 support.ts）。
 *
 * ## 为什么用固定路径而不是 vitest 的 provide/inject
 *
 * 测试进程可能跑在独立的 worker 里，`process.env` 不保证传得过去。
 * 固定路径让 setup 侧和测试侧各自算出同一个位置，不需要任何跨进程传递。
 */
const root = dirname(fileURLToPath(import.meta.url));
export const fixturesRoot = join(root, ".fixtures-test");

export default function setup(): () => void {
  rmSync(fixturesRoot, { recursive: true, force: true });
  execFileSync("node", [join(root, "scripts/fixture.mjs"), fixturesRoot], { stdio: "pipe" });

  return () => {
    rmSync(fixturesRoot, { recursive: true, force: true });
  };
}
