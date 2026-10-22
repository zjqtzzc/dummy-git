/**
 * doc-remind 的纯逻辑：给一个改过的文件，在文档里找可能要跟着改的行。
 * 读文档、跑 git、Hook 的输入输出都在 `../doc-remind.mjs`，这里只有字符串进、字符串出。
 *
 * 线索两类：
 *   1. 文档里提到这个文件路径的行（「改 `ui/ToolButton.vue` 前先读本文」这种，说明这篇文档管它）。
 *   2. 文档里提到这次删掉或改掉的名字的行：取 diff 里删掉的行（`-` 行）中、改完后不再出现在加上的行（`+` 行）里的名字，
 *      改名、删常量、换 git 参数之后，提到旧名字的文档不会报错，只会悄悄过时。
 *
 * 噪音比漏报更伤人：每改一个文件就刷一大片，很快就没人看了。所以下面的规则宁可漏一点。
 */

/** 每个文件最多列几行，多出的只报个数。 */
export const MAX_LINES = 20;

/**
 * 文档里像路径的一段：字母、数字与 `_.-*` 和 `/`。
 * 中文、反引号、括号、空格、顿号都会把它截断，所以不必先找反引号——表格、代码块里的路径也能找到。
 * `*` 要算进来：通配（`packages/extension/src/git/**`）得整段取出，否则剩下的 `packages/extension/src/git/`
 * 会被当成目录对上整层；整段取出后 `**` 按字面比，没有叫 `**` 的文件，自然对不上（见 `mentionsFile`）。
 */
const PATH_TOKEN = /[A-Za-z0-9_.*/-]+/g;

/**
 * 名字：驼峰（`startAutoFetch`）、帕斯卡（`PopupItem`）、全大写常量（`AUTO_FETCH_INTERVAL_MS`）。
 * 帕斯卡至少两段：只有一段的（`Fetch`、`Push`、`Commit`、`Ref`）同时是界面上的英文词，文档里到处都是。
 * 全大写必须带下划线：`HEAD`、`UTF` 这类缩写文档里也到处都是。
 * 前后不能紧挨着标识符字符，这就是「按词边界」：`PopupItemKind` 里不会找出 `PopupItem`。
 */
const NAME =
  /(?<![\w$])(?:[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?![\w$])/g;

/** git 参数（`--date-order`）。前后不能紧挨着 `-` 或字母：`--prune-tags` 里找不出 `--prune`，`fsmonitor--daemon` 里找不出 `--daemon`。 */
const FLAG = /(?<![\w-])--[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?![\w-])/g;

/**
 * 一段文字里的名字与 git 参数，去重。
 * diff 的删除行和文档的每一行用同一个函数切词，「文档提到这个名字」就是切出来的词相等，两边的边界规则天然一致。
 */
function namesIn(text) {
  return [...new Set([...text.matchAll(NAME), ...text.matchAll(FLAG)].map((m) => m[0]))];
}

/**
 * 一个文件的 diff（`git diff` 的输出）里，真正删掉或改掉的名字：在删掉的行里出现、在加上的行里没有再出现。
 *
 * 改动前后都还在的名字不算。只改了常量的值、函数多了个参数、import 换了顺序、一行被格式化成几行，
 * 名字都还在，文档里写的名字依然有效；这个文件本身被改过，第 1 类（提到它路径的文档）照样会列出来。
 * 不排除的话，`dummyGit`、`--all`、测试里的 `toEqual` 这类到处都有的名字，每改一行就冒一次。
 * 加上的行看整个 diff 而不只是同一段：挪到别处的行（删在一段、加在另一段）也是「还在」。
 *
 * 第一个 `@@` 之前是文件头：`--- a/<路径>` 与 `+++ b/<路径>` 也以 `-`、`+` 开头，
 * 不跳过的话路径里的 `autoFetch` 会被当成删掉的名字。
 */
export function deletedNames(diff) {
  const removed = new Set();
  const added = new Set();
  let inHunk = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (inHunk && line.startsWith("-"))
      for (const name of namesIn(line.slice(1))) removed.add(name);
    else if (inHunk && line.startsWith("+"))
      for (const name of namesIn(line.slice(1))) added.add(name);
  }
  return new Set([...removed].filter((name) => !added.has(name)));
}

/** 文档一行里像路径的写法，去掉开头的 `./`、`../` 与句末的 `.`。 */
export function pathTokens(line) {
  const tokens = (line.match(PATH_TOKEN) ?? []).map((raw) =>
    raw.replace(/^(?:\.\.?\/)+/, "").replace(/\.+$/, ""),
  );
  return [...new Set(tokens)].filter((t) => t !== "");
}

/**
 * 文档里的一个路径写法 `token` 是不是在说 `file`（相对仓库根、用 `/` 分隔）。
 * `basenameCounts` 是仓库里每个文件名出现的次数，只用来判断光写文件名时有没有歧义。
 *
 * 文档的写法不统一：`packages/extension/src/core/autoFetch.ts`、`core/autoFetch.ts`、`refLabels.ts`、
 * 目录 `webview/src/log/`。统一按「路径段」比，不按字符串比，`log/` 不会对上 `dialog/`。
 *
 *   - 文件：写法的各段是 `file` 末尾的那几段。`core/autoFetch.ts` 对上 `packages/extension/src/core/autoFetch.ts`。
 *     不是路径的（`origin/main`、`webview/context`）不必另外排除：没有哪个文件以这几段结尾。
 *   - 只写文件名：仓库里只有这一个同名文件才算。`operation.ts` 有好几个，文档说的是哪个只有上下文知道。
 *     文档里的普通英文词也走这条，没有同名文件就对不上。在说参照项目里同名文件的（VS Code 的 `repository.ts`），这种误报认了。
 *   - 目录（以 `/` 结尾）：写法的各段连续出现在 `file` 所在的目录里，且至少两段。
 *     只有一段的（`core/`、`ipc/`、`ui/`、`tree/`）是在说一整层：`CLAUDE.md` 的架构边界、测试策略都这么写，
 *     算进来的话改这一层的任何文件都会冒出来；而且同名目录不止一处（`webview/src/tree/` 与 `logic/tree/`）。
 *     管具体代码的文档会写到第二段（`logic/tree/`、`webview/src/log/`），漏的只是泛泛提到的那些。
 *   - 带 `*` 的是通配（`packages/webview/src/logic/**`、`scripts/demo-*.mjs`）：说的是一类文件或整层的规则，同样不算。
 *     不用专门判断：`*` 按字面和路径段比，永远对不上。
 */
export function mentionsFile(token, file, basenameCounts) {
  const want = token.split("/").filter((s) => s !== "");
  const have = file.split("/");
  if (token.endsWith("/")) {
    if (want.length < 2) return false;
    const dirs = have.slice(0, -1);
    for (let start = 0; start + want.length <= dirs.length; start++) {
      if (want.every((seg, k) => seg === dirs[start + k])) return true;
    }
    return false;
  }
  if (want.length === 1) return want[0] === have.at(-1) && basenameCounts.get(want[0]) === 1;
  if (want.length === 0 || want.length > have.length) return false;
  const offset = have.length - want.length;
  return want.every((seg, k) => seg === have[offset + k]);
}

/**
 * `file` 的线索：`docs` 是 `{ path, lines }` 的列表（按想要的顺序排好），`deleted` 是 `deletedNames` 的结果。
 * 每个文档行至多一条，`mentions` 列出这一行提到的路径写法与名字。
 * 提到路径的排在前面：那是「这篇文档管这个文件」，比「碰巧提到同一个名字」更要紧，截断时先保住它们。
 */
export function findClues(file, deleted, docs, basenameCounts) {
  const clues = [];
  for (const doc of docs) {
    doc.lines.forEach((text, index) => {
      const paths = pathTokens(text).filter((t) => mentionsFile(t, file, basenameCounts));
      const names = namesIn(text).filter((n) => deleted.has(n));
      if (paths.length + names.length === 0) return;
      clues.push({
        doc: doc.path,
        line: index + 1,
        mentions: [...paths, ...names],
        governs: paths.length > 0,
      });
    });
  }
  // sort 是稳定的：同一类里保持文档与行号的顺序。
  return clues.sort((a, b) => Number(b.governs) - Number(a.governs));
}

/**
 * 给人、也给会话看的文字；没有线索时是空串。
 * 一律写成陈述句：Hook 的输出会进会话上下文，命令式的文字可能被当成指令。
 */
export function formatClues(file, clues) {
  if (clues.length === 0) return "";
  const shown = clues
    .slice(0, MAX_LINES)
    .map((c) => `${c.doc}:${c.line} 提到 ${c.mentions.join("、")}`);
  const rest = clues.length - shown.length;
  return [
    `以下文档提到了 ${file} 或其中删改的名字，可能需要一起改：`,
    ...shown,
    ...(rest > 0 ? [`还有 ${rest} 处`] : []),
  ].join("\n");
}
