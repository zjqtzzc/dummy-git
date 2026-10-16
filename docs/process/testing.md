# 测试策略

## 1. 写什么

判据只有一条：**这条断言失败时，是不是真的坏了？** 不是的话别写。

- **扩展侧**：`git/`（进程、解析、命令）、`core/`、`ipc/`、`vscode/` 里不依赖 vscode API 的纯逻辑。
  要 git 的用真 git，不 mock。
- **webview**：`src/logic/**` 的纯逻辑（lint 保证它不 import vue，能在纯 node 下测）。Vue 组件只摆数据，不测。
- **一跑就能看出来的界面问题不写测试**（布局、对齐、点击有没有反应）：用户自己每次都会用最新构建，写了反而维护成本高。
  不做 VS Code 宿主里的冒烟测试。

## 2. 不做成测试的

- **性能数字**（骨架耗时、内存、事件延迟）：是测量不是断言，依赖机器，写成断言必然在别的环境上红。归 `tech/performance.md` 与 `scripts/demo-*.mjs`。
- **自我保护的编译期约束**：`switch` 穷尽性（漏写 `case` → `assertNever` 的参数不是 `never`）、禁 `as`（`check-assertions.mjs`）、
  架构边界（biome）。改坏了 `pnpm check` 立刻红，没有「被悄悄拿掉」这种状态。
- **给人看的叙述**：`demo-race` 打印的「不过队列一条失败且内容丢失 / 过队列两条都进历史」和真实耗时，价值是讲清楚为什么要有队列。

## 3. 需要反向测试的：约束藏在签名里

有的约束，机器只检查「调用方符不符合签名」，没有东西检查「签名有没有继续保持这个约束」：

| 约束 | 载体 | 放宽之后 |
|---|---|---|
| 读 stdin 的命令输入参数必填 | `commit.execute` 的 `message: string` | 改成可选，全部调用点照常编译，约束无声消失 |
| 协议表的封闭性（漏注册 / 多注册） | `defineHandlers` 的签名 | 放宽后多注册重新变成合法 |

做法是 `@ts-expect-error` 反向测试：它会因为「不再报错」而失败（TS2578）。现有两处：
`git/commands/__tests__/commandCompileChecks.ts`、`ipc/__tests__/protocolCompileChecks.ts`。
放在 `__tests__/` 下但不叫 `.test.ts`（没有运行时断言，叫了 vitest 会报「文件里没有测试」），由 `pnpm typecheck` 检查。

两条纪律：
1. **每行只能有一种错**：`@ts-expect-error` 抑制该行的所有错误，不区分是哪一个。要测的那一点之外，参数个数与类型都写对。
2. **必须做变异确认**：把对应机制临时放宽，确认对应那条变红、别的不变。字面量有 TypeScript 自带的多余属性检查兜底，
   所以测「多注册」必须传变量——否则它锁的是字面量检查，不是 `defineHandlers`。

## 4. 测试与 demo 的分工

| 问题 | 归属 |
|---|---|
| 这个行为对不对 | 测试 |
| 为什么这么设计、跑起来什么样、多快多大 | `scripts/demo-*.mjs`（手动跑） |

测试通过时保持沉默：`console.log` 打印的内容没有任何东西在检查它，上百个测试里一打印，「到底哪个红了」就被淹没。
要「断言 + 保留具体内容」用 `toMatchSnapshot()`。

现有 demo：`demo-parse`（不可见字符与解析结果）、`demo-errors`（stderr 带行号，第 1 行最没用、第 3 行才是关键）、
`demo-race`（队列的真实耗时）、`demo-watch`、`demo-watch-timing`（watcher 事件时序）。

## 5. 怎么跑

```bash
pnpm test                                    # 全量（输出同时存到 .tmp/test-results/last.log），目标 < 10 秒
pnpm test:old-git                            # 在 Ubuntu 20.04（git 2.25）的容器里跑全量，约 40 秒；动了 git 命令行就跑一次
pnpm test packages/extension/src/git/parsers # 只跑某个目录
npx vitest run path/to/foo.test.ts           # 只跑一个文件
npx vitest run -t "关键词"                    # 按用例名过滤
npx vitest                                   # watch 模式
```

`pnpm check` 跑全量，提交前必过。超过 10 秒就是信号：集成测试太多，或该共享的 fixture 没共享。

## 6. 怎么写

| 我的测试… | 用什么 | 例子 |
|---|---|---|
| 纯函数，给固定输入看输出 | 直接调用 | `scan.test.ts`、webview 的 `tree.test.ts` |
| 读一段已知的 git 历史（分支、冲突、签名提交…） | `fixtures.xxx`（只读） | `refs.test.ts` 读 `fixtures.tracking` |
| 要改动仓库才能验（提交、锁文件、钩子） | `makeTempRepo()` + `afterEach(cleanupTempRepos)` | `commit.test.ts` |
| 验时序（取消、排队、竞态） | 临时仓库上 `installSlowCommitHook()` 撑开窗口 | `cli.test.ts` 的取消测试 |

这些都在 `packages/extension/src/__tests__/support.ts`。**不要新建第二套 fixture 或 helper**，缺什么加在 `support.ts`。

**fixture 仓库**由 `scripts/fixture.mjs` 建（`base` / `conflict` / `detached` / `tracking` / `signed`），vitest 的 `globalSetup` 整轮建一次。
新场景先想办法塞进已有仓库的历史；真要新仓库，照 `buildSigned()` 的写法加一个 `buildXxx()` 并在文件头表格登记。
签名提交必须是真签名（`gpg.format=ssh`）：只设 `log.showSignature=true` 而没有签名提交，输出毫无变化，等于没测。

**位置与命名**：被测文件同目录下的 `__tests__/<模块>.test.ts`。测试里可以用 `as` 刻意造非法数据（`check-assertions.mjs` 豁免 `__tests__/`）。

```ts
import { describe, expect, it } from "vitest";
import { cli, fixtures } from "../../__tests__/support.js";
import { theThingUnderTest } from "../theThing.js";

describe("theThing：一句话说这组测试在验什么", () => {
  it("具体场景，不要写「it works」", () => {
    expect(theThingUnderTest(/* ... */)).toEqual(/* ... */);
  });
});
```

- `describe` / `it` 用中文写清楚**场景**：好的描述本身就是失败时的诊断信息。
- 用 `toEqual` / `toBe` 这类结构化断言，不用 `toBeTruthy()` 这类含糊断言。
