/**
 * 「**这一条提交**改了哪些文件」的命令与解析。
 *
 * 与 `log.ts` 同样遵守「命令行与解析放在一个文件里」——每个命令行开关都对应
 * 解析上的一个前提，分开放两个文件，改一边忘了另一边就静默错位。
 *
 * ## 为什么不并进 `log.ts`
 *
 * 它确实也是一条 `git log`，但输出形状完全不同：没有记录分隔符、没有字段、
 * 就是一串 `状态\0路径\0` 平铺下来。`log.ts` 的 `splitRecords` / 字段数校验
 * 一个都用不上。唯一共用的是 `LOG_PREFIX`，直接 import 即可，没有复制常量的风险。
 *
 * ## 根提交也能列出文件
 *
 * 用 `diff <hash>^ <hash>` 取文件列表的话，根提交没有 `^`，命令直接失败，
 * 根提交就不显示变更文件。
 *
 * `git log --name-status` 不需要引用父提交——git 自己知道根提交要跟空树比。
 * 实测根提交正常输出 `A\0a.txt\0A\0b.txt\0`，**不需要 `--root`**
 * （`--root` 是给「走历史时把根提交的 diff 也打出来」用的，这里 `-1` 直接点名，用不上）。
 *
 * 少一个「取父提交」的步骤，就少了那一整类 bug ——它在结构上不可能发生。
 */

import { type CommitFileChange, FileStatus } from "@dummy-git/shared";
import { GitParseError } from "./errors.js";
import { LOG_PREFIX } from "./log.js";
import { decode, split } from "./scan.js";

const NUL = 0x00;

/**
 * 这些开关每一个都来自实测（git 2.43，`-m` 另在 2.25 上实测）：
 *
 * | 开关 | 不加会怎样 |
 * |---|---|
 * | `-c log.showSignature=false`（在 `LOG_PREFIX` 里） | 用户开了签名显示时，输出前多一行 `Good "git" signature for …`，第一个「状态」读到的是它 |
 * | `-1` | 会一路走历史，把祖先的文件也列出来 |
 * | `-M` | 用户设了 `diff.renames=false` 时，一次改名变成 `D` + `A` 两条，改名关系丢失 |
 * | `-m --first-parent` | **merge 提交的输出是空的**（git 默认不给 merge 出 diff），界面上点开一个合并提交、展开一条 stash（它也是 merge）什么都看不到 |
 * | `--format=` | 会带上默认的提交头（hash/作者/日期），混进文件列表 |
 *
 * `-M`、`-m`、`--first-parent` 对普通提交都没有副作用（实测输出一致）。
 *
 * 两个缺一不可：单有 `-m` 会对**每个父提交各输出一遍**；单有 `--first-parent`，
 * git 2.31 起才顺带给 merge 出相对第一父提交的 diff，更早的版本（如 2.25）照样输出空、退出码 0。
 */
export function commitFilesArgs(hash: string): string[] {
  return [
    ...LOG_PREFIX,
    "-1",
    "-M",
    "-m",
    "--first-parent",
    "--format=",
    "--name-status",
    "-z",
    hash,
  ];
}

/**
 * git 的状态字母 → 我们的类型。
 *
 * 表放在这里而不是 `shared/`：它是 git 输出格式到我们类型的映射，属于边界
 * （`CLAUDE.md` §B.3、§C.3）。`shared/change.ts` 里的 `FileStatus` 值是
 * `"modified"` 这样的词，不是 `"M"`——git 的 wire format 不进我们的类型定义。
 *
 * 不含 `.`（`Unchanged`）：`git status` 用它表示「这一侧没变」，
 * 而一条提交里的每个文件按定义都变了，出现它说明解析错位。
 */
const STATUS_BY_LETTER: Readonly<Record<string, FileStatus>> = {
  A: FileStatus.Added,
  C: FileStatus.Copied,
  D: FileStatus.Deleted,
  M: FileStatus.Modified,
  R: FileStatus.Renamed,
  T: FileStatus.TypeChanged,
};

/** `R` / `C` 后面跟相似度数字（`R100`、`C087`），且**多带一个路径**。 */
function hasOldPath(letter: string): boolean {
  return letter === "R" || letter === "C";
}

/**
 * 解析 `--name-status -z` 的输出。
 *
 * 格式（实测字节）：`状态\0路径\0` 平铺，改名是 `R100\0旧路径\0新路径\0`。
 * 非 ASCII 路径是**原始 UTF-8 字节，不转义**（进程层已强制 `core.quotepath=false`），
 * 路径里的空格也原样保留——所以只能按 `\0` 切，不能按空格切。
 *
 * `split` 保留末尾空段（`a\0b\0` 是三段，最后一段为空），
 * 空输出（merge 提交、或该提交没动文件）则是一个空段。两者都在这里终止循环。
 */
export function parseNameStatus(stdout: Buffer, hash: string): CommitFileChange[] {
  const tokens = split(stdout, NUL);
  const files: CommitFileChange[] = [];

  const fail = (detail: string, index: number): GitParseError =>
    new GitParseError({
      parser: "parseNameStatus",
      // 这里的「记录」就是第几段，比记录号更能定位——输出是平铺的，没有记录概念。
      recordIndex: index,
      detail: `${detail}（提交 ${hash}）`,
      buf: stdout,
      range: tokens[index] ?? { start: 0, end: stdout.length },
    });

  for (let i = 0; i < tokens.length; ) {
    const rawStatus = decode(stdout, tokens[i] as (typeof tokens)[number]);
    // 末尾空段，或整段输出为空（merge 提交默认无 diff）。
    if (rawStatus === "") break;

    const letter = rawStatus[0] as string;
    const status = STATUS_BY_LETTER[letter];
    if (status === undefined) throw fail(`未知的状态码 ${JSON.stringify(rawStatus)}`, i);

    const pathCount = hasOldPath(letter) ? 2 : 1;
    if (i + pathCount >= tokens.length) {
      throw fail(`状态 ${JSON.stringify(rawStatus)} 后面的路径不完整`, i);
    }

    if (pathCount === 2) {
      files.push({
        status,
        oldPath: decode(stdout, tokens[i + 1] as (typeof tokens)[number]),
        path: decode(stdout, tokens[i + 2] as (typeof tokens)[number]),
      });
    } else {
      files.push({ status, path: decode(stdout, tokens[i + 1] as (typeof tokens)[number]) });
    }

    i += pathCount + 1;
  }

  return files;
}
